import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { authService } from '../services/authService';
import licenseService from '../services/license';

const AuthGate = ({ onAuthenticated, isExpired = false, initialUser = null, onClose = null }) => {
  const [deviceId, setDeviceId] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [fetchingId, setFetchingId] = useState(true);
  const [products, setProducts] = useState([]);
  const [selectedProductId, setSelectedProductId] = useState('aqsati_30d');
  const [showManualCode, setShowManualCode] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copied, setCopied] = useState(false);

  // جلب معرّف الجهاز وقائمة منتجات Google Play
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const id = await licenseService.getDeviceId();
        if (isMounted) {
          setDeviceId(id || '123456');
          setFetchingId(false);
        }
      } catch {
        if (isMounted) {
          setDeviceId('123456');
          setFetchingId(false);
        }
      }

      try {
        const prods = await licenseService.getBillingProducts();
        if (isMounted && prods && prods.length > 0) {
          setProducts(prods);
          if (!prods.some(p => p.productId === selectedProductId)) {
            setSelectedProductId(prods[0].productId);
          }
        }
      } catch (err) {
        console.warn('Failed to load products in AuthGate:', err);
      }
    };

    init();
    return () => { isMounted = false; };
  }, []);

  // نسخ رقم الجهاز
  const handleCopyDeviceId = async () => {
    if (!deviceId) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(deviceId);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = deviceId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // الشراء عبر Google Play Billing
  const handlePurchase = async () => {
    const product = products.find(p => p.productId === selectedProductId) || products[0];
    if (!product) {
      setError('يرجى اختيار باقة للاشتراك');
      return;
    }

    setPurchasing(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await licenseService.purchaseBillingProduct({
        productId: product.productId,
        offerToken: product.offerToken
      });

      if (res) {
        setSuccessMsg('تمت عملية الشراء بنجاح! جاري الدخول...');
        const user = await authService.getOrInitAdminUser(deviceId, res.expiryTime || 2147483647);
        setTimeout(() => {
          onAuthenticated(user);
        }, 600);
      }
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('USER_CANCELED')) {
        setError('تم إلغاء عملية الشراء من قبلك');
      } else {
        setError(msg || 'تعذر إتمام الشراء عبر Google Play، يرجى المحاولة لاحقاً');
      }
    } finally {
      setPurchasing(false);
    }
  };

  // استعادة المشتريات من Google Play
  const handleRestore = async () => {
    setRestoring(true);
    setError('');
    setSuccessMsg('');

    try {
      const res = await licenseService.restoreBillingPurchases();
      if (res && (res.isValid || res.foundActivePurchase || res.isLifetime)) {
        setSuccessMsg('تمت استعادة اشتراكك بنجاح! جاري الدخول...');
        const user = await authService.getOrInitAdminUser(deviceId, res.expiryTime || 2147483647);
        setTimeout(() => {
          onAuthenticated(user);
        }, 600);
      } else {
        setError('لم يتم العثور على أي مشتريات نشطة مرتبطة بحساب Google هذا');
      }
    } catch (err) {
      setError(err?.message || 'تعذر استعادة المشتريات حالياً، تأكد من الاتصال بالإنترنت');
    } finally {
      setRestoring(false);
    }
  };

  // تنظيف كود التفعيل القديم
  const handleCodeChange = (e) => {
    const val = e.target.value
      .replace(/[\u0660-\u0669]/g, (d) => d.charCodeAt(0) - 1632)
      .replace(/[\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) - 1776)
      .replace(/[^\d]/g, '')
      .slice(0, 9);
    setActivationCode(val);
    if (error) setError('');
  };

  // تفعيل النظام بواسطة الكود القديم
  const handleActivate = async (e) => {
    e?.preventDefault();
    if (!activationCode.trim() || activationCode.length !== 9) {
      setError('يرجى إدخال كود التفعيل المكون من 9 أرقام');
      return;
    }

    setLoading(true);
    setError('');
    setSuccessMsg('');

    try {
      const result = await licenseService.activateLicense(activationCode.trim());
      if (result && result.success) {
        setSuccessMsg('تم تفعيل الترخيص بنجاح! جاري الدخول...');
        const user = await authService.getOrInitAdminUser(deviceId, result.expiry);
        setTimeout(() => {
          onAuthenticated(user);
        }, 600);
      } else {
        setError('كود التفعيل غير صحيح أو لا يتطابق مع هذا الجهاز');
      }
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('ERR_INVALID_FORMAT')) {
        setError('صيغة كود التفعيل غير صحيحة، يجب أن يكون 9 أرقام');
      } else if (msg.includes('ERR_WRONG_CODE')) {
        setError('كود التفعيل غير متطابق مع رقم هذا الجهاز');
      } else if (msg.includes('ERR_EXPIRED')) {
        setError('كود التفعيل هذا منتهي الصلاحية');
      } else {
        setError('تعذر التحقق من كود التفعيل، تأكد من صحة الكود');
      }
    } finally {
      setLoading(false);
    }
  };

  // وضع العرض فقط
  const handleViewOnlyAccess = () => {
    const user = initialUser || authService.getCurrentUser() || {
      id: 'admin_local',
      name: 'مدير النظام',
      phone: deviceId || '123456',
      role: 'admin',
      subscription_status: 'expired'
    };
    onAuthenticated(user);
  };

  return (
    <div className="premium-auth fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto modal-safe-area" dir="rtl">
      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -z-10" />

      <div className="auth-card w-full max-w-md rounded-3xl border border-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden my-auto relative backdrop-blur-2xl">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 left-4 z-30 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors text-xs font-bold border border-slate-700 cursor-pointer shadow-md"
            aria-label="إغلاق النافذة"
          >
            ✕
          </button>
        )}
        
        {/* Header Branding */}
        <div className="relative pt-6 pb-3 px-6 text-center overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-56 h-20 bg-emerald-500/15 blur-2xl pointer-events-none rounded-full" />
          
          <div className="relative mx-auto w-14 h-14 mb-2">
            <div className="absolute inset-0 bg-emerald-500/20 rounded-2xl blur-md" />
            <div className="auth-brand-mark relative w-14 h-14 bg-slate-900/90 rounded-2xl border border-emerald-500/30 shadow-lg flex items-center justify-center p-1.5 overflow-hidden mx-auto">
               <img src="/logo-aqsati.png" alt="شعار أقساطي" className="w-full h-full object-contain rounded-xl" />
            </div>
          </div>

          <h1 className="text-2xl font-black text-white tracking-wide flex items-center justify-center gap-2">
            <span>أقساطي</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <span>⚡</span>
              <span>محلي 100%</span>
            </span>
          </h1>
          <p className="auth-tagline text-slate-400 text-xs mt-1 font-medium">
            {isExpired ? 'انتهت فترة ترخيص النظام — اختر باقة للاستمرار' : 'أدر التزاماتك وعقودك بثقة وأمان كامل'}
          </p>
        </div>

        {/* Content Body */}
        <div className="p-6 pt-1 space-y-3.5">
          {error && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center gap-2">
              <span className="text-sm">⚠️</span>
              <span className="font-medium">{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs flex items-center gap-2">
              <span className="text-sm">✅</span>
              <span className="font-medium">{successMsg}</span>
            </div>
          )}

          {/* Main Google Play Subscription Options */}
          {!showManualCode ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-300 font-semibold">باقات الاشتراك عبر Google Play</span>
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoring || purchasing}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold underline transition-colors cursor-pointer disabled:opacity-50"
                >
                  {restoring ? 'جاري الاستعادة...' : 'استعادة المشتريات ↺'}
                </button>
              </div>

              {/* Product Selection Cards */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                {products.map((prod) => {
                  const isSelected = prod.productId === selectedProductId;
                  return (
                    <div
                      key={prod.productId}
                      onClick={() => setSelectedProductId(prod.productId)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-emerald-950/40 border-emerald-500/70 shadow-sm shadow-emerald-900/20 ring-1 ring-emerald-500/40'
                          : 'bg-slate-900/60 hover:bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        <div className={`w-4 h-4 rounded-full border grid place-items-center shrink-0 ${
                          isSelected ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'
                        }`}>
                          {isSelected && <div className="w-1.5 h-1.5 bg-slate-950 rounded-full" />}
                        </div>
                        <div className="truncate">
                          <p className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                            {prod.title}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {prod.description}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-bold text-emerald-400 font-mono bg-emerald-950/60 px-2 py-1 rounded-lg border border-emerald-500/30">
                        {prod.formattedPrice || 'حسب المتجر'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Purchase Button */}
              <button
                type="button"
                onClick={handlePurchase}
                disabled={purchasing || restoring}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50 text-slate-950 rounded-xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-950/50"
              >
                {purchasing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
                    <span>جاري الاتصال بـ Google Play...</span>
                  </>
                ) : (
                  <>
                    <span>الاشتراك وتفعيل النظام</span>
                    <span className="text-base">💳</span>
                  </>
                )}
              </button>

              {/* Secondary Link to Legacy Code Form (Enterprise/Web only) */}
              {!Capacitor.isNativePlatform() && (
                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => setShowManualCode(true)}
                    className="text-[11px] text-slate-400 hover:text-slate-300 underline transition-colors cursor-pointer"
                  >
                    لديك كود ترخيص مسبق للمؤسسات؟ اضغط هنا
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Manual Legacy Activation Form (Preserved for Enterprise/Backwards compatibility) */
            <form onSubmit={handleActivate} className="space-y-3">
              <div className="flex justify-between items-center mb-1">
                <label className="text-slate-300 text-xs font-semibold">تفعيل بكود ترخيص المؤسسات</label>
                <button
                  type="button"
                  onClick={() => setShowManualCode(false)}
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold underline transition-colors"
                >
                  العودة للاشتراك السريع
                </button>
              </div>

              {/* Device ID display */}
              <div className="relative flex items-center">
                <input
                  type="text"
                  readOnly
                  value={fetchingId ? 'جاري التعرف...' : `معرّف الجهاز: ${deviceId}`}
                  className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-3 py-2 text-emerald-400 text-xs font-bold font-mono text-center select-all"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={handleCopyDeviceId}
                  className="absolute left-2 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded"
                >
                  {copied ? 'تم' : 'نسخ'}
                </button>
              </div>

              {/* Activation Code Input */}
              <input
                type="text"
                inputMode="numeric"
                maxLength={9}
                required
                placeholder="أدخل كود التفعيل (9 أرقام)"
                value={activationCode}
                onChange={handleCodeChange}
                className="w-full bg-slate-950/90 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-sm font-bold font-mono tracking-widest text-center focus:border-emerald-500 focus:outline-none"
                dir="ltr"
              />

              <button
                type="submit"
                disabled={loading || activationCode.length !== 9}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl font-bold text-xs transition-all active:scale-[0.98]"
              >
                {loading ? 'جاري التحقق...' : 'تفعيل الكود والدخول'}
              </button>
            </form>
          )}

          {/* Read-Only fallback for expired accounts */}
          {isExpired && (
            <div className="text-center pt-0.5">
              <button
                type="button"
                onClick={handleViewOnlyAccess}
                className="text-xs text-slate-400 hover:text-slate-300 underline transition-colors cursor-pointer"
              >
                تصفح البيانات السابقة (وضع العرض فقط)
              </button>
            </div>
          )}

        </div>

        {/* Footer Trust Bar */}
        <div className="auth-trust py-2.5 px-6 bg-slate-950/80 border-t border-slate-800/80 text-center flex items-center justify-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[10px] text-slate-400 font-medium">
             كافة البيانات المحاسبية مخزنة محلياً ومشفرة 100% على هذا الجهاز
          </p>
        </div>

      </div>
    </div>
  );
};

export default AuthGate;
