import { useState, useEffect, useRef } from 'react';
import { contractService } from '../services/database';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const EarlySettlementModal = ({ isOpen, onClose, onSave, contract, themeColor = 'blue' }) => {
  const themeBg = themeColor === 'indigo' ? 'bg-indigo-600' : 'bg-emerald-600';
  const themeFocus = themeColor === 'indigo' ? 'focus:border-indigo-500' : 'focus:border-emerald-500';
  const themeShadow = themeColor === 'indigo' ? 'shadow-indigo-600/30' : 'shadow-emerald-600/30';
  const [discountAmount, setDiscountAmount] = useState('');
  const [remainingBalance, setRemainingBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const isSubmittingRef = useRef(false);
  const privacyMode = usePrivacyMode();

  useEffect(() => {
    if (isOpen && contract) {
      loadRemainingBalance();
      setDiscountAmount('');
      isSubmittingRef.current = false;
    }
  }, [isOpen, contract]);

  const loadRemainingBalance = async () => {
    const balance = await contractService.getRemainingBalance(contract.id);
    setRemainingBalance(balance);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || isSubmittingRef.current) return;
    
    const discount = parseFloat(discountAmount) || 0;
    const finalAmount = remainingBalance - discount;
    
    if (finalAmount < 0) {
      alert('قيمة الخصم لا يمكن أن تتجاوز الرصيد المتبقي');
      return;
    }

    const confirmed = window.confirm(
      `تأكيد السداد المبكر:\n\n` +
       `الرصيد المتبقي: ${formatPrivateAmount(remainingBalance, privacyMode, 'ريال')}\n` +
       `قيمة الخصم: ${formatPrivateAmount(discount, privacyMode, 'ريال')}\n` +
       `المبلغ النهائي: ${formatPrivateAmount(finalAmount, privacyMode, 'ريال')}\n\n` +
      `هل تريد المتابعة؟`
    );

    if (!confirmed) return;

    isSubmittingRef.current = true;
    setLoading(true);
    let settlementSuccess = false;
    
    try {
      await contractService.applyEarlySettlement(contract.id, discount);
      settlementSuccess = true;
      
      // Close modal first before calling onSave to prevent UI race conditions
      onClose();
      
      // Then refresh the parent component
      if (onSave) {
        await onSave();
      }
    } catch (error) {
      console.error('Early settlement error:', error);
      // Only show error if settlement actually failed
      if (!settlementSuccess) {
        alert(error?.message ? `حدث خطأ أثناء تطبيق السداد المبكر: ${error.message}` : 'حدث خطأ أثناء تطبيق السداد المبكر');
      }
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const finalAmount = remainingBalance - (parseFloat(discountAmount) || 0);

  if (!isOpen || !contract) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 modal-safe-area">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className={`${themeColor === 'indigo' ? 'bg-indigo-900/50' : 'bg-slate-700'} px-6 py-4 flex justify-between items-center`}>
          <h3 className="text-lg font-bold text-white">سداد مبكر - {contract.title}</h3>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-slate-700/50 rounded-xl p-4 border border-slate-600">
            <p className="text-slate-400 text-sm mb-1">الرصيد المتبقي</p>
            <p className="text-2xl font-bold text-white">
               {formatPrivateAmount(remainingBalance, privacyMode, 'ريال')}
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">قيمة الخصم</label>
            <input
              type="number"
              step="0.01"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 ${themeFocus} focus:outline-none`}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
            <p className="text-slate-400 text-sm mb-1">المبلغ النهائي للتسوية</p>
            <p className="text-2xl font-bold text-emerald-400">
               {formatPrivateAmount(finalAmount, privacyMode, 'ريال')}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading || finalAmount < 0}
            className={`w-full ${themeBg} text-white py-4 rounded-xl font-bold text-lg btn-press disabled:opacity-50 shadow-lg ${themeShadow}`}
          >
            {loading ? 'جاري التنفيذ...' : 'تأكيد السداد المبكر'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default EarlySettlementModal;
