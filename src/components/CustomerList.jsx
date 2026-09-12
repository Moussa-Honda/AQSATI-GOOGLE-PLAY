import { useState, useEffect, useCallback } from 'react';
import { customerService, contractService, settingsService } from '../services/database';
import CustomerModal from './CustomerModal';
import ContractModal from './ContractModal';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';
import { generatePDF, PDF_MODES } from '../utils/pdfGenerator';

// Sanitize customer name - remove trailing 00 and whitespace
const sanitizeName = (name) => {
  if (!name) return 'عميل';
  return name.replace(/\s*0+$/g, '').trim() || 'عميل';
};

const getCustomerMonthStatusDisplay = (status, managerId = null) => {
  const baseCard = `bg-[#1e293b]/60 ${managerId ? 'border-indigo-500/30' : 'border-slate-700/50'} shadow-slate-950/20`;

  switch (status) {
    case 'paid':
      return {
        label: 'سدد',
        card: baseCard,
        badge: 'bg-emerald-400/15 border-emerald-300/40 text-emerald-100'
      };
    case 'postponed':
      return {
        label: 'مؤجل',
        card: baseCard,
        badge: 'bg-amber-300/15 border-amber-300/45 text-amber-100'
      };
    case 'overdue':
      return {
        label: '',
        card: baseCard,
        badge: ''
      };
    default:
      return {
        label: '',
        card: baseCard,
        badge: ''
      };
  }
};

