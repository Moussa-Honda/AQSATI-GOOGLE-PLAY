import { useCallback, useEffect, useState } from 'react';
import { useManagerStats, useStats } from '../hooks/useApp';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import CustomerList from '../components/CustomerList';
import ContractList from '../components/ContractList';
import Settings from '../components/Settings';
import AuthGate from '../components/AuthGate';
import CustodyList from '../components/CustodyList';
import CustodyDetails from '../components/CustodyDetails';
import ManagerList from '../components/ManagerList';
import { generatePDFStatement } from '../utils/pdfGenerator';
import { contractService, customerService, installmentService, managerService, settingsService } from '../services/database';
import { formatForWhatsApp } from '../utils/phoneUtils';
import { notifyPageNavigated } from '../services/dataEvents';
import { formatPrivateAmount, usePrivacyMode } from '../hooks/usePrivacyMode';

const formatAmount = (value, privacyMode) => formatPrivateAmount(value, privacyMode);

const ALERT_META = {
  today: {
    title: 'الأقساط المستحقة اليوم',
    empty: 'لا توجد أقساط مستحقة اليوم.',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40'
  },
  late: {
    title: 'الأقساط المتأخرة',
    empty: 'لا توجد أقساط متأخرة.',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/40'
  },
  upcoming: {
    title: 'الأقساط قريبة الاستحقاق',
    empty: 'لا توجد أقساط قريبة خلال الأيام القادمة.',
    badge: 'bg-sky-500/15 text-sky-300 border-sky-500/40'
  }
};

const MOTIVATIONAL_MESSAGES = [
  'وَقُلْ رَبِّ زِدْنِي عِلْمًا',
  'أستغفر الله وأتوب إليه',
  'ابدأ يومك بخطوة ثابتة',
  'رزقك مكتوب، وسعيك مبارك'
];

const MotivationalTicker = ({ enabled, startedAt }) => {
  if (!enabled) return null;

  const cycleDuration = 36000;
  const elapsed = Math.max(0, Date.now() - startedAt);
  const animationDelay = `-${elapsed % cycleDuration}ms`;

  return (
    <div className="motivational-ticker" aria-label="رسائل إيمانية وتشجيعية">
      <div className="motivational-ticker__track" style={{ animationDelay }}>
        {[...MOTIVATIONAL_MESSAGES, ...MOTIVATIONAL_MESSAGES].map((message, index) => (
          <span className="motivational-ticker__item" key={`${message}-${index}`}>
            {message}
          </span>
        ))}
      </div>
    </div>
  );
};

const getAlertAmount = (item) => {
  const remaining = Number(item?.amount || 0) - Number(item?.actual_paid || 0);
  return Math.round(Math.max(0, remaining));
};

