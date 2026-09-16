import { Capacitor, registerPlugin } from '@capacitor/core';

const License = registerPlugin('License');
const Billing = registerPlugin('Billing');
const SECRET_SALT = 'NAYEF_FAZATK_2026_SECURITY_SALT';
const WEB_DEVICE_ID_KEY = 'aqsati_web_device_id';
const WEB_LICENSE_KEY = 'aqsati_license_data';
const WEB_TRIAL_KEY = 'aqsati_trial_data';
const WEB_BILLING_KEY = 'aqsati_billing_entitlement';

// Helper to hash using crypto.subtle (SHA-256) exactly matching Android / Generator logic
const generateNumericHash = async (input) => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    let numericCode = 0;
    for (let i = 0; i < 8; i++) {
      numericCode = (numericCode * 256 + hashArray[i]) % 100000000;
    }
    return String(numericCode).padStart(8, '0');
  } catch (err) {
    console.error('[License] Hash error:', err);
    return '00000000';
  }
};

const getStoredLicenseData = () => {
  let stored = localStorage.getItem(WEB_LICENSE_KEY);
  if (!stored) {
    stored = localStorage.getItem('fazatak_license_data');
    if (stored) {
      localStorage.setItem(WEB_LICENSE_KEY, stored);
    }
  }
  return stored;
};

const getWebDeviceId = () => {
  let id = localStorage.getItem(WEB_DEVICE_ID_KEY) || localStorage.getItem('fazatak_web_device_id');
  if (!id || id.length !== 6) {
    // Generate stable 6-digit numeric device ID
    id = String(Math.floor(100000 + Math.random() * 900000));
  }
  localStorage.setItem(WEB_DEVICE_ID_KEY, id);
  return id;
};

