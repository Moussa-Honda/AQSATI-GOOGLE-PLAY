import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { settingsService } from '../services/database';
import { dueAlertsService } from '../services/dueAlertsService';
import licenseService from '../services/license';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { Clipboard } from '@capacitor/clipboard';
import { useLiveRefresh } from '../hooks/useLiveRefresh';
import { cloudSyncService, SYNC_STATUS_EVENT, LAST_SYNC_KEY } from '../services/cloudSyncService';
import { googleDriveService } from '../services/googleDriveService';
import { importData, formatDate, formatFileSize } from '../services/backupService';
import { notifyDataChanged } from '../services/dataEvents';
import { authService } from '../services/authService';

const SUPPORT_PHONE_DISPLAY = '+966556854162';
const SUPPORT_WHATSAPP_PHONE = '966556854162';

const ToggleItem = ({ title, description, value, onToggle, icon, disabled = false }) => (
  <div className="settings-toggle-item border-b border-slate-700 last:border-0">
    <span className="settings-toggle-icon" aria-hidden="true">{icon}</span>
    <div className="settings-toggle-copy">
      <p className="settings-toggle-title text-white font-medium">{title}</p>
      <p className="settings-toggle-description text-slate-400 text-sm">{description}</p>
    </div>
    <div className="settings-toggle-control">
      <span className={`settings-toggle-status ${value ? 'is-on' : 'is-off'}`}>
        {value ? 'مفعل' : 'متوقف'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={value}
        aria-busy={disabled}
        aria-label={`${title}: ${value ? 'مفعل' : 'متوقف'}`}
        className={`settings-toggle ${value ? 'is-on' : 'is-off'} disabled:cursor-wait disabled:opacity-60`}
      >
        <span className="settings-toggle__knob" aria-hidden="true" />
      </button>
    </div>
  </div>
);

const PdfMarkEditor = ({ label, image, text, error, onFileChange, onClear, onTextChange }) => (
  <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
    <div>
      <label className="block text-sm text-slate-400 mb-2">صورة {label}</label>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFileChange}
        className="w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:font-bold file:text-white hover:file:bg-emerald-500"
      />
      <p className="text-[11px] text-slate-500 mt-2">PNG شفاف أو JPG أو WebP، بحد أقصى 2 ميجابايت.</p>
      {error && <p className="text-xs text-rose-300 mt-2">{error}</p>}
    </div>

    {image && (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <img src={image} alt={`معاينة ${label}`} className="h-16 max-w-40 object-contain" />
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20"
        >
          إزالة الصورة
        </button>
      </div>
    )}

    <div>
      <label className="block text-sm text-slate-400 mb-2">النص البديل لـ{label}</label>
      <input
        type="text"
        value={text}
        onChange={onTextChange}
        className="w-full bg-slate-950 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors"
        placeholder={`مثال: ${label === 'الختم' ? 'معتمد - أقساطي' : 'اسم صاحب التوقيع'}`}
      />
      <p className="text-[11px] text-slate-500 mt-2">يظهر النص إذا لم يتم رفع صورة.</p>
    </div>
  </div>
);

