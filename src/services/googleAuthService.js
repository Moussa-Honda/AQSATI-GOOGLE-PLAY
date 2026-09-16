import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';

// ═══════════════════════════════════════════════════════════════════
//  Google OAuth 2.0 + PKCE  —  Capacitor / Android / iOS / Web
// ═══════════════════════════════════════════════════════════════════
//
//  هذا الملف ينفّذ OAuth 2.0 Authorization Code Flow مع PKCE
//  بدون أي Client Secret — آمن للتطبيقات المحمولة.
//
//  ⚠️  يجب ضبط GOOGLE_CLIENT_ID و REDIRECT_URI_HOSTED في Google Cloud Console.
//      راجع الملف WALKTHROUGH للتفاصيل.
// ═══════════════════════════════════════════════════════════════════

// ─── إعدادات OAuth ─────────────────────────────────────────────────
// Web OAuth Client ID من Google Cloud Console الخاص بمشروع أقساطي
// يمكن تمريره عبر متغير البيئة VITE_GOOGLE_CLIENT_ID
export const GOOGLE_CLIENT_ID =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_CLIENT_ID) ||
  '597146195568-mkdtembb730lqo0bbngopr5desv7s5ur.apps.googleusercontent.com';

// رابط redirect المستضاف الخاص بنظام أقساطي فقط
// هذا الرابط يستقبل authorization code ويعيد توجيهه للتطبيق عبر Custom URL Scheme
const REDIRECT_URI_HOSTED = (() => {
  // على الويب نستخدم نفس الأصل
  if (!Capacitor.isNativePlatform() && typeof window !== 'undefined') {
    return `${window.location.origin}/oauth-callback.html`;
  }
  // على الموبايل نستخدم الرابط المستضاف الخاص بمشروع أقساطي
  return (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_REDIRECT_URI) ||
    'https://aqsati.honda-druid.workers.dev/oauth-callback.html'
  );
})();

// Custom URL Scheme للتطبيق (مطابق لـ appId في capacitor.config.json الخاص بأقساطي)
const APP_SCHEME = 'com.installment.app';
const OAUTH_CALLBACK_PATH = 'oauth/callback';

// نطاق الصلاحيات — الوصول لملفات التطبيق فقط + معرفة البريد المرتبط
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

// Google OAuth endpoints
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

// مفاتيح التخزين في Preferences (خاصة بنظام أقساطي حصراً لمنع أي تداخل)
const PREF_KEYS = {
  ACCESS_TOKEN: 'aqsati_gd_access_token',
  REFRESH_TOKEN: 'aqsati_gd_refresh_token',
  EXPIRES_AT: 'aqsati_gd_expires_at',
  CODE_VERIFIER: 'aqsati_gd_code_verifier',
  STATE: 'aqsati_gd_state',
  USER_EMAIL: 'aqsati_gd_user_email',
};

// ─── PKCE Helpers ──────────────────────────────────────────────────

function generateRandomString(length = 64) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues, (v) => charset[v % charset.length]).join('');
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return await crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateCodeChallenge(codeVerifier) {
  const hashed = await sha256(codeVerifier);
  return base64UrlEncode(hashed);
}

// ─── Preferences Helpers ───────────────────────────────────────────

async function savePref(key, value) {
  await Preferences.set({ key, value: String(value) });
}

async function loadPref(key) {
  const { value } = await Preferences.get({ key });
  return value;
}

async function removePref(key) {
  await Preferences.remove({ key });
}

// ─── الحالة الداخلية ──────────────────────────────────────────────

// Promise resolver لانتظار عودة المستخدم من المتصفح
let _pendingAuthResolve = null;
let _pendingAuthReject = null;
let _listenerRegistered = false;

// متغير في الذاكرة فقط — لا يُحفظ في التخزين
let _cachedAccessToken = null;
let _cachedExpiresAt = 0;

// ─── تسجيل مستمع Deep Link ────────────────────────────────────────

function registerAppUrlListener() {
  if (_listenerRegistered) return;
  _listenerRegistered = true;

  if (Capacitor.isNativePlatform()) {
    App.addListener('appUrlOpen', ({ url }) => {
      if (!url) return;

      // هل هذا هو callback الـ OAuth؟
      const expectedPrefix = `${APP_SCHEME}://${OAUTH_CALLBACK_PATH}`;
      if (!url.startsWith(expectedPrefix)) return;

      try {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get('code');
        const state = urlObj.searchParams.get('state');
        const error = urlObj.searchParams.get('error');

        // إغلاق المتصفح الخارجي
        Browser.close().catch(() => { /* تجاهل */ });

        if (error) {
          _pendingAuthReject?.(new Error(
            error === 'access_denied'
              ? 'تم رفض الوصول. يرجى السماح بالصلاحيات المطلوبة.'
              : `خطأ مصادقة Google: ${error}`
          ));
        } else if (code && state) {
          _pendingAuthResolve?.({ code, state });
        } else {
          _pendingAuthReject?.(new Error('لم يتم استلام بيانات المصادقة بشكل صحيح'));
        }
      } catch (err) {
        console.error('[GoogleAuth] Error parsing callback URL:', err);
        _pendingAuthReject?.(new Error('خطأ في معالجة رابط المصادقة'));
      }
    });
  }
}