export const licenseService = {
  /**
   * Returns the unique device identifier
   */
  async getDeviceId() {
    if (!Capacitor.isNativePlatform()) {
      return getWebDeviceId();
    }

    try {
      const { deviceId } = await License.getDeviceId();
      return deviceId;
    } catch (err) {
      console.error('[LicenseService] Native getDeviceId failed, falling back to web ID:', err);
      return getWebDeviceId();
    }
  },

  /**
   * Attempts to activate the app with the provided code
   */
  async activateLicense(code) {
    if (!code) {
      throw new Error('ERR_MISSING_CODE');
    }

    // Standardize Arabic-Indic digits to Western digits
    const cleanCode = String(code).trim()
      .replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 1632)
      .replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 1776);

    if (cleanCode.length !== 9) {
      throw new Error('ERR_INVALID_FORMAT');
    }

    if (Capacitor.isNativePlatform()) {
      try {
        return await License.activateLicense({ code: cleanCode });
      } catch (err) {
        // Fall back to web algorithm if native plugin fails
        console.warn('[LicenseService] Native activateLicense failed, trying web verification:', err);
      }
    }

    // Web verification matching tools/license_web_generator.html
    const deviceId = await this.getDeviceId();
    const durations = ['30', '90', '180', '365', '9999'];
    const typeDigit = cleanCode.substring(0, 1);
    const codeHash = cleanCode.substring(1);

    let matchedDuration = null;
    for (const d of durations) {
      const expectedHash = await generateNumericHash(deviceId + d + SECRET_SALT);
      if (expectedHash === codeHash) {
        let expectedType = '0';
        if (d === '30') expectedType = '1';
        else if (d === '90') expectedType = '3';
        else if (d === '180') expectedType = '6';
        else if (d === '365') expectedType = '9';

        if (typeDigit === expectedType) {
          matchedDuration = d;
          break;
        }
      }
    }

    if (!matchedDuration) {
      throw new Error('ERR_WRONG_CODE');
    }

    const now = Math.floor(Date.now() / 1000);
    let expiry;
    if (matchedDuration === '9999') {
      expiry = 2147483647; // Lifetime
    } else {
      expiry = now + (Number(matchedDuration) * 24 * 60 * 60);
    }

    const keySource = deviceId + cleanCode + SECRET_SALT;
    const derivedKey = (await generateNumericHash(keySource)).substring(0, 8);

    const licensePayload = {
      code: cleanCode,
      expiry,
      lastSeen: now,
      key: derivedKey
    };

    localStorage.setItem(WEB_LICENSE_KEY, JSON.stringify(licensePayload));
    localStorage.removeItem(WEB_TRIAL_KEY);
    localStorage.removeItem('fazatak_trial_data');
    return { success: true, expiry, isTrial: false, key: derivedKey };
  },

  /**
   * جلب باقات ومنتجات Google Play من المتجر
   */
  async getBillingProducts() {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await Billing.getProducts();
        if (res && res.products && res.products.length > 0) {
          return res.products;
        }
      } catch (err) {
        console.warn('[licenseService] Native getProducts error, using defaults:', err);
      }
    }

    // Default structure matching Play Console configurations (Arabic localized)
    return [
      {
        productId: 'aqsati_30d',
        title: 'اشتراك شهري (30 يوماً)',
        description: 'وصول كامل لكافة الميزات المحاسبية وإدارة الأقساط',
        productType: 'subs',
        formattedPrice: 'حسب المتجر',
        billingPeriod: 'P1M'
      },
      {
        productId: 'aqsati_90d',
        title: 'اشتراك ربع سنوي (90 يوماً)',
        description: 'وصول كامل لـ 3 أشهر مع حفظ البيانات محلياً',
        productType: 'subs',
        formattedPrice: 'حسب المتجر',
        billingPeriod: 'P3M'
      },
      {
        productId: 'aqsati_180d',
        title: 'اشتراك نصف سنوي (180 يوماً)',
        description: 'وصول كامل لـ 6 أشهر مع كافة التقارير والنسخ',
        productType: 'subs',
        formattedPrice: 'حسب المتجر',
        billingPeriod: 'P6M'
      },
      {
        productId: 'aqsati_365d',
        title: 'اشتراك سنوي (365 يوماً)',
        description: 'وصول كامل لعام كامل مع أعلى توفير وموثوقية',
        productType: 'subs',
        formattedPrice: 'حسب المتجر',
        billingPeriod: 'P1Y'
      },
      {
        productId: 'aqsati_lifetime',
        title: 'ترخيص دائم مدى الحياة',
        description: 'شراء لمرة واحدة بدون أي اشتراكات متكررة للأبد',
        productType: 'inapp',
        formattedPrice: 'حسب المتجر',
        isLifetime: true
      }
    ];
  },

  /**
   * تنفيذ شراء منتج أو اشتراك عبر Google Play
   */
  async purchaseBillingProduct({ productId, offerToken }) {
    if (!productId) throw new Error('ERR_MISSING_PRODUCT');

    if (Capacitor.isNativePlatform()) {
      return await Billing.purchase({ productId, offerToken });
    }

    // Web mock for testing/dev environments
    const now = Math.floor(Date.now() / 1000);
    const isLifetime = productId.includes('lifetime');
    let expiryTime = isLifetime ? 2147483647 : (now + 30 * 24 * 60 * 60);
    if (productId.includes('90d')) expiryTime = now + 90 * 24 * 60 * 60;
    if (productId.includes('180d')) expiryTime = now + 180 * 24 * 60 * 60;
    if (productId.includes('365d')) expiryTime = now + 365 * 24 * 60 * 60;

    const mockEntitlement = {
      isValid: true,
      state: isLifetime ? 'LIFETIME' : 'ACTIVE',
      productId,
      expiryTime,
      isLifetime,
      purchaseToken: 'web_mock_token_' + Date.now()
    };
    localStorage.setItem(WEB_BILLING_KEY, JSON.stringify(mockEntitlement));
    return mockEntitlement;
  },

  /**
   * استعادة المشتريات السابقة من Google Play
   */
  async restoreBillingPurchases() {
    if (Capacitor.isNativePlatform()) {
      return await Billing.restorePurchases();
    }

    const stored = localStorage.getItem(WEB_BILLING_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
    return { foundActivePurchase: false };
  },

  /**
   * جلب الاستحقاق الحالي مباشرة
   */
  async getBillingEntitlement() {
    if (Capacitor.isNativePlatform()) {
      try {
        return await Billing.getEntitlement();
      } catch (err) {
        console.warn('[licenseService] getEntitlement native failed:', err);
      }
    }

    const stored = localStorage.getItem(WEB_BILLING_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {}
    }
    return { isValid: false, state: 'NONE' };
  },

  /**
   * فتح صفحة إدارة الاشتراكات في متجر Google Play
   */
  async openSubscriptionManagement(productId = 'aqsati_subscription') {
    if (Capacitor.isNativePlatform()) {
      try {
        return await Billing.openSubscriptionManagement({ productId });
      } catch (e) {
        console.warn('openSubscriptionManagement failed:', e);
      }
    }
    window.open('https://play.google.com/store/account/subscriptions', '_blank');
  },

  /**
   * فحص شامل لحالة الترخيص مع الحفاظ التام على الأولوية المنطقية:
   * Valid Lifetime -> Valid Play Entitlement -> Valid Existing Trial -> Expired/View-Only
   */
  async checkLicenseStatus() {
    const now = Math.floor(Date.now() / 1000);

    // 1. فحص استحقاق Google Play أولاً (سواء دائم أو اشتراك سارٍ)
    if (Capacitor.isNativePlatform()) {
      try {
        const billingEntitlement = await Billing.getEntitlement();
        if (billingEntitlement && billingEntitlement.isValid) {
          const isLifetime = Boolean(billingEntitlement.isLifetime);
          const expiry = isLifetime ? 2147483647 : (billingEntitlement.expiryTime || 2147483647);
          return {
            isValid: true,
            expiry,
            isTrial: false,
            isLifetime,
            key: 'GOOGLE_PLAY_ACTIVE'
          };
        }
      } catch (e) {
        console.warn('[licenseService] Billing entitlement check failed, continuing:', e);
      }
    } else {
      const webBillingRaw = localStorage.getItem(WEB_BILLING_KEY);
      if (webBillingRaw) {
        try {
          const webBilling = JSON.parse(webBillingRaw);
          if (webBilling.isLifetime || (webBilling.expiryTime && webBilling.expiryTime > now)) {
            return {
              isValid: true,
              expiry: webBilling.isLifetime ? 2147483647 : webBilling.expiryTime,
              isTrial: false,
              isLifetime: Boolean(webBilling.isLifetime),
              key: 'GOOGLE_PLAY_ACTIVE'
            };
          }
        } catch {}
      }
    }

    // 2. فحص الترخيص الأصلي القديم (Legacy License)
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await License.checkLicense();
        if (status && status.isValid) {
          return {
            isValid: true,
            expiry: status.expiry,
            isTrial: Boolean(status.isTrial),
            key: status.key || 'AQSATI_SECURE_KEY'
          };
        }
      } catch (err) {
        if (err.message && err.message.includes('ERR_EXPIRED')) {
          throw new Error('ERR_EXPIRED', { cause: err });
        }
      }
    }

    // 3. فحص الـ Web Storage للترخيص القديم
    try {
      const stored = getStoredLicenseData();
      if (stored) {
        const data = JSON.parse(stored);
        if (!data.expiry || now > data.expiry) {
          throw new Error('ERR_EXPIRED');
        }

        data.lastSeen = now;
        localStorage.setItem(WEB_LICENSE_KEY, JSON.stringify(data));

        return {
          isValid: true,
          expiry: data.expiry,
          isTrial: false,
          key: data.key || 'AQSATI_SECURE_KEY'
        };
      }

      // 4. إذا لم يكن هناك ترخيص مسجل، نمنح المستخدم الجديد فترة سماح مجانية لمدة شهر (30 يوماً)
      let trialRaw = localStorage.getItem(WEB_TRIAL_KEY) || localStorage.getItem('fazatak_trial_data');
      let trialData;
      if (!trialRaw) {
        const trialExpiry = now + (30 * 24 * 60 * 60); // 30 يوماً
        trialData = {
          start: now,
          expiry: trialExpiry,
          isTrial: true,
          lastSeen: now
        };
        localStorage.setItem(WEB_TRIAL_KEY, JSON.stringify(trialData));
      } else {
        trialData = JSON.parse(trialRaw);
      }

      if (now > trialData.expiry) {
        throw new Error('ERR_EXPIRED');
      }

      trialData.lastSeen = now;
      localStorage.setItem(WEB_TRIAL_KEY, JSON.stringify(trialData));

      return {
        isValid: true,
        expiry: trialData.expiry,
        isTrial: true,
        key: 'AQSATI_TRIAL_KEY'
      };
    } catch (err) {
      if (err.message && err.message.includes('ERR_EXPIRED')) {
        throw err;
      }
      return { isValid: false, error: err.message || 'ERR_NO_LICENSE' };
    }
  }
};

export default licenseService;
