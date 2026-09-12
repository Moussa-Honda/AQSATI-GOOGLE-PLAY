import { useState, useEffect } from 'react';
import { portfolioExpenseService, settingsService } from '../services/database';
import { toHijriDate } from '../utils/dateUtils';
import { generatePDF, PDF_MODES } from '../utils/pdfGenerator';
import CustodyExpenseModal from './CustodyExpenseModal';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const CustodyDetails = ({ custody, onBack, isReadOnly = false, onRenewalRequest }) => {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [spent, setSpent] = useState(0);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [operationFilter, setOperationFilter] = useState('all');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [hijriEnabled, setHijriEnabled] = useState(false);
  const privacyMode = usePrivacyMode();

  useEffect(() => {
    loadData();
    loadSettings();
  }, [custody.id]);

  const loadSettings = async () => {
    const hijri = await settingsService.get('hijri_calendar');
    setHijriEnabled(hijri === 'true');
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const list = await portfolioExpenseService.getByPortfolioId(custody.id);
      const total = await portfolioExpenseService.getStats(custody.id);
      setExpenses(list);
      setSpent(total);
    } catch (err) {
      console.error('Failed to load custody details:', err);
    } finally {
      setLoading(false);
    }
  };

  useLiveRefresh(loadData, Boolean(custody?.id));

  const handleDeleteExpense = async (id) => {
    if (isReadOnly) return onRenewalRequest?.();
    if (window.confirm('هل أنت متأكد من حذف هذا المصروف؟')) {
      await portfolioExpenseService.delete(id);
      loadData();
    }
  };

  const handleEditExpense = (expense) => {
    if (isReadOnly) return onRenewalRequest?.();
    setShowExpenseModal(false);
    setEditingExpense(expense);
  };

  const handleExportPDF = async () => {
    setGeneratingPdf(true);
    try {
      await generatePDF(custody, PDF_MODES.CUSTODY_STATEMENT, expenses);
    } catch (err) {
      console.error('PDF Error:', err);
    } finally {
      setGeneratingPdf(false);
    }
  };

  const receiptCount = expenses.filter((expense) => expense.entry_type === 'receipt').length;
  const expenseCount = expenses.length - receiptCount;
  const visibleExpenses = expenses.filter((expense) => {
    if (operationFilter === 'receipt') return expense.entry_type === 'receipt';
    if (operationFilter === 'expense') return expense.entry_type !== 'receipt';
    return true;
  });
  const remaining = custody.capital - spent;
  const spentPercentage = custody.capital > 0 ? (spent / custody.capital) * 100 : 0;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center gap-3 shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button onClick={onBack} className="p-2 hover:bg-slate-700 rounded-lg transition-colors">
          <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">{custody.name}</h2>
          <p className="text-slate-400 text-xs">إدارة مصروفات العهدة</p>
        </div>
        <button
          onClick={handleExportPDF}
          disabled={generatingPdf}
          className="px-3 py-2 bg-purple-600/20 border border-purple-500/50 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-600/30 transition-colors flex items-center gap-1.5"
        >
          {generatingPdf ? (
            <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
          PDF
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Summary Card */}
        <div className="p-4">
          <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl relative overflow-hidden">
            {/* Background Decoration */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 blur-3xl -mr-16 -mt-16 rounded-full" />
            
            <div className="relative">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <p className="text-slate-400 text-sm mb-1">الرصيد المتبقي</p>
                  <h3 className="text-3xl font-black text-white">
                    {formatPrivateAmount(remaining, privacyMode)} <span className="text-sm font-normal text-slate-500">SAR</span>
                  </h3>
                </div>
                <div className="w-12 h-12 bg-blue-500/20 rounded-2xl flex items-center justify-center text-2xl">💰</div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">إجمالي العهدة: {formatPrivateAmount(custody.capital, privacyMode)}</span>
                  <span className="text-rose-400">المنصرف: {formatPrivateAmount(spent, privacyMode)}</span>
                </div>
                
                <div className="h-3 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700">
                  <div 
                    className={`h-full rounded-full transition-all duration-1000 ${
                      spentPercentage > 90 ? 'bg-rose-500' : spentPercentage > 70 ? 'bg-amber-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(100, spentPercentage)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Operations List */}
        <div className="space-y-3 px-4 pb-20">
          <div className="flex items-center justify-between py-2">
            <h3 className="font-bold text-white">سجل العمليات</h3>
            <span className="text-xs text-slate-500">{visibleExpenses.length} عملية</span>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-slate-700/60 bg-slate-800/40 p-1">
            {[
              { id: 'all', label: 'الكل', count: expenses.length },
              { id: 'expense', label: 'المصروفات', count: expenseCount },
              { id: 'receipt', label: 'سندات القبض', count: receiptCount }
            ].map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setOperationFilter(filter.id)}
                className={`rounded-xl px-2 py-2 text-xs font-bold transition-colors ${
                  operationFilter === filter.id
                    ? 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-300'
                }`}
              >
                {filter.label}
                <span className="mr-1 text-[10px] opacity-70">({filter.count})</span>
              </button>
            ))}
          </div>

          {visibleExpenses.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-800/30 py-12 text-center">
              <p className="text-sm text-slate-500">
                {operationFilter === 'receipt'
                  ? 'لا توجد سندات قبض مسجلة لهذه العهدة'
                  : operationFilter === 'expense'
                    ? 'لا توجد مصروفات مسجلة لهذه العهدة'
                    : 'لا توجد عمليات مسجلة لهذه العهدة'}
              </p>
            </div>
          ) : (
            visibleExpenses.map((exp) => {
              const isReceipt = exp.entry_type === 'receipt';

              return (
                <div
                  key={exp.id}
                  className={`flex items-start justify-between gap-3 rounded-2xl border p-4 ${
                    isReceipt
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-slate-700/50 bg-slate-800/50'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        isReceipt ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                      }`}
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={isReceipt
                            ? 'M12 8v8m-4-4h8m8 0a9 9 0 11-18 0 9 9 0 0118 0z'
                            : 'M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z'}
                        />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <h4 className="line-clamp-2 break-words text-sm font-bold text-white">
                          {exp.description || (isReceipt ? 'سند قبض' : 'مصروف عام')}
                        </h4>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            isReceipt ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                          }`}
                        >
                          {isReceipt ? 'سند قبض' : 'مصروف'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {exp.date}
                        {hijriEnabled && (
                          <span className="block text-slate-600">{toHijriDate(exp.date)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className={`font-bold ${isReceipt ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isReceipt ? '+' : '-'}{formatPrivateAmount(exp.amount, privacyMode)}
                    </span>
                    {!isReceipt && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleEditExpense(exp)}
                          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-blue-500/10 hover:text-blue-400"
                          aria-label="تعديل المصروف"
                          title="تعديل المصروف"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(exp.id)}
                          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                          aria-label="حذف المصروف"
                          title="حذف المصروف"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* FAB Add Expense */}
      <div className="fixed bottom-24 left-6 z-50">
        <button
          onClick={() => {
            if (isReadOnly) return onRenewalRequest?.();
            setShowExpenseModal(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white w-14 h-14 rounded-2xl shadow-lg shadow-blue-600/30 flex items-center justify-center btn-press cursor-pointer"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </button>
      </div>

      {(showExpenseModal || editingExpense) && (
        <CustodyExpenseModal
          key={editingExpense?.id || 'new-expense'}
          portfolioId={custody.id}
          expense={editingExpense}
          onClose={() => {
            setShowExpenseModal(false);
            setEditingExpense(null);
          }}
          onSaved={() => {
            setShowExpenseModal(false);
            setEditingExpense(null);
            loadData();
          }}
        />
      )}
    </div>
  );
};

export default CustodyDetails;