// مستمع لإغلاق المتصفح (المستخدم أغلق بدون إكمال المصادقة)
function registerBrowserFinishedListener() {
  if (Capacitor.isNativePlatform()) {
    Browser.addListener('browserFinished', () => {
      // إذا كان هناك عملية مصادقة معلقة ولم تكتمل بعد
      setTimeout(() => {
        if (_pendingAuthReject) {
          _pendingAuthReject(new Error('تم إلغاء تسجيل الدخول'));
          _pendingAuthResolve = null;
          _pendingAuthReject = null;
        }
      }, 1500); // انتظر قليلاً لأن appUrlOpen قد يصل متأخراً
    });
  }
}

// ─── Web Popup Flow ────────────────────────────────────────────────

function waitForWebCallback() {
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      if (event.data?.type !== 'google-oauth-callback') return;
      window.removeEventListener('message', handler);

      if (event.data.error) {
        reject(new Error(
          event.data.error === 'access_denied'
            ? 'تم رفض الوصول. يرجى السماح بالصلاحيات المطلوبة.'
            : `خطأ مصادقة Google: ${event.data.error}`
        ));
      } else if (event.data.code) {
        resolve({ code: event.data.code, state: event.data.state });
      } else {
        reject(new Error('لم يتم استلام بيانات المصادقة'));
      }
    };

    window.addEventListener('message', handler);

    // مهلة زمنية (5 دقائق) لمنع Promise معلقة للأبد
    setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('انتهت مهلة تسجيل الدخول. يرجى المحاولة مرة أخرى.'));
    }, 5 * 60 * 1000);
  });
}

// ─── خدمة المصادقة ────────────────────────────────────────────────