const CustomerList = ({ 
  onSelect, 
  isReadOnly, 
  onRenewalRequest, 
  managerId = null, 
  managerName = null, 
  onBack, 
  onShowManagers,
  filterType = 'all' 
}) => {
  const [customers, setCustomers] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [showModal, setShowModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customerBalances, setCustomerBalances] = useState({});
  const [customerReportSummaries, setCustomerReportSummaries] = useState({});
  const [pdfLoading, setPdfLoading] = useState(false);
  const [overdueStatus, setOverdueStatus] = useState({});
  const [lateStatus, setLateStatus] = useState({});
  const [postponedStatus, setPostponedStatus] = useState({});
  const [customerMonthStatuses, setCustomerMonthStatuses] = useState({});
  const [recycleBinEnabled, setRecycleBinEnabled] = useState(false);
  const privacyMode = usePrivacyMode();
  const themeColor = managerId ? 'indigo' : 'blue';
  const themeBg = managerId ? 'bg-indigo-600' : 'bg-blue-600';
  const themeBorder = managerId ? 'focus:border-indigo-500' : 'focus:border-blue-500';
  const themeShadow = managerId ? 'shadow-indigo-600/30' : 'shadow-blue-600/30';

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const [isRecycleBinEnabled, overdueThresholdSetting] = await Promise.all([
        settingsService.get('recycle_bin_enabled'),
        settingsService.get('overdue_threshold_days')
      ]);
      setRecycleBinEnabled(isRecycleBinEnabled === 'true');

      // Use managerId if provided, otherwise 'personal' to show only user's own customers in main list
      const filterId = managerId || 'personal';
      // Load all customers including deleted
      const data = await customerService.getAll(false, filterId, true);
      const customerIds = data.map(customer => customer.id);
      const threshold = parseInt(overdueThresholdSetting, 10) || 30;

      const [balanceSummaries, reportSummaries, overdueMap, lateMap, monthStatusMap, postponedMap] = await Promise.all([
        contractService.getCustomerBalanceSummaries(customerIds),
        contractService.getCustomerReportSummaries(customerIds),
        contractService.getOverdueCustomerMap(customerIds, threshold),
        contractService.getLateCustomerMap(customerIds),
        customerService.getCurrentMonthStatusMap(customerIds),
        contractService.getPostponedCustomerMap(customerIds)
      ]);

      // Calculate display values from one grouped read instead of per-customer queries.
      const balances = {};
      const isOverdueMap = {};

      for (const customer of data) {
        const summary = balanceSummaries[customer.id] || {
          contract_count: 0,
          total_remaining: 0
        };

        balances[customer.id] = summary.total_remaining;

        // Smart auto-archive logic
        const hasContracts = summary.contract_count >= 1;
        const totalRemaining = balances[customer.id];

        const shouldBeActive = !hasContracts || totalRemaining > 0;
        const shouldBeArchived = hasContracts && totalRemaining === 0;

        if (shouldBeArchived && customer.status === 'active') {
          await customerService.update(customer.id, { status: 'archived' }, true);
          customer.status = 'archived';
        } else if (shouldBeActive && customer.status === 'archived') {
          await customerService.update(customer.id, { status: 'active' }, true);
          customer.status = 'active';
        } else if (!customer.status) {
          // Fix for any corrupted records (status is NULL)
          await customerService.update(customer.id, { status: 'active' }, true);
          customer.status = 'active';
        }

        isOverdueMap[customer.id] = Boolean(customer.is_manually_flagged_as_overdue || overdueMap[customer.id]);
      }

      setCustomerBalances(balances);
      setCustomerReportSummaries(reportSummaries || {});
      setOverdueStatus(isOverdueMap);
      setLateStatus(lateMap || {});
      setPostponedStatus(postponedMap || {});
      setCustomerMonthStatuses(monthStatusMap);
      setCustomers(data);
    } catch (error) {
      console.error('Load customers error:', error);
    } finally {
      setLoading(false);
    }
  }, [managerId, filterType]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useLiveRefresh(loadCustomers);

  const filterCustomers = useCallback(() => {
    let result = customers;
    
    if (filterType === 'overdue') {
      result = result.filter(c => overdueStatus[c.id] && (!c.is_deleted));
    } else if (activeTab === 'deleted') {
      result = result.filter(c => c.is_deleted === 1);
    } else {
      // Keep all customers visible in their tab (overdue accounts have distinct visual indicators)
      result = result.filter(c => c.status === activeTab && (!c.is_deleted));
    }
    
    if (search.trim()) {
      result = result.filter(c => 
        sanitizeName(c.name).toLowerCase().includes(search.toLowerCase()) ||
        c.phone?.includes(search)
      );
    }
    
    setFiltered(result);
  }, [customers, search, activeTab, overdueStatus, filterType]);

  useEffect(() => {
    filterCustomers();
  }, [filterCustomers]);

  const handleAddCustomer = () => {
    if (isReadOnly) return onRenewalRequest?.();
    setSelectedCustomer(null);
    setShowModal(true);
  };

  const handleExportCustomersPDF = async () => {
    if (pdfLoading) return;

    setPdfLoading(true);
    try {
      const reportCustomers = customers.filter(customer => customer.is_deleted !== 1);
      await generatePDF(null, PDF_MODES.CUSTOMERS_SUMMARY, {
        customers: reportCustomers,
        summaries: customerReportSummaries,
        scopeName: managerName
      });
    } finally {
      setPdfLoading(false);
    }
  };

  const handleEditCustomer = (customer, e) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    setSelectedCustomer(customer);
    setShowModal(true);
  };

  const handleAddContract = (customer, e) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    setSelectedCustomer(customer);
    setShowContractModal(true);
  };

  const handleDeleteCustomer = async (customer, e) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    
    const confirmed = window.confirm(
      `تنبيه! حذف هذا العميل سيؤدي لإزالة جميع عقوده وسجلاته المالية نهائياً.\n\nالعميل: ${sanitizeName(customer.name)}\n\nهل أنت متأكد؟`
    );
    
    if (confirmed) {
      try {
        await customerService.delete(customer.id);
        loadCustomers();
      } catch (error) {
        console.error('Delete error:', error);
        alert('حدث خطأ أثناء حذف العميل');
      }
    }
  };

  const handleRestoreCustomer = async (customer, e) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    
    try {
      await customerService.restore(customer.id);
      loadCustomers();
    } catch (error) {
      console.error('Restore error:', error);
      alert('حدث خطأ أثناء استرجاع العميل');
    }
  };

  const handleHardDeleteCustomer = async (customer, e) => {
    e.stopPropagation();
    if (isReadOnly) return onRenewalRequest?.();
    
    const confirmed = window.confirm(
      `حذف نهائي! لن تتمكن من استرجاع هذا العميل وبياناته.\n\nالعميل: ${sanitizeName(customer.name)}\n\nهل أنت متأكد؟`
    );
    
    if (confirmed) {
      try {
        await customerService.hardDelete(customer.id);
        loadCustomers();
      } catch (error) {
        console.error('Hard delete error:', error);
        alert('حدث خطأ أثناء الحذف النهائي');
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header if in Manager View */}
      {managerId && (
        <div className={`p-4 ${managerId ? 'bg-indigo-900/30' : 'bg-slate-800/50'} border-b border-slate-700/50 flex items-center gap-4 shrink-0`} style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
          <button onClick={onBack} className="p-2 hover:bg-slate-700 rounded-xl transition-colors text-slate-300">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-black text-white">{managerName || 'حساب بالنيابة'}</h2>
            <p className="text-slate-400 text-xs">عملاء وعقود {managerName || 'هذا الحساب'}</p>
          </div>
        </div>
      )}

      <div className="p-4 space-y-4" style={{ paddingTop: !managerId ? 'calc(env(safe-area-inset-top, 0px) + 16px)' : '0' }}>
        {!managerId && (
          <button
            onClick={onShowManagers}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-2xl font-black flex items-center justify-between group shadow-lg shadow-blue-900/20 active:scale-[0.98] transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="text-right">
                <p className="text-sm font-black">إدارة الحسابات بالنيابة</p>
                <p className="text-[10px] opacity-80 font-bold">إدارة عملاء (موسى، محمد... إلخ)</p>
              </div>
            </div>
            <svg className="w-5 h-5 group-hover:translate-x-[-4px] transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث هنا عن العملاء..."
            className={`flex-1 bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 ${themeBorder} focus:outline-none transition-colors shadow-inner`}
          />
          <button
            onClick={handleAddCustomer}
            className={`${themeBg} text-white px-4 py-3 rounded-xl font-bold btn-press flex items-center gap-2 shadow-lg ${themeShadow} transition-colors`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">عميل</span>
          </button>
          <button
            type="button"
            onClick={handleExportCustomersPDF}
            disabled={pdfLoading || loading}
            className={`${managerId ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/25' : 'bg-blue-500/15 border-blue-500/40 text-blue-300 hover:bg-blue-500/25'} border px-3 py-3 rounded-xl font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50`}
            title="طباعة كشف شامل للعملاء"
          >
            {pdfLoading ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-sm">PDF</span>
            )}
            <span className="hidden sm:inline text-xs">كشف العملاء</span>
          </button>
        </div>

        <div className="flex bg-slate-800 rounded-xl p-1 border border-slate-700">
          {filterType === 'overdue' ? (
            <div className="flex-1 py-2 rounded-lg font-medium text-center text-rose-400 bg-rose-500/10">
              ⚠️ العملاء المتعثرون
            </div>
          ) : (
            ['active', 'archived', ...(recycleBinEnabled ? ['deleted'] : [])].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === tab 
                    ? `${themeBg} text-white shadow-lg` 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab === 'active' ? 'العملاء النشطون' : tab === 'archived' ? 'الأرشيف' : 'سلة المحذوفات 🗑️'}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className={`animate-spin rounded-full h-8 w-8 border-b-2 border-${themeColor}-500`}></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <p className="text-4xl mb-2">👥</p>
            <p>لا يوجد عملاء في هذا القسم</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((customer) => {
              const remainingBalance = customerBalances[customer.id] || 0;
              const monthStatus = customer.is_deleted === 1 ? 'none' : (customerMonthStatuses[customer.id] || 'none');
              const monthStatusDisplay = getCustomerMonthStatusDisplay(monthStatus, managerId);
              const isOverdue = Boolean(
                customer.is_deleted !== 1 && (
                  overdueStatus[customer.id] ||
                  lateStatus[customer.id] ||
                  customer.is_manually_flagged_as_overdue ||
                  monthStatus === 'overdue'
                )
              );
              const hasPostponed = Boolean(
                customer.is_deleted !== 1 && (
                  postponedStatus[customer.id] ||
                  monthStatus === 'postponed'
                )
              );
              const isClean = customer.is_deleted !== 1 && !isOverdue && !hasPostponed;
              
              return (
                <div
                  key={customer.id}
                  onClick={() => onSelect?.(customer)}
                  dir="rtl"
                  className={`${monthStatusDisplay.card} backdrop-blur-md border rounded-2xl p-5 card-hover cursor-pointer flex items-center justify-between gap-4 mb-3 transition-colors duration-300`}
                >
                  {/* ── Right Section: Name & Info ── */}
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <div className="flex items-center gap-2 w-full mb-1">
                      <h4 className="customer-name flex-1 min-w-0 font-black text-white text-sm">
                        {sanitizeName(customer.name)}
                      </h4>

                      {/* Status indicator dots */}
                      {customer.is_deleted !== 1 && (
                        <div className="flex items-center gap-1.5 shrink-0" aria-label="حالة الحساب">
                          {isOverdue && (
                            <span
                              className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse"
                              title="حساب متأخر"
                            />
                          )}
                          {hasPostponed && (
                            <span
                              className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
                              title="أقساط مؤجلة"
                            />
                          )}
                          {isClean && (
                            <span
                              className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                              title="حساب غير متأخر"
                            />
                          )}
                        </div>
                      )}

                      {monthStatusDisplay.label && (
                        <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-black ${monthStatusDisplay.badge}`}>
                          {monthStatusDisplay.label}
                        </span>
                      )}
                    </div>
                    {customer.is_deleted === 1 ? (
                      <p className="text-rose-500 text-xs font-bold mt-1">
                        محذوف منذ: {typeof customer.deleted_at === 'string' ? customer.deleted_at.split(' ')[0] : (customer.deleted_at ? String(customer.deleted_at).split('T')[0] : 'غير معروف')}
                      </p>
                    ) : remainingBalance > 0 && (
                      <p className="text-slate-400 text-xs font-medium mt-1">
                        متبقي: <span className="text-white font-bold">{formatPrivateAmount(remainingBalance, privacyMode, 'ر.س')}</span>
                      </p>
                    )}
                  </div>

                  {/* ── Left Section: Action Icons ── */}
                  <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {customer.is_deleted === 1 ? (
                      <>
                        {/* Restore */}
                        <button
                          onClick={(e) => handleRestoreCustomer(customer, e)}
                          className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-xl text-xs font-bold hover:bg-emerald-500/20 transition-all active:scale-95 shadow-lg flex items-center gap-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          استرجاع
                        </button>

                        {/* Hard Delete */}
                        <button
                          onClick={(e) => handleHardDeleteCustomer(customer, e)}
                          className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-xl text-xs font-bold hover:bg-rose-500/20 transition-all active:scale-95 shadow-lg flex items-center gap-1"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          حذف نهائي
                        </button>
                      </>
                    ) : (
                      <>
                        {/* New Contract */}
                        <button
                          onClick={(e) => handleAddContract(customer, e)}
                          className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-xl flex items-center justify-center hover:bg-emerald-500/20 transition-all active:scale-95 shadow-lg"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </button>

                        {/* Edit */}
                        <button
                          onClick={(e) => handleEditCustomer(customer, e)}
                          className="w-10 h-10 bg-slate-700/40 border border-slate-600/50 text-slate-300 rounded-xl flex items-center justify-center hover:bg-slate-700/60 transition-all active:scale-95 shadow-lg"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>

                        {/* Delete */}
                        <button
                          onClick={(e) => handleDeleteCustomer(customer, e)}
                          className="w-10 h-10 bg-rose-500/10 border border-rose-500/30 text-rose-500 rounded-xl flex items-center justify-center hover:bg-rose-500/20 transition-all active:scale-95 shadow-lg"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <CustomerModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={loadCustomers}
        customer={selectedCustomer}
        managerId={managerId}
        themeColor={themeColor}
      />

      <ContractModal
        isOpen={showContractModal}
        onClose={() => setShowContractModal(false)}
        onSave={loadCustomers}
        customerId={selectedCustomer?.id}
        customerName={selectedCustomer ? sanitizeName(selectedCustomer.name) : ''}
        isBlacklisted={selectedCustomer?.is_blacklisted}
        themeColor={themeColor}
      />
    </div>
  );
};

export default CustomerList;
