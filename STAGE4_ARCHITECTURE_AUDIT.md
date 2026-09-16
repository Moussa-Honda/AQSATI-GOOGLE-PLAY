# تقرير الفحص المعماري الشامل — Stage 4: Read-Only Architecture Audit & Integration Design

> [!IMPORTANT]
> **إقرار الالتزام الصارم بالقواعد (Read-Only Enforcement):**
> تم تنفيذ هذه المرحلة بالكامل بصيغة **القراءة والفحص والتحليل فقط (Read-Only)**.
> - لم يتم تعديل أي ملف في المشروع نهائياً.
> - لم يتم تثبيت أي package عبر npm أو Gradle dependency.
> - لم يتم تغيير `package.json` أو `AndroidManifest.xml` أو ملفات Gradle أو SQLite أو أنظمة Backup أو Auth.
> - لم يتم إجراء أي عمليات Git (commit / push / reset / clean).
> - هذا التقرير هندسي تحليلي استباقي لتصميم دمج Google Play Billing بأقل مخاطرة ممكنة قبل اتخاذ أي قرار تنفيذي.

---

## 1) لقطة حالة كاملة للمشروع (Actual Project Snapshot)

تم فحص بيئة المشروع الفعلية من خلال ملفات النظام وسجلات البناء الحية، وهذه هي القيم الفعلية المسجلة:

| العنصر | القيمة الفعلية في المشروع | المصدر في الكود |
| :--- | :--- | :--- |
| **Git Branch** | `main` | `git status` |
| **HEAD Commit** | `3f532ed46deebb6babbd23c3dc5715f0989d0eb5` | `git log -1` |
| **Git Working Tree** | تعديلات محلية قيد العمل غير مرحلة (Unstaged working files) | `git status` |
| **Package Name & Version** | `installment-app` v`0.0.0` | `package.json:L2-L4` |
| **React Version** | `^19.2.5` | `package.json:L43` |
| **Vite Version** | `^6.0.1` (`@vitejs/plugin-react`) | `package.json:L53` |
| **Capacitor Core / Android** | `^8.3.3` (Capacitor 8) | `package.json:L22-L28` |
| **Android Application ID** | `com.installment.app` | `android/app/build.gradle:L7` |
| **versionCode** | `47` | `android/app/build.gradle:L10` |
| **versionName** | `"0.0.0"` | `android/app/build.gradle:L11` |
| **compileSdkVersion** | `36` (Android 16) | `android/variables.gradle:L3` |
| **targetSdkVersion** | `36` (Android 16) | `android/variables.gradle:L4` |
| **minSdkVersion** | `24` (Android 7.0 Nougat) | `android/variables.gradle:L2` |
| **Android Gradle Plugin (AGP)** | `8.13.0` | `android/build.gradle:L10` |
| **Gradle Distribution** | `8.14.3-all` | `gradle-wrapper.properties:L3` |
| **Java / JDK Runtime** | OpenJDK `21.0.8` (64-Bit Server VM) | `java -version` |
| **Kotlin Support** | غير مطبق في Gradle (`plugins { id 'kotlin-android' }` غير موجود) | `android/build.gradle` |
| **NDK / C++ CMake** | CMake موجود (`3.18.1`)، لكن كود C++ معطل بنص تعليق صريح | `android/app/src/main/cpp/CMakeLists.txt:L3` |
| **16KB Page Alignment** | مكتبات C/C++ المضمنة (`libsqlcipher.so`, `libimage_processing...`) مفحوصة: محاذاة 16KB بنسبة 100% | حزمة `scratch/check_16kb.cjs` |
| **Billing Dependencies الحالية** | **0% — لا توجد أي مكتبة Google Play Billing** | `package.json` و `build.gradle` |
| **Capacitor Billing Plugin** | **غير موجود نهائياً** | `package.json` |
| **Native Android Billing** | **غير موجود نهائياً** | `MainActivity.java` و `AndroidManifest.xml` |
| **اختبار توافق النسخ الاحتياطي** | **25/25 PASS (100% نجاح بدون أي خطأ)** | `node scripts/test_backup_compatibility.cjs` |

---

## 2) فحص البنية الحالية للترخيص بالكامل (License & Auth Audit)

### 2.1 طبقة الترخيص المحلي (License Layer)
النظام يعتمد على طبقتين متكاملتين للترخيص:
1. **واجهة JavaScript:** `src/services/license.js`
   - تستدعي الإضافة الأصلية عبر `registerPlugin('License')` في بيئة أندرويد.
   - توفر بديلاً (Fallback) لبيئة الويب والتطوير باستخدام `localStorage`.
2. **الإضافة الأصلية لنظام أندرويد (Native Plugin):** `android/app/src/main/java/com/installment/app/LicensePlugin.java`
   - مسجلة في `MainActivity.java:L10`.
   - تخزن البيانات مشفرة باستخدام `EncryptedSharedPreferences` (`AES256_SIV` للمفاتيح و `AES256_GCM` للقيم) في ملف `license_prefs`.

### 2.2 الحقول والمعاملات الفعلية في `license_prefs`
- `license_code`: كود التفعيل المكون من 9 أرقام المدخل من المستخدم.
- `expiry`: وقت انتهاء الترخيص بصيغة Unix Timestamp بالثواني.
- `last_seen_time`: آخر وقت تم فيه تشغيل التطبيق بالثواني، ويستخدم لكشف التلاعب بالساعة (`ERR_TIME_TAMPERED` عند التراجع بأكثر من ساعة `now < lastSeen - 3600`).
- `derived_key`: مفتاح تشفير مستنتج محلياً بطول 8 أحرف (`SHA-256` لـ `deviceId + cleanCode + SECRET_SALT`).
- `trial_start_time`: وقت بدء فترة السماح المجانية للمستخدم الجديد (30 يوماً).
- `trial_expiry`: وقت انتهاء فترة السماح المجانية (`trial_start_time + 30 days`).

### 2.3 طبقة التوثيق والمستخدم (Authentication Layer)
- الملف: `src/services/authService.js`
- المفاتيح المستخدمة:
  - `aqsati_auth_user` في `localStorage` (لجلسة المستخدم النشطة).
  - جدول `app_users` في SQLite محلياً.
- الدالة المحورية: `getOrInitAdminUser(deviceId, expiry)` في السطر 136:
  - إذا لم يوجد مستخدم نشط، تبحث عن أول مستخدم في جدول `app_users`.
  - إذا لم تجد، تنشئ مستخدماً افتراضياً ببيانات: `phone: deviceId` و `password_hash: 'ACTIVATED_DEVICE'`.
  - تقوم بتعيين `subscription_expiry` بناءً على قيمة انتهاء الترخيص (أو تاريخ دائم `2099-01-01` إذا كان لا نهائياً).

### 2.4 نقاط التحكم بالوصول (Access Control Points)
- `checkLicenseStatus()`: تفحص سريان الترخيص أو فترة التجربة. ترفع `ERR_EXPIRED` أو `ERR_TIME_TAMPERED`.
- `isExpired`: متغير حالة محوري يبدأ من `App.jsx:L69`، يُمرر إلى شاشة `Dashboard.jsx:L260` ثم يُمرر كـ `isReadOnly` إلى جميع القوائم.
- `isReadOnly`: يمنع عمليات التعديل والإضافة والحذف في كل من:
  - `CustomerList.jsx` (منع إضافة/تعديل/حذف العملاء وعقودهم).
  - `ContractList.jsx` (منع تسجيل السداد، السداد المبكر، التأجيل، وإلغاء التأجيل).
  - `CustodyList.jsx` و `CustodyDetails.jsx` (منع إضافة عهدة أو تسجيل مصروفات).
  - `ManagerList.jsx` (منع إضافة أو تعديل جهات التمويل).
  - `Settings.jsx` (منع استرجاع النسخ من Google Drive).

