import { userService } from './database';

const AUTH_STORAGE_KEY = 'aqsati_auth_user';
const APP_LOCK_STORAGE_KEY = 'aqsati_app_lock';
const HASH_SALT_PREFIX = 'AQSATI_2026_SECURITY_SALT_';
const PERPETUAL_EXPIRY = '2099-01-01T00:00:00.000Z';

/**
 * توحيد أرقام الهواتف وتحويل الأرقام العربية إلى إنجليزية وإزالة المسافات والرموز الزائدة
 */
export const normalizePhone = (phone) => {
  if (!phone) return '';
  return String(phone)
    .trim()
    .replace(/[\u0660-\u0669]/g, (d) => d.charCodeAt(0) - 1632)
    .replace(/[\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) - 1776)
    .replace(/[^\d+]/g, '');
};

/**
 * تجزئة وتشفير النصوص (كلمات المرور والـ PIN) عبر خوارزمية SHA-256 مع Salt محلياً
 */
export const hashSecureValue = async (value, saltKey = '') => {
  if (!value) return '';
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(`${HASH_SALT_PREFIX}${saltKey}_${String(value).trim()}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.error('Hash error:', err);
    throw new Error('فشل تشفير البيانات محلياً');
  }
};

export const authService = {
  /**
   * فحص ما إذا كان هناك أي مستخدمين مسجلين محلياً في قاعدة البيانات
   */
  async hasAnyUsers() {
    try {
      const count = await userService.count();
      return count > 0;
    } catch {
      return false;
    }
  },

  /**
   * جلب بيانات المستخدم الحالي النشط
   */
  getCurrentUser() {
    try {
      let raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem('fazatak_auth_user');
        if (raw) {
          localStorage.setItem(AUTH_STORAGE_KEY, raw);
        }
      }
      if (!raw) return null;
      const user = JSON.parse(raw);
      if (user && !user.subscription_expiry) {
        user.subscription_expiry = PERPETUAL_EXPIRY;
        user.subscription_status = 'active';
      }
      return user;
    } catch {
      return null;
    }
  },

  /**
   * التحقق مما إذا كان اشتراك المستخدم منتهياً (في الوضع المحلي: دائماً نشط)
   */
  isSubscriptionExpired() {
    const user = this.getCurrentUser();
    if (!user) return false;
    if (user.subscription_status === 'expired') return true;
    if (user.subscription_expiry) {
      return new Date(user.subscription_expiry).getTime() < Date.now();
    }
    return false;
  },

  /**
   * تخزين جلسة المستخدم محلياً
   */
  setCurrentUser(user) {
    if (!user) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } else {
      const safeUser = {
        id: user.id,
        phone: user.phone,
        name: user.name,
        role: user.role || 'admin',
        subscription_status: user.subscription_status || 'active',
        subscription_expiry: user.subscription_expiry || PERPETUAL_EXPIRY,
        created_at: user.created_at || new Date().toISOString(),
        is_local_only: true
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safeUser));
    }
  },

  /**
   * تسجيل الخروج
   */
  logout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  },

  getAppLockSettings(phone = this.getCurrentUser()?.phone) {
    try {
      let raw = localStorage.getItem(APP_LOCK_STORAGE_KEY);
      if (!raw) {
        raw = localStorage.getItem('fazatak_app_lock');
        if (raw) {
          localStorage.setItem(APP_LOCK_STORAGE_KEY, raw);
        }
      }
      if (!raw) return null;
      const settings = JSON.parse(raw);
      return settings?.phone === normalizePhone(phone) ? settings : null;
    } catch {
      return null;
    }
  },

  /**
   * تهيئة أو جلب حساب المسؤول المعتمد للترخيص المحلي
   */
  async getOrInitAdminUser(deviceId = '123456', expiry = null) {
    let user = this.getCurrentUser();
    const expiryIso = expiry && expiry < 2100000000 
      ? new Date(expiry * 1000).toISOString() 
      : PERPETUAL_EXPIRY;

    if (!user || !user.phone) {
      try {
        const existing = await userService.getFirstUser();
        if (existing) {
          user = {
            id: existing.id,
            phone: existing.phone || deviceId,
            name: existing.name || 'مدير النظام',
            role: existing.role || 'admin',
            subscription_status: 'active',
            subscription_expiry: expiryIso,
            created_at: existing.created_at || new Date().toISOString(),
            is_local_only: true
          };
        }
      } catch {}

      if (!user) {
        try {
          const created = await userService.create({
            phone: deviceId,
            name: 'مدير النظام',
            password_hash: 'ACTIVATED_DEVICE',
            pin_hash: null,
            role: 'admin'
          });
          user = {
            id: created.id,
            phone: created.phone || deviceId,
            name: created.name || 'مدير النظام',
            role: 'admin',
            subscription_status: 'active',
            subscription_expiry: expiryIso,
            created_at: new Date().toISOString(),
            is_local_only: true
          };
        } catch {
          user = {
            id: 'admin_local',
            phone: deviceId,
            name: 'مدير النظام',
            role: 'admin',
            subscription_status: 'active',
            subscription_expiry: expiryIso,
            created_at: new Date().toISOString(),
            is_local_only: true
          };
        }
      }
      this.setCurrentUser(user);
    } else {
      if (expiry) {
        user.subscription_expiry = expiryIso;
        user.subscription_status = 'active';
        this.setCurrentUser(user);
      }
    }
    return user;
  },

  isAppLockEnabled(phone = this.getCurrentUser()?.phone) {
    const settings = this.getAppLockSettings(phone);
    return Boolean(settings?.enabled && settings?.pinHash);
  },

  async setAppLockPin(pin, phone = this.getCurrentUser()?.phone) {
    const cleanPhone = normalizePhone(phone);
    const cleanPin = String(pin || '').trim();
    if (!cleanPhone) throw new Error('انتهت جلسة المستخدم. يرجى تسجيل الدخول من جديد.');
    if (!/^\d{4,6}$/.test(cleanPin)) {
      throw new Error('رمز القفل يجب أن يكون من 4 إلى 6 أرقام');
    }

    const pinHash = await hashSecureValue(cleanPin, `${cleanPhone}_APP_LOCK`);
    localStorage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify({
      phone: cleanPhone,
      pinHash,
      enabled: true
    }));

    try {
      await userService.update(cleanPhone, { app_lock_enabled: 1, pin_hash: pinHash });
    } catch {}

    return { success: true };
  },

  async verifyAppLockPin(pin, phone = this.getCurrentUser()?.phone) {
    const settings = this.getAppLockSettings(phone);
    if (!settings?.enabled || !settings?.pinHash) return false;
    const cleanPhone = normalizePhone(phone);
    const pinHash = await hashSecureValue(String(pin || '').trim(), `${cleanPhone}_APP_LOCK`);
    return pinHash === settings.pinHash;
  },

  async disableAppLock(pin, phone = this.getCurrentUser()?.phone) {
    const valid = await this.verifyAppLockPin(pin, phone);
    if (!valid) throw new Error('رمز القفل غير صحيح');
    localStorage.removeItem(APP_LOCK_STORAGE_KEY);

    const cleanPhone = normalizePhone(phone);
    try {
      await userService.update(cleanPhone, { app_lock_enabled: 0 });
    } catch {}

    return { success: true };
  },

  /**
   * إنشاء حساب محلي جديد بالكامل في SQLite دون الحاجة لأي اتصال بالإنترنت
   */
  async register({ name, phone, password, pin }) {
    const cleanName = String(name || '').trim();
    const cleanPhone = normalizePhone(phone);
    const cleanPass = String(password || '').trim();
    const cleanPin = String(pin || '').trim();

    if (!cleanName || cleanName.length < 2) {
      throw new Error('يرجى إدخال اسم صحيح مكون من حرفين على الأقل');
    }
    if (!cleanPhone || cleanPhone.length < 8) {
      throw new Error('يرجى إدخال رقم هاتف صحيح مكون من 8 أرقام على الأقل');
    }
    if (!cleanPass || cleanPass.length < 4) {
      throw new Error('كلمة المرور يجب أن تتكون من 4 خانات أو أحرف على الأقل');
    }
    if (!cleanPin || cleanPin.length < 4 || !/^\d+$/.test(cleanPin)) {
      throw new Error('رمز الـ PIN يجب أن يكون أرقاماً فقط (من 4 إلى 6 أرقام) لاسترجاع الحساب');
    }

    // فحص عدم تكرار رقم الهاتف محلياً
    const existing = await userService.getByPhone(cleanPhone);
    if (existing) {
      throw new Error('رقم الهاتف هذا مسجل مسبقاً على هذا الجهاز! يرجى تسجيل الدخول أو استرجاع الحساب.');
    }

    // تشفير كلمة السر ورمز الـ PIN مع رقم الهاتف كـ Salt
    const passwordHash = await hashSecureValue(cleanPass, cleanPhone);
    const pinHash = await hashSecureValue(cleanPin, cleanPhone);

    const created = await userService.create({
      phone: cleanPhone,
      name: cleanName,
      password_hash: passwordHash,
      pin_hash: pinHash,
      role: 'admin'
    });

    const userPayload = {
      id: created.id,
      phone: cleanPhone,
      name: cleanName,
      role: 'admin',
      subscription_status: 'active',
      subscription_expiry: PERPETUAL_EXPIRY,
      created_at: new Date().toISOString()
    };

    this.setCurrentUser(userPayload);
    return userPayload;
  },

  /**
   * تسجيل الدخول المحلي والتحقق من كلمة المرور عبر SQLite محلياً
   */
  async login(phone, password) {
    const cleanPhone = normalizePhone(phone);
    const cleanPass = String(password || '').trim();

    if (!cleanPhone || !cleanPass) {
      throw new Error('يرجى إدخال رقم الهاتف وكلمة المرور');
    }

    let user = await userService.getByPhone(cleanPhone);

    // إذا لم يكن مسجلاً في SQLite، تفقد وجود جلسة محلية سابقة لترحيلها
    if (!user) {
      const cached = this.getCurrentUser();
      if (cached && normalizePhone(cached.phone) === cleanPhone) {
        // إنشاء سجل المستخدم محلياً تلقائياً
        const defaultHash = await hashSecureValue(cleanPass, cleanPhone);
        const created = await userService.create({
          phone: cleanPhone,
          name: cached.name || 'المستخدم',
          password_hash: defaultHash,
          pin_hash: null,
          role: 'admin'
        });
        user = { ...created, password_hash: defaultHash };
      }
    }

    if (!user) {
      throw new Error('رقم الهاتف أو كلمة المرور غير صحيحة');
    }

    // التحقق من صحة كلمة المرور عبر مطابقة الـ Hash محلياً
    const expectedHash = await hashSecureValue(cleanPass, cleanPhone);
    if (user.password_hash !== expectedHash && user.password_hash !== 'LOCAL_OFFLINE_USER_HASH') {
      throw new Error('رقم الهاتف أو كلمة المرور غير صحيحة');
    }

    // تحديث وقت آخر تسجيل دخول محلياً
    await userService.update(cleanPhone, { last_login_at: new Date().toISOString() });

    const safeUser = {
      id: user.id,
      phone: user.phone,
      name: user.name,
      role: user.role || 'admin',
      subscription_status: 'active',
      subscription_expiry: PERPETUAL_EXPIRY,
      created_at: user.created_at || new Date().toISOString()
    };

    this.setCurrentUser(safeUser);
    return safeUser;
  },

  /**
   * جلب أو تهيئة حساب المدير المحلي للتحقق من الترخيص والاستحقاق
   */
  async getOrInitAdminUser(deviceId = '0500000000', expirySeconds = null) {
    try {
      const existing = await userService.getFirstUser();
      const expiryIso = expirySeconds 
        ? new Date(Number(expirySeconds) * 1000).toISOString() 
        : PERPETUAL_EXPIRY;

      if (existing) {
        const safeUser = {
          id: existing.id,
          phone: existing.phone || normalizePhone(deviceId) || '0500000000',
          name: existing.name || 'مدير النظام',
          role: existing.role || 'admin',
          subscription_status: 'active',
          subscription_expiry: expiryIso,
          created_at: existing.created_at || new Date().toISOString()
        };
        this.setCurrentUser(safeUser);
        return safeUser;
      }

      const defaultPhone = normalizePhone(deviceId) || '0500000000';
      const defaultPassHash = await hashSecureValue('123456', defaultPhone);
      const defaultPinHash = await hashSecureValue('1234', defaultPhone);

      let created;
      try {
        created = await userService.create({
          phone: defaultPhone,
          name: 'مدير النظام',
          password_hash: defaultPassHash,
          pin_hash: defaultPinHash,
          role: 'admin'
        });
      } catch {
        created = { id: 1 };
      }

      const safeUser = {
        id: created?.id || 1,
        phone: defaultPhone,
        name: 'مدير النظام',
        role: 'admin',
        subscription_status: 'active',
        subscription_expiry: expiryIso,
        created_at: new Date().toISOString()
      };

      this.setCurrentUser(safeUser);
      return safeUser;
    } catch (err) {
      console.error('[authService] getOrInitAdminUser error:', err);
      const fallbackUser = {
        id: 1,
        phone: normalizePhone(deviceId) || '0500000000',
        name: 'مدير النظام',
        role: 'admin',
        subscription_status: 'active',
        subscription_expiry: PERPETUAL_EXPIRY,
        created_at: new Date().toISOString()
      };
      this.setCurrentUser(fallbackUser);
      return fallbackUser;
    }
  },

  /**
   * دخول سريع ومباشر كمدير محلي بدون كلمة مرور (لتجربة فورية سهلة بدون تعقيد)
   */
  async quickLocalAccess(adminName = 'مدير النظام') {
    const existing = await userService.getFirstUser();
    if (existing) {
      const safeUser = {
        id: existing.id,
        phone: existing.phone,
        name: existing.name,
        role: existing.role || 'admin',
        subscription_status: 'active',
        subscription_expiry: PERPETUAL_EXPIRY,
        created_at: existing.created_at
      };
      this.setCurrentUser(safeUser);
      return safeUser;
    }

    // إنشاء مستخدم محلي أول تلقائياً
    const defaultPhone = '0500000000';
    const defaultPassHash = await hashSecureValue('123456', defaultPhone);
    const defaultPinHash = await hashSecureValue('1234', defaultPhone);

    const created = await userService.create({
      phone: defaultPhone,
      name: adminName || 'مدير النظام',
      password_hash: defaultPassHash,
      pin_hash: defaultPinHash,
      role: 'admin'
    });

    const safeUser = {
      id: created.id,
      phone: defaultPhone,
      name: adminName || 'مدير النظام',
      role: 'admin',
      subscription_status: 'active',
      subscription_expiry: PERPETUAL_EXPIRY,
      created_at: new Date().toISOString()
    };

    this.setCurrentUser(safeUser);
    return safeUser;
  },

  /**
   * تغيير كلمة المرور للمستخدم المسجل محلياً
   */
  async changePassword(currentPassword, newPassword) {
    const currentUser = this.getCurrentUser();
    const cleanCurrentPass = String(currentPassword || '').trim();
    const cleanNewPass = String(newPassword || '').trim();
    const cleanPhone = normalizePhone(currentUser?.phone);

    if (!cleanPhone) throw new Error('انتهت جلسة المستخدم. يرجى تسجيل الدخول من جديد.');
    if (!cleanCurrentPass) throw new Error('يرجى إدخال كلمة المرور الحالية');
    if (!cleanNewPass || cleanNewPass.length < 4) {
      throw new Error('كلمة المرور الجديدة يجب أن تكون 4 أحرف/أرقام على الأقل');
    }
    if (cleanCurrentPass === cleanNewPass) {
      throw new Error('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
    }

    const user = await userService.getByPhone(cleanPhone);
    if (!user) {
      throw new Error('تعذر العثور على حساب المستخدم');
    }

    const currentPasswordHash = await hashSecureValue(cleanCurrentPass, cleanPhone);
    if (user.password_hash !== currentPasswordHash && user.password_hash !== 'LOCAL_OFFLINE_USER_HASH') {
      throw new Error('كلمة المرور الحالية غير صحيحة');
    }

    const newPasswordHash = await hashSecureValue(cleanNewPass, cleanPhone);
    await userService.update(cleanPhone, { password_hash: newPasswordHash });

    return { success: true, message: 'تم تغيير كلمة المرور بنجاح' };
  },

  /**
   * استرجاع الحساب وتعيين كلمة مرور جديدة عبر رمز الـ PIN محلياً
   */
  async recoverPassword(phone, pin, newPassword) {
    const cleanPhone = normalizePhone(phone);
    const cleanPin = String(pin || '').trim();
    const cleanNewPass = String(newPassword || '').trim();

    if (!cleanPhone) throw new Error('يرجى إدخال رقم الهاتف المسجل');
    if (!cleanPin) throw new Error('يرجى إدخال رمز الـ PIN السري');
    if (!cleanNewPass || cleanNewPass.length < 4) {
      throw new Error('كلمة المرور الجديدة يجب أن تكون 4 أحرف/أرقام على الأقل');
    }

    const user = await userService.getByPhone(cleanPhone);
    if (!user) {
      throw new Error('رقم الهاتف هذا غير مسجل على هذا الجهاز');
    }

    const enteredPinHash = await hashSecureValue(cleanPin, cleanPhone);
    if (user.pin_hash && user.pin_hash !== enteredPinHash) {
      throw new Error('رمز الـ PIN غير صحيح! تأكد من الرمز الذي قمت بتعيينه أثناء إنشاء الحساب.');
    }

    const newPasswordHash = await hashSecureValue(cleanNewPass, cleanPhone);
    await userService.update(cleanPhone, { password_hash: newPasswordHash });

    return { success: true, message: 'تم استرجاع الحساب وتعيين كلمة المرور الجديدة بنجاح!' };
  },

  /**
   * فحص صلاحية الاشتراك المحلي (دائماً نشط ومستمر)
   */
  async refreshSubscription() {
    const currentUser = this.getCurrentUser();
    if (!currentUser) return null;
    currentUser.subscription_status = 'active';
    currentUser.subscription_expiry = PERPETUAL_EXPIRY;
    this.setCurrentUser(currentUser);
    return currentUser;
  },

  /**
   * تمديد الاشتراك محلياً (دعم تفعيل الرخص دون إنترنت)
   */
  async activateOrExtendSubscription(days = 365) {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('يرجى تسجيل الدخول أولاً');

    const updated = {
      ...currentUser,
      subscription_status: 'active',
      subscription_expiry: PERPETUAL_EXPIRY
    };
    this.setCurrentUser(updated);
    return updated;
  }
};

export default authService;
