import { useEffect, useRef, useState } from 'react';
import {
  BACKUP_FILE_NAME,
  checkBackupExists,
  createBackup,
  deleteBackup,
  exportData,
  formatDate,
  formatFileSize,
  importData,
  restoreBackup,
  restoreBackupFromText,
  shareBackup,
  inspectBackup
} from '../services/backupService';
import { googleDriveService } from '../services/googleDriveService';

const BackupRestore = ({ isOpen, onClose }) => {
  const fileInputRef = useRef(null);
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [backupInfo, setBackupInfo] = useState(null);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [googleDriveBackups, setGoogleDriveBackups] = useState([]);
  const [showGoogleDriveModal, setShowGoogleDriveModal] = useState(false);
  const [driveEmail, setDriveEmail] = useState(null);
  const [restoreStage, setRestoreStage] = useState('');

  async function refreshBackupInfo() {
    const info = await checkBackupExists();
    setBackupInfo(info);
  }

  useEffect(() => {
    let cancelled = false;

    if (isOpen) {
      checkBackupExists().then((info) => {
        if (!cancelled) setBackupInfo(info);
      });
      googleDriveService.getUserEmail().then((email) => {
        if (!cancelled) setDriveEmail(email);
      }).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const runAction = async (actionName, action) => {
    setLoading(actionName);
    setError('');
    setMessage('');

    try {
      const result = await action();
      await refreshBackupInfo();
      return result;
    } catch (err) {
      setError(err.message || 'حدث خطأ أثناء العملية');
      return null;
    } finally {
      setLoading('');
    }
  };

  const handleCreateBackup = async () => {
    const result = await runAction('backup', createBackup);
    if (result) {
      setMessage(`تم حفظ وتحديث النسخة بنجاح على هذا الجهاز (${result.recordsCount} سجل).`);
    }
  };

  const handleShareBackup = async () => {
    const result = await runAction('share', shareBackup);
    if (result?.downloaded) {
      setMessage('تم تحديث وتنزيل ملف النسخة الاحتياطية على جهازك.');
    } else if (result) {
      setMessage('تم تجهيز النسخة وفتح خيارات المشاركة والحفظ.');
    }
  };

  const handleDelete = async () => {
    if (!confirm('هل أنت متأكد من رغبتك في حذف ملف النسخة الاحتياطية المحفوظ على هذا الجهاز؟')) return;

    const result = await runAction('delete', deleteBackup);
    if (result) {
      setBackupInfo(null);
      setMessage('تم حذف ملف النسخة الاحتياطية بنجاح.');
    }
  };

  const handleFileSelected = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    setError('');
    setMessage('');

    try {
      const text = await file.text();
      const stats = await inspectBackup(text);
      setPendingRestore({
        type: 'file',
        fileName: file.name,
        text,
        stats
      });
    } catch (err) {
      setError('تعذر قراءة ملف النسخة: ' + (err.message || 'الملف غير صالح'));
    }
  };

  const handlePrepareDeviceRestore = async () => {
    try {
      setLoading('inspect');
      const backupData = await exportData();
      const stats = await inspectBackup(backupData);
      setPendingRestore({
        type: 'device',
        fileName: backupInfo?.name || BACKUP_FILE_NAME,
        stats
      });
    } catch (err) {
      setError('تعذر فحص النسخة المحفوظة: ' + err.message);
    } finally {
      setLoading('');
    }
  };

  const handleGoogleDriveBackup = async () => {
    const result = await runAction('google-drive-backup', async () => {
      return await googleDriveService.uploadBackup();
    });
    if (result?.success) {
      setMessage(`تم حفظ النسخة بنجاح على حساب Google Drive الخاص بك (${result.recordsCount} سجل).`);
      googleDriveService.getUserEmail().then(setDriveEmail).catch(() => {});
    }
  };

  const handleGoogleDriveSignOut = async () => {
    try {
      await googleDriveService.signOut();
      setDriveEmail(null);
      setMessage('تم تسجيل الخروج من حساب Google بنجاح.');
    } catch {
      setDriveEmail(null);
    }
  };

  const handleGoogleDriveRestoreClick = async () => {
    const backups = await runAction('google-drive-list', async () => {
      return await googleDriveService.listBackups(10);
    });
    if (!backups || backups.length === 0) {
      setError('لا توجد نسخ احتياطية لتطبيق أقساطي على حساب Google Drive هذا.');
      return;
    }
    setGoogleDriveBackups(backups);
    setShowGoogleDriveModal(true);
  };

  const handleSelectGoogleDriveItem = async (item) => {
    setShowGoogleDriveModal(false);
    try {
      setLoading('drive-download');
      const driveData = await googleDriveService.downloadBackup(item.id);
      const stats = await inspectBackup(driveData);
      setPendingRestore({
        type: 'google-drive',
        fileId: item.id,
        driveData,
        fileName: `Google Drive (${formatDate(item.createdTime || item.modifiedTime)}) - ${item.name}`,
        stats
      });
    } catch (err) {
      setError('تعذر تحميل وفحص النسخة من Google Drive: ' + err.message);
    } finally {
      setLoading('');
    }
  };

  const confirmRestore = async () => {
    if (!pendingRestore) return;

    const restoreSource = pendingRestore;
    setPendingRestore(null);
    setRestoreStage('جاري فحص النسخة الاحتياطية وتوافق الجداول والعلاقات...');

    const onProgress = (stage) => {
      if (stage === 'validating') setRestoreStage('جاري فحص النسخة الاحتياطية وتوافق الجداول...');
      else if (stage === 'snapshot') setRestoreStage('جاري حفظ نسخة أمان للبيانات الحالية...');
      else if (stage === 'restoring') setRestoreStage('جاري استعادة البيانات الذرية وضبط الحقول...');
      else if (stage === 'verifying') setRestoreStage('تم التحقق بنجاح، جاري إتمام العملية...');
      else if (stage === 'completed') setRestoreStage('');
    };

    const result = await runAction('restore', async () => {
      try {
        if (restoreSource.type === 'file') {
          return await restoreBackupFromText(restoreSource.text, onProgress);
        }
        if (restoreSource.type === 'google-drive') {
          return await importData(restoreSource.driveData, onProgress);
        }
        return await restoreBackup(onProgress);
      } finally {
        setRestoreStage('');
      }
    });

    if (result) {
      setMessage(`تمت الاستعادة بنجاح (${result.recordsCount} سجل). سيتم تحديث التطبيق الآن...`);
      setTimeout(() => window.location.reload(), 1500);
    }
  };

  if (!isOpen) return null;

  const isBusy = Boolean(loading);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center modal-safe-area p-4" dir="rtl">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-lg">
              💾
            </div>
            <div>
              <h2 className="text-lg font-black text-white">النسخ الاحتياطي والاستعادة</h2>
              <p className="text-[11px] text-slate-400">حفظ واستعادة البيانات بأمان محلياً أو عبر Google Drive</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 grid place-items-center transition-colors cursor-pointer"
            aria-label="إغلاق"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {restoreStage && (
          <div className="mb-4 p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl text-amber-300 text-xs leading-5 flex items-center gap-2 animate-pulse">
            <span className="text-base">⏳</span>
            <span>{restoreStage}</span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-300 text-xs leading-5 flex items-start gap-2">
            <span className="text-base">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="mb-4 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs leading-5 flex items-start gap-2">
            <span className="text-base">✅</span>
            <span>{message}</span>
          </div>
        )}

        {/* Local Device Backup Info Card */}
        <div className="mb-5 p-4 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-slate-400 text-xs font-semibold">الملف المحلي الأساسي</span>
            <span className="text-emerald-400 font-bold text-xs font-mono" dir="ltr">{backupInfo?.name || BACKUP_FILE_NAME}</span>
          </div>

          {backupInfo ? (
            <div className="grid grid-cols-2 gap-3 text-xs pt-1 border-t border-slate-800/80">
              <div>
                <p className="text-slate-500 text-[11px]">آخر تحديث</p>
                <p className="text-emerald-300 font-medium">{formatDate(backupInfo.exportedAt || backupInfo.updatedAt)}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">الحجم</p>
                <p className="text-white font-mono">{formatFileSize(backupInfo.size)}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">الجداول</p>
                <p className="text-white font-mono">{backupInfo.tablesCount}</p>
              </div>
              <div>
                <p className="text-slate-500 text-[11px]">السجلات الإجمالية</p>
                <p className="text-white font-mono font-bold">{backupInfo.recordsCount}</p>
              </div>
            </div>
          ) : (
            <p className="text-amber-300 text-xs">لا توجد نسخة احتياطية محفوظة على ذاكرة هذا الجهاز بعد.</p>
          )}

          <p className="text-slate-500 text-[10px] leading-relaxed">
            🔒 النسخ الاحتياطي يعمل محلياً بالكامل. يمكنك أيضاً تصدير ملف النسخة ومشاركته لحفظه في أي مكان خارجي.
          </p>
        </div>

        {/* Local Action Buttons */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={handleCreateBackup}
              disabled={isBusy}
              className="bg-emerald-600 hover:bg-emerald-500 text-white py-3 px-3 rounded-xl font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-900/30 transition-all active:scale-[0.98] cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M12 4v12m0 0 4-4m-4 4-4-4" />
              </svg>
              <span>{loading === 'backup' ? 'جاري الحفظ...' : 'حفظ نسخة بالجهاز'}</span>
            </button>

            <button
              onClick={handleShareBackup}
              disabled={isBusy}
              className="bg-blue-600 hover:bg-blue-500 text-white py-3 px-3 rounded-xl font-bold text-xs disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-lg shadow-blue-900/30 transition-all active:scale-[0.98] cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.59 13.51 15.42 17.49M15.41 6.51 8.59 10.49M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              <span>{loading === 'share' ? 'جاري التجهيز...' : 'تصدير / مشاركة ملف'}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={handlePrepareDeviceRestore}
              disabled={isBusy || !backupInfo}
              className="bg-slate-800 hover:bg-slate-700 text-white py-3 px-3 rounded-xl font-bold text-xs disabled:opacity-40 border border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>🔄</span>
              <span>استعادة من الجهاز</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="bg-slate-800 hover:bg-slate-700 text-white py-3 px-3 rounded-xl font-bold text-xs disabled:opacity-40 border border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>📂</span>
              <span>استيراد ملف (.json)</span>
            </button>
          </div>

          {backupInfo && (
            <button
              onClick={handleDelete}
              disabled={isBusy}
              className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 py-2.5 rounded-xl font-bold text-xs disabled:opacity-50 transition-colors cursor-pointer"
            >
              حذف النسخة المحفوظة من ذاكرة الجهاز
            </button>
          )}

          {/* قسم Google Drive الاختياري المحفوظ بعناية */}
          <div className="pt-4 mt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <span className="text-base">📁</span> النسخ على Google Drive (سحابي اختياري)
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                يتطلب إنترنت
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={handleGoogleDriveBackup}
                disabled={isBusy}
                className="bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 py-3 px-3 rounded-xl font-bold text-xs disabled:opacity-40 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <span>☁️</span>
                <span>{loading === 'google-drive-backup' ? 'جاري الرفع...' : 'رفع إلى Drive'}</span>
              </button>

              <button
                onClick={handleGoogleDriveRestoreClick}
                disabled={isBusy}
                className="bg-teal-950/60 hover:bg-teal-900/80 text-teal-300 border border-teal-500/40 py-3 px-3 rounded-xl font-bold text-xs disabled:opacity-40 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <span>📥</span>
                <span>{loading === 'google-drive-list' ? 'جاري الفحص...' : 'استرجاع من Drive'}</span>
              </button>
            </div>

            {driveEmail && (
              <div className="flex items-center justify-between text-[11px] bg-slate-950/80 px-3 py-2 rounded-xl border border-slate-800">
                <span className="text-slate-400">الحساب: <strong className="text-emerald-400 font-mono" dir="ltr">{driveEmail}</strong></span>
                <button
                  type="button"
                  onClick={handleGoogleDriveSignOut}
                  className="text-rose-400 hover:text-rose-300 font-bold transition-colors cursor-pointer"
                >
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileSelected}
          className="hidden"
        />
      </div>

      {/* Confirmation & Inspection Modal before restoring */}
      {pendingRestore && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center modal-safe-area p-4" dir="rtl">
          <div className="bg-slate-900 border border-rose-500/40 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center text-xl border border-rose-500/30">
                ⚠️
              </div>
              <div>
                <h3 className="text-lg font-black text-white">تأكيد استعادة البيانات</h3>
                <p className="text-xs text-rose-300 font-medium">سيتم استبدال البيانات الحالية على الجهاز بهذه النسخة</p>
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3 mb-5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">مصدر النسخة:</span>
                <span className="text-white font-mono font-bold break-all" dir="ltr">{pendingRestore.fileName}</span>
              </div>

              {pendingRestore.stats && (
                <>
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80">
                    <div className="flex justify-between">
                      <span className="text-slate-500">العملاء:</span>
                      <span className="text-emerald-400 font-bold font-mono">{pendingRestore.stats.tables.customers}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">العقود:</span>
                      <span className="text-emerald-400 font-bold font-mono">{pendingRestore.stats.tables.contracts}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">الأقساط:</span>
                      <span className="text-emerald-400 font-bold font-mono">{pendingRestore.stats.tables.installments}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">المصروفات:</span>
                      <span className="text-emerald-400 font-bold font-mono">{pendingRestore.stats.tables.expenses}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80 flex justify-between font-bold">
                    <span className="text-slate-300">إجمالي سجلات الأعمال:</span>
                    <span className="text-emerald-300 font-mono">{pendingRestore.stats.totalRecords}</span>
                  </div>

                  <div className="pt-2 border-t border-emerald-500/20 bg-emerald-500/10 p-2.5 rounded-xl flex items-center gap-2 text-[11px] text-emerald-300 font-medium">
                    <span>🛡️</span>
                    <span>حساب الدخول المحلي ورمز القفل (PIN) محفوظان بالكامل ولن يتأثرا بالاستعادة.</span>
                  </div>
                </>
              )}

              <p className="text-slate-400 text-[10px] leading-relaxed pt-1 border-t border-slate-800/60">
                🛡️ العملية مؤمنة بمعاملة ذرية (Atomic Transaction): في حال حدوث أي خطأ، سيتم التراجع التلقائي دون التأثير على بياناتك الحالية.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPendingRestore(null)}
                disabled={isBusy}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs transition-colors cursor-pointer"
              >
                إلغاء
              </button>
              <button
                onClick={confirmRestore}
                disabled={isBusy}
                className="flex-1 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold text-xs shadow-lg shadow-rose-900/40 transition-all cursor-pointer"
              >
                {loading === 'restore' ? (restoreStage || 'جاري الاستعادة...') : 'تأكيد واستعادة البيانات'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Drive List Modal */}
      {showGoogleDriveModal && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4 modal-safe-area" dir="rtl">
          <div className="bg-slate-900 border border-teal-500/30 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>📁</span> نسخ Google Drive المتوفرة
              </h3>
              <button
                onClick={() => setShowGoogleDriveModal(false)}
                className="w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 grid place-items-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <p className="text-slate-400 text-xs mb-4">
              اختر النسخة التي ترغب باستعادتها إلى جهازك:
            </p>

            <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
              {googleDriveBackups.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelectGoogleDriveItem(item)}
                  className="w-full p-3 bg-slate-950 hover:bg-slate-800/80 border border-slate-800 rounded-xl text-right transition-colors flex items-center justify-between group cursor-pointer"
                >
                  <div>
                    <p className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors" dir="ltr">
                      {item.name}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {formatDate(item.createdTime || item.modifiedTime)} • {formatFileSize(item.size)}
                    </p>
                  </div>
                  <span className="text-emerald-400 text-xs font-bold">اختيار ➔</span>
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowGoogleDriveModal(false)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackupRestore;
