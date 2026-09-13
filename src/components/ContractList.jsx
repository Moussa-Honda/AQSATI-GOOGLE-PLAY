import { useState, useEffect, useCallback, Fragment } from 'react';
import { contractService, installmentService, customerService, settingsService } from '../services/database';
import { toHijriDate } from '../utils/dateUtils';
import ContractModal from './ContractModal';
import PaymentModal from './PaymentModal';
import EarlySettlementModal from './EarlySettlementModal';
import { Clipboard } from '@capacitor/clipboard';
import { generatePDF, PDF_MODES } from '../utils/pdfGenerator';
import { formatForWhatsApp } from '../utils/phoneUtils';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { formatPrivateAmount } from '../hooks/usePrivacyMode';

// Helper function to round numbers
const roundAmount = (amount) => {
  if (!amount || isNaN(amount)) return 0;
  return Math.round(amount);
};

const getInstallmentRemaining = (installment) => {
  const actualPaid = Number(installment?.actual_paid || 0);
  const status = String(installment?.status || '').trim().toLowerCase();
  const paidAmount = status === 'paid' && actualPaid <= 0
    ? Number(installment?.amount || 0)
    : actualPaid;
  return Number(installment?.amount || 0) - paidAmount;
};

const isInstallmentPaidForDisplay = (installment) => {
  const status = String(installment?.status || '').trim().toLowerCase();
  return status === 'paid' || (Number(installment?.actual_paid || 0) > 0 && getInstallmentRemaining(installment) <= 0.009);
};

const isInstallmentPostponedForDisplay = (installment) => {
  const status = String(installment?.status || '').trim().toLowerCase();
  return status === 'postponed' && !isInstallmentPaidForDisplay(installment);
};

const getLocalDateText = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isInstallmentLateForDisplay = (installment) => {
  const status = String(installment?.status || '').trim().toLowerCase();
  return status === 'pending'
    && !isInstallmentPaidForDisplay(installment)
    && String(installment?.due_date || '') < getLocalDateText();
};

const getInstallmentStatusGroup = (installment) => {
  if (isInstallmentPaidForDisplay(installment)) return 'paid';
  if (isInstallmentPostponedForDisplay(installment)) return 'postponed';
  return 'active'; // pending or partially paid
};

const getInstallmentPaidAmount = (installment) => {
  const status = String(installment?.status || '').trim().toLowerCase();
  const actualPaid = Number(installment?.actual_paid || 0);
  if (status === 'paid' && actualPaid <= 0) {
    return Number(installment?.amount || 0);
  }
  return Math.max(0, actualPaid);
};

const getInstallmentsForDisplay = (items = []) => {
  const scheduleNumbers = new Map(
    [...items]
      .sort((a, b) => {
        const dateOrder = String(a.due_date || '').localeCompare(String(b.due_date || ''));
        if (dateOrder !== 0) return dateOrder;

        return Number(a.id || 0) - Number(b.id || 0);
      })
      .map((item, index) => [item.id, index + 1])
  );

  const sortByDueDateAndId = (a, b) => {
    const dateOrder = String(a.due_date || '').localeCompare(String(b.due_date || ''));
    if (dateOrder !== 0) return dateOrder;

    return Number(a.id || 0) - Number(b.id || 0);
  };

  const active = [];
  const postponed = [];
  const paid = [];

  for (const item of items) {
    const group = getInstallmentStatusGroup(item);
    if (group === 'active') {
      active.push(item);
    } else if (group === 'postponed') {
      postponed.push(item);
    } else {
      paid.push(item);
    }
  }

  // Secondary priority: Due date (oldest first), then ID/schedule number
  active.sort(sortByDueDateAndId);
  postponed.sort(sortByDueDateAndId);
  paid.sort(sortByDueDateAndId);

  // Top Priority: Active (pending & partial)
  // Bottom Priority: Postponed, then Fully Paid
  return [...active, ...postponed, ...paid].map((item) => ({
    ...item,
    scheduleNumber: scheduleNumbers.get(item.id),
    statusGroup: getInstallmentStatusGroup(item),
    isBottomSection: getInstallmentStatusGroup(item) !== 'active'
  }));
};

