import { useState, useEffect, useCallback } from 'react';

const ONBOARDING_KEY = 'aqsati_onboarding_done';

const slides = [
  {
    id: 0,
    icon: (
      <svg viewBox="0 0 80 80" fill="none" className="w-28 h-28">
        <circle cx="40" cy="40" r="38" fill="url(#g0)" opacity="0.15" />
        <defs>
          <radialGradient id="g0" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </radialGradient>
        </defs>
        {/* Hand with coins */}
        <path d="M20 52c0 0 8-6 20-6s18 4 18 4" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" />
        <ellipse cx="40" cy="32" rx="12" ry="12" fill="none" stroke="#6366f1" strokeWidth="2.5" />
        <path d="M40 26v12M36 30l4-4 4 4" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="58" cy="22" r="6" fill="#10b981" />
        <path d="M55.5 22l1.5 1.5 3-3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 60h48" stroke="#334155" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="18" y="52" width="44" height="10" rx="3" fill="#1e293b" opacity="0.7" />
      </svg>
    ),
    gradient: 'from-indigo-600/20 via-blue-600/10 to-transparent',
    accent: 'indigo',
    accentHex: '#6366f1',
    title: 'أهلاً بك في أقساطي',
    subtitle: 'وضوح مالي، من أول قسط',
    description: 'مساحتك الهادئة لإدارة الأقساط والديون والعملاء، بقرارات أسرع وتفاصيل أقل تشتيتاً.',
  },
  {
    id: 1,
    icon: (
      <svg viewBox="0 0 80 80" fill="none" className="w-28 h-28">
        <circle cx="40" cy="40" r="38" fill="url(#g1)" opacity="0.15" />
        <defs>
          <radialGradient id="g1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#6366f1" />
          </radialGradient>
        </defs>
        <rect x="18" y="20" width="44" height="40" rx="4" fill="#1e293b" />
        <rect x="24" y="28" width="32" height="4" rx="2" fill="#10b981" opacity="0.7" />
        <rect x="24" y="36" width="22" height="3" rx="1.5" fill="#334155" />
        <rect x="24" y="43" width="28" height="3" rx="1.5" fill="#334155" />
        <rect x="24" y="50" width="18" height="3" rx="1.5" fill="#334155" />
        <circle cx="58" cy="52" r="10" fill="#10b981" />
        <path d="M54 52l2.5 2.5 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    gradient: 'from-emerald-600/20 via-teal-600/10 to-transparent',
    accent: 'emerald',
    accentHex: '#10b981',
    title: 'إدارة العملاء',
    subtitle: 'والعقود بسهولة',
    description: 'أضف عملاءك، أنشئ عقودهم، وراجع دورة السداد من شاشة واحدة دون جداول متفرقة.',
  },
  {
    id: 2,
    icon: (
      <svg viewBox="0 0 80 80" fill="none" className="w-28 h-28">
        <circle cx="40" cy="40" r="38" fill="url(#g2)" opacity="0.15" />
        <defs>
          <radialGradient id="g2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </radialGradient>
        </defs>
        {/* Bell with badge */}
        <path d="M40 18c-8 0-14 6-14 14v10l-4 6h36l-4-6V32c0-8-6-14-14-14z" fill="#1e293b" stroke="#f59e0b" strokeWidth="2" />
        <path d="M36 54c0 2.2 1.8 4 4 4s4-1.8 4-4" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
        <circle cx="54" cy="24" r="8" fill="#ef4444" />
        <text x="54" y="28" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">!</text>
        <path d="M22 46h36" stroke="#334155" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    gradient: 'from-amber-600/20 via-orange-600/10 to-transparent',
    accent: 'amber',
    accentHex: '#f59e0b',
    title: 'تنبيهات ذكية',
    subtitle: 'لا تفوّت قسط',
    description: 'اعرف ما يحتاج اهتمامك الآن، وتواصل مع العميل برسالة واتساب جاهزة في اللحظة المناسبة.',
  },
  {
    id: 3,
    icon: (
      <svg viewBox="0 0 80 80" fill="none" className="w-28 h-28">
        <circle cx="40" cy="40" r="38" fill="url(#g3)" opacity="0.15" />
        <defs>
          <radialGradient id="g3" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#3b82f6" />
          </radialGradient>
        </defs>
        {/* Cloud sync */}
        <path d="M52 44c4 0 8-3.5 8-8s-3.5-8-8-8c-0.5 0-1 0-1.5 0.1C49.1 24.4 45 22 40 22c-7.2 0-13 5.8-13 13 0 5 2.8 9.3 7 11.5" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
        <path d="M30 44h20" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
        <path d="M36 50l4 4 4-4M36 38l4-4 4 4" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="56" cy="56" r="8" fill="#3b82f6" />
        <path d="M53 56l2 2 4-4" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    gradient: 'from-violet-600/20 via-purple-600/10 to-transparent',
    accent: 'violet',
    accentHex: '#8b5cf6',
    title: 'مزامنة سحابية',
    subtitle: 'بياناتك في أمان',
    description: 'بياناتك محمية ومهيأة للعمل على الجوال أو سطح المكتب، حتى عندما تكون خارج المكتب.',
  },
];

const accentClasses = {
  indigo: {
    bg: 'bg-indigo-600',
    bgLight: 'bg-indigo-600/20',
    border: 'border-indigo-500/40',
    text: 'text-indigo-400',
    dot: 'bg-indigo-500',
    button: 'from-indigo-600 to-blue-600 shadow-indigo-600/30',
  },
  emerald: {
    bg: 'bg-emerald-600',
    bgLight: 'bg-emerald-600/20',
    border: 'border-emerald-500/40',
    text: 'text-emerald-400',
    dot: 'bg-emerald-500',
    button: 'from-emerald-600 to-teal-600 shadow-emerald-600/30',
  },
  amber: {
    bg: 'bg-amber-500',
    bgLight: 'bg-amber-500/20',
    border: 'border-amber-500/40',
    text: 'text-amber-400',
    dot: 'bg-amber-500',
    button: 'from-amber-500 to-orange-600 shadow-amber-500/30',
  },
  violet: {
    bg: 'bg-violet-600',
    bgLight: 'bg-violet-600/20',
    border: 'border-violet-500/40',
    text: 'text-violet-400',
    dot: 'bg-violet-500',
    button: 'from-violet-600 to-purple-600 shadow-violet-600/30',
  },
};

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      const done = localStorage.getItem(ONBOARDING_KEY) || localStorage.getItem('fazatak_onboarding_done');
      if (!done) {
        setShowOnboarding(true);
      }
    } catch {}
    setChecked(true);
  }, []);

  const completeOnboarding = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {}
    setShowOnboarding(false);
  }, []);

  return { showOnboarding: checked && showOnboarding, completeOnboarding };
}

