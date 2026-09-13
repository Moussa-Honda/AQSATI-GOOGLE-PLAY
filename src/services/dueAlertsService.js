import { Capacitor } from '@capacitor/core';
import { installmentService, settingsService } from './database';
import { webPushService } from './webPushService';

// ============================================================
// تنبيهات العملاء المتأخرين / المستحقين اليوم
// يعمل على: PWA أندرويد (Chrome) + PWA سفاري iOS 16.4+ + تطبيق Capacitor
// يعتمد على Web Push مع Cloudflare Worker حتى تصل التنبيهات والتطبيق مغلقاً.
// ============================================================

const ENABLED_SETTING_KEY = 'due_alerts_enabled';
const LAST_SENT_STORAGE_KEY = 'fazatak_due_alerts_last_sent';
const NOTIFICATION_TAG = 'fazatak-due-alerts';

const toMoney = (value) => Math.round(Number(value || 0)).toLocaleString('en-US');

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

const isIOS = () => (
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
);

const isStandalone = () => {
  if (typeof window === 'undefined') return false;
  if (window.navigator?.standalone === true) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches;
  } catch {
    return false;
  }
};

const isSupported = () => {
  if (isNative()) return true;
  return typeof window !== 'undefined' && 'Notification' in window;
};

// سبب عدم توفر التنبيهات، لعرض إرشاد واضح للمستخدم
const getUnsupportedReason = () => {
  if (isIOS() && !isStandalone()) return 'ios_not_installed';
  if (isSupported()) return null;
  return 'unsupported';
};

const getPermission = () => {
  if (isNative()) return 'unknown';
  if (!isSupported()) return 'unsupported';
  return Notification.permission;
};

const readLastSent = () => {
  try {
    const raw = localStorage.getItem(LAST_SENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeLastSent = (value) => {
  try {
    localStorage.setItem(LAST_SENT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // التخزين قد يكون محجوباً، التنبيه نفسه يعمل بدونه
  }
};

const buildSignature = (alerts) => [
  alerts?.lateCount || 0,
  alerts?.todayCount || 0,
  Math.round(alerts?.totalAmount || 0)
].join(':');

const todayKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const buildMessage = (alerts) => {
  const parts = [];
  if (alerts.lateCount > 0) parts.push(`${alerts.lateCount} عميل متأخر`);
  if (alerts.todayCount > 0) parts.push(`${alerts.todayCount} عميل مستحق اليوم`);

  const names = [...alerts.late, ...alerts.today]
    .slice(0, 3)
    .map((item) => String(item.customer_name || 'عميل').replace(/\s*0+$/g, '').trim())
    .filter(Boolean)
    .join('، ');

  return {
    title: alerts.lateCount > 0 ? 'عملاء متأخرون عن السداد' : 'أقساط مستحقة اليوم',
    body: `${parts.join(' • ')} — الإجمالي ${toMoney(alerts.totalAmount)} ريال${names ? `\n${names}` : ''}`
  };
};

const showWebNotification = async ({ title, body }) => {
  const options = {
    body,
    icon: '/icons/aqasti-icon-192.png',
    badge: '/icons/icon-96.png',
    tag: NOTIFICATION_TAG,
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    data: { url: '/' }
  };

  // على أندرويد يجب استخدام Service Worker، وهو يعمل أيضاً على سفاري iOS المثبّت
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return true;
    } catch (error) {
      console.warn('[DueAlerts] SW notification failed:', error);
    }
  }

  try {
    new Notification(title, options);
    return true;
  } catch (error) {
    console.warn('[DueAlerts] Notification failed:', error);
    return false;
  }
};

const showNativeNotification = async ({ title, body }) => {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted') {
      status = await LocalNotifications.requestPermissions();
    }
    if (status.display !== 'granted') return false;

    await LocalNotifications.schedule({
      notifications: [{
        id: 1200001,
        title,
        body,
        smallIcon: 'ic_stat_icon_config_sample',
        schedule: { at: new Date(Date.now() + 1000) }
      }]
    });
    return true;
  } catch (error) {
    console.warn('[DueAlerts] Native notification failed:', error);
    return false;
  }
};

