import { useState, useEffect } from 'react';
import { Clipboard } from '@capacitor/clipboard';
import licenseService from '../services/license';

const SUPPORT_PHONE_DISPLAY = '+966556854162';
const SUPPORT_WHATSAPP_PHONE = '966556854162';

const LicenseGate = ({ onActivated, isModal = false }) => {
  const [deviceId, setDeviceId] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadDeviceId();
  }, []);

  const loadDeviceId = async () => {
    const id = await licenseService.getDeviceId();
    setDeviceId(id);
  };

  const handleCopy = async () => {
    await Clipboard.write({ string: deviceId });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSupportWhatsApp = () => {
    const message = `السلام عليكم، لدي استفسار بخصوص الدعم الفني لتطبيق أقساطي. رقم الجهاز: ${deviceId || ''}`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleActivate = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    
    try {
      const result = await licenseService.activateLicense(code.trim());
      if (result.success) {
        onActivated(result.key, result.expiry);
      }
    } catch (err) {
      let msg = 'فشل التفعيل: تأكد من الكود وحاول مجدداً';
      const errCode = err.message || '';
      
      if (errCode.includes('ERR_EXPIRED')) msg = 'عذراً، هذا الكود منتهي الصلاحية';
      else if (errCode.includes('ERR_WRONG_CODE')) msg = 'هذا الكود غير صالح لهذا الجهاز';
      else if (errCode.includes('ERR_INVALID_FORMAT')) msg = 'تنسيق الكود غير صحيح (9 أرقام)';
      else if (errCode.includes('ERR_TIME_TAMPERED')) msg = 'تنبيه: تم اكتشاف تلاعب في وقت الجهاز';
      else if (errCode.includes('ERR_COMPROMISED')) msg = 'تم اكتشاف بيئة غير آمنة (Root/Emulator)';
      
      setError(msg);
    } finally {
      setLoading(false);
    }

  };

  return (
    <div className={`${!isModal ? 'fixed inset-0 z-[9999] bg-slate-950 flex items-start justify-center overflow-y-auto modal-safe-area text-right' : 'text-right'}`} dir="rtl">
      <div className={`w-full ${!isModal ? 'max-w-md shrink-0 my-auto' : ''} bg-slate-900 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden`}>
        {/* Header */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 p-8 text-center">
          <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm">
            <span className="text-4xl">🛡️</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">تفعيل التطبيق</h1>
          <p className="text-emerald-100/80 text-sm">برجاء إدخال كود التفعيل للمتابعة</p>
        </div>

        {/* Content */}
        <div className="p-8 space-y-6">
          {/* Device ID Section */}
          <div className="space-y-2">
            <label className="text-slate-400 text-xs font-medium mr-1">معرف الجهاز الخاص بك</label>
            <div className="flex gap-2">
              <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 font-mono text-emerald-400 text-center text-sm tracking-wider">
                {deviceId || 'جاري التحميل...'}
              </div>
              <button 
                onClick={handleCopy}
                className={`px-4 rounded-xl transition-all ${copied ? 'bg-emerald-600' : 'bg-slate-800 hover:bg-slate-700'} text-white flex items-center justify-center`}
              >
                {copied ? '✅' : '📋'}
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mr-1 italic">قم بنسخ هذا المعرف وأرسله للمطور للحصول على الكود</p>
          </div>

          <div className="h-px bg-slate-800" />

          <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-white text-sm font-bold">لتجديد الاشتراك</p>
                <p className="text-emerald-300 text-sm font-mono mt-1" dir="ltr">{SUPPORT_PHONE_DISPLAY}</p>
              </div>
              <button
                type="button"
                onClick={handleSupportWhatsApp}
                className="h-10 px-4 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-500 transition-colors active:scale-95"
              >
                واتساب
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-5">
              يرسل الزر رقم الجهاز تلقائيًا حتى تحصل على كود التجديد الصحيح.
            </p>
          </div>

          {/* Activation Code Section */}
          <div className="space-y-2">
            <label className="text-slate-400 text-xs font-medium mr-1">كود التفعيل (9 أرقام)</label>
            <input
              type="tel"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="مثلاً: 912345678"
              maxLength={9}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-4 text-white text-2xl font-bold focus:border-emerald-500 focus:outline-none transition-colors text-center tracking-[0.5em]"
            />
          </div>

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-xl text-xs text-center animate-pulse">
              ⚠️ {error}
            </div>
          )}

          <button
            onClick={handleActivate}
            disabled={loading || !code.trim()}
            className={`w-full py-4 rounded-2xl font-bold text-lg shadow-xl transition-all ${
              loading || !code.trim() 
                ? 'bg-slate-800 text-slate-500 opacity-50' 
                : 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-emerald-900/20 active:scale-95'
            }`}
          >
            {loading ? 'جاري التحقق...' : 'تفعيل الآن'}
          </button>
        </div>

        {/* Footer */}
        <div className="bg-slate-950/50 p-4 text-center border-t border-slate-800">
           <p className="text-[10px] text-slate-600">نظام حماية أقساطي للأقساط والديون © 2026</p>
        </div>
      </div>
    </div>
  );
};

export default LicenseGate;