export default function WelcomeOnboarding({ onComplete }) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState('next');
  const [visible, setVisible] = useState(true);

  const slide = slides[currentSlide];
  const accent = accentClasses[slide.accent];
  const isLast = currentSlide === slides.length - 1;

  const goTo = (nextIndex, dir = 'next') => {
    if (animating) return;
    setAnimating(true);
    setDirection(dir);
    setTimeout(() => {
      setCurrentSlide(nextIndex);
      setAnimating(false);
    }, 280);
  };

  const handleNext = () => {
    if (isLast) {
      handleComplete();
    } else {
      goTo(currentSlide + 1, 'next');
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      goTo(currentSlide - 1, 'prev');
    }
  };

  const handleComplete = () => {
    setVisible(false);
    setTimeout(() => onComplete?.(), 350);
  };

  const handleSkip = () => {
    handleComplete();
  };

  return (
    <div
      className="premium-onboarding fixed inset-0 z-[99999] flex flex-col bg-slate-900 overflow-hidden"
      style={{
        transition: 'opacity 0.35s ease',
        opacity: visible ? 1 : 0,
      }}
      dir="rtl"
    >
      {/* Animated background gradient blob */}
      <div
        className={`absolute inset-0 bg-gradient-to-b ${slide.gradient} transition-all duration-700 pointer-events-none`}
      />
      <div
        className="absolute top-0 right-0 w-72 h-72 rounded-full blur-3xl opacity-20 transition-all duration-700 pointer-events-none"
        style={{ background: slide.accentHex }}
      />
      <div
        className="absolute bottom-0 left-0 w-64 h-64 rounded-full blur-3xl opacity-10 transition-all duration-700 pointer-events-none"
        style={{ background: slide.accentHex }}
      />

      {/* Skip button */}
      <div className="relative flex justify-between items-center px-6 pt-14 pb-2">
        <button
          type="button"
          onClick={handleSkip}
          className="text-slate-500 text-sm font-medium hover:text-slate-400 transition-colors"
        >
          تخطي
        </button>
        {/* App name */}
        <span className="onboarding-brand flex items-center gap-2">
          <img src="/logo-aqsati.png" alt="شعار أقساطي" className="w-8 h-8 object-contain rounded-lg shadow" />
          <span>أقساطي</span>
        </span>
      </div>

      {/* Slide content */}
      <div
        className="relative flex-1 flex flex-col items-center justify-center px-8 text-center"
        style={{
          transition: 'opacity 0.28s ease, transform 0.28s ease',
          opacity: animating ? 0 : 1,
          transform: animating
            ? direction === 'next' ? 'translateX(-30px)' : 'translateX(30px)'
            : 'translateX(0)',
        }}
      >
        {/* Floating icon container */}
        <div
          className={`onboarding-card relative flex items-center justify-center rounded-3xl p-6 mb-8 ${accent.bgLight} border ${accent.border} shadow-lg`}
          style={{
            boxShadow: `0 0 40px ${slide.accentHex}25`,
          }}
        >
          {/* Pulse ring */}
          <div
            className="absolute inset-0 rounded-3xl animate-ping opacity-20"
            style={{ background: slide.accentHex }}
          />
          {slide.icon}
        </div>

        <p className="onboarding-kicker mb-2">إدارة مالية سعودية، بهدوء</p>

        {/* Title */}
        <h1 className="text-3xl font-black text-white leading-tight mb-1">
          {slide.title}
        </h1>
        <h2 className={`text-xl font-bold mb-5 ${accent.text}`}>
          {slide.subtitle}
        </h2>

        {/* Description */}
        <p className="text-slate-400 text-base leading-relaxed max-w-xs">
          {slide.description}
        </p>

        {/* Feature pills for first slide */}
        {slide.id === 0 && (
          <div className="flex flex-wrap gap-2 justify-center mt-6">
            {['أقساط', 'ديون', 'عملاء', 'تنبيهات', 'واتساب'].map((tag) => (
              <span
                key={tag}
                className={`text-xs font-bold px-3 py-1 rounded-full ${accent.bgLight} ${accent.text} border ${accent.border}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="relative px-6 pb-12 pt-4 space-y-5">
        {/* Dots indicator */}
        <div className="flex items-center justify-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(i, i > currentSlide ? 'next' : 'prev')}
              className={`rounded-full transition-all duration-300 ${
                i === currentSlide
                  ? `w-6 h-2.5 ${accent.dot}`
                  : 'w-2.5 h-2.5 bg-slate-700'
              }`}
              aria-label={`الشريحة ${i + 1}`}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-3">
          {currentSlide > 0 && (
            <button
              type="button"
              onClick={handlePrev}
              className="flex-1 py-4 rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 font-bold text-sm hover:bg-slate-700 transition-colors"
            >
              السابق
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            className={`flex-1 py-4 rounded-2xl bg-gradient-to-l ${accent.button} text-white font-bold text-base shadow-lg transition-all active:scale-[0.97]`}
          >
            {isLast ? '🚀 ابدأ الآن' : 'التالي'}
          </button>
        </div>
      </div>
    </div>
  );
}
