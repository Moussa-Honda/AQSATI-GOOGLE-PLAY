import { useState, useEffect } from 'react';
import { installmentService, contractService } from '../services/database';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

// Helper function to round numbers
const roundAmount = (amount) => {
  if (!amount || isNaN(amount)) return 0;
  return Math.round(amount);
};

const PaymentModal = ({ isOpen, onClose, onSave, installment, themeColor = 'blue', mode = 'regular' }) => {
  const isExtraMode = mode === 'extra';
  const themeFocus = themeColor === 'indigo' ? 'focus:border-indigo-500' : 'focus:border-emerald-500';
  const themeBg = themeColor === 'indigo' ? 'bg-indigo-600' : 'bg-emerald-600';
  const themeShadow = themeColor === 'indigo' ? 'shadow-indigo-600/30' : 'shadow-emerald-600/30';
  const [formData, setFormData] = useState({
    actual_paid: '',
    discount: ''
  });
  const [loading, setLoading] = useState(false);
  const [contractRemaining, setContractRemaining] = useState(0);
  const [excessAmount, setExcessAmount] = useState(0);
  const [shortageAmount, setShortageAmount] = useState(0);
  const privacyMode = usePrivacyMode();

  useEffect(() => {
    if (installment) {
      const remaining = roundAmount(installment.amount - (installment.actual_paid || 0));
      setFormData({
        actual_paid: isExtraMode ? '' : remaining.toString(),
        discount: ''
      });
      loadContractRemaining();
    }
  }, [installment, isExtraMode]);

  useEffect(() => {
    const paid = parseFloat(formData.actual_paid) || 0;
    const discount = parseFloat(formData.discount) || 0;
    const totalInput = paid + discount;
    const installmentAmount = installment?.amount || 0;
    const currentPaid = installment?.actual_paid || 0;
    const remainingToPay = installmentAmount - currentPaid;
    
    if (totalInput > remainingToPay) {
      setExcessAmount(roundAmount(totalInput - remainingToPay));
      setShortageAmount(0);
    } else if (totalInput < remainingToPay && totalInput > 0) {
      setShortageAmount(roundAmount(remainingToPay - totalInput));
      setExcessAmount(0);
    } else {
      setExcessAmount(0);
      setShortageAmount(0);
    }
  }, [formData.actual_paid, formData.discount, installment]);

  const loadContractRemaining = async () => {
    if (!installment?.contract_id) return;
    
    try {
      const remaining = await contractService.getRemainingBalance(installment.contract_id);
      setContractRemaining(roundAmount(remaining));
    } catch (error) {
      console.error('Error loading contract:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const actualPaid = parseFloat(formData.actual_paid) || 0;
      const discount = isExtraMode ? 0 : (parseFloat(formData.discount) || 0);
      
      const totalPayment = actualPaid + discount;
      const newRemaining = contractRemaining - totalPayment;
      
      if (newRemaining <= 0 && discount > 0) {
        const confirmed = window.confirm(
          `سيتم إغلاق العقد بعد هذا الدفع بخصم ${formatPrivateAmount(discount, privacyMode, 'ر.س')}. هل تريد المتابعة؟`
        );
        if (!confirmed) {
          setLoading(false);
          return;
        }
      }

      await installmentService.pay(
        installment.id,
        actualPaid,
        null,
        discount
      );

      await onSave?.();
      onClose();
      setFormData({ actual_paid: '', discount: '' });
    } catch (error) {
      console.error('Payment error:', error);
      alert('حدث خطأ أثناء تسجيل الدفع');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !installment) return null;

  const installmentRemaining = roundAmount(installment.amount - (installment.actual_paid || 0));
  const newRemaining = contractRemaining - (parseFloat(formData.actual_paid) || 0) - (parseFloat(formData.discount) || 0);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 modal-safe-area">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden max-h-[90dvh] flex flex-col">
        {/* Header */}
        <div className={`${themeColor === 'indigo' ? 'bg-indigo-900/50' : 'bg-slate-700'} px-6 py-4 flex justify-between items-center shrink-0`}>
          <div>
            <h3 className="text-lg font-bold text-white">{isExtraMode ? 'المبلغ الإضافي' : 'تسديد قسط'}</h3>
            <p className="text-slate-400 text-sm">{installment.contract_title}</p>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
          {/* Installment Info Card */}
          <div className="bg-slate-700/50 rounded-xl p-4 border border-slate-600">
            <div className="flex justify-between mb-2">
              <span className="text-slate-400">مبلغ القسط</span>
              <span className="text-white font-bold">{formatPrivateAmount(installment.amount, privacyMode, 'ر.س')}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-slate-400">المتبقي من القسط</span>
              <span className="text-rose-400 font-bold">{formatPrivateAmount(installmentRemaining, privacyMode, 'ر.س')}</span>
            </div>
            <div className="flex justify-between mb-2">
              <span className="text-slate-400">المتبقي من العقد</span>
              <span className="text-amber-400 font-bold">{formatPrivateAmount(contractRemaining, privacyMode, 'ر.س')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">تاريخ الاستحقاق</span>
              <span className="text-white">{installment.due_date}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Actual Paid */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">{isExtraMode ? 'المبلغ الإضافي المستلم' : 'المبلغ المدفوع'}</label>
              <input
                type="number"
                step="0.01"
                value={formData.actual_paid}
                onChange={(e) => setFormData({ ...formData, actual_paid: e.target.value })}
                className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 ${themeFocus} focus:outline-none transition-colors`}
                placeholder="0.00"
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                {isExtraMode
                  ? 'يسدد القسط الحالي أولاً، ثم يوزع الباقي من آخر قسط في الجدول للأعلى.'
                  : 'المبلغ المستلم فعلياً من العميل'}
              </p>
            </div>

            {/* Excess Warning */}
            {excessAmount > 0 && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
                <p className="text-blue-400 text-sm">
                   💡 سيتم توزيع الفائض ({formatPrivateAmount(excessAmount, privacyMode, 'ر.س')}) من آخر قسط في الجدول إلى الأعلى
                </p>
              </div>
            )}

            {shortageAmount > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                <p className="text-amber-400 text-sm">
                   ⚠️ سيتم تسجيل المبلغ كدفعة جزئية، والمتبقي ({formatPrivateAmount(shortageAmount, privacyMode, 'ر.س')}) يبقى على نفس القسط
                </p>
              </div>
            )}

            {/* Discount */}
            {!isExtraMode && (
              <div>
                <label className="block text-sm text-slate-400 mb-2">
                  خصم التسوية المبكرة (اختياري)
                  <span className="text-amber-400 text-xs mr-2">للعقود التي تريد إغلاقها</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.discount}
                  onChange={(e) => setFormData({ ...formData, discount: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none transition-colors"
                  placeholder="0.00"
                />
              </div>
            )}

            {/* New Balance Preview */}
            <div className="bg-slate-700/30 rounded-xl p-4 border border-slate-600">
              <p className="text-slate-400 text-sm mb-2">المتبقي في العقد بعد الدفع:</p>
              <p className={`text-2xl font-bold ${newRemaining <= 0 ? 'text-emerald-400' : 'text-white'}`}>
                {formatPrivateAmount(Math.max(0, roundAmount(newRemaining)), privacyMode, 'ر.س')}
                {newRemaining <= 0 && <span className="text-sm mr-2">✓ سيتم إغلاق العقد</span>}
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full ${themeBg} text-white py-4 rounded-xl font-bold text-lg hover:opacity-90 transition-colors disabled:opacity-50 shadow-lg ${themeShadow}`}
            >
              {loading ? 'جاري التسجيل...' : 'تأكيد الدفع'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
