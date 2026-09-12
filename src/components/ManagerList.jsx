import { useState, useEffect, useCallback } from 'react';
import { managerService } from '../services/database';
import ManagerModal from './ManagerModal';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const ManagerList = ({ onSelectManager, onBack, filterType = 'all', isReadOnly = false, onRenewalRequest }) => {
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const privacyMode = usePrivacyMode();

  const isDeletedView = filterType !== 'overdue' && showDeleted;

  const loadManagers = useCallback(async () => {
    setLoading(true);
    try {
      let data;
      if (filterType === 'overdue') {
        data = await managerService.getManagersWithOverdueCount();
      } else if (showDeleted) {
        await managerService.cleanupDeleted();
        data = await managerService.getAllWithStats(true);
      } else {
        data = await managerService.getAllWithStats();
      }
      setManagers(data);
    } catch (error) {
      console.error('Error loading managers:', error);
    } finally {
      setLoading(false);
    }
  }, [filterType, showDeleted]);

  useEffect(() => {
    loadManagers();
  }, [loadManagers]);

  useLiveRefresh(loadManagers);

  const handleDelete = async (manager, e) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    if (window.confirm(`هل أنت متأكد من حذف "${manager.name}"؟\nسيُنقل الحساب إلى المحذوفات لمدة 7 أيام، وستبقى جميع العملاء والعقود والبيانات محفوظة.`)) {
      await managerService.delete(manager.id);
      loadManagers();
    }
  };

  const handleRestore = async (manager, e) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    await managerService.restore(manager.id);
    loadManagers();
  };

  // Calculate totals for overdue section
  const totalStats = managers.reduce((acc, manager) => ({
    totalContracts: acc.totalContracts + (manager.total_contracts || 0),
    totalPaid: acc.totalPaid + (manager.total_paid || 0),
    totalRemaining: acc.totalRemaining + (manager.total_remaining || 0)
  }), { totalContracts: 0, totalPaid: 0, totalRemaining: 0 });

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="p-4 bg-slate-800/50 border-b border-slate-700/50 flex items-center gap-4 shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
        <button onClick={onBack} className="p-2 hover:bg-slate-700 rounded-xl transition-colors text-slate-300">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-black text-white">
            {filterType === 'overdue' ? 'قسم المتعثرين' : isDeletedView ? 'المحذوفات' : 'إدارة الحسابات بالنيابة'}
          </h2>
          <p className="text-slate-400 text-xs">
            {filterType === 'overdue'
              ? 'فلترة العملاء المتأخرين في السداد'
              : isDeletedView
                ? 'يمكن استرجاع الحساب خلال 7 أيام قبل الحذف النهائي'
                : 'إدارة العملاء والعقود لأطراف أخرى'}
          </p>
        </div>
        {!isDeletedView && (
          <button
            onClick={() => {
              if (isReadOnly) return onRenewalRequest?.();
              setShowModal(true);
            }}
            className="w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20 active:scale-95 transition-all cursor-pointer"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>

      {filterType !== 'overdue' && (
        <div className="px-4 pt-3 bg-slate-900 shrink-0">
          <div className="flex bg-slate-800 rounded-xl p-1 border border-slate-700">
            <button
              type="button"
              onClick={() => setShowDeleted(false)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${!showDeleted ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              الحسابات بالنيابة
            </button>
            <button
              type="button"
              onClick={() => setShowDeleted(true)}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-colors ${showDeleted ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              المحذوفات
            </button>
          </div>
        </div>
      )}

      {/* Total Stats for Overdue Section */}
      {filterType === 'overdue' && managers.length > 0 && (
        <div className="bg-rose-500/10 border-b border-rose-500/30 p-4">
          <h3 className="text-sm font-bold text-rose-400 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            إجمالي المتعثرين
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-900/50 rounded-xl p-3 text-center border border-rose-500/20">
              <p className="text-[10px] text-slate-500 font-bold mb-1">إجمالي العقود</p>
              <p className="text-sm font-black text-rose-400">
                {formatPrivateAmount(totalStats.totalContracts, privacyMode)}
              </p>
            </div>
            <div className="bg-slate-900/50 rounded-xl p-3 text-center border border-rose-500/20">
              <p className="text-[10px] text-slate-500 font-bold mb-1">المدفوع</p>
              <p className="text-sm font-black text-emerald-400">
                {formatPrivateAmount(totalStats.totalPaid, privacyMode)}
              </p>
            </div>
            <div className="bg-slate-900/50 rounded-xl p-3 text-center border border-rose-500/20">
              <p className="text-[10px] text-slate-500 font-bold mb-1">المتبقي للتحصيل</p>
              <p className="text-sm font-black text-rose-400">
                {formatPrivateAmount(totalStats.totalRemaining, privacyMode)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500"></div>
          </div>
        ) : managers.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <div className="text-6xl mb-4 opacity-20">👥</div>
            <p className="text-lg font-bold">{isDeletedView ? 'لا توجد حسابات محذوفة' : 'لا يوجد حسابات مضافة حالياً'}</p>
            <p className="text-sm opacity-60 mt-1">{isDeletedView ? 'تظهر هنا الحسابات المحذوفة خلال آخر 7 أيام' : 'اضغط على زر (+) لإضافة أول شخص تدير حساباته'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {managers.map((manager) => (
              <div
                key={manager.id}
                onClick={() => !isDeletedView && onSelectManager(manager)}
                className={`bg-slate-800/40 border border-slate-700/50 rounded-[2rem] p-6 ${!isDeletedView ? 'cursor-pointer hover:bg-slate-800/60 active:scale-[0.98]' : ''} transition-all group relative overflow-hidden`}
              >
                {/* Decoration Gradient */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-[50px] -mr-16 -mt-16 pointer-events-none" />
                
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-xl font-black text-white mb-1 group-hover:text-indigo-400 transition-colors">
                      {manager.name}
                    </h3>
                    <p className="text-slate-500 text-xs font-medium flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      {manager.phone || 'بدون رقم'}
                    </p>
                  </div>
                  <button 
                    onClick={(e) => isDeletedView ? handleRestore(manager, e) : handleDelete(manager, e)}
                    className={isDeletedView ? 'px-3 py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-bold hover:bg-emerald-500/20 transition-colors' : 'p-2 text-slate-600 hover:text-rose-500 transition-colors'}
                  >
                    {isDeletedView ? 'استرجاع' : null}
                    <svg className={isDeletedView ? 'hidden' : 'w-5 h-5'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-indigo-500/10 rounded-2xl p-3 border border-indigo-500/20">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">عدد العملاء</p>
                    <p className="text-sm font-black text-indigo-300">
                      {Number(manager.customer_count || 0).toLocaleString('en-US')}
                    </p>
                  </div>
                  <div className="bg-cyan-500/10 rounded-2xl p-3 border border-cyan-500/20">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">العقود السارية</p>
                    <p className="text-sm font-black text-cyan-300">
                      {Number(manager.active_contract_count || 0).toLocaleString('en-US')}
                    </p>
                  </div>
                </div>

                {/* Financial Stats Grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900/50 rounded-2xl p-3 border border-slate-700/30">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">إجمالي العقود</p>
                    <p className="text-sm font-black text-indigo-400">
                      {formatPrivateAmount(manager.total_contracts, privacyMode)}
                    </p>
                  </div>
                  <div className="bg-slate-900/50 rounded-2xl p-3 border border-slate-700/30">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">المدفوع</p>
                    <p className="text-sm font-black text-emerald-400">
                      {formatPrivateAmount(manager.total_paid, privacyMode)}
                    </p>
                  </div>
                  <div className="bg-slate-900/50 rounded-2xl p-3 border border-slate-700/30">
                    <p className="text-[10px] text-slate-500 font-bold mb-1">المتبقي للتحصيل</p>
                    <p className="text-sm font-black text-rose-400">
                      {formatPrivateAmount(manager.total_remaining, privacyMode)}
                    </p>
                  </div>
                </div>
                {isDeletedView && (
                  <p className="text-rose-300/80 text-xs font-bold mt-4">
                    يُحذف سجل الحساب نهائياً بعد 7 أيام، مع بقاء العملاء وبياناتهم محفوظة ومخفية عن الرئيسية.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ManagerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={loadManagers}
      />
    </div>
  );
};

export default ManagerList;
