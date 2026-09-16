import { Capacitor } from '@capacitor/core';
import { exportData } from './backupService';
import { googleAuthService, GOOGLE_CLIENT_ID } from './googleAuthService';

// ═══════════════════════════════════════════════════════════════════
//  Google Drive Backup Service  —  Local-Only App
// ═══════════════════════════════════════════════════════════════════
//
//  Google Drive هو خدمة Backup اختيارية خارجية فقط.
//  لا يُستخدم كمصدر بيانات أساسي.
//  لا يعمل بدون إنترنت — وهذا متوقع وطبيعي.
//
//  الواجهة العامة:
//    - uploadBackup()     → رفع النسخة الاحتياطية
//    - listBackups(limit) → قائمة النسخ السابقة
//    - downloadBackup(id) → تنزيل نسخة معينة
//    - signOut()          → تسجيل الخروج من Google
//    - isSignedIn()       → هل المستخدم مسجل دخول؟
// ═══════════════════════════════════════════════════════════════════

// ─── التحقق من الاتصال بالإنترنت ──────────────────────────────────

/**
 * فحص شامل للاتصال — لا يعتمد على navigator.onLine وحده
 * يحاول الوصول فعلياً إلى Google لأن وجود WiFi لا يعني وجود إنترنت حقيقي
 */
async function assertNetworkAvailable() {
  // فحص أولي سريع
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('OFFLINE');
  }

  // فحص فعلي — محاولة الوصول إلى Google
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch('https://www.googleapis.com/drive/v3/about', {
      method: 'HEAD',
      signal: controller.signal,
      // بدون credentials — هذا مجرد فحص وصول
    });

    clearTimeout(timeoutId);

    // 401 يعني الخادم يعمل لكن بدون مصادقة — الإنترنت يعمل
    // أي رد يعني الإنترنت يعمل
    return true;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('OFFLINE');
    }
    // أخطاء الشبكة الأخرى
    if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError') || err.message?.includes('Network request failed')) {
      throw new Error('OFFLINE');
    }
    // خطأ غير متعلق بالشبكة — الإنترنت يعمل على الأرجح
    return true;
  }
}

/**
 * تغليف عمليات Google Drive بفحص شبكة ومعالجة أخطاء موحدة
 */
async function withNetworkCheck(operation) {
  try {
    await assertNetworkAvailable();
  } catch (err) {
    if (err.message === 'OFFLINE') {
      throw new Error('النسخ الاحتياطي إلى Google Drive يحتاج إلى اتصال بالإنترنت.');
    }
    throw err;
  }

  try {
    return await operation();
  } catch (err) {
    // تحويل الأخطاء التقنية لرسائل مفهومة
    const msg = err.message || '';

    if (msg === 'OFFLINE' || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      throw new Error('فقد الاتصال بالإنترنت أثناء العملية. يرجى المحاولة مرة أخرى.');
    }

    if (msg === 'SESSION_EXPIRED') {
      throw new Error('انتهت جلسة Google. يرجى تسجيل الدخول مرة أخرى.');
    }

    if (msg.includes('تم إلغاء تسجيل الدخول') || msg.includes('access_denied')) {
      throw err; // رسالة واضحة بالفعل
    }

    // debug فقط
    console.error('[GoogleDrive] Operation error:', err);
    throw err;
  }
}

// ─── الخدمة العامة ────────────────────────────────────────────────

export { GOOGLE_CLIENT_ID };

export const googleDriveService = {

  /**
   * رفع النسخة الاحتياطية الحالية إلى Google Drive
   */
  async uploadBackup() {
    return withNetworkCheck(async () => {
      const token = await googleAuthService.getValidToken();
      const backupData = await exportData();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `أقساطي_Backup_${timestamp}.json`;
      const fileContent = JSON.stringify(backupData, null, 2);

      const metadata = {
        name: fileName,
        mimeType: 'application/json',
        description: `نسخة احتياطية لتطبيق أقساطي - ${new Date().toLocaleString('ar-SA')}`,
      };

      const boundary = '-------AqsatiBackupBoundary' + Date.now();
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartRequestBody =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        fileContent +
        closeDelimiter;

      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary="${boundary}"`,
          },
          body: multipartRequestBody,
        }
      );

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        const msg = errorJson.error?.message || `فشل الرفع برمز حالة ${response.status}`;

        // 401/403 يعني التوكن غير صالح
        if (response.status === 401 || response.status === 403) {
          // إبطال التوكن ومحاولة ثانية
          await googleAuthService.signOut();
          throw new Error('SESSION_EXPIRED');
        }

        throw new Error(`خطأ في Google Drive: ${msg}`);
      }

      const createdFile = await response.json();
      const recordsCount = Object.values(backupData.counts || {}).reduce((acc, c) => acc + c, 0);

      return {
        success: true,
        fileId: createdFile.id,
        fileName: createdFile.name,
        recordsCount,
        createdAt: new Date().toISOString(),
      };
    });
  },

  /**
   * جلب قائمة النسخ الاحتياطية السابقة من Google Drive
   */
  async listBackups(limit = 10) {
    return withNetworkCheck(async () => {
      const token = await googleAuthService.getValidToken();

      const query = "(name contains 'أقساطي_Backup' or name contains 'Aqsati_Backup' or name contains 'Fazatak_Backup' or name contains 'Aqsati_Main_Backup' or name contains 'Fazatak_Main_Backup') and trashed = false";
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        query
      )}&orderBy=createdTime desc&pageSize=${limit}&fields=files(id,name,size,createdTime,modifiedTime)`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await googleAuthService.signOut();
          throw new Error('SESSION_EXPIRED');
        }

        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || 'تعذر جلب النسخ من Google Drive');
      }

      const data = await response.json();
      return data.files || [];
    });
  },

  /**
   * تنزيل محتوى نسخة احتياطية من Google Drive
   */
  async downloadBackup(fileId) {
    return withNetworkCheck(async () => {
      const token = await googleAuthService.getValidToken();

      const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          await googleAuthService.signOut();
          throw new Error('SESSION_EXPIRED');
        }
        throw new Error('تعذر تنزيل ملف النسخة من Google Drive');
      }

      return await response.json();
    });
  },

  /**
   * تسجيل الخروج من Google
   */
  async signOut() {
    return googleAuthService.signOut();
  },

  /**
   * هل المستخدم مسجل دخول في Google؟
   */
  async isSignedIn() {
    return googleAuthService.isSignedIn();
  },

  /**
   * معرفة بريد الحساب المتصل
   */
  async getUserEmail() {
    return googleAuthService.getUserEmail();
  },

  /**
   * تبديل الحساب أو إعادة تسجيل الدخول
   */
  async reSignIn() {
    return googleAuthService.reSignIn();
  },
};