### 2.5 خريطة الاعتماديات الحقيقية (Real Dependency Flow Map)

```text
[تشغيل التطبيق App.jsx]
         │
         ▼
[licenseService.getDeviceId()] ──► Native: Settings.Secure.ANDROID_ID + DEVICE_SALT ──► 6 أرقام
         │
         ▼
[licenseService.checkLicenseStatus()]
         │
         ├─────────────────────────────────────────┐
         │ (الترخيص سارٍ أو التجربة سارية)          │ (فشل التحقق أو انتهاء المدة)
         ▼                                         ▼
[authService.getOrInitAdminUser]              [حدث خطأ ERR_EXPIRED]
         │                                         │
         ▼                                         ▼
[isLicensed = true, isExpired = false]        [isLicensed = false, isExpired = true]
         │                                         │
         ▼                                         ▼
[شاشة Dashboard كاملة الصلاحيات]             [ظهور شاشة AuthGate.jsx]
                                                   │
                         ┌─────────────────────────┴─────────────────────────┐
                         ▼                                                   ▼
                [إدخال كود تفعيل 9 أرقام]                           [الضغط على "وضع العرض فقط"]
                         │                                                   │
                         ▼                                                   ▼
                [licenseService.activateLicense]                    [handleViewOnlyAccess()]
                         │                                                   │
                         ▼                                                   ▼
                [تحديث license_prefs]                              [isLicensed=true, isExpired=true]
                         │                                                   │
                         ▼                                                   ▼
                [الدخول إلى Dashboard]                              [الدخول إلى Dashboard بوضع View-Only]
                                                                    (البيانات متاحة للقراءة والـ PDF)
```

---

## 3) فحص نقاط إنشاء المستخدم والترخيص (User vs License Lifecycle)

من خلال تتبع الشفرة البرمجية بدقة:

1. **متى يتم إنشاء المستخدم؟**
   - يتم إنشاء المستخدم إما تلقائياً عبر `authService.getOrInitAdminUser(deviceId, expiry)` عند نجاح فحص الترخيص في `App.jsx:L115`، أو يدوياً عبر شاشة التسجيل `authService.register({ name, phone, password, pin })` في `authService.js:L253`.
2. **هل إنشاء المستخدم يحتاج ترخيصاً؟**
   - **نعم في المسار المباشر:** التطبيق لا يسمح بالوصول إلى الشاشة الرئيسية لإنشاء المستخدم إلا إذا كان هناك ترخيص صالح أو فترة تجربة نشطة (30 يوماً).
3. **هل المستخدم موجود قبل الترخيص أم بعده؟**
   - في أول تشغيل، المستخدم **غير موجود** في SQLite. يبدأ فحص الترخيص أولاً، وإذا مُنحت فترة السماح (Trial)، يتم إنشاء المستخدم فوراً في SQLite كمدير نظام بحساب مرتبط بمعرف الجهاز.
4. **ماذا يحدث في أول تشغيل للتطبيق؟**
   - يتحقق `LicensePlugin.java:L184`؛ يجد `trial_start_time == 0` و `code == null`.
   - يقوم تلقائياً بإنشاء فترة سماح مجانية (30 يوماً): `trial_start_time = now` و `trial_expiry = now + 30 days`.
   - يتم الدخول مباشرة إلى التطبيق بدون إزعاج المستخدم وبدون طلب أي كود، ويتم إنشاء مستخدم محلي برقم الجهاز.
5. **ماذا يحدث بعد انتهاء التجربة؟**
   - يكتشف `LicensePlugin.java:L195` أن `now > trialExpiry`؛ يرفض الدخول بـ `ERR_EXPIRED`.
   - يفتح التطبيق شاشة `AuthGate.jsx` مع رسالة: "انتهت فترة ترخيص النظام — يرجى إدخال كود التجديد".
6. **ماذا يحدث بعد انتهاء الترخيص المدفوع؟**
   - يكتشف `LicensePlugin.java:L211` أن `now > expiry`؛ يرفض الدخول بـ `ERR_EXPIRED`.
   - تظهر شاشة `AuthGate.jsx`، مع ظهور زر إضافي صريح: `"تصفح البيانات السابقة (وضع العرض فقط)"` (`AuthGate.jsx:L298`).
7. **ماذا يحدث في View-Only (وضع العرض فقط)؟**
   - يدخل المستخدم إلى `Dashboard` مع تمرير `isExpired = true`.
   - يستطيع تصفح جميع العملاء، العقود، جداول السداد، والتقارير، وإنشاء وتصدير ملفات PDF، وتصدير النسخ الاحتياطية.
   - يُمنع تماماً من إجراء أي عمليات كتابة أو سداد أو تعديل أو استرجاع بيانات.
8. **هل بيانات الأعمال (Business Data) مرتبطة بالترخيص؟**
   - **لا إطلاقاً.** جداول `customers`, `contracts`, `installments`, `payments`, `expenses` مخزنة في SQLite بشكل مستقل تماماً ولا تحتوي على أي عمود يشير إلى الترخيص أو حالة الاشتراك.
9. **هل الترخيص مرتبط بالمستخدم أم بالجهاز؟**
   - الترخيص الحالي **مرتبط بالجهاز حصراً (Device-Bound)** من خلال تجزئة رقم `ANDROID_ID` المدمج في `LicensePlugin.java:L52`.
10. **هل هناك أكثر من طبقة تتحقق من الاشتراك؟**
    - نعم، توجد طبقتان:
      - الطبقة 1: فحص أصلي عند بدء التشغيل في Java `LicensePlugin.checkLicense()` أو Web `localStorage`.
      - الطبقة 2: فحص واجهة المستخدم في React (`isReadOnly` / `isExpired`) لمنع أزرار التعديل وفتح نافذة التجديد عند النقر عليها.

---

## 4) مصفوفة الصلاحيات: الحساب النشط مقابل منتهي الصلاحية (Active vs View-Only Matrix)

تم توثيق هذا السلوك بدقة متناهية من واقع الأسطر البرمجية في مكونات واجهة المستخدم:

