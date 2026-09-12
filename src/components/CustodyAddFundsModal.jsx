import { useState } from 'react';
import { portfolioService } from '../services/database';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const CustodyAddFundsModal = ({ custody, onClose, onSaved }) => {
  const [amount, setAmount] = useState('');
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
      await portfolioService.addCapital(custody.id, value, { date });
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

      <div className="relative w-full max-w-md mx-4 bg-slate-800 rounded-3xl border border-slate-700 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
          <div>
            <h3 className="text-xl font-bold text-white">إضافة مبلغ للعهدة</h3>
            <p className="text-slate-400 text-xs mt-1">{custody.name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-slate-900/60 rounded-2xl p-4 border border-slate-700">
            <p className="text-slate-500 text-xs">المبلغ المسلم حالياً</p>
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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? 'جاري إضافة المبلغ...' : 'إضافة المبلغ'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CustodyAddFundsModal;
