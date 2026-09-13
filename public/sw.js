// ============================================================
// أقساطي للأقساط والديون - Service Worker
// استراتيجية: Cache First للـ assets + Offline fallback للـ navigation
// ============================================================

const CACHE_VERSION = 'v2.7.0';
const CACHE_NAME = `fazatak-cache-${CACHE_VERSION}`;
const OFFLINE_PAGE = '/index.html';

// ── الأصول الثابتة (دائماً نفس المسار)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/manifest.json',
  '/logo-mark.svg',
  '/logo-aqasti.svg',
  '/favicon.svg',
  '/icons.svg',
  '/icons/aqasti-apple-touch-icon.png',
  '/icons/icon-48.png',
  '/icons/icon-72.png',
  '/icons/icon-96.png',
  '/icons/icon-128.png',
  '/icons/aqasti-icon-192.png',
  '/icons/icon-256.png',
  '/icons/aqasti-icon-512.png',
  '/assets/sql-wasm.wasm',
];

// ── الأصول الديناميكية (hashed) تُحقن تلقائياً من Vite plugin بعد كل build
// [INJECT_DYNAMIC_ASSETS]
const DYNAMIC_ASSETS = [];
// [END_INJECT_DYNAMIC_ASSETS]

const ALL_PRECACHE = [...new Set([...STATIC_ASSETS, ...DYNAMIC_ASSETS])];

