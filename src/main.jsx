import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { defineCustomElements as jeepSqlite } from 'jeep-sqlite/loader'
import { initDatabase } from './services/database.js'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const syncViewportHeight = () => {
  const height = window.visualViewport?.height || window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${height}px`)
}

syncViewportHeight()
window.addEventListener('resize', syncViewportHeight)
window.visualViewport?.addEventListener('resize', syncViewportHeight)

// Register jeep-sqlite web component for in-browser SQLite WebAssembly
jeepSqlite(window)

// Register Service Worker for Offline PWA
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })

      console.log('[SW] Registered ✅ scope:', registration.scope)

      // لا نُعيد التحميل تلقائياً لتجنب فقدان البيانات
      // التحديث يحدث في المرة القادمة التي يفتح فيها المستخدم التطبيق

    } catch (err) {
      console.warn('[SW] Registration failed:', err)
    }
  })
}


const mountApp = async () => {
  try {
    // Ensure jeep-sqlite element is attached and defined before initDatabase
    if (typeof document !== 'undefined') {
      let jeepEl = document.querySelector('jeep-sqlite')
      if (!jeepEl && document.body) {
        jeepEl = document.createElement('jeep-sqlite')
        jeepEl.setAttribute('wasmPath', '/assets')
        jeepEl.setAttribute('autoSave', 'true')
        document.body.appendChild(jeepEl)
      } else if (jeepEl) {
        jeepEl.setAttribute('autoSave', 'true')
      }
    }
    if (typeof customElements !== 'undefined') {
      try {
        await customElements.whenDefined('jeep-sqlite')
      } catch {}
    }

    await initDatabase()

    const rootEl = document.getElementById('root')
    if (rootEl) {
      createRoot(rootEl).render(
        <StrictMode>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </StrictMode>,
      )
    }
  } catch (err) {
    console.error('Failed to initialize database:', err)
    const rootEl = document.getElementById('root')
    if (rootEl) {
      createRoot(rootEl).render(
        <div className="flex items-center justify-center h-screen bg-slate-900 text-white p-8 text-center font-sans" dir="rtl">
          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 max-w-md w-full shadow-2xl">
            <h1 className="text-xl font-bold text-rose-400 mb-2">خطأ في تهيئة قاعدة البيانات</h1>
            <p className="text-slate-300 text-sm mb-4">{err.message || 'تعذر تشغيل محرك البيانات'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white font-medium text-sm transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        </div>
      )
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp)
} else {
  mountApp()
}
