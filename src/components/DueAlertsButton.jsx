import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { dueAlertsService } from '../services/dueAlertsService';
import { formatPrivateAmount } from '../hooks/usePrivacyMode';

const cleanName = (value) => String(value || '').replace(/\s*0+$/g, '').trim() || 'عميل';

const TABS = [
  { id: 'late', label: 'متأخر', accent: 'rose' },
  { id: 'today', label: 'مستحق اليوم', accent: 'amber' }
];

const TAB_STYLES = {
  rose: {
    active: 'bg-rose-500/20 border-rose-500/50 text-rose-200',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    empty: 'لا يوجد عملاء متأخرون عن السداد.'
  },
  amber: {
    active: 'bg-amber-500/20 border-amber-500/50 text-amber-200',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    empty: 'لا يوجد عملاء مستحقون اليوم.'
  }
};

const PERMISSION_MESSAGES = {
  ios_not_installed: 'على الآيفون: افتح قائمة المشاركة في سفاري ثم «إضافة إلى الشاشة الرئيسية»، وشغّل التطبيق من الأيقونة لتفعيل التنبيهات (iOS 16.4 أو أحدث).',
  unsupported: 'هذا المتصفح لا يدعم تنبيهات النظام. القائمة داخل التطبيق تعمل بشكل طبيعي.',
  denied: 'تم رفض التنبيهات من إعدادات الجهاز. افتح إعدادات الإشعارات للتطبيق واختر السماح ثم أعد المحاولة.',
  default: 'لم يتم منح صلاحية التنبيهات بعد. اضغط الزر واسمح بالتنبيهات من نافذة النظام.',
  not_configured: 'لم يتم إعداد مفاتيح Push في Cloudflare بعد.',
  not_authenticated: 'يجب تسجيل الدخول قبل تفعيل تنبيهات الجهاز.',
  registration_failed: 'تعذر حفظ هذا الجهاز في خدمة التنبيهات.',
  push_service_unavailable: 'خدمة التنبيهات غير متاحة حالياً في Cloudflare.',
  send_failed: 'تم التسجيل لكن تعذر إرسال إشعار الاختبار. تحقق من إعدادات Cloudflare.'
};