const PostponeModal = ({ isOpen, installment, loading, onClose, onConfirm, privacyMode = false }) => {
  if (!isOpen || !installment) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 modal-safe-area">
      <div className="bg-slate-800 rounded-2xl w-full max-w-md overflow-hidden border border-slate-700">
        <div className="bg-slate-700 px-6 py-4 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-bold text-white">تأجيل القسط</h3>
            <p className="text-slate-400 text-sm">{installment.contract_title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
        </div>

        <div className="p-6 space-y-4">
          <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-4 text-sm">
            <div className="flex justify-between mb-2">
              <span className="text-slate-400">القسط</span>
               <span className="text-white font-bold">{formatPrivateAmount(installment.amount, privacyMode, 'ر.س')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">تاريخ الاستحقاق</span>
              <span className="text-white">{installment.due_date}</span>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => onConfirm('end')}
            className="w-full text-right bg-amber-500/10 border border-amber-500/40 text-amber-200 rounded-xl p-4 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
          >
            <span className="block font-bold text-white mb-1">تأجيل لنهاية الجدول</span>
            <span className="text-xs text-amber-200/80">يخرج هذا القسط من المتأخرات ويتم إنشاء قسط جديد بعد آخر قسط.</span>
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => onConfirm('next')}
            className="w-full text-right bg-blue-500/10 border border-blue-500/40 text-blue-200 rounded-xl p-4 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
          >
            <span className="block font-bold text-white mb-1">تأجيل للشهر التالي</span>
            <span className="text-xs text-blue-200/80">يخرج هذا القسط من المتأخرات ويضاف مبلغه إلى القسط القادم.</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const ContractList = ({ customerId, isReadOnly, onRenewalRequest, themeColor = 'blue' }) => {
  const themeText = themeColor === 'indigo' ? 'text-indigo-400' : 'text-blue-400';
  const themeBorder = themeColor === 'indigo' ? 'border-indigo-500/30' : 'border-blue-500/30';
  const themeLightBg = themeColor === 'indigo' ? 'bg-indigo-500/20' : 'bg-blue-500/20';
  const [contracts, setContracts] = useState([]);
  const [expandedContract, setExpandedContract] = useState(null);
  const [installments, setInstallments] = useState({});
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState(null);
  const [paymentMode, setPaymentMode] = useState('regular');
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [postponeLoading, setPostponeLoading] = useState(false);
  const [undoPostponeLoading, setUndoPostponeLoading] = useState(null);
  const [selectedPostponeInstallment, setSelectedPostponeInstallment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [quickPaymentMode, setQuickPaymentMode] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState(null);
  const [hijriEnabled, setHijriEnabled] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [autoAppendIban, setAutoAppendIban] = useState(false);
  const [ibanNumber, setIbanNumber] = useState('');
  const [showContractModal, setShowContractModal] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [showEarlySettlement, setShowEarlySettlement] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(null); // tracks contract.id being exported

  const loadData = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    const [contractsData, customerData] = await Promise.all([
      contractService.getByCustomerId(customerId),
      customerService.getById(customerId)
    ]);
    setContracts(contractsData);
    setCustomer(customerData);
    setLoading(false);
  }, [customerId]);

  const loadSettings = useCallback(async () => {
    const quick = await settingsService.get('quick_payment_mode');
    const hijri = await settingsService.get('hijri_calendar');
    const privacy = await settingsService.get('privacy_mode');
    const autoIban = await settingsService.get('auto_append_iban');
    const iban = await settingsService.get('iban_number');
    setQuickPaymentMode(quick === 'true');
    setHijriEnabled(hijri === 'true');
    setPrivacyMode(privacy === 'true');
    setAutoAppendIban(autoIban === 'true');
    setIbanNumber(iban || '');
  }, []);

  const refreshContractInstallments = useCallback(async (contractId) => {
    if (!contractId) return;

    const data = await installmentService.getByContractId(contractId);
    setInstallments(prev => ({ ...prev, [contractId]: data }));
  }, []);

  useEffect(() => {
    if (customerId) {
      loadData();
      loadSettings();
    }
  }, [customerId, loadData, loadSettings]);

  useLiveRefresh(() => {
    if (!customerId) return;
    loadData();
    loadSettings();
    if (expandedContract) {
      refreshContractInstallments(expandedContract);
    }
  }, Boolean(customerId));

  const toggleContract = async (contractId) => {
    if (expandedContract === contractId) {
      setExpandedContract(null);
    } else {
      setExpandedContract(contractId);
      if (!installments[contractId]) {
        await refreshContractInstallments(contractId);
      }
    }
  };

  const handlePay = (installment, contract) => {
    if (isReadOnly) return onRenewalRequest?.();
    setPaymentMode('regular');
    setSelectedInstallment({
      ...installment,
      contract_id: contract.id,
      contract_title: contract.title,
      customer_name: customer?.name,
      customer_phone: customer?.phone
    });
    setShowPaymentModal(true);
  };

  const handleExtraPayment = (installment, contract) => {
    if (isReadOnly) return onRenewalRequest?.();
    setPaymentMode('extra');
    setSelectedInstallment({
      ...installment,
      contract_id: contract.id,
      contract_title: contract.title,
      customer_name: customer?.name,
      customer_phone: customer?.phone
    });
    setShowPaymentModal(true);
  };

  const handleQuickPay = async (installment, contract) => {
    if (isReadOnly) return onRenewalRequest?.();
    const remaining = roundAmount(installment.amount - (installment.actual_paid || 0));
    const confirmed = window.confirm(
      `تأكيد سداد القسط بمبلغ ${formatPrivateAmount(remaining, privacyMode, 'ريال')}؟`
    );
    
    if (confirmed) {
      try {
        await installmentService.pay(installment.id, remaining, null, 0);
        await loadData();
        await refreshContractInstallments(contract.id);
      } catch (error) {
        console.error('Quick payment error:', error);
        alert('حدث خطأ أثناء تسجيل الدفع');
      }
    }
  };

  const handlePayButton = (installment, contract, isLongPress = false) => {
    if (isReadOnly) return onRenewalRequest?.();
    if (quickPaymentMode && !isLongPress) {
      handleQuickPay(installment, contract);
    } else {
      handlePay(installment, contract);
    }
  };

  const handleMouseDown = (installment, contract) => {
    if (isReadOnly) return;
    if (!quickPaymentMode) return;
    const timer = setTimeout(() => {
      handlePay(installment, contract);
    }, 800);
    setLongPressTimer(timer);
  };

  const handleMouseUp = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
  };

  const handleOpenPostpone = (installment, contract) => {
    if (isReadOnly) return onRenewalRequest?.();
    setSelectedPostponeInstallment({
      ...installment,
      contract_id: contract.id,
      contract_title: contract.title
    });
    setShowPostponeModal(true);
  };

  const handlePostpone = async (mode) => {
    if (!selectedPostponeInstallment) return;

    setPostponeLoading(true);
    const contractId = selectedPostponeInstallment.contract_id;

    try {
      await installmentService.postpone(selectedPostponeInstallment.id, mode);
      await refreshContractInstallments(contractId);
      await loadData();
      setShowPostponeModal(false);
      setSelectedPostponeInstallment(null);
    } catch (error) {
      console.error('Postpone error:', error);
      alert('حدث خطأ أثناء تأجيل القسط');
    } finally {
      setPostponeLoading(false);
    }
  };

  const handleUndoPostpone = async (installment, contract) => {
    if (isReadOnly) return onRenewalRequest?.();

    const confirmed = window.confirm('هل تريد إلغاء تأجيل هذا القسط وإرجاعه للحالة المعلقة؟');
    if (!confirmed) return;

    setUndoPostponeLoading(installment.id);
    try {
      await installmentService.undoPostpone(installment.id);
      await refreshContractInstallments(contract.id);
      await loadData();
    } catch (error) {
      console.error('Undo postpone error:', error);
      alert(error?.message || 'حدث خطأ أثناء إلغاء التأجيل');
    } finally {
      setUndoPostponeLoading(null);
    }
  };

  const sendWhatsApp = async (installment, toGuarantor = false) => {
    const contract = contracts.find(c => c.id === installment.contract_id);
    const template = await settingsService.getWhatsAppTemplate();
    let message = template
      .replace(/\[الاسم\]/g, customer?.name || '')
      .replace(/\[المبلغ\]/g, roundAmount(installment.amount).toLocaleString('en-US') || '')
      .replace(/\[التاريخ\]/g, installment.due_date || '')
      .replace(/\[العقد\]/g, contract?.title || '');
    
    if (autoAppendIban && ibanNumber) {
      message += `\nللسداد، الآيبان: ${ibanNumber}`;
    }
    
    const phone = toGuarantor && contract?.guarantor_phone 
      ? formatForWhatsApp(contract.guarantor_phone)
      : formatForWhatsApp(customer?.phone);
      
    if (!phone) {
      alert('لا يوجد رقم هاتف');
      return;
    }
    
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  // ── PDF handlers ────────────────────────────────────────────────────────
  const handleContractPDF = async (contract) => {
    if (pdfLoading) return;
    setPdfLoading(contract.id);
    try {
      let contractInstallments = installments[contract.id];
      if (!contractInstallments || contractInstallments.length === 0) {
        contractInstallments = await installmentService.getByContractId(contract.id);
        if (contractInstallments && contractInstallments.length > 0) {
          setInstallments(prev => ({ ...prev, [contract.id]: contractInstallments }));
        }
      }
      await generatePDF(customer, PDF_MODES.CONTRACT_STATEMENT, { contract, installments: contractInstallments });
    } catch (e) {
      console.error('Contract PDF error:', e);
      alert('حدث خطأ أثناء إنشاء PDF');
    } finally {
      setPdfLoading(null);
    }
  };

  const handleInstallmentReceipt = async (installment, contract) => {
    try {
      await generatePDF(customer, PDF_MODES.INSTALLMENT_RECEIPT, { installment, contract });
    } catch (e) {
      console.error('Receipt PDF error:', e);
      alert('حدث خطأ أثناء إنشاء الإيصال');
    }
  };

  const prepareNajizDocument = async (contract) => {
    const customerName = customer?.name || '';
    const nationalId = 'غير متوفر'; // You may want to add this to customer table
    const totalAmount = roundAmount(contract.total_amount).toLocaleString('en-US');
    const dueDate = contract.creation_date;
    
    const legalText = `
سند لأمر

أنا الموقع أدناه: ${customerName}
رقم الهوية: ${nationalId}

أقر بأنني مدين لصاحب هذا السند بمبلغ وقدره ${totalAmount} ريال سعودي فقط لا غير.

تاريخ الاستحقاق: ${dueDate}

التوقيع: ___________
التاريخ: ${new Date().toLocaleDateString('ar-SA')}
    `.trim();
    
    try {
      await Clipboard.write({ string: legalText });
      alert('تم نسخ بيانات السند');
    } catch (error) {
      console.error('Clipboard error:', error);
      alert('تعذر النسخ');
    }
  };

  const getStatusText = (status, inst = null) => {
    if (inst && isInstallmentPaidForDisplay(inst)) return 'مدفوع';
    if (status === 'paid') return 'مدفوع';
    if (status === 'postponed') return 'مؤجل';
    if (inst) {
      const paidAmount = getInstallmentPaidAmount(inst);
      if (isInstallmentLateForDisplay(inst)) return paidAmount > 0 ? 'متأخر جزئياً' : 'متأخر';
      if (paidAmount > 0) return 'دفع جزئي';
    }
    return 'معلق';
  };

  const formatAmount = (amount) => {
    if (privacyMode) return '*** ريال';
    return `${roundAmount(amount).toLocaleString('en-US')} ر.س`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className={`animate-spin rounded-full h-8 w-8 border-b-2 border-${themeColor}-500`}></div>
      </div>
    );
  }

  if (contracts.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-4xl mb-2">📋</p>
        <p>لا يوجد عقود لهذا العميل</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
        {contracts.map((contract) => {
          const remaining = roundAmount((contract.total_amount || 0) - (contract.total_paid || 0));
          const progress = contract.total_amount 
            ? ((contract.total_paid || 0) / contract.total_amount) * 100 
            : 0;

          return (
            <div key={contract.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              <div 
                onClick={() => toggleContract(contract.id)}
                className="p-4 cursor-pointer hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-white">{contract.title || 'عقد جديد'}</h4>
                  <span className={`px-2 py-1 rounded-lg text-xs font-medium border ${
                    contract.status === 'completed' 
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : `${themeLightBg} ${themeText} ${themeBorder}`
                  }`}>
                    {contract.status === 'completed' ? 'مكتمل' : 'نشط'}
                  </span>
                </div>

                {contract.guarantor_name && (
                  <div className="bg-slate-900/50 rounded-lg p-2 mb-2 text-sm">
                    <p className="text-slate-500">الكفيل: <span className="text-slate-300">{contract.guarantor_name}</span></p>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm mb-3">
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <p className="text-slate-500 text-xs">رأس المال</p>
                    <p className="text-amber-400 font-medium">{formatAmount(contract.capital_amount)}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <p className="text-slate-500 text-xs">إجمالي التقسيط</p>
                    <p className="text-white font-medium">{formatAmount(contract.total_amount)}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <p className="text-slate-500 text-xs">المدفوع</p>
                    <p className="text-emerald-400 font-medium">{formatAmount(contract.total_paid || 0)}</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <p className="text-slate-500 text-xs">المتبقي</p>
                    <p className={`font-medium ${remaining > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {formatAmount(remaining)}
                    </p>
                  </div>
                </div>

                <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div 
                    className={`h-full bg-gradient-to-l from-emerald-500 to-${themeColor}-500 transition-all`}
                    style={{ width: `${Math.min(progress, 100)}%` }}
                  />
                </div>

                <div className="flex justify-between items-center mt-2">
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        prepareNajizDocument(contract);
                      }}
                      className="px-3 py-1.5 bg-purple-600/20 border border-purple-500/50 text-purple-400 rounded-lg text-xs font-medium hover:bg-purple-600/30 transition-colors"
                    >
                      📄 تجهيز سند لأمر
                    </button>
                    
                    {contract.status === 'active' && remaining > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isReadOnly) return onRenewalRequest?.();
                          setSelectedContract(contract);
                          setShowEarlySettlement(true);
                        }}
                        className="px-3 py-1.5 bg-emerald-600/20 border border-emerald-500/50 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-600/30 transition-colors"
                      >
                        💰 سداد مبكر
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContractPDF(contract);
                      }}
                      disabled={pdfLoading === contract.id}
                      className={`px-3 py-1.5 ${themeLightBg} border ${themeBorder} ${themeText} rounded-lg text-xs font-medium hover:opacity-80 transition-colors flex items-center gap-1 disabled:opacity-50`}
                    >
                      {pdfLoading === contract.id ? '⏳' : '📄'} كشف العقد
                    </button>
                    
                    {/* Edit/Delete Contract Buttons */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isReadOnly) return onRenewalRequest?.();
                        setEditingContract(contract);
                        setShowContractModal(true);
                      }}
                      className="px-3 py-1.5 bg-blue-600/20 border border-blue-500/50 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-600/30 transition-colors"
                    >
                      ✏️ تعديل
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isReadOnly) return onRenewalRequest?.();
                        if (window.confirm(`⚠️ هل أنت متأكد من حذف عقد "${contract.title}"؟\n\nسيتم حذف العقد وجميع أقساطه نهائياً!`)) {
                          contractService.delete(contract.id).then(() => {
                            loadData();
                            setInstallments(prev => {
                              const next = { ...prev };
                              delete next[contract.id];
                              return next;
                            });
                            alert('✅ تم حذف العقد بنجاح');
                          }).catch(err => {
                            console.error('Error deleting contract:', err);
                            alert('❌ حدث خطأ أثناء حذف العقد');
                          });
                        }
                      }}
                      className="px-3 py-1.5 bg-rose-600/20 border border-rose-500/50 text-rose-400 rounded-lg text-xs font-medium hover:bg-rose-600/30 transition-colors"
                    >
                      🗑️ حذف
                    </button>
                    
                    {contract.guarantor_phone && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = `https://wa.me/${formatForWhatsApp(contract.guarantor_phone)}`;
                          window.open(url, '_blank');
                        }}
                        className={`px-3 py-1.5 ${themeLightBg} border ${themeBorder} ${themeText} rounded-lg text-xs font-medium hover:opacity-80 transition-colors`}
                      >
                        👤 واتساب الكفيل
                      </button>
                    )}
                  </div>
                  
                  <svg 
                    className={`w-5 h-5 text-slate-500 transition-transform ${
                      expandedContract === contract.id ? 'rotate-180' : ''
                    }`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {expandedContract === contract.id && installments[contract.id] && (
                <div className="border-t border-slate-700">
                  <div className="p-4">
                    <h5 className="text-sm font-bold text-slate-400 mb-3">جدول الأقساط</h5>
                    
                    <div className="flex flex-col gap-2">
                      {(() => {
                        const displayList = getInstallmentsForDisplay(installments[contract.id]);
                        const activeCount = displayList.filter(i => !i.isBottomSection).length;
                        const bottomCount = displayList.filter(i => i.isBottomSection).length;
                        const hasBothSections = activeCount > 0 && bottomCount > 0;
                        let renderedArchiveDivider = false;

                        return displayList.map((inst) => {
                          const paidAmount = getInstallmentPaidAmount(inst);
                          const remainingAmount = Math.max(0, getInstallmentRemaining(inst));
                          const isPaid = isInstallmentPaidForDisplay(inst);
                          const isPartial = !isPaid && paidAmount > 0;
                          const primaryAmount = isPaid ? paidAmount : remainingAmount;

                          const showArchiveDivider = hasBothSections && inst.isBottomSection && !renderedArchiveDivider;
                          if (showArchiveDivider) {
                            renderedArchiveDivider = true;
                          }

                          return (
                            <Fragment key={inst.id}>
                              {showArchiveDivider && (
                                <div className="flex items-center gap-2 pt-3 pb-1 text-xs font-semibold text-slate-400">
                                  <div className="h-px bg-slate-700/80 flex-1"></div>
                                  <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-[11px]">
                                    <span>📁</span>
                                    <span>الأرشيف والمنجزات (مؤجل / مدفوع)</span>
                                    <span className="text-[10px] text-slate-500 font-mono">({bottomCount})</span>
                                  </div>
                                  <div className="h-px bg-slate-700/80 flex-1"></div>
                                </div>
                              )}
                              <div
                                className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-slate-900 rounded-lg p-3 gap-3"
                              >
                          <div className="flex items-start gap-3 min-w-0">
                            <span className="text-slate-500 text-xs w-8 pt-1">#{inst.scheduleNumber}</span>
                            <span className={`w-2 h-2 rounded-full ${
                              isPaid ? 'bg-emerald-500' :
                              inst.status === 'postponed' ? 'bg-amber-500' :
                              isPartial ? 'bg-amber-400' : 'bg-rose-500'
                            } mt-2 shrink-0`} />
                            
                            <div className="min-w-0">
                              <p className={`font-black leading-6 ${isPaid ? 'text-emerald-300' : isPartial ? 'text-rose-300' : 'text-white'}`}>
                                {formatAmount(primaryAmount)}
                              </p>
                              {isPartial && (
                                <p className="text-emerald-400 text-[11px] leading-5">
                                  مدفوع: {formatAmount(paidAmount)}
                                  <span className="text-slate-500"> | أصل القسط: {formatAmount(inst.amount)}</span>
                                </p>
                              )}
                              {isPaid && paidAmount > 0 && paidAmount !== inst.amount && (
                                <p className="text-amber-400 text-xs">
                                  القسط الأصلي: {formatAmount(inst.amount)}
                                </p>
                              )}
                              <div className="text-slate-500 text-xs">
                                {inst.due_date}
                                {hijriEnabled && (
                                  <span className="block text-slate-600">{toHijriDate(inst.due_date)}</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap">
                            {inst.status === 'paid' && (
                              <div className="flex gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleInstallmentReceipt(inst, contract);
                                  }}
                                  className="h-9 min-w-9 px-3 flex items-center justify-center bg-white/5 border border-white/10 text-slate-400 rounded-xl hover:bg-white/10 transition-colors"
                                  title="إيصال الدفع"
                                >
                                  🧾
                                </button>
                                
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (isReadOnly) return onRenewalRequest?.();
                                    const confirmed = window.confirm('هل تريد إلغاء عملية السداد لهذا القسط وإعادته للحالة المعلقة؟');
                                    if (confirmed) {
                                      await installmentService.undoPay(inst.id);
                                      await loadData();
                                      await refreshContractInstallments(contract.id);
                                    }
                                  }}
                                  className="h-9 min-w-9 px-3 flex items-center justify-center bg-rose-500/5 border border-rose-500/20 text-rose-500/70 rounded-xl hover:bg-rose-500/10 transition-colors"
                                  title="إلغاء السداد"
                                >
                                  ↩️
                                </button>
                              </div>
                            )}

                            {inst.status === 'pending' && (
                              <div className="flex items-center justify-end gap-2 flex-wrap">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    sendWhatsApp(inst);
                                  }}
                                  className="h-9 min-w-9 px-3 flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl hover:bg-emerald-500/20 transition-all active:scale-95"
                                  title="إرسال تذكير واتساب"
                                >
                                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                  </svg>
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePayButton(inst, contract);
                                  }}
                                  onMouseDown={() => handleMouseDown(inst, contract)}
                                  onMouseUp={handleMouseUp}
                                  onMouseLeave={handleMouseUp}
                                  onTouchStart={() => handleMouseDown(inst, contract)}
                                  onTouchEnd={handleMouseUp}
                                  className="h-9 px-3 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/15 active:scale-95"
                                >
                                  {quickPaymentMode ? 'سريع' : 'سداد'}
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleExtraPayment(inst, contract);
                                  }}
                                  className="h-9 px-3 bg-blue-600/15 border border-blue-500/35 text-blue-300 rounded-xl text-xs font-black hover:bg-blue-600/25 transition-all active:scale-95"
                                  title="المبلغ الإضافي"
                                >
                                  زائد
                                </button>

                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenPostpone(inst, contract);
                                  }}
                                  className="h-9 px-3 bg-amber-600/15 border border-amber-500/35 text-amber-300 rounded-xl text-xs font-black hover:bg-amber-600/25 transition-all active:scale-95"
                                  title="تأجيل القسط"
                                >
                                  تأجيل
                                </button>
                              </div>
                            )}

                            {inst.status === 'postponed' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleUndoPostpone(inst, contract);
                                }}
                                disabled={undoPostponeLoading === inst.id}
                                className="h-9 px-3 bg-amber-600/15 border border-amber-500/35 text-amber-200 rounded-xl text-xs font-black hover:bg-amber-600/25 transition-all active:scale-95 disabled:opacity-50"
                                title="إلغاء تأجيل القسط"
                              >
                                {undoPostponeLoading === inst.id ? 'جارٍ...' : 'إلغاء التأجيل'}
                              </button>
                            )}

                            <div className="flex flex-col items-center gap-1">
                              <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_8px] ${
                                isPaid ? 'bg-emerald-500 shadow-emerald-500/50' :
                                inst.status === 'postponed' ? 'bg-amber-500 shadow-amber-500/50' :
                                isPartial ? 'bg-amber-400 shadow-amber-400/50 animate-pulse' :
                                'bg-rose-500 shadow-rose-500/50 animate-pulse'
                              }`} />
                              <span className="text-[8px] font-bold text-slate-500">
                                {getStatusText(inst.status, inst)}
                              </span>
                            </div>
                          </div>
                        </div>
                        </Fragment>
                        );
                      });
                    })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <PaymentModal
        isOpen={showPaymentModal}
        onClose={() => {
          setShowPaymentModal(false);
          setSelectedInstallment(null);
          setPaymentMode('regular');
        }}
        onSave={() => {
          loadData();
          if (expandedContract) {
            refreshContractInstallments(expandedContract);
          }
        }}
        installment={selectedInstallment}
        themeColor={themeColor}
        mode={paymentMode}
      />

      <PostponeModal
        isOpen={showPostponeModal}
        installment={selectedPostponeInstallment}
        loading={postponeLoading}
        onClose={() => {
          if (postponeLoading) return;
          setShowPostponeModal(false);
          setSelectedPostponeInstallment(null);
        }}
         onConfirm={handlePostpone}
         privacyMode={privacyMode}
       />

      <ContractModal
        isOpen={showContractModal}
        onClose={() => {
          setShowContractModal(false);
          setEditingContract(null);
        }}
        onSave={() => {
          loadData();
          if (editingContract?.id) {
            refreshContractInstallments(editingContract.id);
          }
        }}
        customerId={customerId}
        customerName={customer?.name || ''}
        isBlacklisted={customer?.is_blacklisted}
        contract={editingContract}
        themeColor={themeColor}
      />

      <EarlySettlementModal
        isOpen={showEarlySettlement}
        onClose={() => {
          setShowEarlySettlement(false);
          setSelectedContract(null);
        }}
        onSave={() => {
          loadData();
          if (expandedContract) {
            refreshContractInstallments(expandedContract);
          }
        }}
        contract={selectedContract}
        customerName={customer?.name}
        themeColor={themeColor}
      />
    </div>
  );
};

export default ContractList;