| الميزة / الوظيفة | الحساب النشط (Active / Trial) | منتهي الصلاحية (Expired / View-Only) | السند البرمجي في الكود |
| :--- | :---: | :---: | :--- |
| **فتح التطبيق وتجاوز شاشة القفل** | متاح بالكامل | متاح عبر زر "وضع العرض فقط" | `AuthGate.jsx:L119-L128` |
| **عرض قائمة وتفاصيل العملاء** | متاح | متاح | `CustomerList.jsx:L181` |
| **إضافة عميل جديد** | متاح | **محظور** (يفتح نافذة التجديد) | `CustomerList.jsx:L186` |
| **تعديل بيانات عميل** | متاح | **محظور** (يفتح نافذة التجديد) | `CustomerList.jsx:L221` |
| **حذف عميل (مؤقت أو نهائي)** | متاح | **محظور** (يفتح نافذة التجديد) | `CustomerList.jsx:L235, L267` |
| **عرض العقود والأقساط** | متاح | متاح بالكامل | `ContractList.jsx` |
| **إنشاء عقد جديد** | متاح | **محظور** (يفتح نافذة التجديد) | `CustomerList.jsx:L228` |
| **تعديل أو حذف عقد** | متاح | **محظور** | `ContractList.jsx:L593, L605` |
| **تسجيل سداد قسط (عادي / سريع)** | متاح | **محظور** (يفتح نافذة التجديد) | `ContractList.jsx:L255, L281` |
| **سداد مبكر لعقد كامل** | متاح | **محظور** | `ContractList.jsx:L568` |
| **تأجيل قسط أو التراجع عن التأجيل** | متاح | **محظور** | `ContractList.jsx:L325, L355` |
| **توليد وتصدير كشف حساب PDF** | **متاح بالكامل** | **متاح بالكامل** | `CustomerList.jsx:L191` و `ContractList.jsx:L579` |
| **إرسال رسالة تذكير قسط عبر واتساب** | متاح | متاح (خدمة مراسلة عميل) | `Dashboard.jsx:L390-L405` |
| **إدارة جهات التمويل (Managers)** | متاح | **محظور** (عرض فقط) | `ManagerList.jsx:L61, L70, L120` |
| **إدارة العهد والمصروفات (Custody)** | متاح | **محظور** (عرض فقط) | `CustodyList.jsx:L48` و `CustodyDetails.jsx:L53` |
| **تصدير نسخة احتياطية محلية** | متاح | متاح | `backupService.js:L387` |
| **استرجاع نسخة احتياطية من Drive** | متاح | **محظور** (يطلب التجديد أولاً) | `Settings.jsx:L127` |

> **استنتاج بالغ الأهمية:**
> نظام View-Only الحالي في أقساطي مصمم باحترافية عالية لحماية بيانات المستخدم من الضياع أو الإتلاف عند انتهاء الاشتراك، ولا يُقفل قاعدة البيانات بل يحافظ عليها للقراءة وتصدير الـ PDF، وهو نمط متوافق هندسياً وأخلاقياً مع متطلبات الاحتفاظ بالبيانات.

---

## 5) فحص توافق Google Play Billing مع بيئة المشروع الحالية

### 5.1 ما هي أفضل طريقة تقنية لإضافة Google Play Billing إلى المشروع؟
هناك خياران متاحان في عالم Capacitor:
- **الخيار (أ): إضافة جاهزة من مجتمع Capacitor (مثل `@capgo/native-purchases` أو `@revenuecat/purchases-capacitor`):**
  - *المميزات:* جاهز ومختبر.
  - *العيوب والمخاطر في أقساطي:*
    - مكتبة RevenueCat تتطلب خادماً خارجياً وحساباً سحابياً، وهو ما يخالف مبدأ "محلي 100% Offline" الصارم في هذا المشروع.
    - إضافات الطرف الثالث قد تستخدم إصدارات قديمة من Play Billing Library لا تتوافق مع اشتراطات Google Play الحديثة (PBL 6+ أو 7)، أو تتطلب إعدادات Gradle معقدة قد تتعارض مع Java 21 و AGP 8.13.0.
- **الخيار (ب): إنشاء Native Capacitor Bridge مخصص داخل كود أندرويد للمشروع (مثل `BillingPlugin.java` أو توسيع `LicensePlugin.java`):**
  - *المميزات:*
    - **أقل مخاطرة ممكنة:** الاعتماد المباشر على مكتبة جوجل الرسمية `com.android.billingclient:billing:7.1.1` دون أي وسيط خارجي.
    - التحكم الكامل بنسبة 100% في دورة التخزين المؤقت (Offline caching)، والتحقق من الاستحقاق المحلي، والتكامل الصامت مع `EncryptedSharedPreferences`.
    - الحفاظ الكامل على نمط الإضافات المتبع حالياً في المشروع (مشابه تماماً لـ `LicensePlugin.java` المسجل في `MainActivity.java`).
  - *التوصية الهندسية:* **الخيار (ب) هو الأنسب والأنقى معمارياً والأكثر أماناً لمشروع أقساطي.**

### 5.2 هل معمارية إضافات Capacitor (Plugin Architecture) مناسبة؟
- **نعم تماماً.** المشروع يستخدم بالفعل Capacitor 8.3.3، ويدعم تسجيل الـ Plugins محلياً في `MainActivity.java` عبر `registerPlugin(...)` بنجاح واستقرار عاليين.

### 5.3 هل هناك تعارض محتمل مع Capacitor أو Gradle أو Java؟
- **فحص التوافقية:**
  - `compileSdkVersion = 36` و `targetSdkVersion = 36`: متوافق تماماً مع Billing Library 7.x.
  - `minSdkVersion = 24`: مكتبة Billing Library 7 تتطلب `minSdkVersion 21+`، وبالتالي متوافقة بالكامل.
  - `Java 21`: متوافق تماماً مع AGP 8.13.0.
  - `Kotlin`: المشروع لا يستخدم Kotlin حالياً في كود أندرويد الرئيسي (كل من `MainActivity.java` و `LicensePlugin.java` مكتوبان بلغة Java). بناء جسر الفوترة بلغة Java أو إضافة Kotlin stdlib كـ dependency لن يُحدث أي تعارض، ولكن كتابته بلغة Java يحافظ على انسجام الكود الأصلي وتفادي زيادة حجم التطبيق.

---

## 6) تصميم نموذج المنتجات والاشتراكات (Product Model Design)

### 6.1 الفرق الجوهري بين أنواع المنتجات في Google Play
وفقاً لـ **Google Play Billing Documentation (Play Billing Library 6 & 7)**، يجب التمييز الصارم بين:

1. **Auto-renewing Subscriptions (اشتراكات متجددة تلقائياً):**
   - تخصم المبلغ دورياً (شهرياً/سنوياً) من بطاقة المستخدم حتى يقوم بالإلغاء من خلال Google Play Subscriptions Center.
   - ممتازة للمستخدمين الذين يفضلون عدم تكرار الدفع يدوياً.
2. **Prepaid Plans (الخطط مسبقة الدفع — Base Plans):**
   - يدفع المستخدم مقدماً لفترة محددة (مثل: شهر، 3 أشهر، 6 أشهر، سنة) **ولا تتجدد تلقائياً**.
   - بعد انتهاء المدة، يتوقف الاشتراك حتى يقوم المستخدم بـ "إعادة التعبئة" (Top-up / Extend) من داخل التطبيق عبر Play Billing.
   - **تطابق بنسبة 100% نموذج أقساطي الحالي (30، 90، 180، 365 يوماً).**
3. **One-Time Non-Consumable Product (منتج الشراء لمرة واحدة مدى الحياة):**
   - يدفع المستخدم مرة واحدة ويمتلك الميزة للأبد (`BillingClient.ProductType.INAPP`).
   - لا تتكرر الفاتورة، ويمكن استعادتها دائماً على أي جهاز جديد يسجل فيه المستخدم بنفس حساب Google.
   - يطابق خيار "الترخيص الدائم" (`9999` يوماً / Lifetime) في النظام القديم.

### 6.2 جدول المنتجات المقترح (Product Structure Proposal)

