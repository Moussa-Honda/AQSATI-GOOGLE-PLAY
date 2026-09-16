# فزتك (Fazatak) — نظام التقسيط والجدولة (PWA)

نظام متكامل واحترافي لإدارة الأقساط، العقود، العملاء، السندات، والمصروفات، مبني ليعمل كتطبيق ويب تقدمي (**Progressive Web App - PWA**) كامل ومتوافق مع جميع الأجهزة (iPhone، iPad، Android، و Desktop) مع دعم كامل للعمل بدون إنترنت (**Offline First**) ودون الحاجة لحساب مطور Apple أو متجر التطبيقات.

---

## 📱 مميزات التطبيق ومعمارية الـ PWA

1. **متوافق 100% مع iOS Safari و iPhone / iPad:**
   - دعم التثبيت المباشر عبر Safari: **Share (مشاركة) ➔ Add to Home Screen (إضافة إلى الشاشة الرئيسية)**.
   - دعم كامل لهوامش الشاشات الحديثة (`safe-area-inset-top`, `safe-area-inset-bottom`, Dynamic Island, Notch, Home Indicator).
   - تجربة مستخدم وتصميم Mobile First باللغة العربية مع دعم كامل لاتجاه اليمين (`dir="rtl"`).
   - خطوط عربية مدمجة محلياً (Tajawal) لتعمل بالكامل في وضع عدم الاتصال بدون أي CDN خارجي.

2. **التخزين المحلي ووضع عدم الاتصال (Offline First Architecture):**
   ```text
   iPhone / Android / Desktop (PWA)
                 ↓
      Service Worker Cache
                 ↓
   SQLite WebAssembly (WASM)
                 ↓
     IndexedDB Storage (Local)
                 ↓
   JSON Backup / Future Cloud Sync
   ```
   - استخدام محرك SQLite WebAssembly مدعوماً بـ IndexedDB لحفظ البيانات محلياً على الجهاز.
   - حفظ تلقائي مستمر (`auto-persistence`) في `IndexedDB` بعد أي عملية إضافة أو تعديل، مما يضمن بقاء البيانات حتى بعد إغلاق المتصفح أو إعادة تشغيل الجهاز.
   - دعم كامل لتوليد وتصدير ومشاركة كشوفات الـ PDF عبر **Web Share API** وتنزيل النسخ الاحتياطية بصيغة JSON.

3. **نظام التراخيص المدمج:**
   - توليد معرف جهاز ثابت (`Web Device ID`) لكل مستخدم.
   - التحقق من كود التفعيل الرقمي المكون من 9 أرقام بخوارزمية تشفير رقمي `SHA-256` محلية متوافقة تماماً مع أداة توليد الرخص [`tools/license_web_generator.html`](tools/license_web_generator.html).

---

## 🚀 طريقة التشغيل والتطوير (Getting Started)

### المتطلبات الأساسية
- Node.js (الإصدار 18 أو أحدث)
- npm

### 1. تثبيت الحزم
```bash
npm install
```

### 2. التشغيل في بيئة التطوير (Development)
```bash
npm run dev
```
افتح الرابط في المتصفح (افتراضياً `http://localhost:5173`).

### 3. بناء النسخة الإنتاجية (Production Build)
```bash
npm run build
```
تُحفظ مخرجات البناء داخل المجلد `dist/`.

### 4. معاينة نسخة الإنتاج محلياً (Preview)
```bash
npm run preview
```

---

## 🌐 النشر على Cloudflare Pages

تم إعداد المشروع ليعمل بسلاسة وتلقائية مع **Cloudflare Pages**:

### إعدادات البناء في Cloudflare Pages:
| الإعداد | القيمة |
| :--- | :--- |
| **Framework preset** | `Vite` |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | `/` |

### ملفات التوجيه والترويسات المجهزة:
- `public/_redirects`: لمعالجة مسارات Single Page Application (SPA Fallback):
  ```text
  /*  /index.html  200
  ```
- `public/_headers`: لضبط ترويسات الأمان والتخزين المؤقت لملفات WASM والـ Service Worker والأصول الثابتة.

---

## 🔐 إعدادات Supabase ومتغيرات البيئة (Environment Variables)

المشروع مصمم ليعمل في الأساس **محلياً دون الحاجة لأي خادم خارجي (Offline-First)**، ويمكن ربطه مستقبلاً مع Supabase عبر إنشاء ملف `.env` (الاسترشاد بـ [`.env.example`](.env.example)):

```env
# Supabase Configuration (اختياري للربط السحابي المستقبلي)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

> [!WARNING]
> لا تقم مطلقاً بوضع مفتاح `service_role` أو أي مفاتيح سرية خاصة داخل ملفات الواجهة الأمامية.


---

## 📲 طريقة تثبيت الـ PWA على iPhone و iPad

1. افتح رابط الموقع المنشور على متصفح **Safari** على جهاز iPhone أو iPad.
2. اضغط على زر المشاركة **Share** (أيقونة المربع وسهم لأعلى في أسفل الشاشة).
3. مرر لأسفل واختر **إضافة إلى الشاشة الرئيسية (Add to Home Screen)**.
4. اضغط على **إضافة (Add)** في الزاوية العلوية.
5. سيظهر التطبيق كأيقونة مستقلة على شاشة الجوال الرئيسية بدون شريط متصفح أو إطارات، ليعمل كتطبيق كامل ومستقل.

---

## 🛡️ الفحص الأمني وإرشادات المفاتيح الخاصة

- تم استبعاد ملفات المفاتيح الخاصة وحجبها تماماً من الـ Git عبر `.gitignore`.
- في حال كان المفتاح الموجود في مجلد `tools/` قد استُخدم في إصدار سابق لأغراض إنتاجية، يُوصى بتدويره (Key Rotation).
- التطبيق لا يرسل أي بيانات مالية أو محاسبية إلى أي جهة خارجية ويعتمد بنسبة 100% على التخزين المحلي الآمن.