const Settings = ({ onSettingsChange, onLicenseRenewed, currentUser, onLogout, isReadOnly = false, onRenewalRequest }) => {
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [appLockEnabled, setAppLockEnabled] = useState(() => authService.isAppLockEnabled(currentUser?.phone));
  const [appLockCurrentPin, setAppLockCurrentPin] = useState('');
  const [appLockPin, setAppLockPin] = useState('');
  const [appLockConfirm, setAppLockConfirm] = useState('');
  const [appLockLoading, setAppLockLoading] = useState(false);
  const [appLockMessage, setAppLockMessage] = useState('');
  const [appLockError, setAppLockError] = useState('');
  const [driveLoading, setDriveLoading] = useState('');
  const [driveMessage, setDriveMessage] = useState('');
  const [driveError, setDriveError] = useState('');
  const [driveBackups, setDriveBackups] = useState([]);
  const [showDriveRestoreModal, setShowDriveRestoreModal] = useState(false);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState(null);

  const handleDriveUpload = async () => {
    setDriveLoading('upload');
    setDriveMessage('');
    setDriveError('');
    try {
      const res = await googleDriveService.uploadBackup();
      setDriveMessage(`تم حفظ النسخة بنجاح في حسابك بـ Google Drive (${res.recordsCount} سجل).`);
    } catch (err) {
      console.error('Google Drive backup error:', err);
      setDriveError(err.message || 'فشل الرفع إلى Google Drive');
    } finally {
      setDriveLoading('');
    }
  };

  const handleDriveRestoreClick = async () => {
    if (isReadOnly) return onRenewalRequest?.();
    setDriveLoading('list');
    setDriveMessage('');
    setDriveError('');
    try {
      const backups = await googleDriveService.listBackups(15);
      if (!backups || backups.length === 0) {
        setDriveError('لا توجد نسخ احتياطية لتطبيق أقساطي على حساب Google Drive هذا.');
        return;
      }
      setDriveBackups(backups);
      setShowDriveRestoreModal(true);
    } catch (err) {
      console.error('Google Drive list error:', err);
      setDriveError(err.message || 'تعذر جلب النسخ من Google Drive');
    } finally {
      setDriveLoading('');
    }
  };

  const handleConfirmRestore = async (file) => {
    if (!file) return;
    setDriveLoading('restore');
    setDriveError('');
    try {
      const payload = await googleDriveService.downloadBackup(file.id);
      const res = await importData(payload);
      notifyDataChanged({ scope: 'all', action: 'google-drive-restore' });
      setShowDriveRestoreModal(false);
      setSelectedBackupForRestore(null);
      setDriveMessage(`تمت استعادة البيانات بنجاح (${res.recordsCount} سجل). جاري تحديث التطبيق...`);
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (err) {
      console.error('Google Drive restore error:', err);
      setDriveError(err.message || 'فشلت عملية استعادة النسخة');
      setSelectedBackupForRestore(null);
    } finally {
      setDriveLoading('');
    }
  };

  const [syncStatusText, setSyncStatusText] = useState('محفوظ مع السحابة تلقائياً ✓');
  const [isSyncingLive, setIsSyncingLive] = useState(false);

  useEffect(() => {
    const handleSyncEvent = (e) => {
      const { status } = e.detail || {};
      if (status === 'syncing' || status === 'pending') {
        setIsSyncingLive(true);
        setSyncStatusText('جاري الحفظ التلقائي في السحابة...');
      } else if (status === 'synced') {
        setIsSyncingLive(false);
        setSyncStatusText('تم الحفظ التلقائي في السحابة بنجاح ✓');
      } else if (status === 'error') {
        setIsSyncingLive(false);
        setSyncStatusText('بانتظار اتصال الإنترنت للمزامنة...');
      }
    };

    window.addEventListener(SYNC_STATUS_EVENT, handleSyncEvent);
    return () => window.removeEventListener(SYNC_STATUS_EVENT, handleSyncEvent);
  }, []);
  const [showCustodySection, setShowCustodySection] = useState(true);
  const [quickPaymentMode, setQuickPaymentMode] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [screenPrivacy, setScreenPrivacy] = useState(true);
  const [hijriCalendar, setHijriCalendar] = useState(false);
  const [showMotivationalTicker, setShowMotivationalTicker] = useState(true);
  const [overdueThreshold, setOverdueThreshold] = useState(30);
  const [stagnancyThreshold, setStagnancyThreshold] = useState(90);
  const [dueAlertsEnabled, setDueAlertsEnabled] = useState(false);
  const [dueAlertsStatus, setDueAlertsStatus] = useState('');
  const [whatsappTemplate, setWhatsappTemplate] = useState('');
  const [updatingSetting, setUpdatingSetting] = useState(null);

  const [businessName, setBusinessName] = useState('');
  const [businessContact, setBusinessContact] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [showDetailsOnPdf, setShowDetailsOnPdf] = useState(false);
  const [pdfStampEnabled, setPdfStampEnabled] = useState(false);
  const [pdfStampImage, setPdfStampImage] = useState('');
  const [pdfStampText, setPdfStampText] = useState('');
  const [pdfStampError, setPdfStampError] = useState('');
  const [pdfSignatureEnabled, setPdfSignatureEnabled] = useState(false);
  const [pdfSignatureImage, setPdfSignatureImage] = useState('');
  const [pdfSignatureText, setPdfSignatureText] = useState('');
  const [pdfSignatureError, setPdfSignatureError] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState(null);
  const [renewalCode, setRenewalCode] = useState('');
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalMessage, setRenewalMessage] = useState('');
  const [deviceCopied, setDeviceCopied] = useState(false);

  async function loadSettings() {
    try {
      const [
        quick, privacy, screenPrivacyValue,
        bizName, bizContact, taxNo, showPdf, stampEnabled, stampImage, stampText, signatureEnabled, signatureImage, signatureText, overThreshold, stagThreshold,
        dueAlerts, whatsappText,
         showCustody, showTicker
      ] = await Promise.all([
        settingsService.get('quick_payment_mode'),
        settingsService.get('privacy_mode'),
        settingsService.get('screen_privacy'),
        settingsService.get('business_name'),
        settingsService.get('business_contact'),
        settingsService.get('tax_number'),
        settingsService.get('show_details_on_pdf'),
        settingsService.get('pdf_stamp_enabled'),
        settingsService.get('pdf_stamp_image'),
        settingsService.get('pdf_stamp_text'),
        settingsService.get('pdf_signature_enabled'),
        settingsService.get('pdf_signature_image'),
        settingsService.get('pdf_signature_text'),
        settingsService.get('overdue_threshold_days'),
        settingsService.get('stagnancy_threshold_days'),
        settingsService.get('due_alerts_enabled'),
        settingsService.getWhatsAppTemplate(),
         settingsService.get('show_custody_section'),
         settingsService.get('show_motivational_ticker')
      ]);
      
      setShowCustodySection(showCustody !== 'false');
      setShowMotivationalTicker(showTicker !== 'false');
      setQuickPaymentMode(quick === 'true');
      setPrivacyMode(privacy === 'true');
      setScreenPrivacy(screenPrivacyValue !== 'false');
      setBusinessName(bizName || '');
      setBusinessContact(bizContact || '');
      setTaxNumber(taxNo || '');
      setShowDetailsOnPdf(showPdf === 'true');
      setPdfStampEnabled(stampEnabled === 'true');
      setPdfStampImage(stampImage || '');
      setPdfStampText(stampText || '');
      setPdfSignatureEnabled(signatureEnabled === 'true');
      setPdfSignatureImage(signatureImage || '');
      setPdfSignatureText(signatureText || '');
      setOverdueThreshold(parseInt(overThreshold) || 30);
      setStagnancyThreshold(parseInt(stagThreshold) || 90);
      setDueAlertsEnabled(dueAlerts === 'true' && ['granted', 'unknown'].includes(dueAlertsService.getPermission()));
      setWhatsappTemplate(whatsappText || '');
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  useLiveRefresh(loadSettings);

  async function loadLicenseInfo() {
    try {
      const id = await licenseService.getDeviceId();
      setDeviceId(id);
    } catch (error) {
      console.error('Device ID error:', error);
    }

    try {
      const status = await licenseService.checkLicenseStatus();
      setLicenseExpiry(status?.expiry || null);
    } catch {
      setLicenseExpiry(null);
    }
  }

  useEffect(() => {
    loadSettings();
    loadLicenseInfo();
  }, []);

  const formatLicenseExpiry = (expiry) => {
    if (!expiry) return 'غير متاح';
    if (expiry > 2100000000) return 'تفعيل دائم';
    const date = new Date(expiry * 1000);
    return date.toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const copyDeviceId = async () => {
    if (!deviceId) return;
    await Clipboard.write({ string: deviceId });
    setDeviceCopied(true);
    setTimeout(() => setDeviceCopied(false), 2000);
  };

  const handleSupportWhatsApp = () => {
    const message = `السلام عليكم، أريد تجديد اشتراك تطبيق أقساطي. رقم الجهاز: ${deviceId || ''}`;
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleRenewLicense = async (e) => {
    e.preventDefault();
    if (!renewalCode.trim()) return;

    setRenewalLoading(true);
    setRenewalMessage('');

    try {
      const result = await licenseService.activateLicense(renewalCode.trim());
      if (result.success) {
        setLicenseExpiry(result.expiry);
        setRenewalCode('');
        setRenewalMessage(`تم تجديد الاشتراك بنجاح. تاريخ الانتهاء الجديد: ${formatLicenseExpiry(result.expiry)}`);
        onLicenseRenewed?.(result.key, result.expiry);
      }
    } catch (error) {
      const errCode = error.message || '';
      let msg = 'تعذر تجديد الاشتراك. تأكد من الكود وحاول مرة أخرى.';
      if (errCode.includes('ERR_WRONG_CODE')) msg = 'هذا الكود غير صالح لهذا الجهاز.';
      else if (errCode.includes('ERR_INVALID_FORMAT')) msg = 'تنسيق الكود غير صحيح. يجب أن يكون 9 أرقام.';
      else if (errCode.includes('ERR_TIME_TAMPERED')) msg = 'تم اكتشاف تلاعب في وقت الجهاز.';
      setRenewalMessage(msg);
    } finally {
      setRenewalLoading(false);
    }
  };

  const toggleSetting = async (key, value, setter) => {
    if (updatingSetting) return;

    const newValue = !value;
    setter(newValue);
    setUpdatingSetting(key);

    try {
      await settingsService.set(key, newValue.toString());

      if (key === 'screen_privacy' && Capacitor.isNativePlatform()) {
        if (newValue) {
          await PrivacyScreen.enable();
        } else {
          await PrivacyScreen.disable();
        }
      }

      onSettingsChange?.();
    } catch (e) {
      console.error(e);
      setter(value);
    } finally {
      setUpdatingSetting(null);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setPasswordMessage('');
    setPasswordError('');

    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError('كلمة المرور الجديدة وتأكيدها غير متطابقين');
      return;
    }

    setPasswordLoading(true);
    try {
      const result = await authService.changePassword(passwordForm.current, passwordForm.next);
      setPasswordMessage(result.message);
      setPasswordForm({ current: '', next: '', confirm: '' });
    } catch (error) {
      setPasswordError(error.message || 'تعذر تغيير كلمة المرور');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSaveAppLock = async (event) => {
    event.preventDefault();
    setAppLockMessage('');
    setAppLockError('');

    if (!/^\d{4,6}$/.test(appLockPin)) {
      setAppLockError('رمز القفل يجب أن يكون من 4 إلى 6 أرقام');
      return;
    }
    if (appLockPin !== appLockConfirm) {
      setAppLockError('رمز القفل وتأكيده غير متطابقين');
      return;
    }

    setAppLockLoading(true);
    try {
      if (appLockEnabled && !(await authService.verifyAppLockPin(appLockCurrentPin, currentUser?.phone))) {
        throw new Error('رمز القفل الحالي غير صحيح');
      }
      await authService.setAppLockPin(appLockPin, currentUser?.phone);
      setAppLockEnabled(true);
      setAppLockCurrentPin('');
      setAppLockPin('');
      setAppLockConfirm('');
      setAppLockMessage(appLockEnabled ? 'تم تغيير رمز قفل التطبيق' : 'تم تفعيل قفل التطبيق');
    } catch (error) {
      setAppLockError(error.message || 'تعذر حفظ رمز قفل التطبيق');
    } finally {
      setAppLockLoading(false);
    }
  };

  const handleDisableAppLock = async () => {
    setAppLockMessage('');
    setAppLockError('');
    setAppLockLoading(true);
    try {
      await authService.disableAppLock(appLockCurrentPin, currentUser?.phone);
      setAppLockEnabled(false);
      setAppLockCurrentPin('');
      setAppLockMessage('تم إيقاف قفل التطبيق');
    } catch (error) {
      setAppLockError(error.message || 'تعذر إيقاف قفل التطبيق');
    } finally {
      setAppLockLoading(false);
    }
  };

  const handleDueAlertsToggle = async () => {
    if (updatingSetting) return;

    setUpdatingSetting('due_alerts_enabled');
    setDueAlertsStatus('');
    try {
      const result = await dueAlertsService.setEnabled(!dueAlertsEnabled);
      setDueAlertsEnabled(result.enabled);

      if (result.enabled) {
        setDueAlertsStatus('تم التفعيل. سيصلك Push بالعملاء المتأخرين والمستحقين اليوم حتى مع إغلاق التطبيق.');
        const test = await dueAlertsService.sendTest();
        if (!test.sent) {
          setDueAlertsStatus(`تم التسجيل، لكن تعذر إرسال إشعار الاختبار: ${test.reason || 'unknown'}`);
        }
      } else if (result.reason === 'ios_not_installed') {
        setDueAlertsStatus('على الآيفون: من سفاري اختر «مشاركة» ثم «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من الأيقونة ثم فعّل التنبيهات (iOS 16.4 أو أحدث).');
      } else if (result.reason === 'denied') {
        setDueAlertsStatus('التنبيهات مرفوضة من إعدادات الجهاز. افتح إعدادات الإشعارات للتطبيق واختر السماح ثم أعد المحاولة.');
      } else if (result.reason === 'unsupported') {
        setDueAlertsStatus('هذا المتصفح لا يدعم تنبيهات النظام.');
      } else if (result.reason === 'off') {
        setDueAlertsStatus('تم إيقاف تنبيهات الجهاز.');
      } else {
        setDueAlertsStatus('لم يتم منح صلاحية التنبيهات. اضغط الزر مرة أخرى واسمح بها من نافذة النظام.');
      }

      onSettingsChange?.();
    } catch (error) {
      console.error('Due alerts toggle error:', error);
      setDueAlertsStatus('تعذر تحديث التنبيهات.');
    } finally {
      setUpdatingSetting(null);
    }
  };

  const updateBusinessSetting = async (key, value, setter) => {
    setter(value);
    await settingsService.set(key, value);
    onSettingsChange?.();
  };

  const updateWhatsappTemplate = async (value) => {
    setWhatsappTemplate(value);
    await settingsService.set('whatsapp_template', value);
    onSettingsChange?.();
  };

  const handlePdfMarkImageChange = (event, settingKey, setImage, setError) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('يرجى اختيار صورة صحيحة.');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setError('حجم الصورة يجب ألا يتجاوز 2 ميجابايت.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      setImage(dataUrl);
      setError('');
      await settingsService.set(settingKey, dataUrl);
      onSettingsChange?.();
    };
    reader.onerror = () => setError('تعذر قراءة الصورة.');
    reader.readAsDataURL(file);
  };

  const clearPdfMarkImage = async (settingKey, setImage, setError) => {
    setImage('');
    setError('');
    await settingsService.set(settingKey, '');
    onSettingsChange?.();
  };

  return (
    <div className="p-4 space-y-6 overflow-y-auto custom-scrollbar h-full bg-slate-900 pb-20" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
      
      {/* ── Client Account & Cloud Sync Section ── */}
      {currentUser && (
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 border border-emerald-500/30 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-2xl">
                👤
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{currentUser.name}</h3>
                <p className="text-emerald-400 font-mono text-xs mt-0.5" dir="ltr">{currentUser.phone}</p>
              </div>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-colors"
              >
                تسجيل الخروج
              </button>
            )}
          </div>

          <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800 space-y-2.5 mb-0 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">حالة الاشتراك السحابي:</span>
              <span className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] border ${
                isReadOnly 
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' 
                  : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              }`}>
                {isReadOnly 
                  ? 'منتهي (وضع العرض فقط)' 
                  : currentUser.subscription_status === 'trial' 
                    ? 'فترة تجريبية سارية (35 يوماً)' 
                    : 'اشتراك نشط'}
              </span>
            </div>
            {currentUser.subscription_expiry && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">تاريخ انتهاء الاشتراك:</span>
                <span className="text-slate-200 font-mono font-medium">
                  {new Date(currentUser.subscription_expiry).toLocaleDateString('ar-EG')}
                </span>
              </div>
            )}
            {isReadOnly && (
              <div className="pt-2 border-t border-slate-800/80 flex gap-2">
                <button
                  type="button"
                  onClick={onRenewalRequest}
                  className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl font-bold text-xs shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  ⚡ تجديد الاشتراك الآن
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const message = `السلام عليكم، أريد تجديد اشتراك تطبيق أقساطي لرقم الحساب: ${currentUser?.phone || ''}`;
                    window.open(`https://wa.me/${SUPPORT_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`, '_blank');
                  }}
                  className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs shadow transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                >
                  <span>💬</span>
                  <span>واتساب</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── قسم النسخ والاسترجاع عبر Google Drive فقط ── */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-850 rounded-2xl p-5 border border-emerald-500/30 shadow-lg relative overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-lg">
              ☁️
            </span>
            <div>
              <h3 className="text-base font-bold text-white">النسخ الاحتياطي عبر Google Drive</h3>
              <p className="text-slate-400 text-xs mt-0.5">حفظ واسترجاع بضغطة زر واحدة لحسابك</p>
            </div>
          </div>
          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
            Google Drive
          </span>
        </div>

        {driveMessage && (
          <div className="mb-3 p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs leading-5 flex items-center gap-2">
            <span>✅</span>
            <span>{driveMessage}</span>
          </div>
        )}

        {driveError && (
          <div className="mb-3 p-3 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs leading-5 flex items-center gap-2">
            <span>⚠️</span>
            <span>{driveError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={handleDriveUpload}
            disabled={Boolean(driveLoading)}
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-3 px-4 rounded-xl shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <span className="text-lg">☁️</span>
            <span>{driveLoading === 'upload' ? 'جاري الرفع إلى Drive...' : 'رفع إلى Google Drive'}</span>
          </button>

          <button
            type="button"
            onClick={handleDriveRestoreClick}
            disabled={Boolean(driveLoading)}
            className="w-full bg-slate-700/80 hover:bg-slate-700 text-slate-100 font-bold py-3 px-4 rounded-xl border border-slate-600 shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            <span className="text-lg">📥</span>
            <span>{driveLoading === 'list' ? 'جاري جلب النسخ...' : 'استرجاع من Google Drive'}</span>
          </button>
        </div>
      </div>

      {/* License Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">الاشتراك والجهاز</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">رقم الجهاز</label>
            <div className="flex gap-2">
              <div className="flex-1 bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-emerald-400 font-mono text-center tracking-wider">
                {deviceId || 'جاري التحميل...'}
              </div>
              <button
                type="button"
                onClick={copyDeviceId}
                className={`px-4 rounded-xl font-bold transition-colors ${deviceCopied ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
              >
                {deviceCopied ? 'تم' : 'نسخ'}
              </button>
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700 rounded-xl p-4 flex items-center justify-between gap-3">
            <span className="text-slate-400 text-sm">انتهاء الاشتراك الحالي</span>
            <span className="text-white font-bold text-sm">{formatLicenseExpiry(licenseExpiry)}</span>
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-white text-sm font-bold">تواصل معنا للتجديد</p>
              <p className="text-emerald-300 text-sm font-mono mt-1" dir="ltr">{SUPPORT_PHONE_DISPLAY}</p>
            </div>
            <button
              type="button"
              onClick={handleSupportWhatsApp}
              className="h-10 px-4 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-500 transition-colors active:scale-95"
            >
              واتساب
            </button>
          </div>

          <form onSubmit={handleRenewLicense} className="space-y-3">
            <label className="block text-sm text-slate-400">كود تجديد الاشتراك</label>
            <input
              type="tel"
              value={renewalCode}
              onChange={(e) => setRenewalCode(e.target.value.replace(/[^0-9٠-٩]/g, ''))}
              maxLength={9}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-center font-bold tracking-[0.35em] placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors"
              placeholder="912345678"
              dir="ltr"
            />
            <button
              type="submit"
              disabled={renewalLoading || !renewalCode.trim()}
              className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
              {renewalLoading ? 'جاري التجديد...' : 'تفعيل / تجديد الاشتراك'}
            </button>
          </form>

          {renewalMessage && (
            <p className="text-xs text-slate-300 leading-5 bg-slate-900/70 border border-slate-700 rounded-xl p-3">
              {renewalMessage}
            </p>
          )}
        </div>
      </div>

      {/* Privacy Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">🛡️ الخصوصية والعرض</h3>
        <ToggleItem title="وضع الخصوصية" description="إخفاء الأرقام المالية" value={privacyMode} onToggle={() => toggleSetting('privacy_mode', privacyMode, setPrivacyMode)} icon="🔒" />
        <ToggleItem title="حماية الشاشة" description="منع لقطات الشاشة وتسجيل الفيديو" value={screenPrivacy} onToggle={() => toggleSetting('screen_privacy', screenPrivacy, setScreenPrivacy)} icon="📸" />
        <ToggleItem title="التاريخ الهجري" description="عرض التاريخ الهجري" value={hijriCalendar} onToggle={() => toggleSetting('hijri_calendar', hijriCalendar, setHijriCalendar)} icon="📅" />
        <ToggleItem title="قسم العهد" description="إظهار قسم العهد في الشريط السفلي" value={showCustodySection} onToggle={() => toggleSetting('show_custody_section', showCustodySection, setShowCustodySection)} icon="💼" />
         <ToggleItem title="الرسائل التحفيزية" description="عرض آية أو ذكر أو عبارة تشجيعية بجانب شعار أقساطي" value={showMotivationalTicker} onToggle={() => toggleSetting('show_motivational_ticker', showMotivationalTicker, setShowMotivationalTicker)} icon="✨" />
      </div>

      {/* Account Security Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2">🔐 أمان الحساب</h3>
        <p className="text-slate-400 text-xs mb-4">
          تغيير كلمة المرور للحساب <span dir="ltr" className="text-slate-300">{currentUser?.phone || ''}</span>
        </p>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="block text-sm text-slate-400 mb-2">كلمة المرور الحالية</label>
            <input
              type="password"
              value={passwordForm.current}
              onChange={(event) => setPasswordForm((form) => ({ ...form, current: event.target.value }))}
              autoComplete="current-password"
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="أدخل كلمة المرور الحالية"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">كلمة المرور الجديدة</label>
            <input
              type="password"
              value={passwordForm.next}
              onChange={(event) => setPasswordForm((form) => ({ ...form, next: event.target.value }))}
              autoComplete="new-password"
              minLength={6}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="6 أحرف أو أرقام على الأقل"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-2">تأكيد كلمة المرور الجديدة</label>
            <input
              type="password"
              value={passwordForm.confirm}
              onChange={(event) => setPasswordForm((form) => ({ ...form, confirm: event.target.value }))}
              autoComplete="new-password"
              minLength={6}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="أعد كتابة كلمة المرور الجديدة"
            />
          </div>
          <button
            type="submit"
            disabled={passwordLoading}
            className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {passwordLoading ? 'جاري تغيير كلمة المرور...' : 'حفظ كلمة المرور الجديدة'}
          </button>
          {passwordError && <p className="text-rose-300 text-xs bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{passwordError}</p>}
          {passwordMessage && <p className="text-emerald-300 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">{passwordMessage}</p>}
        </form>

        <div className="mt-6 border-t border-slate-700/60 pt-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h4 className="text-base font-bold text-white">🔒 قفل التطبيق عند الفتح</h4>
              <p className="text-slate-400 text-xs mt-1">اطلب رمز PIN عند فتح التطبيق أو العودة إليه بعد إخفائه.</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold ${appLockEnabled ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-slate-600 bg-slate-900/60 text-slate-400'}`}>
              {appLockEnabled ? 'مفعل' : 'متوقف'}
            </span>
          </div>

          <form onSubmit={handleSaveAppLock} className="space-y-3">
            {appLockEnabled && (
              <div>
                <label className="block text-sm text-slate-400 mb-2">رمز القفل الحالي</label>
                <input
                  type="password"
                  value={appLockCurrentPin}
                  onChange={(event) => setAppLockCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-center tracking-[0.35em] placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors"
                  placeholder="••••"
                  dir="ltr"
                />
              </div>
            )}
            <div>
              <label className="block text-sm text-slate-400 mb-2">{appLockEnabled ? 'رمز القفل الجديد' : 'رمز PIN للقفل'}</label>
              <input
                type="password"
                value={appLockPin}
                onChange={(event) => setAppLockPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={6}
                autoComplete="new-password"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-center tracking-[0.35em] placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors"
                placeholder="4 إلى 6 أرقام"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-2">تأكيد رمز القفل</label>
              <input
                type="password"
                value={appLockConfirm}
                onChange={(event) => setAppLockConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={6}
                autoComplete="new-password"
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white text-center tracking-[0.35em] placeholder-slate-500 focus:border-emerald-500 focus:outline-none transition-colors"
                placeholder="أعد كتابة الرمز"
                dir="ltr"
              />
            </div>
            <button type="submit" disabled={appLockLoading} className="w-full bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-500 transition-colors disabled:opacity-50">
              {appLockLoading ? 'جاري الحفظ...' : appLockEnabled ? 'تغيير رمز القفل' : 'تفعيل قفل التطبيق'}
            </button>
            {appLockEnabled && (
              <button type="button" onClick={handleDisableAppLock} disabled={appLockLoading} className="w-full bg-slate-700 text-slate-200 py-3 rounded-xl font-bold hover:bg-slate-600 transition-colors disabled:opacity-50">
                إيقاف قفل التطبيق
              </button>
            )}
            {appLockError && <p className="text-rose-300 text-xs bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">{appLockError}</p>}
            {appLockMessage && <p className="text-emerald-300 text-xs bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3">{appLockMessage}</p>}
          </form>
        </div>
      </div>

      {/* Business Details Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">بيانات المؤسسة / المستخدم</h3>
        <ToggleItem
          title="إظهار البيانات في الفواتير والكشوفات"
          description="عرض الاسم والجوال والرقم الضريبي في رأس PDF"
          value={showDetailsOnPdf}
          onToggle={() => toggleSetting('show_details_on_pdf', showDetailsOnPdf, setShowDetailsOnPdf)}
          icon="🏷️"
        />

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-2">اسم المؤسسة أو الشخص</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => updateBusinessSetting('business_name', e.target.value, setBusinessName)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
                placeholder="مثال: مؤسسة أقساطي للتقسيط"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">رقم الجوال</label>
            <input
              type="tel"
              value={businessContact}
              onChange={(e) => updateBusinessSetting('business_contact', e.target.value, setBusinessContact)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="مثال: 05xxxxxxxx"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-2">الرقم الضريبي</label>
            <input
              type="text"
              value={taxNumber}
              onChange={(e) => updateBusinessSetting('tax_number', e.target.value, setTaxNumber)}
              className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors"
              placeholder="مثال: 300000000000003"
              dir="ltr"
            />
          </div>

           <div className="pt-4 border-t border-slate-700/50 space-y-4">
             <ToggleItem
              title="إظهار الختم في PDF"
              description="إضافة صورة الختم إلى أسفل كل كشف أو إيصال"
              value={pdfStampEnabled}
              onToggle={() => toggleSetting('pdf_stamp_enabled', pdfStampEnabled, setPdfStampEnabled)}
              icon="🔖"
            />

            {pdfStampEnabled && (
              <PdfMarkEditor
                label="الختم"
                image={pdfStampImage}
                text={pdfStampText}
                error={pdfStampError}
                onFileChange={(event) => handlePdfMarkImageChange(event, 'pdf_stamp_image', setPdfStampImage, setPdfStampError)}
                onClear={() => clearPdfMarkImage('pdf_stamp_image', setPdfStampImage, setPdfStampError)}
                onTextChange={(event) => updateBusinessSetting('pdf_stamp_text', event.target.value, setPdfStampText)}
              />
            )}

            <ToggleItem
              title="إظهار التوقيع في PDF"
              description="إضافة صورة التوقيع إلى خانة توقيع الإدارة"
              value={pdfSignatureEnabled}
              onToggle={() => toggleSetting('pdf_signature_enabled', pdfSignatureEnabled, setPdfSignatureEnabled)}
              icon="🖋️"
            />

            {pdfSignatureEnabled && (
              <PdfMarkEditor
                label="التوقيع"
                image={pdfSignatureImage}
                text={pdfSignatureText}
                error={pdfSignatureError}
                onFileChange={(event) => handlePdfMarkImageChange(event, 'pdf_signature_image', setPdfSignatureImage, setPdfSignatureError)}
                onClear={() => clearPdfMarkImage('pdf_signature_image', setPdfSignatureImage, setPdfSignatureError)}
                onTextChange={(event) => updateBusinessSetting('pdf_signature_text', event.target.value, setPdfSignatureText)}
              />
            )}
          </div>
        </div>
      </div>

      {/* Payment Section */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 shadow-sm">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">💳 الدفع والإشعارات</h3>
        <ToggleItem title="نمط السداد السريع" description="الضغطة الواحدة تسدد فوراً" value={quickPaymentMode} onToggle={() => toggleSetting('quick_payment_mode', quickPaymentMode, setQuickPaymentMode)} icon="⚡" />

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <h4 className="text-sm font-bold text-slate-400">رسالة واتساب للأقساط</h4>
          <textarea
            value={whatsappTemplate}
            onChange={(e) => updateWhatsappTemplate(e.target.value)}
            rows={5}
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none transition-colors resize-none leading-6"
            placeholder="اكتب رسالة واتساب الافتراضية"
          />
          <p className="text-xs text-slate-500 leading-5">
            المتغيرات المتاحة: [الاسم] [المبلغ] [التاريخ] [العقد]
          </p>
        </div>

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <h4 className="text-sm font-bold text-slate-400">تنبيهات العملاء المتأخرين والمستحقين اليوم</h4>
          <ToggleItem
            title="تنبيهات الجهاز"
            description="تنبيه بأسماء العملاء المتأخرين أو المستحقين اليوم عند فتح التطبيق"
            value={dueAlertsEnabled}
            onToggle={handleDueAlertsToggle}
            disabled={updatingSetting === 'due_alerts_enabled'}
            icon="🔔"
          />

          <p className="text-[11px] text-slate-500 leading-5">
            زر الجرس 🔔 في أعلى الشاشة الرئيسية يعرض قائمة العملاء المتأخرين والمستحقين اليوم مع مبالغهم وأزرار الواتساب.
          </p>

          {dueAlertsStatus && (
            <p className="text-xs text-slate-400 leading-5 bg-slate-900/70 border border-slate-700 rounded-xl p-3">
              {dueAlertsStatus}
            </p>
          )}
        </div>

        <div className="pt-4 border-t border-slate-700/50 mt-4 space-y-4">
          <h4 className="text-sm font-bold text-slate-400">إعدادات قسم المتعثرين الذكي</h4>
          
          <div className="flex items-center justify-between">
            <p className="text-white text-sm">أيام تأخر السداد</p>
            <input
              type="number"
              value={overdueThreshold}
              onChange={async (e) => {
                const val = e.target.value;
                setOverdueThreshold(val);
                await settingsService.set('overdue_threshold_days', val.toString());
                onSettingsChange?.();
              }}
              className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-center outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-white text-sm">أيام الركود (Stagnancy)</p>
            <input
              type="number"
              value={stagnancyThreshold}
              onChange={async (e) => {
                const val = e.target.value;
                setStagnancyThreshold(val);
                await settingsService.set('stagnancy_threshold_days', val.toString());
                onSettingsChange?.();
              }}
              className="w-20 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-center outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="text-center text-slate-500 text-sm pt-4">
         <p>نظام أقساطي - مزامنة سحابية آمنة ومشفرة</p>
      </div>

      {/* ── نافذة اختيار نسخة Google Drive للاسترجاع ── */}
      {showDriveRestoreModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 modal-safe-area" dir="rtl">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">📥</span>
                <h3 className="text-base font-bold text-white">النسخ في Google Drive</h3>
              </div>
              <button
                onClick={() => {
                  setShowDriveRestoreModal(false);
                  setSelectedBackupForRestore(null);
                }}
                className="w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 grid place-items-center"
              >
                ✕
              </button>
            </div>

            <p className="text-slate-400 text-xs py-3 leading-5">
              اختر النسخة التي تود استعادتها لاستبدال البيانات الحالية:
            </p>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar max-h-64 my-1">
              {driveBackups.map((item) => (
                <div
                  key={item.id}
                  className="p-3 bg-slate-800/80 hover:bg-slate-800 border border-slate-700 rounded-xl transition-all flex items-center justify-between gap-3"
                >
                  <div className="overflow-hidden">
                    <p className="text-sm font-bold text-white mb-0.5">
                      {formatDate(item.createdTime || item.modifiedTime)}
                    </p>
                    <p className="text-xs text-slate-400 truncate font-mono" dir="ltr">
                      {item.name} {item.size ? `(${formatFileSize(Number(item.size))})` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBackupForRestore(item)}
                    disabled={driveLoading === 'restore'}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold shrink-0 shadow transition-all active:scale-95"
                  >
                    استرجاع
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowDriveRestoreModal(false);
                  setSelectedBackupForRestore(null);
                }}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── نافذة تأكيد الاسترجاع ── */}
      {selectedBackupForRestore && (
        <div className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4 modal-safe-area" dir="rtl">
          <div className="bg-slate-900 border border-rose-500/30 rounded-2xl w-full max-w-sm p-5 shadow-2xl">
            <h4 className="text-base font-bold text-rose-300 mb-2 flex items-center gap-2">
              <span>⚠️</span> تأكيد استرجاع النسخة
            </h4>
            <p className="text-slate-300 text-xs leading-6 mb-4">
              سيتم استبدال البيانات الحالية على هذا الجهاز ببيانات النسخة المحددة:
              <br />
              <span className="text-white font-bold block mt-1">
                تاريخ: {formatDate(selectedBackupForRestore.createdTime || selectedBackupForRestore.modifiedTime)}
              </span>
            </p>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedBackupForRestore(null)}
                disabled={driveLoading === 'restore'}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => handleConfirmRestore(selectedBackupForRestore)}
                disabled={driveLoading === 'restore'}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow transition-all"
              >
                {driveLoading === 'restore' ? 'جاري الاستعادة...' : 'تأكيد الاسترجاع'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;

      