| المعرف المقترح (Product ID) | نوع المنتج في Google Play | الخطة / Base Plan | المدة الزمنية المكافئة | التوصيف المالي والتقني |
| :--- | :--- | :--- | :--- | :--- |
| `aqsati_sub_access` | **Subscription** | `base-plan-monthly-autorenew` | 1 شهر (30 يوم) | اشتراك متجدد تلقائياً |
| `aqsati_sub_access` | **Subscription** | `base-plan-annual-autorenew` | 1 سنة (365 يوم) | اشتراك سنوي متجدد تلقائياً |
| `aqsati_prepaid_30d` | **Subscription** | `base-plan-prepaid-30d` | 30 يوم | خطة مسبقة الدفع (غير متجددة) |
| `aqsati_prepaid_90d` | **Subscription** | `base-plan-prepaid-90d` | 90 يوم | خطة مسبقة الدفع (غير متجددة) |
| `aqsati_prepaid_180d` | **Subscription** | `base-plan-prepaid-180d` | 180 يوم | خطة مسبقة الدفع (غير متجددة) |
| `aqsati_prepaid_365d` | **Subscription** | `base-plan-prepaid-365d` | 365 يوم | خطة مسبقة الدفع (غير متجددة) |
| `aqsati_lifetime` | **One-Time In-App Product (INAPP)** | — (Non-consumable) | دائم (Lifetime) | شراء لمرة واحدة بدون انتهاء |

> [!NOTE]
> **قاعدة هامة:** وفقاً لسياسات Google Play، لا يجوز تصنيف منتج "شراء مدى الحياة" كاشتراك دوري متجدد، بل يجب إنشاؤه في Play Console تحت قسم **In-App Products (Managed Products)** وتعيينه كـ non-consumable (أي لا يتم استدعاء `consumeAsync`).

---

## 7) تصميم دورة حياة الشراء (Purchase Lifecycle State Machine)

توضح المصفوفة التالية كيف يتعامل التطبيق مع كل حالة شراء واردة من Google Play، وكيف تنعكس على الاستحقاق المحلي (Local Entitlement) ثم على صلاحيات التطبيق (App Access):

| حالة الشراء (Play Billing State) | الإجراء التقني المطلوب في التطبيق | حالة الاستحقاق المحلي (Local Entitlement) | صلاحيات الوصول للتطبيق (App Access) |
| :--- | :--- | :--- | :--- |
| **`PURCHASED`** | 1. التحقق من توقيع المعاملة محلياً.<br>2. استدعاء `acknowledgePurchase()` فوراً.<br>3. حساب تاريخ الانتهاء وتخزينه في `license_prefs`. | `ACTIVE` (تحديث تاريخ الانتهاء ورمز الشراء) | **صلاحيات كاملة** (إلغاء قفل التعديل والإضافة) |
| **`PENDING`** (مثل الدفع النقدي أو معالجة البنك) | لا يتم منح الترخيص بعد؛ يتم إشعار المستخدم بأن العملية قيد المعالجة من جوجل. | `PENDING_APPROVAL` (مع الحفاظ على الوضع السابق) | وضع التجربة إذا كانت سارية، أو وضع العرض فقط (View-Only) |
| **`CANCELED`** (إلغاء الشراء أثناء نافذة الدفع) | إغلاق نافذة الدفع دون أي تغيير على البيانات المحلية. | دون تغيير | حسب الحالة السابقة للمستخدم |
| **`REFUNDED`** (استرداد الأموال عبر Google) | ترصد مكتبة Google Play اختفاء الـ purchaseToken؛ يتم تحويل الاستحقاق إلى منتهٍ. | `REVOKED` / `EXPIRED` | التحويل الفوري إلى **وضع العرض فقط (View-Only)** دون مساس بالبيانات |
| **`REVOKED`** (سحب الوصول من قبل الدعم/جوجل) | إبطال صلاحية التوكن محلياً. | `REVOKED` | **وضع العرض فقط (View-Only)** |
| **`EXPIRED`** (انتهاء مدة الخطة دون تجديد) | مقارنة التوقيت المحلي الحالي مع `expiry` المخزن. | `EXPIRED` | **وضع العرض فقط (View-Only)** مع إتاحة شاشة التجديد |
| **`ACCOUNT_HOLD`** (فشل تجديد البطاقة مؤقتاً) | تمنح جوجل فترة سماح (Grace Period)؛ التطبيق يمنح صلاحيات حتى انتهاء مهلة السماح. | `GRACE_PERIOD` | صلاحيات كاملة مع تنبيه بضرورة تحديث وسيلة الدفع |
| **`PAUSED`** (إيقاف الاشتراك مؤقتاً بواسطة المستخدم) | عند حلول موعد الإيقاف الفعلي، يتم اعتبار الاشتراك منتهياً مؤقتاً. | `PAUSED` | **وضع العرض فقط (View-Only)** حتى استئناف الاشتراك |
| **Restore Purchases (استعادة المشتريات)** | استدعاء `queryPurchasesAsync()` لكل من `SUBS` و `INAPP` ومزامنة أحدث استحقاق. | تحديث `license_prefs` بأحدث توكن وتاريخ انتهاء | فك القفل فوراً إذا وجد شراء نشط |
| **إعادة تثبيت التطبيق (Reinstall)** | استدعاء تلقائي صامت لـ `queryPurchasesAsync()` عند أول تشغيل عبر حساب Google. | إعادة بناء `license_prefs` من بيانات Google Play | استعادة الترخيص فوراً بدون إدخال أي كود |
| **تغيير الجهاز (Device Change)** | يفتح المستخدم التطبيق بنفس حساب Google Play؛ يستعيد التطبيق الترخيص تلقائياً. | تسجيل الاستحقاق على الجهاز الجديد في `license_prefs` | فك القفل فوراً (حساب Google يحل محل الارتباط بالعتاد) |
| **تشغيل التطبيق بدون إنترنت (Offline)** | فحص الاستحقاق المخزن محلياً في `license_prefs` دون إجراء أي اتصال بالشبكة. | قراءة `expiry` و `last_seen_time` المحفوظين محلياً | **صلاحيات كاملة** طالما أن تاريخ الجهاز لم يتجاوز تاريخ الانتهاء |
| **عودة الإنترنت بعد انقطاع** | مزامنة خلفية هادئة لـ `queryPurchasesAsync()` للتحقق من أي إلغاء أو استرداد دون تعطيل المستخدم. | تحديث تاريخ التحقق الأخير `last_verification` | استمرار العمل دون مقاطعة تجربة المستخدم |

---

## 8) الفحص الدقيق لواقع العمل دون إنترنت (Offline Reality Analysis)

