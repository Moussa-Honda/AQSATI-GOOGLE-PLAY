import { useState, useEffect } from 'react';
import { portfolioService, portfolioExpenseService } from '../services/database';
import CustodyModal from './CustodyModal';
import CustodyAddFundsModal from './CustodyAddFundsModal';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const CustodyList = ({ onSelectCustody, isReadOnly, onRenewalRequest }) => {
  const [custodies, setCustodies] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCustody, setEditingCustody] = useState(null);
  const [addingFundsTo, setAddingFundsTo] = useState(null);
  const privacyMode = usePrivacyMode();

  useEffect(() => {
    loadCustodies();
  }, []);

  const loadCustodies = async () => {
    setLoading(true);
    try {
      const data = await portfolioService.getAll();
      const statsMap = {};
      
      for (const item of data) {
        const spent = await portfolioExpenseService.getStats(item.id);
        statsMap[item.id] = {
          spent,
          remaining: item.capital - spent
        };
      }
      
      setCustodies(data);
      setStats(statsMap);
    } catch (err) {
      console.error('Failed to load custodies:', err);
    } finally {
      setLoading(false);
    }
  };

  useLiveRefresh(loadCustodies);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    if (window.confirm('هل أنت متأكد من حذف هذه العهدة؟')) {
      await portfolioService.delete(id);
      loadCustodies();
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="p-4 flex items-center justify-between" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <h2 className="text-xl font-bold text-white">نظام العهد</h2>
        <button
          onClick={() => {
            if (isReadOnly) {
              onRenewalRequest();
            } else {
              setEditingCustody(null);
              setShowModal(true);
            }
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2"
        >
          <span>+</span>
          فتح عهدة جديدة
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar">
        {custodies.length === 0 ? (
          <div className="bg-slate-800/50 rounded-2xl p-8 border border-slate-700 text-center">
            <div className="text-4xl mb-3">🏦</div>
            <p className="text-slate-400">لا توجد عهد نشطة حالياً</p>
            <p className="text-slate-500 text-xs mt-1">اضغط على زر "فتح عهدة" للبدء</p>
          </div>
        ) : (
          custodies.map((item) => (
            <div
              key={item.id}
              onClick={() => onSelectCustody(item)}
              className="bg-[#0f172a] border border-slate-800 rounded-2xl p-4 card-hover cursor-pointer flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                {/* Right Section: Custody Name & Description */}
                <div className="min-w-0 flex-1 text-right">
                  <h3
                    className="text-base sm:text-lg font-black text-white leading-snug break-words"
                    title={item.name}
                  >
                    {item.name}
                  </h3>
                  {item.description ? (
                    <p
                      className="mt-1 text-xs text-slate-400 line-clamp-1 break-words"
                      title={item.description}
                    >
                      {item.description}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-slate-500 font-medium">عهدة مالية نشطة</p>
                  )}
                </div>

                {/* Left Section: Actions & Custody Icon */}
                <div className="flex shrink-0 items-center gap-1.5 pt-0.5" onClick={e => e.stopPropagation()}>
                  {/* إضافة مبلغ */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly) return onRenewalRequest?.();
                      setAddingFundsTo(item);
                    }}
                    className="h-8 px-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-1 transition-all active:scale-95"
                    title="إضافة مبلغ للعهدة"
                  >
                    <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="text-[11px] font-bold">إضافة</span>
                  </button>

                  {/* تعديل */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isReadOnly) return onRenewalRequest?.();
                      setEditingCustody(item);
                      setShowModal(true);
                    }}
                    className="w-8 h-8 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl flex items-center justify-center transition-all active:scale-95"
                    title="تعديل العهدة"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>

                  {/* حذف */}
                  <button
                    onClick={(e) => handleDelete(e, item.id)}
                    className="w-8 h-8 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl flex items-center justify-center transition-all active:scale-95"
                    title="حذف العهدة"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>

                  {/* أيقونة العهدة متناسقة في أقصى اليسار */}
                  <div
                    className="w-8 h-8 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-sm shadow-inner shrink-0"
                    title="عهدة مالية"
                  >
                    🏦
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="bg-slate-900/50 rounded-xl p-2 border border-slate-800">
                  <p className="text-[9px] text-slate-500 mb-0.5">المبلغ المسلم</p>
                  <p className="text-xs font-bold text-white">
                    {formatPrivateAmount(item.capital, privacyMode)}
                  </p>
                </div>
                <div className="bg-slate-900/50 rounded-xl p-2 border border-slate-800">
                  <p className="text-[9px] text-slate-500 mb-0.5">المنصرف</p>
                  <p className="text-xs font-bold text-rose-400">
                    {formatPrivateAmount(stats[item.id]?.spent, privacyMode)}
                  </p>
                </div>
                <div className="bg-blue-500/5 rounded-xl p-2 border border-blue-500/10">
                  <p className="text-[9px] text-blue-400/70 mb-0.5">المتبقي</p>
                  <p className="text-xs font-bold text-blue-400">
                    {formatPrivateAmount(stats[item.id]?.remaining, privacyMode)}
                  </p>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${
                    (stats[item.id]?.remaining / item.capital) < 0.2 ? 'bg-rose-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.max(0, Math.min(100, (stats[item.id]?.remaining / item.capital) * 100))}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <CustodyModal
          custody={editingCustody}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            loadCustodies();
          }}
        />
      )}

      {addingFundsTo && (
        <CustodyAddFundsModal
          custody={addingFundsTo}
          onClose={() => setAddingFundsTo(null)}
          onSaved={() => {
            setAddingFundsTo(null);
            loadCustodies();
          }}
        />
      )}
    </div>
  );
};

export default CustodyList;