// ─────────────────────────────────────────────
// INSTALL: cache كل الأصول مسبقاً
// ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // نحاول cache كل الأصول، أي خطأ لا يوقف التثبيت
      const results = await Promise.allSettled(
        ALL_PRECACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to precache: ${url}`, err);
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        console.warn(`[SW] ${failed.length} assets failed to precache`);
      } else {
        console.log(`[SW] All ${ALL_PRECACHE.length} assets precached ✅`);
      }
    })
  );
  // أسرع تفعيل: لا تنتظر إغلاق التبويبات القديمة
  self.skipWaiting();
});

// ─────────────────────────────────────────────
// ACTIVATE: حذف الـ caches القديمة
// ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name.startsWith('fazatak-cache-') && name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      )
    ).then(() => {
      console.log(`[SW] Activated cache: ${CACHE_NAME}`);
      return self.clients.claim();
    })
  );
});

// ─────────────────────────────────────────────
// PUSH: استقبال إشعارات المتأخرين والمستحقين اليوم من Cloudflare
// ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  const title = payload.title || 'أقساطي';
  const options = {
    body: payload.body || 'لديك تحديث جديد في أقساطي',
    icon: payload.icon || '/icons/aqasti-icon-192.png',
    badge: payload.badge || '/icons/icon-96.png',
    tag: payload.tag || 'fazatak-due-alerts',
    renotify: Boolean(payload.renotify),
    dir: 'rtl',
    lang: 'ar',
    data: payload.data || { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// NOTIFICATION CLICK: فتح التطبيق عند الضغط على التنبيه
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => 'focus' in client);
      if (existing) {
        existing.navigate(targetUrl);
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ─────────────────────────────────────────────
// FETCH: الاستراتيجية الذكية حسب نوع الطلب
// ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // تجاهل الطلبات غير GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // تجاهل طلبات مختلف الأصول (Supabase, Google, etc.)
  const isExternal = url.origin !== self.location.origin;
  if (isExternal) {
    // للطلبات الخارجية: شبكة أولاً ثم cache
    event.respondWith(networkFirstWithCacheFallback(request));
    return;
  }

  // ── SPA Navigation (فتح الصفحة / تحديثها)
  // استراتيجية: Cache First → Network → Offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  // ── الأصول الـ hashed (JS, CSS, fonts, wasm, images)
  // استراتيجية: Cache First (لا تتغير بدون تغيير الاسم)
  const isHashedAsset = isStaticHashedAsset(url);
  if (isHashedAsset) {
    event.respondWith(cacheFirstWithNetworkFallback(request));
    return;
  }

  // ── الأصول الثابتة بدون hash (icons, manifest)
  // استراتيجية: Stale While Revalidate
  const isStaticFile = isStaticFileNoHash(url);
  if (isStaticFile) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // ── الباقي: Network first مع cache fallback
  event.respondWith(networkFirstWithCacheFallback(request));
});

// ─────────────────────────────────────────────
// استراتيجيات الـ Fetch
// ─────────────────────────────────────────────

/**
 * SPA Navigation - Network First with Cache Fallback:
 * 1. جرب الشبكة أولاً (يضمن تشغيل jeep-sqlite بشكل صحيح)
 * 2. إذا انقطع الإنترنت → index.html من الـ cache
 * 3. طوارئ → صفحة offline مضمّنة
 * 
 * ملاحظة: Cache First للـ navigation يُسبب مشاكل مع jeep-sqlite WebStore
 */
async function handleNavigation(request) {
  try {
    // أولاً: جرب الشبكة
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      // خزّن نسخة محدّثة في الـ cache
      const cache = await caches.open(CACHE_NAME);
      cache.put(OFFLINE_PAGE, networkResponse.clone());
      return networkResponse;
    }
    // إذا رجعت الشبكة بخطأ، انتقل للـ cache
    throw new Error(`Network response: ${networkResponse?.status}`);
  } catch {
    // لا إنترنت أو خطأ → ارجع من الـ cache
    const cached = await caches.match(OFFLINE_PAGE) || await caches.match('/');
    if (cached) return cached;
    // لا إنترنت ولا cache → صفحة خطأ مضمّنة
    return buildOfflineFallbackPage();
  }
}


/**
 * Cache First with Network Fallback:
 * مثالي للأصول الـ hashed (لا تتغير بدون hash جديد)
 */
async function cacheFirstWithNetworkFallback(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] cacheFirstWithNetworkFallback failed:', request.url);
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/**
 * Stale While Revalidate:
 * أرجع الـ cache فوراً + حدّث في الخلفية
 */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (response && response.status === 200) {
      caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);

  return cached || (await networkPromise) || new Response('', { status: 503 });
}

/**
 * Network First with Cache Fallback:
 * للطلبات التي يجب أن تكون حديثة (API, external)
 */
async function networkFirstWithCacheFallback(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503 });
  }
}

/**
 * تحديث الـ cache في الخلفية بدون تأخير المستخدم
 */
function refreshCacheInBackground(request, cacheKey) {
  fetch(request).then((response) => {
    if (response && response.status === 200) {
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(cacheKey || request, response);
      });
    }
  }).catch(() => {/* offline, skip */});
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isStaticHashedAsset(url) {
  const path = url.pathname;
  // الأصول الـ hashed تكون في /assets/ وتحتوي على - أو hash patterns
  return (
    path.startsWith('/assets/') &&
    (path.endsWith('.js') ||
      path.endsWith('.css') ||
      path.endsWith('.woff2') ||
      path.endsWith('.woff') ||
      path.endsWith('.wasm') ||
      path.endsWith('.webp') ||
      path.endsWith('.png') ||
      path.endsWith('.jpg'))
  );
}

function isStaticFileNoHash(url) {
  const path = url.pathname;
  return (
    path.startsWith('/icons/') ||
    path.endsWith('.svg') ||
    path.endsWith('.png') ||
    path.endsWith('.webmanifest') ||
    path.endsWith('.json') ||
    path === '/favicon.svg'
  );
}

/**
 * صفحة offline مضمّنة في حالة الطوارئ (لا cache + لا إنترنت)
 */
function buildOfflineFallbackPage() {
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
   <title>أقساطي - غير متصل</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#1e293b;border:1px solid #334155;border-radius:20px;
          padding:32px 24px;max-width:360px;width:100%;text-align:center}
    .icon{font-size:56px;margin-bottom:16px}
    h1{font-size:22px;font-weight:800;color:#f1f5f9;margin-bottom:8px}
    p{font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:24px}
    button{background:#6366f1;color:#fff;border:none;border-radius:12px;
           padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer;width:100%}
    button:hover{background:#4f46e5}
    .tip{margin-top:16px;font-size:12px;color:#475569;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📡</div>
    <h1>أنت غير متصل</h1>
     <p>يبدو أن الاتصال بالإنترنت منقطع. أقساطي يعمل بالكامل بدون إنترنت بعد أول تحميل.</p>
    <button onclick="window.location.reload()">🔄 إعادة المحاولة</button>
    <p class="tip">💡 تأكد من أن التطبيق قد فتح مرة واحدة على الأقل وأنت متصل بالإنترنت لتفعيل وضع الـ Offline</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