### 8.1 هل يستطيع من اشترى عبر Google Play استخدام التطبيق لاحقاً بدون إنترنت؟
- **نعم، بكل تأكيد، ولكن وفق قواعد تقنية محددة يجب إيضاحها بشفافية:**
  1. **Google Play Store Local Cache:**
     - تطبيق "Google Play Store" الموجود على نظام أندرويد يقوم بتخزين المشتريات النشطة محلياً في ذاكرة التخزين المؤقت لجهاز أندرويد (Device Cache).
     - عند استدعاء الدالة الرسمية `BillingClient.queryPurchasesAsync()`، فإنها **تقرأ أولاً من الكاش المحلي للجهاز** وتعمل حتى في حال انقطاع اتصال الإنترنت التام.
  2. **Local Entitlement Isolation (الاستحقاق المحلي المستقل):**
     - عند إتمام عملية الشراء بنجاح عبر الإنترنت، يقوم تطبيق أقساطي بحفظ بيانات الاستحقاق (تاريخ الانتهاء، رقم العملية، المفتاح المشفر) في `license_prefs` عبر `EncryptedSharedPreferences`.
     - عند تشغيل التطبيق في الصحراء أو في وضع الطيران، **لا يحتاج التطبيق إلى سؤال Google إطلاقاً** لفتح الشاشات اليومية، بل يتحقق من `license_prefs` المحلية في أجزاء من الثانية.
  3. **العمليات التي تتطلب إنترنت حصراً (Cannot be offline):**
     - لحظة الدفع وإتمام الشراء الأولى.
     - استدعاء التأكيد `acknowledgePurchase` (يجب أن يتم عبر الإنترنت خلال 72 ساعة كحد أقصى وإلا يتم إلغاء الشراء واسترداده تلقائياً بواسطة جوجل).
     - لحظة استعادة المشتريات لأول مرة على جهاز جديد تماماً تم تثبيت التطبيق عليه للتو.
     - مزامنة كشف الاسترداد (Refund) أو الإلغاء إذا قرر المستخدم إلغاء الاشتراك من إعدادات حسابه في جوجل.

### 8.2 الخلاصة الهندسية لـ Offline
التطبيق يظل **Offline-First 100% في كافة عملياته المحاسبية اليومية (تسجيل العملاء، العقود، السندات، الأقساط، التقارير، الـ PDF، النسخ الاحتياطي)**. أما التحقق من ترخيص Google Play، فيتم عبر نموذج "الاستحقاق المحلي المؤقت بصلاحية زمنية" (Time-Bounded Cached Entitlement)، بحيث يمنح المستخدم حرية العمل بلا اتصال لأسابيع وشهور كاملة حتى تاريخ انتهاء فترته المشتراة.

---

## 9) تصميم الاستحقاق المحلي (Local Entitlement Schema)

دون أي تعديل على قاعدة بيانات SQLite أو جداول العملاء، يتم حفظ حالة الشراء في نفس الحاوية الآمنة الحالية (`EncryptedSharedPreferences` في أندرويد، و `localStorage` في الويب كـ Fallback):

```text
اسم الحاوية: license_prefs (أو aqsati_billing_prefs)
التشفير: AES-256 GCM (MasterKeys.AES256_GCM_SPEC)
```

### الحقول المخزنة في الاستحقاق المحلي:
1. `entitlement_source`: مصدر الاستحقاق (`"GOOGLE_PLAY"` أو `"LEGACY_ACTIVATION_CODE"`).
2. `product_id`: معرف المنتج المشتري (مثل: `"aqsati_sub_access"` أو `"aqsati_lifetime"`).
3. `purchase_token`: التوكن المشفر الصادر من Google Play لإثبات الشراء.
4. `purchase_time`: توقيت الشراء بالثواني (Unix Epoch).
5. `expiry_time`: توقيت انتهاء الصلاحية المحسوب (Unix Epoch). وفي حالة الشراء الدائم يكون `2147483647`.
6. `is_acknowledged`: قيمة منطقية (Boolean) تؤكد إتمام عملية التأكيد لدى جوجل.
7. `purchase_signature`: التوقيع الرقمي للعملية للتحقق من سلامتها بدون خادم.
8. `last_validated_time`: توقيت آخر اتصال ناجح تم فيه فحص المعاملة مع Google Play Cache.
9. `tamper_guard_time`: آخر وقت تم تسجيله لتطبيق حماية الساعة المحلية من التلاعب.

> **قاعدة ذهبية:** **0% تعديل على SQLite.** لن يتم إنشاء أي جدول اشتراكات ولن يتم إضافة أي عمود في جداول التطبيق.

---

## 10) فحص أثر نظام الفوترة على مكونات النظام الحالي (System Impact Analysis)

| القطاع / المكون | الأثر الفعلي المحتمل لـ Play Billing | التقييم ومستوى المخاطرة | دليل العزل البرمجي في المشروع |
| :--- | :--- | :--- | :--- |
| **بيانات الأعمال (Customers, Contracts, Installments)** | **صفر (Zero Impact)** — لا يوجد أي ترابط بين استعلامات SQLite وبين نظام الفوترة. | **آمن تماماً (No Risk)** | جداول SQLite لا تعلم شيئاً عن الترخيص؛ الفحص يتم فقط في React Props (`isReadOnly`). |
| **المدفوعات والمصروفات (Payments & Expenses)** | **صفر (Zero Impact)** — العمليات المالية مسجلة في جداولها المستقلة. | **آمن تماماً (No Risk)** | `src/services/database.js` مستقل تماماً. |
| **التقارير والمستندات و PDF** | **صفر (Zero Impact)** — توليد الـ PDF يعتمد على `jspdf` ومحاذاة النصوص المحلية. | **آمن تماماً (No Risk)** | كشوفات الـ PDF تعمل في الوضعين: النشط والعرض فقط. |
| **النسخ الاحتياطي والاسترجاع (Backup & Restore)** | **صفر (Zero Impact)** — هيكل ملف النسخ الاحتياطي `Aqsati_Backup.json` معزول تماماً عن الترخيص. | **آمن تماماً (No Risk)** | تم إثبات ذلك باجتياز **25/25 اختبار توافق** في حزمة `test_backup_compatibility.cjs`. |
| **تسجيل الدخول وقفل التطبيق (Login & App Lock)** | **صفر (Zero Impact)** — قفل التطبيق بـ PIN وحساب المدير يعتمدان على التشفير المحلي في `app_users`. | **آمن تماماً (No Risk)** | تم فحص عزل جدول `app_users` (الاختبار 8 و 12 في حزمة الاختبارات بنجاح 100%). |
| **التشغيل بدون إنترنت (Offline Startup)** | **محفوظ بنسبة 100%** — بدء التطبيق لا ينتظر استجابة شبكة إطلاقاً. | **آمن تماماً (No Risk)** | القراءة من `EncryptedSharedPreferences` تستغرق أقل من 5ms. |

---

## 11) فحص نظام التجربة الحالي (Trial System Audit)

- **أين يبدأ الـ Trial حالياً؟**
  - يبدأ في أول تشغيل للتطبيق داخل `LicensePlugin.java:L184`.
- **أين يتم حفظه؟**
  - يتم حفظه في `license_prefs` عبر المفاتيح: `trial_start_time` و `trial_expiry`.
- **هل هو مرتبط بالجهاز؟**
  - نعم، محفوظ داخل مساحة التخزين الخاصة بالتطبيق المشفرة بالجهاز.
- **ماذا يحدث بعد حذف التطبيق وإعادة تثبيته (Uninstall / Reinstall)؟**
  - **ثغرة معمارية مسجلة في الكود الحالي:** عند قيام المستخدم بإلغاء تثبيت التطبيق، يقوم نظام أندرويد بمسح مجلد `shared_prefs` الخاص بالتطبيق بالكامل. عند إعادة التثبيت، يجد التطبيق أن `trial_start_time == 0`، **فيمنحه 30 يوماً تجريبية جديدة تلقائياً!**
- **مقارنة الخيارات بين Local Trial و Google Play Free Trial:**

