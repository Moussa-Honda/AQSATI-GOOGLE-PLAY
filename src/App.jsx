import { useEffect, useState } from 'react';
import Dashboard from './screens/Dashboard';
import AuthGate from './components/AuthGate';
import WelcomeOnboarding, { useOnboarding } from './components/WelcomeOnboarding';
import { authService } from './services/authService';
import { cloudSyncService } from './services/cloudSyncService';
import licenseService from './services/license';
import { settingsService } from './services/database';
import { dueAlertsService } from './services/dueAlertsService';
import { Capacitor } from '@capacitor/core';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import './index.css';

const AppLockScreen = ({ onUnlock }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUnlock = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const valid = await authService.verifyAppLockPin(pin);
      if (!valid) {
        setError('رمز القفل غير صحيح');
        return;
      }
      setPin('');
      onUnlock();
    } catch (unlockError) {
      setError(unlockError.message || 'تعذر فتح التطبيق');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="premium-auth fixed inset-0 z-[99999] flex items-center justify-center p-4" dir="rtl">
      <div className="auth-card w-full max-w-sm rounded-3xl border border-slate-800 p-6 text-center shadow-2xl">
        <img src="/logo-mark.svg" alt="شعار أقساطي" className="mx-auto mb-4 h-16 w-16" />
        <h1 className="text-2xl font-black text-white">التطبيق مقفل</h1>
        <p className="mt-2 text-sm text-slate-400">أدخل رمز القفل للوصول إلى بياناتك</p>
        <form onSubmit={handleUnlock} className="mt-6 space-y-4">
          <input
            type="password"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoFocus
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-center text-2xl tracking-[0.45em] text-white outline-none focus:border-emerald-400"
            placeholder="••••"
            aria-label="رمز قفل التطبيق"
          />
          <button type="submit" disabled={loading || pin.length < 4} className="w-full rounded-xl bg-emerald-600 py-3 font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'جاري التحقق...' : 'فتح التطبيق'}
          </button>
          {error && <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">{error}</p>}
        </form>
      </div>
    </div>
  );
};

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLicensed, setIsLicensed] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [expiry, setExpiry] = useState(null);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [decryptionKey, setDecryptionKey] = useState('FAZATAK_SECURE_KEY');
  const { showOnboarding, completeOnboarding } = useOnboarding();

  useEffect(() => {
    checkAppLicense();
    initScreenPrivacy();
    cloudSyncService.initAutoSyncListener();
  }, []);

  useEffect(() => {
    if (!isLicensed) return;

    // تنبيه العملاء المتأخرين / المستحقين اليوم عند فتح التطبيق
    dueAlertsService.runAutoCheck().catch((error) => {
      console.warn('Due alerts init note:', error);
    });

    // فحص مزامنة التحديثات في الخلفية عند فتح التطبيق
    if (currentUser?.phone) {
      cloudSyncService.syncWithCloud(currentUser.phone).catch((err) => {
        console.warn('Background sync check note:', err);
      });
    }
  }, [isLicensed, currentUser]);

  useEffect(() => {
    if (!isLicensed || !currentUser?.phone) return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && authService.isAppLockEnabled(currentUser.phone)) {
        setIsAppLocked(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isLicensed, currentUser]);

  const initScreenPrivacy = async () => {
    if (!Capacitor.isNativePlatform()) return;

    try {
      const isEnabled = await settingsService.get('screen_privacy');
      if (isEnabled === 'false') {
        await PrivacyScreen.disable();
      } else {
        await PrivacyScreen.enable();
      }
    } catch (e) {
      console.error('PrivacyScreen init error:', e);
    }
  };

  const checkAppLicense = async () => {
    try {
      // 1. التحقق أولاً من جلسة العميل المربوطة برقم الهاتف
      const user = authService.getCurrentUser();

      if (user && user.phone) {
        setCurrentUser(user);
        setIsAppLocked(authService.isAppLockEnabled(user.phone));
        const expiryMs = new Date(user.subscription_expiry).getTime();
        const hasExpired = expiryMs < Date.now() || user.subscription_status === 'expired';

        setIsLicensed(true);
        setIsExpired(hasExpired);
        setExpiry(Math.floor(expiryMs / 1000));
        setDecryptionKey('FAZATAK_SECURE_KEY');

        // فحص واسترجاع ذكي فوري إذا كانت المعاملات غير موجودة محلياً قبل فتح الواجهة
        try {
          await cloudSyncService.fullSyncOnLogin(user.phone);
        } catch (syncErr) {
          console.warn('Startup sync check note:', syncErr);
        }

        // تحديث صلاحية الاشتراك في الخلفية إن وجد إنترنت
        authService.refreshSubscription().then((updated) => {
          if (updated && updated.subscription_expiry) {
            setCurrentUser(updated);
            const updatedExpMs = new Date(updated.subscription_expiry).getTime();
            setExpiry(Math.floor(updatedExpMs / 1000));
            const stillExpired = updatedExpMs < Date.now() || updated.subscription_status === 'expired';
            setIsExpired(stillExpired);
          }
        }).catch(() => {});

        return;
      }

      // 2. إذا لم يكن مسجلاً برقم الهاتف، يجب تسجيل الدخول أو إنشاء حساب
      setIsLicensed(false);
      setIsExpired(false);
      setCurrentUser(null);
    } catch (err) {
      if (err.message === 'ERR_EXPIRED') {
        setIsLicensed(false);
        setIsExpired(true);
      } else {
        setIsLicensed(false);
      }
    } finally {
      setTimeout(() => setIsLoading(false), 400);
    }
  };

  const handleAuthenticated = async (user) => {
    setCurrentUser(user);
    const expiryMs = new Date(user.subscription_expiry).getTime();
    const hasExpired = expiryMs < Date.now() || user.subscription_status === 'expired';
    setExpiry(Math.floor(expiryMs / 1000));
    setIsLicensed(true);
    setIsExpired(hasExpired);
    setIsAppLocked(false);
    setDecryptionKey('FAZATAK_SECURE_KEY');
  };

  const handleLogout = () => {
    authService.logout();
    setCurrentUser(null);
    setIsLicensed(false);
    setIsExpired(false);
    setIsAppLocked(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
          <p className="text-slate-400 text-xs animate-pulse">جاري التحقق من الحساب والترخيص...</p>
        </div>
      </div>
    );
  }

  // Show welcome onboarding for brand new users (before auth gate)
  if (showOnboarding) {
    return <WelcomeOnboarding onComplete={completeOnboarding} />;
  }

  if (!isLicensed) {
    return (
      <AuthGate
        isExpired={isExpired}
        initialUser={currentUser}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (isAppLocked) {
    return <AppLockScreen onUnlock={() => setIsAppLocked(false)} />;
  }

  return (
    <Dashboard
      currentUser={currentUser}
      decryptionKey={decryptionKey}
      isExpired={isExpired}
      expiry={expiry}
      onReActivate={checkAppLicense}
      onLogout={handleLogout}
    />
  );
}

export default App;