const HomeAlertsPanel = ({ alerts, loading, onSelectAlert, privacyMode }) => {
  const total = alerts?.total || 0;
  const lateCount = alerts?.late?.length || 0;
  const todayCount = alerts?.today?.length || 0;
  const upcomingCount = alerts?.upcoming?.length || 0;

  const cards = [
    {
      key: 'today',
      title: 'اليوم',
      count: todayCount,
      detail: 'استحقاقات اليوم',
      color: todayCount > 0 
        ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 shadow-sm shadow-amber-500/10' 
        : 'border-slate-700/60 bg-slate-800/40 text-slate-400 hover:border-slate-600',
      dot: todayCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-slate-600',
      onClick: () => onSelectAlert('today')
    },
    {
      key: 'late',
      title: 'متأخر',
      count: lateCount,
      detail: 'متابعة مطلوبة',
      color: lateCount > 0 
        ? 'border-rose-500/60 bg-rose-500/15 text-rose-300 shadow-sm shadow-rose-500/10' 
        : 'border-slate-700/60 bg-slate-800/40 text-slate-400 hover:border-slate-600',
      dot: lateCount > 0 ? 'bg-rose-400 animate-pulse' : 'bg-slate-600',
      onClick: () => onSelectAlert('late')
    },
    {
      key: 'upcoming',
      title: 'قريباً',
      count: upcomingCount,
      detail: 'خلال 3 أيام',
      color: upcomingCount > 0 
        ? 'border-sky-500/60 bg-sky-500/15 text-sky-300 shadow-sm shadow-sky-500/10' 
        : 'border-slate-700/60 bg-slate-800/40 text-slate-400 hover:border-slate-600',
      dot: upcomingCount > 0 ? 'bg-sky-400 animate-pulse' : 'bg-slate-600',
      onClick: () => onSelectAlert('upcoming')
    }
  ];

  if (loading) {
    return (
      <div className="premium-alerts-panel bg-slate-800/50 border border-slate-700/60 rounded-2xl p-4">
        <div className="h-4 w-32 bg-slate-700 rounded animate-pulse mb-3" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(item => <div key={item} className="h-20 bg-slate-900/60 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="premium-alerts-panel bg-slate-800/50 border border-slate-700/60 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${total > 0 ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'} shadow-[0_0_12px_rgba(69,210,160,0.8)]`} />
          متابعة الاستحقاقات
        </h3>
        {total > 0 ? (
          <span className="text-xs font-semibold text-rose-300 bg-rose-500/15 border border-rose-500/30 px-2.5 py-0.5 rounded-full">
            {total} قسط مستحق • {formatPrivateAmount(alerts?.totalAmount, privacyMode, 'ر.س')}
          </span>
        ) : (
          <span className="text-xs text-emerald-400/90 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            جميع الأقساط منتظمة
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={card.onClick}
            className={`border rounded-xl p-3 text-right transition-all active:scale-[0.98] cursor-pointer ${card.color}`}
          >
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-xs font-bold truncate">{card.title}</span>
              <span className={`w-2 h-2 rounded-full shrink-0 ${card.dot}`} />
            </div>
            <p className="text-xl font-black leading-none">{card.count}</p>
            <p className="text-[10px] opacity-80 mt-1 truncate">{card.detail}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

const HomeAlertsModal = ({ isOpen, onClose, alertType, homeAlerts, onOpenCustomer, onSendWhatsApp, onMarkPaid, privacyMode }) => {
  const [markingId, setMarkingId] = useState(null);

  if (!isOpen || !alertType) return null;

  const meta = ALERT_META[alertType] || ALERT_META.today;
  const items = homeAlerts?.[alertType] || [];

  const handleMarkPaid = async (item) => {
    if (!onMarkPaid || markingId === item.id) return;
    setMarkingId(item.id);
    try {
      await onMarkPaid(item);
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
        <div className="p-4 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-bold text-white">{meta.title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">عدد الأقساط: {items.length}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-700/70 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-sm font-bold"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto custom-scrollbar max-h-[68vh]">
          {items.length === 0 ? (
            <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 text-center text-slate-400 text-sm">
              {meta.empty}
            </div>
          ) : items.map((item) => (
            <div key={item.id} className="bg-slate-800/80 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-white font-bold truncate">{item.customer_name || 'عميل'}</h4>
                  <p className="text-slate-400 text-xs mt-1 truncate">{item.contract_title || 'عقد'}</p>
                </div>
                <span className={`shrink-0 text-[11px] font-bold border rounded-full px-2 py-1 ${meta.badge}`}>
                   {formatPrivateAmount(getAlertAmount(item), privacyMode, 'ر.س')}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900/60 rounded-lg p-2">
                  <p className="text-slate-500">تاريخ الاستحقاق</p>
                  <p className="text-slate-200 font-bold mt-1">{item.due_date || '-'}</p>
                </div>
                <div className="bg-slate-900/60 rounded-lg p-2">
                  <p className="text-slate-500">المسؤول</p>
                  <p className="text-slate-200 font-bold mt-1 truncate">{item.manager_name || 'بدون'}</p>
                </div>
              </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenCustomer(item)}
                  className="bg-blue-600/20 border border-blue-500/40 text-blue-300 py-2.5 rounded-xl text-xs font-bold hover:bg-blue-600/30 transition-colors"
                >
                  فتح العميل
                </button>
                <button
                  type="button"
                  onClick={() => onSendWhatsApp(item)}
                  className="bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 py-2.5 rounded-xl text-xs font-bold hover:bg-emerald-600/30 transition-colors"
                >
                  واتساب
                </button>
                <button
                  type="button"
                  onClick={() => handleMarkPaid(item)}
                  disabled={markingId === item.id}
                  className="col-span-2 bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 py-2.5 rounded-xl text-xs font-bold hover:bg-emerald-600/30 transition-colors disabled:opacity-60"
                >
                  {markingId === item.id ? 'جاري تسجيل الدفع...' : 'العميل دفع'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Dashboard = ({ isExpired, expiry, isTrial = false, onReActivate, currentUser, onLogout }) => {
  const { stats: personalStats } = useStats();
  const { stats: managerStats } = useManagerStats();
  const privacyMode = usePrivacyMode();
  const stats = {
    totalInstallments: personalStats.totalInstallments + managerStats.managerTotalInstallments,
    totalPaid: personalStats.totalPaid + managerStats.managerTotalPaid,
    totalRemaining: personalStats.totalRemaining + managerStats.managerTotalRemaining
  };
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedCustody, setSelectedCustody] = useState(null);
  const [selectedManager, setSelectedManager] = useState(null);
  const [showRenewal, setShowRenewal] = useState(false);
  const [showCustodySection, setShowCustodySection] = useState(true);
  const [showMotivationalTicker, setShowMotivationalTicker] = useState(true);
  const [tickerStartedAt] = useState(() => Date.now());
  const [homeAlerts, setHomeAlerts] = useState({ late: [], today: [], upcoming: [], total: 0, totalAmount: 0 });
  const [homeAlertsLoading, setHomeAlertsLoading] = useState(true);
  const [selectedAlertType, setSelectedAlertType] = useState(null);

  const loadDashboardSettings = useCallback(async () => {
    try {
      const [showCustody, showTicker] = await Promise.all([
        settingsService.get('show_custody_section'),
        settingsService.get('show_motivational_ticker')
      ]);
      const isVisible = showCustody !== 'false';
      setShowCustodySection(isVisible);
      setShowMotivationalTicker(showTicker !== 'false');
      if (!isVisible) {
        setActiveTab((prev) => (prev === 'custody' ? 'dashboard' : prev));
      }
    } catch (error) {
      console.error('Error loading dashboard settings:', error);
    }
  }, []);

  const loadHomeAlerts = useCallback(async () => {
    try {
      setHomeAlertsLoading(true);
      const data = await installmentService.getHomeAlerts(3);
      setHomeAlerts(data || { late: [], today: [], upcoming: [], total: 0, totalAmount: 0 });
    } catch (error) {
      console.error('Home alerts error:', error);
    } finally {
      setHomeAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardSettings();
  }, [loadDashboardSettings]);

  useLiveRefresh(loadDashboardSettings);

  useEffect(() => {
    loadHomeAlerts();
    const interval = setInterval(() => {
      loadHomeAlerts();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadHomeAlerts]);

  useLiveRefresh(loadHomeAlerts);

  useEffect(() => {
    if (activeTab === 'dashboard') {
      loadHomeAlerts();
    }
  }, [activeTab, loadHomeAlerts]);

  // تحديث تلقائي وفوري للبيانات والإحصائيات كلما تنقل المستخدم بين التبويبات أو الصفحات
  useEffect(() => {
    notifyPageNavigated({
      activeTab,
      customerId: selectedCustomer?.id,
      managerId: selectedManager?.id,
      custodyId: selectedCustody?.id
    });
  }, [activeTab, selectedCustomer?.id, selectedManager?.id, selectedCustody?.id]);

  const getRemainingDays = () => {
    if (isExpired) return 'منتهي (عرض فقط)';
    if (!expiry) return null;
    if (expiry > 2100000000) return 'تفعيل دائم';
    const now = Math.floor(Date.now() / 1000);
    const diff = expiry - now;
    if (diff <= 0) return 'منتهي (عرض فقط)';
    const days = Math.ceil(diff / (24 * 60 * 60));
    if (isTrial) {
      return `فترة سماح: باقي ${days} يوم`;
    }
    return `باقي ${days} يوم`;
  };

  const remainingText = getRemainingDays();

  const handleOpenAlertCustomer = async (item) => {
    try {
      const customer = await customerService.getById(item.customer_id);
      if (!customer) {
        alert('تعذر فتح العميل');
        return;
      }

      setSelectedAlertType(null);
      if (customer.manager_id) {
        try {
          const mgr = await managerService.getById(customer.manager_id);
          setSelectedManager(mgr || null);
        } catch {
          setSelectedManager(null);
        }
      } else {
        setSelectedManager(null);
      }
      setSelectedCustomer(customer);
      setActiveTab('managers');
    } catch (error) {
      console.error('Open alert customer error:', error);
      alert('تعذر فتح العميل');
    }
  };

  const handleAlertWhatsApp = async (item) => {
    const phone = formatForWhatsApp(item.customer_phone);
    if (!phone) {
      alert('لا يوجد رقم جوال لهذا العميل');
      return;
    }

    try {
      const template = await settingsService.getWhatsAppTemplate();
      const message = template
        .replace(/\[الاسم\]/g, item.customer_name || '')
        .replace(/\[المبلغ\]/g, getAlertAmount(item).toLocaleString('en-US'))
        .replace(/\[التاريخ\]/g, item.due_date || '')
        .replace(/\[العقد\]/g, item.contract_title || '');

      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
    } catch (error) {
      console.error('Alert WhatsApp error:', error);
      alert('تعذر تجهيز رسالة واتساب');
    }
  };

  const handleAlertMarkPaid = async (item) => {
    if (isExpired) {
      setShowRenewal(true);
      return;
    }

    const remaining = getAlertAmount(item);
    if (remaining <= 0) return;

    try {
      await installmentService.pay(item.id, remaining, null, 0);
      await loadHomeAlerts();
    } catch (error) {
      console.error('Alert payment error:', error);
      alert('حدث خطأ أثناء تسجيل الدفع');
    }
  };

  const tabs = [
    { id: 'dashboard', label: 'الرئيسية', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: 'managers', label: 'الحسابات بالنيابة', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
    { id: 'debtors', label: 'المتعثرين', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )},
    ...(showCustodySection ? [{
      id: 'custody', label: 'العهد', icon: (active) => (
        <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
            d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    }] : []),
    { id: 'settings', label: 'الإعدادات', icon: (active) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="dashboard-home flex flex-col h-full overflow-y-auto custom-scrollbar">
            {isExpired && (
              <div className="mx-4 mt-4 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex-1">
                  <h4 className="text-rose-400 font-bold text-sm">انتهى الاشتراك! ⚠️</h4>
                  <p className="text-rose-400/80 text-[10px]">وضع العرض فقط: يمكنك تصفح البيانات ولكن لا يمكن إنشاء معاملات جديدة حتى تجديد الاشتراك.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowRenewal(true)}
                    className="bg-rose-500 hover:bg-rose-400 text-white px-3.5 py-2 rounded-lg text-xs font-bold shadow-lg shadow-rose-500/20 transition-all active:scale-95 cursor-pointer"
                  >
                    تجديد الاشتراك
                  </button>
                </div>
              </div>
            )}

            <div className="dashboard-topbar p-4 flex items-center justify-between border-b" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-slate-900 border border-emerald-400/30 flex items-center justify-center p-0.5 overflow-hidden">
                  <img src="/logo-aqsati.png" alt="شعار أقساطي" className="w-full h-full object-contain rounded-xl" />
                </div>
                <div>
                   <p className="brand-serif text-xl leading-none text-white">أقساطي</p>
                </div>
               </div>
               <MotivationalTicker enabled={showMotivationalTicker} startedAt={tickerStartedAt} />
               {remainingText && (
                 <div className={`px-3 py-1.5 rounded-full text-[10px] font-bold flex items-center gap-1.5 border shadow-sm ${
                   isExpired ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                   remainingText === 'تفعيل دائم' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                   isTrial ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                   'bg-blue-500/10 text-blue-400 border-blue-500/30'
                 }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {remainingText}
                </div>
              )}
            </div>

            <div className="px-4 pt-4">
              <section className="dashboard-summary">
                <div className="dashboard-summary__header">
                  <div>
                    <p className="dashboard-summary__eyebrow">الملخص المالي</p>
                    <h1 className="dashboard-summary__title">متابعة الأقساط</h1>
                  </div>
                  <span className="dashboard-summary__currency">ر.س</span>
                </div>
                <div className="dashboard-kpis">
                  <div className="dashboard-kpi dashboard-kpi--total">
                    <span>قيمة العقود</span>
                     <strong>{formatAmount(stats.totalInstallments, privacyMode)}</strong>
                  </div>
                  <div className="dashboard-kpi dashboard-kpi--paid">
                    <span>المحصّل</span>
                     <strong>{formatAmount(stats.totalPaid, privacyMode)}</strong>
                  </div>
                  <div className="dashboard-kpi dashboard-kpi--remaining">
                    <span>المتبقي للتحصيل</span>
                     <strong>{formatAmount(stats.totalRemaining, privacyMode)}</strong>
                  </div>
                </div>
              </section>
            </div>

            <div className="dashboard-home__alerts p-4 space-y-3">
              <div className="px-1 pt-1">
                <h2 className="dashboard-section-title">يحتاج اهتمامك</h2>
                <p className="dashboard-section-caption">اضغط على أي رقم لعرض التفاصيل</p>
              </div>
              <HomeAlertsPanel
                alerts={homeAlerts}
                loading={homeAlertsLoading}
                onSelectAlert={setSelectedAlertType}
                privacyMode={privacyMode}
              />

            </div>

            <div className="dashboard-home__cta px-4 pb-4">
              <button
                onClick={() => {
                  if (isExpired) {
                    setShowRenewal(true);
                  } else {
                    setActiveTab('managers');
                  }
                }}
                className={`w-full ${isExpired ? 'bg-slate-700 text-slate-400' : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'} py-4 rounded-2xl font-bold text-lg btn-press flex items-center justify-center gap-3 shadow-lg ${!isExpired && 'shadow-indigo-600/30'}`}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {isExpired ? 'تجديد لإضافة عملاء' : 'إضافة حساب بالنيابة'}
              </button>
            </div>
          </div>
        );

      case 'managers':
        return selectedCustomer ? (
          <div className="flex flex-col h-full">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center gap-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <button onClick={() => setSelectedCustomer(null)} className={`p-2 ${selectedCustomer.manager_id ? 'hover:bg-indigo-700/50' : 'hover:bg-slate-700'} rounded-lg transition-colors`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-white">{(String(selectedCustomer?.name || '')).replace(/\s*0+$/g, '').trim() || 'عميل'}</h2>
                <p className="text-slate-400 text-sm">{selectedCustomer.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (isExpired) return setShowRenewal(true);
                    const newValue = !selectedCustomer.is_manually_flagged_as_overdue;
                    await customerService.update(selectedCustomer.id, { is_manually_flagged_as_overdue: newValue });
                    setSelectedCustomer({ ...selectedCustomer, is_manually_flagged_as_overdue: newValue });
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                    selectedCustomer.is_manually_flagged_as_overdue 
                      ? 'bg-amber-500 border-amber-600 text-white' 
                      : 'bg-slate-700 border-slate-600 text-slate-400'
                  }`}
                >
                  {selectedCustomer.is_manually_flagged_as_overdue ? '🔴 متعثر' : '⚪ تمييز كمتعثر'}
                </button>
                <button
                  onClick={async () => {
                    try {
                      const contracts = await contractService.getByCustomerId(selectedCustomer.id);
                      await generatePDFStatement(selectedCustomer, contracts);
                    } catch (pdfErr) {
                      console.error('[Dashboard] PDF button error:', pdfErr);
                      alert('حدث خطأ أثناء إنشاء PDF');
                    }
                  }}
                  className="px-3 py-2 bg-purple-600/20 border border-purple-500/50 text-purple-400 rounded-lg text-sm font-medium hover:bg-purple-600/30 transition-colors"
                >
                  PDF
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              <ContractList 
                customerId={selectedCustomer.id} 
                isReadOnly={isExpired} 
                onRenewalRequest={() => setShowRenewal(true)} 
                themeColor={selectedCustomer.manager_id ? 'indigo' : 'blue'}
              />
            </div>
          </div>
        ) : selectedManager ? (
          <CustomerList 
            onSelect={setSelectedCustomer} 
            isReadOnly={isExpired} 
            onRenewalRequest={() => setShowRenewal(true)} 
            managerId={selectedManager.id}
            managerName={selectedManager.name}
            onBack={() => {
              setSelectedCustomer(null);
              setSelectedManager(null);
            }}
          />
        ) : (
          <ManagerList 
            key="managers-list"
            onSelectManager={(mgr) => {
              setSelectedCustomer(null);
              setSelectedManager(mgr);
            }} 
            onBack={() => {
              setSelectedCustomer(null);
              setSelectedManager(null);
              setActiveTab('dashboard');
            }} 
            isReadOnly={isExpired}
            onRenewalRequest={() => setShowRenewal(true)}
          />
        );

      case 'debtors':
        return selectedCustomer ? (
          <div className="flex flex-col h-full">
            <div className="p-4 bg-slate-800 border-b border-slate-700 flex items-center gap-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
              <button onClick={() => setSelectedCustomer(null)} className="p-2 hover:bg-rose-900/30 rounded-lg transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-white">{(String(selectedCustomer?.name || '')).replace(/\s*0+$/g, '').trim() || 'عميل'}</h2>
                <span className="text-[10px] bg-rose-500 text-white px-2 py-0.5 rounded-full">عميل متعثر ⚠️</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (isExpired) return setShowRenewal(true);
                    const newValue = !selectedCustomer.is_manually_flagged_as_overdue;
                    await customerService.update(selectedCustomer.id, { is_manually_flagged_as_overdue: newValue });
                    setSelectedCustomer({ ...selectedCustomer, is_manually_flagged_as_overdue: newValue });
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
                    selectedCustomer.is_manually_flagged_as_overdue 
                      ? 'bg-amber-500 border-amber-600 text-white' 
                      : 'bg-slate-700 border-slate-600 text-slate-400'
                  }`}
                >
                  {selectedCustomer.is_manually_flagged_as_overdue ? '🔴 متعثر' : '⚪ تمييز كمتعثر'}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              <ContractList 
                customerId={selectedCustomer.id} 
                isReadOnly={isExpired} 
                onRenewalRequest={() => setShowRenewal(true)} 
                themeColor="red" 
              />
            </div>
          </div>
        ) : selectedManager ? (
          <CustomerList 
            onSelect={setSelectedCustomer} 
            isReadOnly={isExpired} 
            onRenewalRequest={() => setShowRenewal(true)} 
            managerId={selectedManager.id}
            managerName={selectedManager.name}
            filterType="overdue"
            onBack={() => {
              setSelectedCustomer(null);
              setSelectedManager(null);
            }}
          />
        ) : (
          <ManagerList 
            key="debtors-list"
            onSelectManager={(mgr) => {
              setSelectedCustomer(null);
              setSelectedManager(mgr);
            }} 
            filterType="overdue"
            onBack={() => {
              setSelectedCustomer(null);
              setSelectedManager(null);
              setActiveTab('dashboard');
            }} 
            isReadOnly={isExpired}
            onRenewalRequest={() => setShowRenewal(true)}
          />
        );

      case 'custody':
        if (!showCustodySection) return null;
        return selectedCustody ? (
          <CustodyDetails 
            custody={selectedCustody} 
            onBack={() => setSelectedCustody(null)} 
            isReadOnly={isExpired}
            onRenewalRequest={() => setShowRenewal(true)}
          />
        ) : (
          <CustodyList onSelectCustody={setSelectedCustody} isReadOnly={isExpired} onRenewalRequest={() => setShowRenewal(true)} />
        );

      case 'settings':
        return <Settings 
          isReadOnly={isExpired} 
          isTrial={isTrial}
          onRenewalRequest={() => setShowRenewal(true)} 
           onSettingsChange={() => {
             loadHomeAlerts();
             loadDashboardSettings();
          }}
          onLicenseRenewed={onReActivate}
          currentUser={currentUser}
          onLogout={onLogout}
        />;

      default:
        return null;
    }
  };

  return (
    <div className="premium-dashboard dashboard-shell flex flex-col h-full max-h-full flex-1 min-h-0 w-full bg-slate-900 overflow-hidden relative">
      {/* ── Persistent Read-Only / View-Only Warning Banner ── */}
      {isExpired && (
        <div className="bg-gradient-to-r from-amber-600/30 via-rose-600/25 to-amber-600/30 border-b border-amber-500/40 px-3 py-2 shrink-0 flex items-center justify-between gap-2 z-40 backdrop-blur-md shadow-md">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-amber-400 text-base shrink-0 animate-pulse">🔒</span>
            <div className="min-w-0">
              <p className="text-amber-200 text-xs font-bold truncate">
                وضع العرض والمشاهدة فقط (انتهت فترة التجربة / الاشتراك)
              </p>
              <p className="text-amber-300/80 text-[10px] truncate hidden sm:block">
                يمكنك الاطلاع على كافة الحسابات والتقارير ولكن لا يمكن إنشاء أو تسجيل معاملات جديدة
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowRenewal(true)}
              className="px-3 py-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-lg font-black text-xs shadow-md transition-all active:scale-95 cursor-pointer"
            >
              تجديد الآن
            </button>
          </div>
        </div>
      )}

      {/* ── Page content ── */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {renderContent()}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav
        className="premium-nav bg-slate-900 border-t border-slate-700/50 shrink-0 z-30 relative"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)'
        }}
      >
        <div className="flex justify-around items-stretch" style={{ height: '72px' }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== 'customers' && tab.id !== 'managers' && tab.id !== 'debtors') {
                    setSelectedCustomer(null);
                    setSelectedManager(null);
                  } else {
                    // Also reset selection when switching between these specific tabs
                    setSelectedCustomer(null);
                    setSelectedManager(null);
                  }
                  if (tab.id !== 'custody') setSelectedCustody(null);
                }}
                data-active={active ? 'true' : 'false'}
                className="flex flex-col items-center justify-center gap-0.5 flex-1 relative px-1"
                style={{ minHeight: '72px' }}
              >
                <span className={`transition-all duration-200 ${active ? 'text-emerald-300' : 'text-slate-400'}`}
                      style={{ transform: active ? 'scale(1.1)' : 'scale(1)', display: 'block' }}>
                  {tab.icon(active)}
                </span>
                <span style={{
                  fontSize: '11px',
                  fontWeight: '700',
                  color: active ? 'var(--fazatak-mint)' : 'var(--fazatak-muted)',
                  lineHeight: 1.2,
                  marginTop: '4px',
                  textAlign: 'center',
                  whiteSpace: 'nowrap'
                }}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {selectedAlertType && (
        <HomeAlertsModal
          isOpen={Boolean(selectedAlertType)}
          alertType={selectedAlertType}
          homeAlerts={homeAlerts}
          onClose={() => setSelectedAlertType(null)}
          onOpenCustomer={handleOpenAlertCustomer}
          onSendWhatsApp={handleAlertWhatsApp}
          onMarkPaid={handleAlertMarkPaid}
          privacyMode={privacyMode}
        />
      )}

      {/* ── Renewal Modal ── */}
      {showRenewal && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center modal-safe-area">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowRenewal(false)} />
          <div className="relative w-full max-w-md mx-4">
            <button
              onClick={() => setShowRenewal(false)}
              className="absolute -top-10 left-2 text-white/70 hover:text-white transition-colors text-xs font-bold bg-slate-800 px-3 py-1.5 rounded-lg z-10"
            >
              إغلاق [✕]
            </button>
            <AuthGate
              isExpired={true}
              initialUser={currentUser}
              onAuthenticated={() => {
                setShowRenewal(false);
                onReActivate?.();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