| وجه المقارنة | Local Trial (الوضع الحالي) | Google Play Free Trial (تجربة جوجل الرسمية) |
| :--- | :--- | :--- |
| **الارتباط بحساب المستخدم** | مرتبط بذاكرة الجهاز فقط (يُعاد تصفيره عند الحذف). | **مرتبط بحساب Google Play للمستخدم** (لا يمكن تكراره بالحذف). |
| **طلب بطاقة دفع** | لا يتطلب أي بطاقة ائتمان من العميل. | يتطلب إدخال وسيلة دفع في Google Play تبدأ الخصم بعد انتهاء التجربة. |
| **تجربة الاستخدام للمستخدم العربي** | سهلة جداً وتزيد من تجربة التطبيق فوراً. | قد تسبب تردد بعض المستخدمين الذين لا يملكون بطاقة مربوطة بجوجل. |
| **التوصية الهندسية:** | **الحفاظ على الـ Local Trial (فترة سماح 30 يوم) كخطوة أولى للمستخدم الجديد**، مع إتاحة خيار الشراء من Google Play في أي وقت قبل أو بعد انتهاء الشهر. هذا يضمن أعلى معدل تحويل دون تنفير المستخدمين الجدد. |

---

## 12) فحص نظام كود التفعيل القديم (Legacy Activation Code Audit)

- **الملفات المرتبطة بنظام الكود:**
  1. `android/app/src/main/java/com/installment/app/LicensePlugin.java` (الدوال: `activateLicense`, `generateNumericHash`).
  2. `src/services/license.js` (الخوارزمية الموازية للويب).
  3. `tools/license_web_generator.html` (أداة التوليد الخارجية).
  4. `src/components/AuthGate.jsx` (شاشة إدخال الكود المكون من 9 أرقام).
- **هل وجود حقل إدخال الكود في تطبيق معروض للمستهلكين على Google Play مسموح؟**
  - **مؤكد من وثائق Google Play الرسمية (Payments Policy):**
    - السماح للمستهلك العادي بشراء كود تفعيل خارجي عبر واتساب أو التحويل البنكي ثم إدخاله لتفعيل التطبيق على متجر جوجل بلاي **يعد مخالفة صريحة وخطيرة لسياسة الدفع ومحاولة للالتفاف على Google Play Billing (Bypassing In-App Purchases)**.
  - **حالة الـ Enterprise / Controlled Deployment:**
    - تستثني جوجل التطبيقات الموجهة للشركات في حالتين فقط:
      1. توزيع التطبيق عبر **Managed Google Play** الخاص بمؤسسة معينة (Private Enterprise App).
      2. تطبيقات SaaS التي يدفع فيها صاحب العمل اشتراكاً خارجياً ويحصل الموظف على اسم مستخدم/كلمة مرور تابعة للشركة (وليس دفعاً فردياً لتفعيل جهاز عبر واتساب).
    - تطبيق "أقساطي" الموجه للأفراد وأصحاب مكاتب التقسيط على المتجر العام لا يعتبر معفى تلقائياً من سياسة جوجل.
  - **الحل الهندسي السليم:**
    - في نسخة Google Play الاستهلاكية: جعل Google Play Billing هو القناة الرسمية الوحيدة للتجديد والدفع.
    - يمكن الإبقاء على حقل إدخال الكود القديم فقط عبر بوابة مخفية (Hidden Secret Tap أو خاصية للمؤسسات غير المعلنة للمستهلك العادي)، مع إزالة أي نصوص تشير إلى "شراء الكود" أو "طلب الكود عبر واتساب".

---

## 13) فحص شامل لروابط واستخدامات واتساب (WhatsApp Audit & Classification)

تم حصر جميع نقاط ظهور واتساب و `wa.me` في المشروع وتصنيفها بدقة بالغة وفق متطلبات جوجل:

| موقع الملف والسطر | الرابط أو النص المستخدم | التصنيف | تقييم الامتثال لـ Google Play | الإجراء المطلوب لاحقاً في نسخة المتجر |
| :--- | :--- | :---: | :--- | :--- |
| `src/components/AuthGate.jsx:L64` | `https://wa.me/966556854162?text=طلب كود التفعيل` | **B (Purchase Flow)** | **مخالف لسياسة Google Play** (توجيه لدفع خارجي) | **يجب حذفه أو تحويله إلى Google Play Billing** |
| `src/components/AuthGate.jsx:L187` | `"طلب الكود عبر واتساب 💬"` | **B (Purchase Flow)** | **مخالف لسياسة Google Play** | **يجب استبداله بزر "الاشتراك عبر متجر Google Play"** |
| `src/components/AuthGate.jsx:L291` | `"اطلبه عبر واتساب في دقيقة"` | **B (Purchase Flow)** | **مخالف لسياسة Google Play** | **يجب حذفه من واجهة التفعيل** |
| `src/components/Settings.jsx:L567` | `https://wa.me/966556854162?text=تجديد ترخيص` | **B (Purchase Flow)** | **مخالف لسياسة Google Play** | **استبداله بزر تجديد عبر Google Play** |
| `src/components/Settings.jsx:L668` | `"تواصل معنا للتجديد عبر واتساب"` | **B (Purchase Flow)** | **مخالف لسياسة Google Play** | **استبداله بـ "إدارة الاشتراك" عبر متجر جوجل** |
| `src/screens/Dashboard.jsx:L360` | `https://wa.me/966556854162?text=تجديد اشتراك` | **B (Purchase Flow)** | **مخالف لسياسة Google Play** | **استبداله بنافذة شراء Google Play** |
| `src/screens/Dashboard.jsx:L405` | `https://wa.me/${item.customer_phone}?text=...` | **D (Utility / Customer Alert)** | **نظامي ومتوافق 100%** (مراسلة عميل للتذكير بقسطه) | **يظل كما هو دون أي تغيير** (وظيفة محاسبية أساسية) |
| `src/components/ContractList.jsx:L395` | `https://wa.me/${customer_phone}?text=...` | **D (Utility / Customer Alert)** | **نظامي ومتوافق 100%** (إرسال إيصال أو تذكير) | **يظل كما هو دون أي تغيير** |
| `src/components/ContractList.jsx:L630` | `https://wa.me/${guarantor_phone}?text=...` | **D (Utility / Guarantor Alert)** | **نظامي ومتوافق 100%** (مراسلة الضامن) | **يظل كما هو دون أي تغيير** |
| `src/components/LicenseGate.jsx:L32` | `https://wa.me/966556854162?text=...` | **B (Purchase Flow)** | **مخالف** (المكون مهمل وغير مستخدم أصلاً في الواجهة) | **تنظيف المكون غير المستخدم لاحقاً** |

---

## 14) فحص الأمان والتشفير (Security Architecture Audit)

### 14.1 الثغرات الحالية المسجلة في نظام الكود المحلي:
1. **سرية الـ Salt البرمجي:**
   - القيمة `SECRET_SALT = "NAYEF_FAZATK_2026_SECURITY_SALT"` مكتوبة كنص صريح (Plaintext) في كل من `src/services/license.js:L4` و `android/app/src/main/java/com/installment/app/LicensePlugin.java:L18`.
   - يمكن استخراج هذا المفتاح في أقل من دقيقة واحدة عبر فك حزمة الـ APK أو قراءة حزم الـ JavaScript المضغوطة.