export const googleAuthService = {

  /**
   * تسجيل الدخول إلى Google — يفتح المتصفح ويعود بـ access_token
   */
  async signIn() {
    registerAppUrlListener();
    registerBrowserFinishedListener();

    // 1. إنشاء PKCE code_verifier و code_challenge
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateRandomString(32);

    // 2. حفظ code_verifier و state (نحتاجهما بعد العودة)
    await savePref(PREF_KEYS.CODE_VERIFIER, codeVerifier);
    await savePref(PREF_KEYS.STATE, state);

    // 3. بناء رابط OAuth
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI_HOSTED,
      response_type: 'code',
      scope: SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline', // للحصول على refresh_token
      prompt: 'consent',       // إجبار الموافقة للحصول على refresh_token
    });

    const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;

    // 4. فتح المتصفح وانتظار العودة
    let callbackData;

    if (Capacitor.isNativePlatform()) {
      // على الموبايل: فتح في متصفح النظام
      callbackData = await new Promise((resolve, reject) => {
        _pendingAuthResolve = resolve;
        _pendingAuthReject = reject;

        Browser.open({ url: authUrl, presentationStyle: 'popover' })
          .catch((err) => {
            _pendingAuthResolve = null;
            _pendingAuthReject = null;
            reject(new Error('تعذر فتح متصفح المصادقة: ' + (err.message || '')));
          });
      });
    } else {
      // على الويب: فتح popup
      const popup = window.open(
        authUrl,
        'google-auth',
        'width=500,height=700,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('تم حظر النافذة المنبثقة. يرجى السماح بالنوافذ المنبثقة والمحاولة مرة أخرى.');
      }

      callbackData = await waitForWebCallback();
    }

    // 5. التحقق من state
    const savedState = await loadPref(PREF_KEYS.STATE);
    if (callbackData.state !== savedState) {
      throw new Error('خطأ أمني: حالة المصادقة غير متطابقة');
    }

    // 6. استبدال الـ code بـ tokens
    const savedVerifier = await loadPref(PREF_KEYS.CODE_VERIFIER);
    const tokens = await this._exchangeCodeForTokens(callbackData.code, savedVerifier);

    // 7. تنظيف البيانات المؤقتة
    await removePref(PREF_KEYS.CODE_VERIFIER);
    await removePref(PREF_KEYS.STATE);

    return tokens.access_token;
  },

  /**
   * استبدال authorization code بـ tokens
   * @private
   */
  async _exchangeCodeForTokens(code, codeVerifier) {
    const body = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI_HOSTED,
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[GoogleAuth] Token exchange failed:', errorData);
      const errorDesc = errorData.error_description || errorData.error || '';
      throw new Error(`فشل المصادقة مع Google: ${errorDesc}`);
    }

    const data = await response.json();

    // حفظ التوكنات
    const expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    _cachedAccessToken = data.access_token;
    _cachedExpiresAt = expiresAt;

    await savePref(PREF_KEYS.ACCESS_TOKEN, data.access_token);
    await savePref(PREF_KEYS.EXPIRES_AT, String(expiresAt));

    if (data.refresh_token) {
      await savePref(PREF_KEYS.REFRESH_TOKEN, data.refresh_token);
    }

    return data;
  },

  /**
   * تجديد access_token باستخدام refresh_token
   * @private
   */
  async _refreshAccessToken() {
    const refreshToken = await loadPref(PREF_KEYS.REFRESH_TOKEN);
    if (!refreshToken) {
      throw new Error('SESSION_EXPIRED');
    }

    const body = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[GoogleAuth] Token refresh failed:', errorData);

      // إذا كان refresh_token غير صالح، نمسح كل شيء
      if (response.status === 400 || response.status === 401) {
        await this.signOut();
        throw new Error('SESSION_EXPIRED');
      }

      throw new Error('فشل تجديد جلسة Google');
    }

    const data = await response.json();

    const expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    _cachedAccessToken = data.access_token;
    _cachedExpiresAt = expiresAt;

    await savePref(PREF_KEYS.ACCESS_TOKEN, data.access_token);
    await savePref(PREF_KEYS.EXPIRES_AT, String(expiresAt));

    // Google أحياناً يرسل refresh_token جديد
    if (data.refresh_token) {
      await savePref(PREF_KEYS.REFRESH_TOKEN, data.refresh_token);
    }

    return data.access_token;
  },

  /**
   * الحصول على access_token صالح — مع تجديد تلقائي
   * يطلب تسجيل دخول إذا لم يوجد token أو انتهت الجلسة
   */
  async getValidToken() {
    // 1. فحص الذاكرة المؤقتة أولاً
    if (_cachedAccessToken && _cachedExpiresAt > Date.now() + 60000) {
      return _cachedAccessToken;
    }

    // 2. فحص التخزين
    const savedToken = await loadPref(PREF_KEYS.ACCESS_TOKEN);
    const savedExpiry = Number(await loadPref(PREF_KEYS.EXPIRES_AT)) || 0;

    if (savedToken && savedExpiry > Date.now() + 60000) {
      _cachedAccessToken = savedToken;
      _cachedExpiresAt = savedExpiry;
      return savedToken;
    }

    // 3. محاولة التجديد بـ refresh_token
    const refreshToken = await loadPref(PREF_KEYS.REFRESH_TOKEN);
    if (refreshToken) {
      try {
        return await this._refreshAccessToken();
      } catch (err) {
        if (err.message === 'SESSION_EXPIRED') {
          // الجلسة انتهت تماماً — يجب تسجيل دخول جديد
          return await this.signIn();
        }
        throw err;
      }
    }

    // 4. لا يوجد أي token — يجب تسجيل دخول
    return await this.signIn();
  },

  /**
   * هل المستخدم مسجل دخول حالياً؟
   */
  async isSignedIn() {
    const refreshToken = await loadPref(PREF_KEYS.REFRESH_TOKEN);
    if (!refreshToken) return false;

    const savedExpiry = Number(await loadPref(PREF_KEYS.EXPIRES_AT)) || 0;
    if (savedExpiry > Date.now() + 60000) return true;

    // لديه refresh_token لكن access_token منتهي — لا يزال "مسجل دخول"
    return true;
  },

  /**
   * جلب بريد حساب Google المتصل حالياً بنظام أقساطي
   */
  async getUserEmail() {
    const cachedEmail = await loadPref(PREF_KEYS.USER_EMAIL);
    if (cachedEmail) return cachedEmail;

    try {
      const token = await this.getValidToken();
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.email) {
          await savePref(PREF_KEYS.USER_EMAIL, data.email);
          return data.email;
        }
      }
    } catch {
      // تجاهل في حالة عدم توفر الشبكة
    }
    return null;
  },

  /**
   * تسجيل الخروج — مسح جميع التوكنات الخاصة بأقساطي
   */
  async signOut() {
    // محاولة إبطال التوكن في Google (best effort)
    const accessToken = _cachedAccessToken || await loadPref(PREF_KEYS.ACCESS_TOKEN);
    if (accessToken) {
      fetch(`${REVOKE_ENDPOINT}?token=${accessToken}`, { method: 'POST' }).catch(() => {});
    }

    // مسح الذاكرة
    _cachedAccessToken = null;
    _cachedExpiresAt = 0;
    _pendingAuthResolve = null;
    _pendingAuthReject = null;

    // مسح التخزين
    await Promise.all(Object.values(PREF_KEYS).map((key) => removePref(key)));
  },

  /**
   * إعادة تسجيل الدخول مع اختيار حساب جديد
   */
  async reSignIn() {
    await this.signOut();
    return await this.signIn();
  },
};
