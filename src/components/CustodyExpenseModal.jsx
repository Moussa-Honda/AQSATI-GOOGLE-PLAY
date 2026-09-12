import { useEffect, useState } from 'react';
import { portfolioExpenseService } from '../services/database';

const CustodyExpenseModal = ({ portfolioId, expense = null, onClose, onSaved }) => {
  const [formData, setFormData] = useState({
    amount: expense?.amount?.toString() || '',
    description: expense?.description || '',
    date: expense?.date || new Date().toISOString().split('T')[0]
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setFormData({
      amount: expense?.amount?.toString() || '',
      description: expense?.description || '',
      date: expense?.date || new Date().toISOString().split('T')[0]
    });
  }, [expense]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.amount || !formData.description) {
      alert('يرجى إدخال المبلغ والوصف');
      return;
    }

    setLoading(true);
    try {
      const data = {
        portfolio_id: portfolioId,
        amount: parseFloat(formData.amount),
        description: formData.description,
        date: formData.date
      };

      if (expense) {
        await portfolioExpenseService.update(expense.id, data);
      } else {
        await portfolioExpenseService.create(data);
      }
      onSaved();
    } catch (err) {
      console.error('Failed to save expense:', err);
      alert('حدث خطأ أثناء الحفظ');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center modal-safe-area">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={onClose} />
      
      <div className="relative w-full max-w-sm bg-slate-800 rounded-[2.5rem] border border-slate-700 shadow-2xl overflow-hidden">
        <div className="p-6 text-center border-b border-slate-700">
          <h3 className="text-xl font-bold text-white">{expense ? 'تعديل المصروف' : 'تسجيل مصروف جديد'}</h3>
          <p className="text-slate-400 text-xs mt-1">سيتم خصم المبلغ من رصيد العهدة</p>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="text-center">
            <label className="block text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">المبلغ</label>
            <div className="relative inline-block w-full">
              <input
                type="number"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                className="w-full bg-transparent text-4xl font-black text-center text-rose-500 placeholder-rose-500/20 focus:outline-none"
                placeholder="0.00"
                autoFocus
                required
              />
              <span className="text-rose-500/50 font-bold ml-2">SAR</span>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">البيان / الوصف</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-4 text-white focus:border-blue-500 focus:outline-none transition-colors shadow-inner"
                placeholder="مثال: شراء قرطاسية"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">تاريخ الصرف</label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-4 text-white focus:border-blue-500 focus:outline-none transition-colors shadow-inner"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-bold py-5 rounded-2xl shadow-xl shadow-blue-500/20 transition-all active:scale-[0.98] disabled:opacity-50 text-lg"
          >
            {loading ? 'جاري الحفظ...' : (expense ? 'حفظ التعديل' : 'تأكيد العملية')}
          </button>
          
          <button
            type="button"
            onClick={onClose}
            className="w-full text-slate-500 font-medium py-2 hover:text-slate-300 transition-colors"
          >
            إلغاء
          </button>
        </form>
      </div>
    </div>
  );
};

export default CustodyExpenseModal;
