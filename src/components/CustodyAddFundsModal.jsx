import { useState } from 'react';
import { portfolioService } from '../services/database';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const CustodyAddFundsModal = ({ custody, onClose, onSaved }) => {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('transfer');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const privacyMode = usePrivacyMode();

  const handleSubmit = async (event) => {
    event.preventDefault();
    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
      alert('يرجى إدخال مبلغ أكبر من صفر');
      return;
    }

    setLoading(true);
    try {
      await portfolioService.addCapital(custody.id, value, {
        date,
        payment_method: paymentMethod,
        notes: notes.trim()
      });
      onSaved();
    } catch (error) {
      console.error('Failed to add custody funds:', error);
      alert('حدث خطأ أثناء إضافة المبلغ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center modal-safe-area" dir="rtl">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md mx-4 bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center shrink-0">
          <div>
            <h3 className="text-xl font-bold text-white">إضافة مبلغ للعهدة</h3>
            <p className="text-slate-400 text-xs mt-1">{custody.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-700/50">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
          <div className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700">
            <p className="text-slate-500 text-xs font-medium">المبلغ المسلم حالياً</p>
            <p className="text-white text-lg font-black mt-1">
              {formatPrivateAmount(custody.capital, privacyMode)}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">المبلغ المراد إضافته</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="مثال: 3000"
              autoFocus
              required
            />
          </div>

          {/* اختيار طريقة الاستلام: تحويل أو نقدي */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">طريقة الاستلام</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPaymentMethod('transfer')}
                className={`py-2.5 px-3 rounded-xl border font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer ${
                  paymentMethod === 'transfer'
                    ? 'bg-blue-600/20 border-blue-500 text-blue-400 shadow-sm ring-1 ring-blue-500/50'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                }`}
              >
                <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <span>تحويل</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`py-2.5 px-3 rounded-xl border font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer ${
                  paymentMethod === 'cash'
                    ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400 shadow-sm ring-1 ring-emerald-500/50'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                }`}
              >
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span>نقدي</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">تاريخ الاستلام</label>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:border-blue-500 focus:outline-none transition-colors"
              required
            />
          </div>

          {/* خانة الملاحظات */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">ملاحظات (اختياري)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors text-sm resize-none"
              placeholder="مثال: رقم الحوالة، اسم المحول، أو أي تفاصيل إضافية..."
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? 'جاري إضافة المبلغ...' : 'إضافة المبلغ'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CustodyAddFundsModal;