const DueAlertsButton = ({ alerts, loading, onOpenCustomer, onSendWhatsApp, onRefresh, privacyMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('late');
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [portalTarget, setPortalTarget] = useState(null);

  // الشريط العلوي يستخدم backdrop-filter، لذلك يجب إخراج النافذة منه حتى تتوسط الشاشة
  useEffect(() => {
    setPortalTarget(document.querySelector('.premium-dashboard') || document.body);
  }, []);

  const lateCount = alerts?.lateCount || 0;
  const todayCount = alerts?.todayCount || 0;
  const totalCount = lateCount + todayCount;

  const loadEnabled = useCallback(async () => {
    const value = await dueAlertsService.isEnabled();
    const permission = dueAlertsService.getPermission();
    setEnabled(value && (permission === 'granted' || permission === 'unknown'));
  }, []);

  useEffect(() => {
    loadEnabled();
  }, [loadEnabled]);

  useEffect(() => {
    if (!isOpen) return;
    setActiveTab(lateCount > 0 || todayCount === 0 ? 'late' : 'today');
    onRefresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleToggle = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await dueAlertsService.setEnabled(!enabled);
      setEnabled(result.enabled);

      if (result.enabled) {
        const test = await dueAlertsService.sendTest();
        setStatus(test.sent
          ? 'تم تفعيل Push وإرسال إشعار اختباري. ستصلك تنبيهات المتأخرين والمستحقين حتى مع إغلاق التطبيق.'
          : `تم تفعيل الاشتراك، لكن تعذر إرسال الاختبار: ${PERMISSION_MESSAGES[test.reason] || test.reason}`);
      } else {
        setStatus(PERMISSION_MESSAGES[result.reason] || 'تم إيقاف تنبيهات النظام.');
      }
    } catch (error) {
      console.error('Due alerts toggle error:', error);
      setStatus('تعذر تحديث التنبيهات.');
    } finally {
      setBusy(false);
    }
  };

  const handleNotifyNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await dueAlertsService.sendTest();
      if (result.sent) {
        setStatus('تم إرسال إشعار Push اختباري إلى هذا الجهاز.');
      } else {
        setStatus(PERMISSION_MESSAGES[result.reason] || 'تعذر إظهار التنبيه على هذا الجهاز.');
      }
    } finally {
      setBusy(false);
    }
  };

  const items = (activeTab === 'late' ? alerts?.late : alerts?.today) || [];
  const accent = activeTab === 'late' ? 'rose' : 'amber';
  const styles = TAB_STYLES[accent];
  const unsupportedReason = dueAlertsService.getUnsupportedReason();

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`تنبيهات العملاء: ${totalCount}`}
        className={`relative w-10 h-10 shrink-0 rounded-2xl border flex items-center justify-center btn-press transition-colors ${
          totalCount > 0
            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
            : 'bg-slate-800/70 border-slate-700 text-slate-400'
        }`}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {!loading && totalCount > 0 && (
          <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow-lg shadow-rose-500/40">
            {totalCount > 99 ? '99+' : totalCount}
          </span>
        )}
      </button>

      {isOpen && portalTarget && createPortal((
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[9000] p-4" dir="rtl">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[88vh]">
            <div className="p-4 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">تنبيهات العملاء</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {totalCount} عميل • {formatPrivateAmount(alerts?.totalAmount, privacyMode, 'ر.س')}
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 shrink-0 rounded-full bg-slate-700/70 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-4 pb-0 shrink-0">
              <div className="grid grid-cols-2 gap-2">
                {TABS.map((tab) => {
                  const count = tab.id === 'late' ? lateCount : todayCount;
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`border rounded-xl py-2.5 px-3 text-sm font-bold transition-colors ${
                        isActive ? TAB_STYLES[tab.accent].active : 'bg-slate-800/60 border-slate-700 text-slate-400'
                      }`}
                    >
                      {tab.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto custom-scrollbar flex-1">
              <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white text-sm font-bold">تنبيهات الجهاز</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">تنبيه بالمتأخرين والمستحقين اليوم عند فتح التطبيق</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggle}
                    disabled={busy || Boolean(unsupportedReason)}
                    className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-50 ${
                      enabled
                        ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-700/60 border-slate-600 text-slate-300'
                    }`}
                  >
                    {enabled ? 'مفعل' : 'تشغيل'}
                  </button>
                </div>

                {enabled && !unsupportedReason && (
                  <button
                    type="button"
                    onClick={handleNotifyNow}
                    disabled={busy}
                    className="w-full bg-blue-600/20 border border-blue-500/40 text-blue-300 py-2 rounded-xl text-xs font-bold hover:bg-blue-600/30 transition-colors disabled:opacity-50"
                  >
                    إرسال إشعار Push اختباري
                  </button>
                )}

                {(status || unsupportedReason) && (
                  <p className="text-[11px] text-slate-400 leading-5 bg-slate-900/70 border border-slate-700 rounded-lg p-2.5">
                    {status || PERMISSION_MESSAGES[unsupportedReason]}
                  </p>
                )}
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((key) => <div key={key} className="h-20 bg-slate-800/70 rounded-xl animate-pulse" />)}
                </div>
              ) : items.length === 0 ? (
                <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 text-center text-slate-400 text-sm">
                  {styles.empty}
                </div>
              ) : items.map((item) => (
                <div key={`${activeTab}-${item.customer_id}`} className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="text-white font-bold truncate">{cleanName(item.customer_name)}</h4>
                      <p className="text-slate-400 text-[11px] mt-1 truncate">
                        {item.installments_count} قسط
                        {activeTab === 'late' ? ` • متأخر ${item.days_late} يوم` : ` • تاريخ ${item.first_due_date}`}
                        {item.manager_name ? ` • ${item.manager_name}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className={`text-[11px] font-bold border rounded-full px-2 py-1 ${styles.badge}`}>
                        {formatPrivateAmount(item.due_amount, privacyMode, 'ر.س')}
                      </span>
                      {item.is_hard_debtor && (
                        <span className="text-[10px] font-bold text-rose-300">متعثر 🔴</span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsOpen(false);
                        onOpenCustomer?.(item);
                      }}
                      className="bg-blue-600/20 border border-blue-500/40 text-blue-300 py-2.5 rounded-xl text-xs font-bold hover:bg-blue-600/30 transition-colors"
                    >
                      فتح العميل
                    </button>
                    <button
                      type="button"
                      onClick={() => onSendWhatsApp?.(item)}
                      className="bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 py-2.5 rounded-xl text-xs font-bold hover:bg-emerald-600/30 transition-colors"
                    >
                      واتساب
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ), portalTarget)}
    </>
  );
};

export default DueAlertsButton;