export const dueAlertsService = {
  isSupported,
  isIOS,
  isStandalone,
  getPermission,
  getUnsupportedReason,

  async isEnabled() {
    try {
      return (await settingsService.get(ENABLED_SETTING_KEY)) === 'true';
    } catch {
      return false;
    }
  },

  async getAlerts() {
    return installmentService.getDueCustomerAlerts();
  },

  // تفعيل التنبيهات: يجب استدعاؤها من ضغطة مستخدم حتى يظهر طلب الصلاحية
  async enable() {
    if (isNative()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') status = await LocalNotifications.requestPermissions();
      if (status.display !== 'granted') return { enabled: false, reason: status.display };
    } else {
      if (isIOS() && !isStandalone()) {
        return { enabled: false, reason: 'ios_not_installed' };
      }
      if (!webPushService.isSupported()) {
        return { enabled: false, reason: getUnsupportedReason() };
      }

      // This must run from the user's button click so iOS can show permission UI.
      const subscription = await webPushService.ensureSubscription({ requestPermission: true });
      if (!subscription.granted) {
        return { enabled: false, reason: subscription.reason };
      }
    }

    try {
      await settingsService.set(ENABLED_SETTING_KEY, 'true');
    } catch (error) {
      if (!isNative()) await webPushService.unsubscribe();
      throw error;
    }

    return { enabled: true, reason: 'granted' };
  },

  async disable() {
    if (!isNative()) await webPushService.unsubscribe();
    await settingsService.set(ENABLED_SETTING_KEY, 'false');
    writeLastSent(null);
    return { enabled: false, reason: 'off' };
  },

  async setEnabled(next) {
    return next ? this.enable() : this.disable();
  },

  // تنبيه محلي اختياري عند فتح التطبيق، بينما الإشعار الأساسي يصل من Web Push بالخلفية.
  async notify({ alerts = null, force = false } = {}) {
    if (!isSupported()) return { sent: false, reason: getUnsupportedReason() };
    if (!isNative() && Notification.permission !== 'granted') {
      return { sent: false, reason: Notification.permission };
    }

    const data = alerts || await this.getAlerts();
    if (!data || data.total === 0) return { sent: false, reason: 'empty', alerts: data };

    const signature = buildSignature(data);
    const day = todayKey();

    if (!force) {
      const last = readLastSent();
      if (last && last.day === day && last.signature === signature) {
        return { sent: false, reason: 'throttled', alerts: data };
      }
    }

    const message = buildMessage(data);
    const sent = isNative()
      ? await showNativeNotification(message)
      : await showWebNotification(message);

    if (sent) writeLastSent({ day, signature, at: Date.now() });
    return { sent, reason: sent ? 'sent' : 'failed', alerts: data };
  },

  async runAutoCheck() {
    if (!await this.isEnabled()) return { sent: false, reason: 'disabled' };
    if (!isSupported()) return { sent: false, reason: getUnsupportedReason() };
    if (!isNative() && Notification.permission !== 'granted') {
      return { sent: false, reason: 'no_permission' };
    }
    return this.notify();
  },

  // اختبار Push الحقيقي: يمر عبر Cloudflare ثم يعود إلى هذا الجهاز من مزود Push.
  async sendTest() {
    if (isNative()) {
      const message = {
        title: 'تجربة تنبيهات أقساطي',
        body: 'التنبيهات تعمل على هذا الجهاز ✅'
      };
      const sent = await showNativeNotification(message);
      return { sent, reason: sent ? 'sent' : 'failed' };
    }

    if (isIOS() && !isStandalone()) return { sent: false, reason: 'ios_not_installed' };
    if (!webPushService.isSupported()) {
      return { sent: false, reason: getUnsupportedReason() };
    }
    const result = await webPushService.sendTestNotification();
    return { sent: result.sent, reason: result.sent ? 'sent' : result.permission };
  }
};

export default dueAlertsService;