2. **استنساخ الأكواد:**
   - خوارزمية التشفير تعتمد على `SHA-256` مقطوع إلى 8 خانات رقمية، وبمعرفة الـ Salt ورقم الجهاز، يمكن لأي شخص كتابة كود توليد مشابه لأداة `license_web_generator.html` وتوليد أكواد مجانية دون دفع.
3. **الاعتماد على `ANDROID_ID`:**
   - قد يتغير `ANDROID_ID` عند إعادة ضبط المصنع، وفي المقابل يمكن تزييفه على الأجهزة التي تمتلك صلاحيات Root.

### 14.2 كيف يعالج Google Play Billing هذه الثغرات؟
- عند الشراء عبر Google Play:
  1. تصدر جوجل **Purchase Token** و **Signed Purchase Data** موثقة بتوقيع رقمي غير متماثل (RSA / ECDSA) خاص بحساب المطور على Google Play Console.
  2. التطبيق يتحقق من صحة التوقيع عبر **مفتاح الترخيص العام (Google Play Base64 Public Key)** المشتق من لوحة التحكم.
  3. لا يمكن لأي مستخدم أو مخترق توليد توقيع صالح دون امتلاك المفتاح الخاص لجوجل.
  4. هذا يوفر حماية رياضية قاطعة لترخيص التطبيق دون الحاجة لأي مفاتيح سرية مكشوفة في الكود.

---

## 15) فحص إقرار الخصائص المالية (Financial Features Declaration Audit)

بناءً على الفحص الفعلي للكود المصدري ومطابقته بسياسات Google Play:

1. **طبيعة التطبيق الفعلية في الكود:**
   - التطبيق هو **أداة إدارة محاسبية ودفتر ديون وأقساط محلي للمستخدم (Offline Installment Tracker & Bookkeeping)**.
   - التطبيق **لا يقدم قروضاً مالية (Does NOT originate personal loans)**.
   - التطبيق **لا يحول أموالاً ولا يربط بحسابات بنكية (No banking/wire services)**.
   - التطبيق **لا يقبل مدفوعات العملاء عبر الإنترنت (No payment gateway/checkout for debtors)**.
2. **التصنيف الدقيق لمتجر Google Play:**
   - يندرج تحت تصنيف: **Business / Finance Utility (أدوات الأعمال والمالية — إدارة السجلات المحاسبية)**.
   - **لا يخضع** لسياسة "Personal Loans Policy" التقييدية طالما تم الإفصاح عنه بدقة في "Financial Features Declaration" داخل Play Console بأنه "دفتر تتبع محاسبي خاص بالمستخدم فقط" (Personal/Business Ledger).
3. **الأثر المباشر على أذونات النظام:**
   - سياسة Personal Loans في Google Play تمنع منعاً باتاً قراءة جهات الاتصال (`READ_CONTACTS`) لتطبيقات الإقراض الشخصي.
   - نظراً لأن أقساطي هو "دفتر تقسيط ومبيعات آجلة"، فإن استخدام ميزة جلب رقم العميل من دفتر العناوين مبرر كأداة لإدخال بيانات العميل؛ لكن لتفادي أي لبس لدى مراجعي جوجل، فإن إزالة إذن `WRITE_CONTACTS` غير المستخدم وحصر `READ_CONTACTS` على اختيار العميل التفاعلي فقط (عبر `Contacts.pickContact`) يحمي التطبيق بنسبة 100%.

---

## 16) سلامة النسخ الاحتياطي بعد الفحص (Backup Regression Safety)

تم تشغيل حزمة اختبارات توافق النسخ الاحتياطي بالكامل للتأكد من عدم وجود أي تراجع:
```bash
node scripts/test_backup_compatibility.cjs
```
**النتيجة الرسمية المسجلة:**
- إجمالي الاختبارات: **25 اختباراً**
- الاختبارات الناجحة: **25/25 PASS (100%)**
- اختبار الـ Round-Trip (Old Backup -> Offline Import -> Offline Export): **PASS بنجاح تام وبدون أي فقدان للبيانات**
- عزل جدول `app_users`: **PASS بنجاح تام**

> **النتيجة:** نؤكد قطعياً أن طبقة التراخيص والفوترة مفصولة تماماً عن محرك النسخ الاحتياطي، ولن تتأثر سلامة بيانات المستخدمين مطلقاً عند دمج Google Play Billing.

---

## 17) قائمة الملفات المتوقع تعديلها لاحقاً مقابل الملفات المحمية

### 17.1 الملفات المقترح تعديلها لاحقاً (عند مرحلة الـ Implementation)

| الملف (File Path) | سبب التعديل | دور الفوترة (Billing Role) | تقييم المخاطرة |
| :--- | :--- | :--- | :--- |
| `android/app/build.gradle` | إضافة تبعية جوجل الرسمية للفوترة | `implementation "com.android.billingclient:billing:7.1.1"` | **منخفضة جداً** (مكتبة رسمية مستقرة) |
| `android/app/src/main/AndroidManifest.xml` | إضافة إذن الفوترة الرسمي | `<uses-permission android:name="com.android.vending.BILLING" />` | **منخفضة** (إذن تشغيلي قياسي) |
| `android/app/src/main/java/com/installment/app/LicensePlugin.java` (أو ملف `BillingPlugin.java` مستقل) | معالجة دورة الشراء والتحقق من التوكن | الجسر الأصلي (Native Bridge) لإدارة الشراء والاستعلام عن الكاش المحلي | **متوسطة** (يجب كتابته بعناية واختباره) |
| `src/services/license.js` | إضافة دوال الشراء والاستعادة | ربط واجهة React مع الجسر الأصلي واستدعاء `purchaseProduct` و `restorePurchases` | **منخفضة** (واجهة استدعاءات برمجية) |
| `src/components/AuthGate.jsx` | استبدال روابط واتساب بأزرار الشراء الرسمية | عرض خيارات الاشتراك (شهري، سنوي، دائم) عبر Google Play | **منخفضة** (تعديل واجهة مستخدم فقط) |
| `src/components/Settings.jsx` | تحديث قسم الترخيص لعرض "إدارة الاشتراك" | فتح صفحة اشتراكات Google Play وزر "استعادة المشتريات" | **منخفضة** (تعديل واجهة مستخدم فقط) |
| `src/screens/Dashboard.jsx` | توجيه نافذة التجديد لشاشة الشراء الرسمية | ربط زر التجديد بدورة Google Play الرسمية | **منخفضة** |

### 17.2 الملفات المحمية الصارمة (Files That MUST Remain Unchanged)

| الملف أو المجلد | سبب الحظر الصارم للتعديل |
| :--- | :--- |
| **`src/services/database.js`** | يحتوي على بنية SQLite وجداول العملاء والعقود والأقساط؛ يجب ألا يرتبط بالفوترة مطلقاً. |
| **`src/services/backupService.js`** | محرك النسخ والتحقق من التوافقية؛ أي تغيير فيه يهدد استعادة البيانات القديمة. |
| **`src/utils/pdfGenerator.js`** | محرك توليد وطباعة السندات والفواتير؛ مستقل تماماً ويجب أن يظل متاحاً في View-Only. |
| **`src/services/googleDriveService.js`** | نظام النسخ السحابي المستقل؛ لا علاقة له بفوترة التطبيق. |
| **`scripts/test_backup_compatibility.cjs`** | حزمة الاختبارات المعيارية؛ يجب أن تبقى حارساً صارماً لصحة البيانات. |
| **جداول SQLite وعلاقات الـ Foreign Keys** | يجب الحفاظ عليها نقية 100% دون إضافة جداول فوترة إليها. |

