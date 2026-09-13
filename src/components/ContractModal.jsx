import { useState, useEffect, useRef } from 'react';
import { contractService, installmentService, customerService, settingsService } from '../services/database';
import { getDefaultDueDate } from '../utils/dateUtils';
import { sanitizePhoneNumber } from '../utils/phoneUtils';
import { isWebContactsSupported, isNativePlatform, pickContactDirectly } from '../services/contactService';
import ContactPickerModal from './ContactPickerModal';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const getPaidAmount = (installment) => {
  const actualPaid = Number(installment?.actual_paid || 0);
  const status = String(installment?.status || '').trim().toLowerCase();
  return status === 'paid' && actualPaid <= 0
    ? Number(installment?.amount || 0)
    : actualPaid;
};

const ContractModal = ({ isOpen, onClose, onSave, customerId, customerName, isBlacklisted, contract = null, themeColor = 'blue' }) => {
  const guarantorNameInputRef = useRef(null);
  const themeBg = themeColor === 'indigo' ? 'bg-indigo-600' : 'bg-emerald-600';
  const themeFocus = themeColor === 'indigo' ? 'focus:border-indigo-500' : 'focus:border-blue-500';
  const themeShadow = themeColor === 'indigo' ? 'shadow-indigo-600/30' : 'shadow-emerald-600/30';
  const [formData, setFormData] = useState({
    title: '',
    capital_amount: '',
    total_amount: '',
    monthly_amount: '',
    installment_count: '',
    first_due_date: new Date().toISOString().split('T')[0],
    guarantor_name: '',
    guarantor_phone: ''
  });
  const [loading, setLoading] = useState(false);
  const [salaryDaySync, setSalaryDaySync] = useState(false);
  const [customerCreditScore, setCustomerCreditScore] = useState('A');
  const [enableReschedule, setEnableReschedule] = useState(false);
  const [paidCredit, setPaidCredit] = useState(0);
  const [showGuarantorPicker, setShowGuarantorPicker] = useState(false);
  const isEditing = Boolean(contract?.id);
  const privacyMode = usePrivacyMode();

  const handlePickGuarantorContact = async () => {
    if (isWebContactsSupported() || isNativePlatform()) {
      try {
        const result = await pickContactDirectly();
        if (result && !result.unsupported) {
          setFormData(prev => ({
            ...prev,
            guarantor_name: result.name || prev.guarantor_name,
            guarantor_phone: result.phone || prev.guarantor_phone
          }));
          return;
        }
      } catch (e) {
        console.warn('Direct pick guarantor failed:', e);
      }
    }
    setShowGuarantorPicker(true);
  };

  const handleGuarantorSelected = (contact) => {
    if (!contact) return;
    setFormData(prev => ({
      ...prev,
      guarantor_name: contact.name || prev.guarantor_name,
      guarantor_phone: contact.phone || prev.guarantor_phone
    }));
  };

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      if (customerId) checkCreditScore();

      if (contract) {
        setEnableReschedule(false);
        setPaidCredit(Math.round(Number(contract.total_paid || 0)));
        setFormData({
          title: contract.title || '',
          capital_amount: contract.capital_amount ?? '',
          total_amount: contract.total_amount ?? '',
          monthly_amount: '',
          installment_count: '',
          first_due_date: contract.creation_date?.split('T')?.[0] || new Date().toISOString().split('T')[0],
          guarantor_name: contract.guarantor_name || '',
          guarantor_phone: contract.guarantor_phone || ''
        });

        installmentService.getByContractId(contract.id).then((items) => {
          const paid = items.reduce((sum, item) => sum + getPaidAmount(item), 0);
          const firstPending = items.find(item => item.status !== 'paid')?.due_date;
          setPaidCredit(Math.round(paid));
          if (firstPending) {
            setFormData(prev => ({ ...prev, first_due_date: firstPending }));
          }
        }).catch(error => console.error('Load contract installments error:', error));
      } else {
        setEnableReschedule(false);
        setPaidCredit(0);
        setFormData({
          title: '',
          capital_amount: '',
          total_amount: '',
          monthly_amount: '',
          installment_count: '',
          first_due_date: salaryDaySync ? getDefaultDueDate() : new Date().toISOString().split('T')[0],
          guarantor_name: '',
          guarantor_phone: ''
        });
      }
    }
  }, [isOpen, salaryDaySync, contract, customerId]);

  const loadSettings = async () => {
    const salary = await settingsService.get('salary_day_sync');
    setSalaryDaySync(salary === 'true');
  };

  const checkCreditScore = async () => {
    const score = await customerService.getCreditScore(customerId);
    setCustomerCreditScore(score);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!isEditing && isBlacklisted) {
      const confirmed = window.confirm('⚠️ هذا العميل في القائمة السوداء. هل تريد المتابعة؟');
      if (!confirmed) return;
    }

    if (!isEditing && customerCreditScore === 'C') {
      const confirmed = window.confirm('⚠️ هذا العميل لديه تقييم ائتماني ضعيف (C). هل تريد المتابعة؟');
      if (!confirmed) return;
    }

    setLoading(true);
    
    try {
      const title = formData.title.trim() || 'عقد جديد';
      const capitalAmount = parseFloat(formData.capital_amount) || 0;
      const totalAmount = parseFloat(formData.total_amount) || 0;
      const monthlyAmount = parseFloat(formData.monthly_amount) || 0;
      const months = parseFloat(formData.installment_count) || 0;
      const totalMonths = Math.ceil(months);
      const numberOfRegularMonths = totalMonths - 1;
      const totalRegularAmount = monthlyAmount * numberOfRegularMonths;
      const lastInstallmentAmount = totalAmount - totalRegularAmount;

      if (isEditing) {
        if (enableReschedule) {
          if (paidCredit > totalAmount) {
            alert('المدفوع الحالي أكبر من إجمالي العقد الجديد. ارفع الإجمالي أو لا تستخدم إعادة الجدولة.');
            setLoading(false);
            return;
          }

          const confirmed = window.confirm(
            `سيتم إعادة بناء جدول الأقساط وتوزيع المدفوع السابق (${formatPrivateAmount(paidCredit, privacyMode, 'ر.س')}) على الأقساط الجديدة.\n\nهل تريد المتابعة؟`
          );

          if (!confirmed) {
            setLoading(false);
            return;
          }

          await contractService.reschedule(
            contract.id,
            {
              title,
              capital_amount: capitalAmount,
              total_amount: totalAmount,
              guarantor_name: formData.guarantor_name || null,
              guarantor_phone: formData.guarantor_phone ? sanitizePhoneNumber(formData.guarantor_phone) : null
            },
            {
              monthly_amount: monthlyAmount,
              installment_count: months,
              first_due_date: formData.first_due_date
            }
          );

          onSave?.();
          onClose();
          return;
        }

        await contractService.update(contract.id, {
          title,
          capital_amount: capitalAmount,
          total_amount: totalAmount,
          guarantor_name: formData.guarantor_name || null,
          guarantor_phone: formData.guarantor_phone ? sanitizePhoneNumber(formData.guarantor_phone) : null
        });

        onSave?.();
        onClose();
        return;
      }

      // Validation: Check if months are sufficient
      // The last month can have extra amount to cover the total
      // Example: 7600 total, 500 monthly, 15 months
      // 14 months × 500 = 7000, last month = 600 (500 + 100 extra) ✓

      // Last month must be at least the monthly amount (can be more)
      if (lastInstallmentAmount > monthlyAmount * 2) {
        // If last month needs more than 2x monthly, reject
        const requiredMonths = Math.ceil((totalAmount - (monthlyAmount * 2)) / monthlyAmount) + 1;
        alert(`❌ عدد الأشهر غير كافٍ!\n\nالمطلوب: ${requiredMonths} أشهر على الأقل\nالمُدخل: ${months} شهر\n\nلتغطية مبلغ ${formatPrivateAmount(totalAmount, privacyMode, 'ريال')} بقسط شهري ${formatPrivateAmount(monthlyAmount, privacyMode, 'ريال')}`);
        setLoading(false);
        return;
      }

      if (lastInstallmentAmount < monthlyAmount) {
        const maxMonths = Math.max(1, Math.floor(totalAmount / monthlyAmount));
        alert(`❌ عدد الأشهر زائد!\n\nالحد الأقصى المناسب: ${maxMonths} شهر\nالمُدخل: ${months} شهر\n\nالقسط الأخير سيصبح ${formatPrivateAmount(lastInstallmentAmount, privacyMode, 'ريال')}، ويجب أن يكون مساوياً للقسط الشهري أو أعلى منه.`);
        setLoading(false);
        return;
      }

      const contractId = await contractService.create({
        customer_id: customerId,
        title: title,
        capital_amount: capitalAmount,
        total_amount: totalAmount,
        guarantor_name: formData.guarantor_name || null,
        guarantor_phone: formData.guarantor_phone ? sanitizePhoneNumber(formData.guarantor_phone) : null
      });

      const firstDate = new Date(formData.first_due_date);
      
      // Smart calculation: distribute total amount across months
      // Example: 7600 total, 500 monthly, 15 months
      // 14 months × 500 = 7000
      // Last month = 7600 - 7000 = 600
      
      // All months except last get the regular monthly amount
      const regularInstallmentAmount = monthlyAmount;
      for (let i = 0; i < totalMonths; i++) {
        const dueDate = new Date(firstDate);
        dueDate.setMonth(dueDate.getMonth() + i);
        
        // Determine amount for this installment
        let installmentAmount;
        
        if (i < numberOfRegularMonths) {
          // Regular months get the monthly amount
          installmentAmount = regularInstallmentAmount;
        } else {
          // Last month gets the remainder (may be more than monthly amount)
          installmentAmount = lastInstallmentAmount;
        }
        
        // Handle fractional months for the last installment
        if (i === totalMonths - 1 && months % 1 !== 0) {
          const fractionalPart = months % 1;
          installmentAmount = installmentAmount * fractionalPart;
        }
        
        // Only create installment if amount > 0
        if (installmentAmount > 0) {
          await installmentService.create({
            contract_id: contractId,
            amount: Math.round(installmentAmount * 100) / 100,
            due_date: dueDate.toISOString().split('T')[0]
          });
        }
      }

      onSave();
      onClose();
    } catch (error) {
      console.error('Error creating contract:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalAmount = parseFloat(formData.total_amount) || 0;
  const installmentCount = parseFloat(formData.installment_count) || 0;
  const monthlyAmount = parseFloat(formData.monthly_amount) || 0;
  const previewTotalMonths = Math.ceil(installmentCount);
  const previewRegularMonths = Math.max(0, previewTotalMonths - 1);
  const previewLastInstallment = totalAmount - (monthlyAmount * previewRegularMonths);
  const hasInstallmentPreview = totalAmount > 0 && installmentCount > 0 && monthlyAmount > 0;
  const previewNeedsMoreMonths = hasInstallmentPreview && previewLastInstallment > monthlyAmount * 2;
  const previewHasTooManyMonths = hasInstallmentPreview && previewLastInstallment < monthlyAmount;
  const previewMaxMonths = monthlyAmount > 0 ? Math.max(1, Math.floor(totalAmount / monthlyAmount)) : 0;
  const previewRemainingAfterPaid = Math.max(0, Math.round(totalAmount - paidCredit));

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 modal-safe-area">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden max-h-[90dvh] flex flex-col">
        <div className={`${themeColor === 'indigo' ? 'bg-indigo-900/50' : 'bg-slate-700'} px-6 py-4 flex justify-between items-center shrink-0`}>
          <div>
            <h3 className="text-lg font-bold text-white">{isEditing ? 'تعديل العقد' : `عقد جديد - ${customerName}`}</h3>
            {!isEditing && customerCreditScore !== 'A' && (
              <div className={`text-xs mt-1 px-2 py-0.5 rounded inline-block ${
                customerCreditScore === 'B' ? 'bg-amber-500/20 text-amber-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                التقييم الائتماني: {customerCreditScore}
              </div>
            )}
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {!isEditing && isBlacklisted && (
          <div className="bg-rose-500/20 border border-rose-500/50 text-rose-400 px-4 py-3 m-4 rounded-xl">
            ⚠️ تحذير: هذا العميل في القائمة السوداء
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
          <div>
            <label className="block text-sm text-slate-400 mb-2">وصف العقد / المنتج</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 ${themeFocus} focus:outline-none transition-colors`}
              placeholder="مثال: جهاز iPhone 15 Pro (أو اتركه فارغاً لـ 'عقد جديد')"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">
              رأس المال (للمالك فقط)
              <span className="text-rose-400 text-xs mr-1">* مخفي عن العميل</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.capital_amount}
              onChange={(e) => setFormData({ ...formData, capital_amount: e.target.value })}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none transition-colors"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">إجمالي مبلغ العقد</label>
            <input
              type="number"
              step="0.01"
              value={formData.total_amount}
              onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 ${themeFocus} focus:outline-none transition-colors`}
              placeholder="0.00"
              required
            />
          </div>

          {isEditing && (
            <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-white font-bold text-sm">إعادة جدولة الأقساط</p>
                  <p className="text-slate-400 text-xs mt-1">توزيع المدفوع السابق على جدول جديد</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEnableReschedule(value => !value)}
                  className={`w-14 h-8 rounded-full transition-colors relative shrink-0 ${enableReschedule ? 'bg-emerald-500' : 'bg-slate-600'}`}
                >
                  <span className={`absolute top-1 w-6 h-6 rounded-full bg-white transition-transform ${enableReschedule ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-slate-500">المدفوع الحالي</p>
                   <p className="text-emerald-400 font-black mt-1">{formatPrivateAmount(paidCredit, privacyMode, 'ر.س')}</p>
                </div>
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-slate-500">المتبقي بعد الجدولة</p>
                   <p className="text-rose-400 font-black mt-1">{formatPrivateAmount(previewRemainingAfterPaid, privacyMode, 'ر.س')}</p>
                </div>
              </div>
            </div>
          )}

          {(!isEditing || enableReschedule) && (
            <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-2">القسط الشهري</label>
              <input
                type="number"
                step="0.01"
                value={formData.monthly_amount}
                onChange={(e) => setFormData({ ...formData, monthly_amount: e.target.value })}
                className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white ${themeFocus} focus:outline-none transition-colors`}
                placeholder="0.00"
                required={!isEditing || enableReschedule}
              />
            </div>

            <div>
              <label className="block text-sm text-slate-400 mb-2">عدد الأقساط</label>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={formData.installment_count}
                onChange={(e) => setFormData({ ...formData, installment_count: e.target.value })}
                className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white ${themeFocus} focus:outline-none transition-colors`}
                placeholder="مثال: 12 أو 3.5"
                required={!isEditing || enableReschedule}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">أول قسط</label>
            <input
              type="date"
              value={formData.first_due_date}
              onChange={(e) => setFormData({ ...formData, first_due_date: e.target.value })}
              className={`w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white ${themeFocus} focus:outline-none transition-colors`}
            />
          </div>

          {hasInstallmentPreview && (
            <div className={`rounded-xl p-4 text-center border ${
              previewNeedsMoreMonths || previewHasTooManyMonths
                ? 'bg-rose-500/10 border-rose-500/40'
                : 'bg-slate-700/50 border-slate-600'
            }`}>
              <p className="text-slate-400 text-sm mb-1">توزيع الأقساط</p>
              {previewNeedsMoreMonths ? (
                <p className="text-rose-300 text-sm leading-6">
                   عدد الأقساط غير كافٍ. القسط الأخير سيصبح {formatPrivateAmount(previewLastInstallment, privacyMode, 'ريال')}.
                </p>
              ) : previewHasTooManyMonths ? (
                <p className="text-rose-300 text-sm leading-6">
                  عدد الأقساط زائد. الحد الأقصى المناسب {previewMaxMonths} شهر.
                </p>
              ) : (
                <>
                  {isEditing && enableReschedule && paidCredit > 0 && (
                    <p className="text-emerald-300 text-sm leading-6 mb-2">
                       سيتم خصم {formatPrivateAmount(paidCredit, privacyMode, 'ر.س')} من أول الأقساط الجديدة.
                    </p>
                  )}
                  {previewRegularMonths > 0 && (
                    <p className="text-lg text-amber-400">
                       الأقساط 1-{previewRegularMonths}: <span className="font-bold">{formatPrivateAmount(monthlyAmount, privacyMode, 'ريال')}</span>
                    </p>
                  )}
                  <p className="text-slate-500 text-xs mt-1">
                     القسط الأخير: {formatPrivateAmount(previewLastInstallment, privacyMode, 'ريال')}
                  </p>
                </>
              )}
            </div>
          )}

            </>
          )}

          {/* Guarantor Section */}
          <div className="border-t border-slate-700 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-400 flex items-center gap-2">
                <span>👤</span>
                معلومات الكفيل (اختياري)
              </h4>
              <button
                type="button"
                onClick={handlePickGuarantorContact}
                className="text-xs bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/40 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
                <span>إضافة من جهات الاتصال</span>
              </button>
            </div>
            
            <div className="space-y-3">
              <input
                ref={guarantorNameInputRef}
                type="text"
                name="guarantor_name"
                id="guarantor-name"
                autoComplete="name"
                value={formData.guarantor_name}
                onChange={(e) => setFormData({ ...formData, guarantor_name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
                placeholder="اسم الكفيل"
              />
              
              <input
                type="tel"
                name="guarantor_tel"
                id="guarantor-tel"
                autoComplete="tel"
                value={formData.guarantor_phone}
                onChange={(e) => setFormData({ ...formData, guarantor_phone: e.target.value })}
                onBlur={(e) => {
                  const sanitized = sanitizePhoneNumber(e.target.value);
                  setFormData(prev => ({ ...prev, guarantor_phone: sanitized }));
                }}
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-colors"
                placeholder="رقم هاتف الكفيل"
                dir="ltr"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full ${themeBg} text-white py-3 rounded-xl font-bold btn-press disabled:opacity-50 shadow-lg ${themeShadow}`}
          >
            {loading ? 'جاري الحفظ...' : (isEditing && enableReschedule ? 'حفظ وإعادة الجدولة' : isEditing ? 'حفظ التعديلات' : 'إنشاء العقد والأقساط')}
          </button>
        </form>
      </div>
    </div>

    {/* نافذة استرداد جهات الاتصال للكفيل */}
    <ContactPickerModal
      isOpen={showGuarantorPicker}
      onClose={() => setShowGuarantorPicker(false)}
      onSelectContact={handleGuarantorSelected}
      title="إضافة الكفيل من جهات الاتصال"
    />
  </>
  );
};

export default ContractModal;