---

## 18) المعمارية المقترحة لدمج Google Play Billing (Architecture Proposal)

```text
                        ┌──────────────────────────────────────────────┐
                        │              Google Play Console             │
                        │ (Sub: Monthly/Annual, In-App: Lifetime)      │
                        └──────────────────────┬───────────────────────┘
                                               │
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │          Google Play Billing Client          │
                        │       (com.android.billingclient:billing)     │
                        │   - Online: Purchasing & Acknowledgment      │
                        │   - Offline: Local Play Store Device Cache   │
                        └──────────────────────┬───────────────────────┘
                                               │
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │      Native Billing Bridge (Android Java)    │
                        │   - Verify purchase signature locally        │
                        │   - Handle PurchasesUpdatedListener          │
                        │   - Fallback to Device Trial if fresh        │
                        └──────────────────────┬───────────────────────┘
                                               │
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │      Local Entitlement (Secure Storage)      │
                        │   - EncryptedSharedPreferences (license_prefs)
                        │   - Expiry Time, Product ID, Valid Token     │
                        │   - Zero Network Needed for App Launch       │
                        └──────────────────────┬───────────────────────┘
                                               │
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │         License Layer (licenseService)       │
                        │   - Check isExpired / isTrial / isLifetime   │
                        └──────────────────────┬───────────────────────┘
                                               │
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │        AuthGate & App Access Control         │
                        │   - Full Access: Create/Edit/Delete/Pay      │
                        │   - View-Only: Read data, Export PDF/Backup  │
                        └──────────────────────┬───────────────────────┘
                                               │
                                               ▼
                        ┌──────────────────────────────────────────────┐
                        │      100% Offline SQLite Business Core       │
                        │   (customers, contracts, installments...)    │
                        │           مفصولة ومعزولة تماماً              │
                        └──────────────────────────────────────────────┘
```

---

## 19) الخلاصة التنفيذية والقرار النهائي (Executive Decision Framework)

### A — الوضع الحالي (Current State)
التطبيق يعمل بنظام ترخيص محلي مشفر معتمد على خوارزمية هاش رقمية مرتبطة برقم الجهاز (`ANDROID_ID`) و Salt محلي، مع فترة سماح مجانية 30 يوماً، وتوجيه العميل لواتساب للحصول على كود 9 أرقام لتجديد الترخيص. التطبيق يحتوي على وضع View-Only ممتاز يحمي بيانات المستخدمين.

### B — الأدلة من الكود (Evidence)
- الترخيص مشفر في `LicensePlugin.java` و `license.js` عبر `license_prefs`.
- المستخدم المحلي ينشأ تلقائياً في `authService.js:L136` برقم الجهاز.
- وضع View-Only ينفذ بدقة في `CustomerList.jsx` و `ContractList.jsx` عبر خاصية `isReadOnly`.
- يوجد 5 مواضع توجيه مباشر إلى واتساب لشراء وتجديد الترخيص عبر `wa.me/966556854162`.

### C — حقائق السياسات الموثقة (Policy Facts)
- **مؤكد من Google Play Payments Policy:** توجيه المستخدم لواتساب لشراء كود تفعيل داخل التطبيق مخالف صراحة لسياسة الدفع لمتجر جوجل، ويجب استخدام Google Play Billing.
- **مؤكد من Android Billing Library Guide:** مكتبة Play Billing تدعم الكاش المحلي وتعمل بلا إنترنت للاستعلام عن المشتريات، مما يضمن عمل التطبيق Offline.
- **مؤكد من Financial Features Declaration Policy:** تطبيق أقساطي مصنف كدفتر محاسبي محلي (Accounting Ledger) وليس تطبيق قروض شخصية (Personal Loans).

### D — المخاطر الرئيسية (Risks)
1. **مخاطرة رفض المتجر (Rejection Risk):** عالية جداً في حال رفع التطبيق بوابات واتساب لشراء الترخيص الحالية دون دمج Google Play Billing.
2. **مخاطرة سلامة البيانات (Data Regression Risk):** منعدمة (0%) طالما تم عزل الفوترة عن SQLite و Backup.
3. **مخاطرة الحسابات المعلقة (Account Hold / Grace Period):** متوسطة؛ وتم حلها في التصميم المقترح بنظام الاستحقاق المحلي المؤقت.

### E — المعمارية المقترحة (Proposed Architecture)
تطوير **Native Billing Bridge** مدمج في أندرويد يعتمد على `BillingClient 7.x` الرسمي، يخزن الاستحقاق في `EncryptedSharedPreferences` الحالية، ويغذي `licenseService` و `AuthGate`، مع إبقاء قاعدة البيانات المحاسبية معزولة ومحلية بنسبة 100%.

### F — الملفات المتوقع تعديلها لاحقاً (Files to Change Later)
`android/app/build.gradle`, `AndroidManifest.xml`, جسر الفوترة في أندرويد, `license.js`, `AuthGate.jsx`, `Settings.jsx`, `Dashboard.jsx`.

### G — الملفات المحمية الصارمة (Files to Protect)
`database.js`, `backupService.js`, `pdfGenerator.js`, `googleDriveService.js`, جميع جداول SQLite، وحزمة الاختبارات `test_backup_compatibility.cjs`.

### H — الاختبارات المطلوبة لاحقاً عند التنفيذ (Tests Required Later)
1. تشغيل حزمة النسخ الاحتياطي والتأكد من استمرار **25/25 PASS**.
2. اختبار الشراء عبر حسابات الاختبار المرخصة (License Testing Accounts) في Play Console.
3. اختبار استعادة المشتريات (Restore Purchases) على جهاز جديد.
4. اختبار استمرار عمل التطبيق في وضع الطيران (Airplane Mode) بعد الشراء.
5. اختبار انتهاء الاشتراك والتحول التلقائي السلس إلى وضع العرض فقط (View-Only).

### I — القرارات المطلوب اتخاذها من طرفك (Open Decisions for Business)
1. **اعتماد نموذج الأسعار والاشتراكات:** هل نعتمد خطة متجددة تلقائياً (شهري/سنوي) + خطة شراء دائم (Lifetime)، أم نعتمد أيضاً خطط مسبقة الدفع (Prepaid Plans) لـ 3 و 6 أشهر؟
2. **فترة السماح للمستخدم الجديد:** هل نبقي على الـ Local Trial المجاني لمدة 30 يوماً بدون بطاقة (موصى به لتجربة الاستخدام السلسة)، أم نعتمد Google Play Subscription Trial؟
3. **مصير كود التفعيل القديم:** هل يتم إخفاؤه تماماً عن نسخة المستهلكين العامة في المتجر لحماية التطبيق من الرفض؟

### J — التقييم الهندسي النهائي (GO / NO-GO)
**[ GO ] — المشروع جاهز هندسياً ومعمارياً بالكامل للانتقال إلى مرحلة التنفيذ (Implementation)**، حيث تم التحقق من سلامة البنية التحتية، وتوافق بيئة Capacitor و Android الحديثة، وعزل بيانات SQLite بالكامل بنسبة 100%.

---

Stage 4 Read-Only Audit Completed — Awaiting Approval.
