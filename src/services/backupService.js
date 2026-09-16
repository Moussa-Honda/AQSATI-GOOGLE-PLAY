import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { getDatabase, persistWebStore } from './database.js';

export const BACKUP_FILE_NAME = 'أقساطي_Backup.json';

export const LEGACY_BACKUP_FILE_NAMES = [
  'Aqsati_Main_Backup.json',
  'Fazatak_Main_Backup.json',
  'أقساطي_Main_Backup.json'
];

const BACKUP_DIRECTORY = Directory.Documents;
const BACKUP_VERSION = '2.0-offline';

/**
 * الجداول التجارية المشتركة في نظام النسخ الاحتياطي
 * ملاحظة أمنية ومعمارية: تم استبعاد جدول app_users تماماً من Business Backup
 * لحماية كلمات المرور ورموز الـ PIN المحلية ومنع كسر تسجيل الدخول المحلي عند استيراد نسخ Online.
 */
export const BUSINESS_TABLES = [
  { name: 'settings', orderBy: 'key' },
  { name: 'managers', orderBy: 'id' },
  { name: 'customers', orderBy: 'id' },
  { name: 'contracts', orderBy: 'id' },
  { name: 'installments', orderBy: 'id' },
  { name: 'expenses', orderBy: 'id' },
  { name: 'portfolios', orderBy: 'id' },
  { name: 'portfolio_expenses', orderBy: 'id' },
  { name: 'customer_month_statuses', orderBy: 'id' },
  { name: 'installment_postponements', orderBy: 'id' }
];

export const TABLES = BUSINESS_TABLES;

export const LEGACY_TABLE_ALIASES = {
  payments: 'installments',
  custody: 'portfolios',
  custody_expenses: 'portfolio_expenses'
};

/**
 * إعدادات الجهاز والعتاد الحساسة (Hardware & Local Device Settings):
 * تخص هذا الجهاز الفيزيائي فقط، ولا يجوز استبدالها بإعدادات قادمة من جهاز أو مستخدم آخر.
 */
export const HARDWARE_DEVICE_KEYS = new Set([
  'biometric_enabled',
  'screen_privacy',
  'privacy_mode',
  'due_alerts_enabled',
  'recycle_bin_enabled',
  'device_id',
  'license_key'
]);

/**
 * أصول الصور الرقمية (Stamp & Signature):
 * يتم تحديثها إذا كانت النسخة القادمة تحتوي على صورة فعلية، وتُحفظ الصورة المحلية إذا كانت النسخة فارغة.
 */
export const IMAGE_SETTING_KEYS = new Set([
  'pdf_stamp_image',
  'pdf_signature_image'
]);

export const DEVICE_SETTINGS_KEYS = new Set([
  ...HARDWARE_DEVICE_KEYS,
  ...IMAGE_SETTING_KEYS
]);

const quoteIdentifier = (identifier) => `"${identifier.replace(/"/g, '""')}"`;

const getErrorMessage = (error) => error?.message || String(error);

const getBackupFileOptions = (fileName = BACKUP_FILE_NAME) => ({
  path: fileName,
  directory: BACKUP_DIRECTORY
});

/**
 * تسوية أسماء الجداول القديمة وعزل app_users
 */
export const normalizeBackupTables = (tables = {}) => {
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    return {};
  }

  const normalized = { ...tables };

  // عزل تام لجدول app_users: لا يتم استيراده من أي ملف backup
  delete normalized.app_users;

  for (const [legacyName, currentName] of Object.entries(LEGACY_TABLE_ALIASES)) {
    if (normalized[currentName] === undefined && Array.isArray(normalized[legacyName])) {
      normalized[currentName] = normalized[legacyName];
    }
  }

  return normalized;
};

export const parseSqlDefault = (rawDefault) => {
  if (rawDefault === null || rawDefault === undefined) return null;
  const str = String(rawDefault).trim();
  if (/^'(.*)'$/s.test(str)) {
    return str.slice(1, -1).replace(/''/g, "'");
  }
  if (/^"(.*)"$/s.test(str)) {
    return str.slice(1, -1).replace(/""/g, '"');
  }
  if (str.toUpperCase() === 'CURRENT_TIMESTAMP') {
    return new Date().toISOString();
  }
  if (str.toUpperCase() === 'CURRENT_DATE') {
    return new Date().toISOString().split('T')[0];
  }
  if (str.toUpperCase() === 'CURRENT_TIME') {
    return new Date().toISOString().split('T')[1].split('.')[0];
  }
  if (str.toUpperCase() === 'NULL') {
    return null;
  }
  if (!isNaN(Number(str))) {
    return Number(str);
  }
  return str;
};

export const getTableMetadata = async (db, tableName) => {
  const result = await db.query(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  const columns = {};
  for (const col of (result.values || [])) {
    columns[col.name] = {
      name: col.name,
      type: (col.type || '').toUpperCase(),
      notnull: Boolean(col.notnull),
      defaultValue: col.dflt_value,
      hasDefault: col.dflt_value !== null && col.dflt_value !== undefined,
      pk: Boolean(col.pk)
    };
  }
  return columns;
};

export const resolveRowForDatabase = (rawRow, tableMeta, tableName) => {
  const insertData = {};
  const allowedColumns = Object.keys(tableMeta);

  for (const colName of allowedColumns) {
    const colMeta = tableMeta[colName];
    const val = rawRow[colName];

    if (val !== undefined && val !== null) {
      // 1. القيمة موجودة وغير فارغة في النسخة: تُحفظ كما هي 100%
      insertData[colName] = val;
    } else if (val === null) {
      // 2. القيمة موجودة صراحةً ولكنها NULL (Explicit NULL)
      if (!colMeta.notnull) {
        // العمود يسمح بـ NULL: نحترم قيمة NULL تماماً ولا نستبدلها بالـ Default
        insertData[colName] = null;
      } else {
        // العمود NOT NULL والقيمة صراحةً NULL
        if (tableName === 'portfolio_expenses' && colName === 'entry_type') {
          // سلوك مثبت من كود المشروع: نوع القيد يستقر على 'expense'
          insertData[colName] = 'expense';
        } else {
          throw new Error(`الحقل ${colName} في جدول ${tableName} إلزامي (NOT NULL) ولا يمكن أن يحتوي على قيمة فارغة (NULL)`);
        }
      }
    } else {
      // 3. العمود مفقود تماماً من النسخة القديمة (Missing Old Field -> Compatibility Case)
      if (colMeta.hasDefault) {
        // استخدام القيمة الافتراضية المحددة في SQLite PRAGMA table_info
        insertData[colName] = parseSqlDefault(colMeta.defaultValue);
      } else if (!colMeta.notnull) {
        // عمود يقبل NULL وليس له default
        insertData[colName] = null;
      } else {
        // عمود NOT NULL بدون DEFAULT مفقود من النسخة: الرفض الآمن مع Rollback
        throw new Error(`العمود ${colName} في جدول ${tableName} إلزامي (NOT NULL) بدون قيمة افتراضية، ومفقود من النسخة الاحتياطية`);
      }
    }
  }

  return insertData;
};

const getTableColumns = async (db, tableName) => {
  const result = await db.query(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  return (result.values || []).map((column) => column.name);
};

const getRowCount = async (db, tableName) => {
  const result = await db.query(`SELECT COUNT(*) as count FROM ${quoteIdentifier(tableName)}`);
  return Number(result.values?.[0]?.count || 0);
};

const getBackupRowsCount = (tables = {}) => {
  return BUSINESS_TABLES.reduce((total, table) => total + (tables[table.name]?.length || 0), 0);
};

/**
 * فحص ما قبل الاستعادة (Preflight Validation)
 * يتحقق بدقة من:
 * 1. بنية الـ JSON وصحته
 * 2. وجود جداول أعمال معروفة
 * 3. صحة الصفوف والأعمدة والمفاتيح الأساسية
 * 4. تكامل العلاقات والـ Foreign Keys
 * ممنوع لمس قاعدة البيانات إذا فشل هذا الفحص.
 */
export const preflightValidateBackup = (backupInput) => {
  let backup = backupInput;
  if (typeof backup === 'string') {
    try {
      backup = JSON.parse(backupInput);
    } catch (e) {
      throw new Error('ملف النسخة الاحتياطية ليس ملف JSON صالحاً', { cause: e });
    }
  }

  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('ملف النسخة تالف أو غير صالح (ليس كائناً صحيحاً)');
  }

  const rawTables = backup.tables && typeof backup.tables === 'object' && !Array.isArray(backup.tables)
    ? backup.tables
    : backup;

  const normalizedTables = normalizeBackupTables(rawTables);

  const includedTables = BUSINESS_TABLES.filter((table) => Array.isArray(normalizedTables[table.name]));
  if (includedTables.length === 0) {
    throw new Error('ملف النسخة لا يحتوي على أي جداول أعمال صالحة ومعروفة للاستعادة');
  }

  // التحقق من صحة الصفوف والمفاتيح الأساسية (Primary Keys)
  for (const table of includedTables) {
    const rows = normalizedTables[table.name];
    const seenPks = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`الصف رقم ${i + 1} في جدول ${table.name} غير صالح`);
      }

      if (table.name === 'settings') {
        const key = row.key != null ? String(row.key).trim() : '';
        if (!key) {
          throw new Error('يوجد سجل بدون مفتاح صالح في جدول الإعدادات');
        }
      } else {
        const id = row.id != null ? Number(row.id) : null;
        if (id == null || isNaN(id) || !Number.isInteger(id) || id <= 0) {
          throw new Error(`الصف رقم ${i + 1} في جدول ${table.name} يحتوي على معرّف ID غير صالح (${row.id})`);
        }
        if (seenPks.has(id)) {
          throw new Error(`معرّف مكرر (${id}) في جدول ${table.name}`);
        }
        seenPks.add(id);
      }
    }
  }

  // التحقق من تكامل العلاقات (Foreign Keys & Relations Integrity)
  const customerIds = new Set((normalizedTables.customers || []).map((r) => Number(r.id)));
  const contractIds = new Set((normalizedTables.contracts || []).map((r) => Number(r.id)));
  const installmentIds = new Set((normalizedTables.installments || []).map((r) => Number(r.id)));
  const portfolioIds = new Set((normalizedTables.portfolios || []).map((r) => Number(r.id)));

  if (normalizedTables.contracts) {
    for (const contract of normalizedTables.contracts) {
      if (contract.customer_id == null) {
        throw new Error(`العقد رقم ${contract.id} لا يحتوي على معرف عميل (customer_id) مطلوب`);
      }
      if (normalizedTables.customers && !customerIds.has(Number(contract.customer_id))) {
        throw new Error(`العقد رقم ${contract.id} يشير إلى عميل غير موجود برقم (${contract.customer_id})`);
      }
    }
  }

  if (normalizedTables.installments) {
    for (const inst of normalizedTables.installments) {
      if (inst.contract_id == null) {
        throw new Error(`القسط رقم ${inst.id} لا يحتوي على معرف عقد (contract_id) مطلوب`);
      }
      if (normalizedTables.contracts && !contractIds.has(Number(inst.contract_id))) {
        throw new Error(`القسط رقم ${inst.id} يشير إلى عقد غير موجود برقم (${inst.contract_id})`);
      }
    }
  }

  if (normalizedTables.customer_month_statuses) {
    const seenMonthPairs = new Set();
    for (const cms of normalizedTables.customer_month_statuses) {
      if (cms.customer_id == null) {
        throw new Error(`سجل حالة الشهر رقم ${cms.id} لا يحتوي على معرف عميل (customer_id) مطلوب`);
      }
      if (normalizedTables.customers && !customerIds.has(Number(cms.customer_id))) {
        throw new Error(`سجل حالة الشهر رقم ${cms.id} يشير إلى عميل غير موجود (${cms.customer_id})`);
      }
      const pairKey = `${cms.customer_id}_${cms.month_key}`;
      if (seenMonthPairs.has(pairKey)) {
        throw new Error(`تكرار حالة الشهر لنفس العميل (${pairKey}) في جدول customer_month_statuses`);
      }
      seenMonthPairs.add(pairKey);
    }
  }

  if (normalizedTables.portfolio_expenses) {
    for (const pe of normalizedTables.portfolio_expenses) {
      if (pe.portfolio_id == null) {
        throw new Error(`مصروف المحفظة رقم ${pe.id} لا يحتوي على معرف محفظة (portfolio_id) مطلوب`);
      }
      if (normalizedTables.portfolios && !portfolioIds.has(Number(pe.portfolio_id))) {
        throw new Error(`مصروف المحفظة رقم ${pe.id} يشير إلى محفظة غير موجودة (${pe.portfolio_id})`);
      }
    }
  }

  if (normalizedTables.installment_postponements) {
    for (const postp of normalizedTables.installment_postponements) {
      if (postp.installment_id == null) {
        throw new Error(`طلب التأجيل رقم ${postp.id} لا يحتوي على معرف قسط (installment_id) مطلوب`);
      }
      if (normalizedTables.installments && !installmentIds.has(Number(postp.installment_id))) {
        throw new Error(`طلب التأجيل رقم ${postp.id} يشير إلى قسط غير موجود (${postp.installment_id})`);
      }
      if (postp.contract_id == null) {
        throw new Error(`طلب التأجيل رقم ${postp.id} لا يحتوي على معرف عقد (contract_id) مطلوب`);
      }
      if (normalizedTables.contracts && !contractIds.has(Number(postp.contract_id))) {
        throw new Error(`طلب التأجيل رقم ${postp.id} يشير إلى عقد غير موجود (${postp.contract_id})`);
      }
    }
  }

  return {
    ...backup,
    app: backup.app || 'fazatak',
    version: backup.version || '2.0-offline',
    tables: normalizedTables
  };
};

export const assertBackupShape = preflightValidateBackup;

const parseBackupText = (text) => {
  return preflightValidateBackup(text);
};

export const computeChecksum = async (dataString) => {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(String(dataString));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'none';
  }
};

export const inspectBackup = async (backupInput) => {
  const backup = preflightValidateBackup(backupInput);
  const tables = backup.tables;
  return {
    app: backup.app || 'fazatak',
    version: backup.version || '2.0-offline',
    exportedAt: backup.exportedAt || null,
    totalRecords: getBusinessRecordsCount(backup),
    tables: {
      customers: tables.customers?.length || 0,
      contracts: tables.contracts?.length || 0,
      installments: tables.installments?.length || 0,
      expenses: tables.expenses?.length || 0,
      managers: tables.managers?.length || 0,
      portfolios: tables.portfolios?.length || 0,
      portfolio_expenses: tables.portfolio_expenses?.length || 0,
      customer_month_statuses: tables.customer_month_statuses?.length || 0,
      installment_postponements: tables.installment_postponements?.length || 0,
      settings: tables.settings?.length || 0
    },
    app_users_protected: true
  };
};

export const exportData = async () => {
  const db = await getDatabase();
  const tables = {};
  const counts = {};

  for (const table of BUSINESS_TABLES) {
    try {
      const tableName = quoteIdentifier(table.name);
      const orderBy = quoteIdentifier(table.orderBy);
      const result = await db.query(`SELECT * FROM ${tableName} ORDER BY ${orderBy}`);
      tables[table.name] = result.values || [];
      counts[table.name] = tables[table.name].length;
    } catch (error) {
      console.warn(`Skipping table ${table.name}:`, getErrorMessage(error));
      tables[table.name] = [];
      counts[table.name] = 0;
    }
  }

  const payload = {
    app: 'aqsati',
    version: BACKUP_VERSION,
    fileName: BACKUP_FILE_NAME,
    exportedAt: new Date().toISOString(),
    counts,
    tables
  };

  const rawString = JSON.stringify(payload);
  payload.checksum = await computeChecksum(rawString);

  return payload;
};

const readLocalBackupText = async () => {
  if (!Capacitor.isNativePlatform()) {
    const cached = localStorage.getItem('aqsati_web_backup_cache') || localStorage.getItem('fazatak_web_backup_cache');
    if (!cached) throw new Error('لا توجد نسخة احتياطية محفوظة محلياً');
    return cached;
  }

  // 1. محاولة قراءة الاسم الأساسي الجديد أولاً (أقساطي_Backup.json)
  try {
    const file = await Filesystem.readFile({
      ...getBackupFileOptions(BACKUP_FILE_NAME),
      encoding: Encoding.UTF8
    });
    return file.data;
  } catch (err) {
    // 2. المحاولة مع الأسماء القديمة للتوافق الكامل
    for (const legacyName of LEGACY_BACKUP_FILE_NAMES) {
      try {
        const file = await Filesystem.readFile({
          ...getBackupFileOptions(legacyName),
          encoding: Encoding.UTF8
        });
        return file.data;
      } catch {}
    }
    throw err;
  }
};

const verifySavedBackup = (sourceBackup, savedBackup) => {
  for (const table of BUSINESS_TABLES) {
    const sourceCount = sourceBackup.tables[table.name]?.length || 0;
    const savedCount = savedBackup.tables[table.name]?.length || 0;

    if (sourceCount !== savedCount) {
      throw new Error(`فشل التحقق من جدول ${table.name}`);
    }
  }
};

const writeLocalBackup = async (backup) => {
  const jsonString = JSON.stringify(backup, null, 2);

  if (!Capacitor.isNativePlatform()) {
    localStorage.setItem('aqsati_web_backup_cache', jsonString);
    const savedBackup = parseBackupText(jsonString);
    verifySavedBackup(backup, savedBackup);
    return { size: jsonString.length, mtime: Date.now() };
  }

  try {
    await Filesystem.requestPermissions();
  } catch {
    // Some platforms do not need explicit storage permission.
  }

  await Filesystem.writeFile({
    ...getBackupFileOptions(),
    data: jsonString,
    encoding: Encoding.UTF8,
    recursive: true
  });

  const savedBackup = parseBackupText(await readLocalBackupText());
  verifySavedBackup(backup, savedBackup);

  return Filesystem.stat(getBackupFileOptions());
};

const readCurrentSettingsMap = async (db) => {
  try {
    const res = await db.query('SELECT key, value FROM settings');
    const map = new Map();
    for (const r of (res.values || [])) {
      map.set(r.key, r.value);
    }
    return map;
  } catch {
    return new Map();
  }
};

const createSafetySnapshot = async (db) => {
  const snapshotTables = {};
  for (const table of BUSINESS_TABLES) {
    try {
      const res = await db.query(`SELECT * FROM ${quoteIdentifier(table.name)}`);
      snapshotTables[table.name] = res.values || [];
    } catch {
      snapshotTables[table.name] = [];
    }
  }
  const snapshot = {
    created_at: new Date().toISOString(),
    tables: snapshotTables
  };
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('aqsati_pre_restore_safety_backup', JSON.stringify(snapshot));
    } catch {}
  }
  return snapshot;
};

/**
 * استيراد البيانات الذرية المتوافقة بالكامل مع Online Backup
 * @param {Object|string} backup - كائن النسخة الاحتياطية أو نص JSON
 * @param {Function} [onProgress] - دالة تتبع المراحل
 */
export const importData = async (backup, onProgress = () => {}) => {
  // المرحلة 1: التحقق القبلي الصارم (Preflight Validation) قبل أي تعديل على قاعدة البيانات
  onProgress('validating');
  const validBackup = preflightValidateBackup(backup);
  const db = await getDatabase();
  const tableColumns = {};
  const importedTables = BUSINESS_TABLES.filter((table) => Array.isArray(validBackup.tables[table.name]));
  let transactionStarted = false;

  // المرحلة 2: إنشاء نسخة أمان احتياطية قبل بدء المعاملة
  onProgress('snapshot');
  await createSafetySnapshot(db);

  try {
    const tableMetadata = {};
    for (const table of importedTables) {
      tableMetadata[table.name] = await getTableMetadata(db, table.name);
    }

    // قراءة الإعدادات الحالية لدمجها والحفاظ على المفاتيح الخاصة بالجهاز والـ PDF
    const currentSettings = await readCurrentSettingsMap(db);

    // المرحلة 3: بدء المعاملة الذرية
    onProgress('restoring');
    await db.beginTransaction();
    transactionStarted = true;

    // حذف البيانات بترتيب التبعيات العكسي (Reverse Dependency Order)
    // لا نحذف settings بالكامل حتى لا نفقد إعدادات الجهاز الحساسة
    const tablesToDelete = [...importedTables].reverse().filter((t) => t.name !== 'settings');
    for (const table of tablesToDelete) {
      await db.run(`DELETE FROM ${quoteIdentifier(table.name)}`, [], false);
    }

    // إدراج البيانات بترتيب التبعيات الصحيح (Forward Dependency Order)
    for (const table of importedTables) {
      if (table.name === 'settings') {
        // سياسة دمج إعدادات الأعمال مع الحفاظ على إعدادات الجهاز
        const incomingSettings = validBackup.tables.settings || [];
        const mergedSettings = new Map(currentSettings);

        for (const item of incomingSettings) {
          const key = item.key;
          const val = item.value;

          if (HARDWARE_DEVICE_KEYS.has(key)) {
            // مفاتيح الجهاز والعتاد الحساسة: إذا كانت موجودة محلياً نحتفظ بها تماماً، وإذا لم تكن موجودة محلياً نأخذها من النسخة
            if (!currentSettings.has(key)) {
              mergedSettings.set(key, val ?? '');
            }
          } else if (IMAGE_SETTING_KEYS.has(key)) {
            // أختام وتواقيع الـ PDF: إذا كانت النسخة تحتوي على صورة حقيقية نحدثها، وإلا نبقي الصورة المحلية الحالية
            if (val != null && String(val).trim().length > 0) {
              mergedSettings.set(key, val);
            }
          } else {
            // إعدادات الأعمال: يتم الاستبدال مباشرة بالقيمة القادمة من Online
            mergedSettings.set(key, val ?? '');
          }
        }

        for (const [key, value] of mergedSettings.entries()) {
          await db.run(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [key, value],
            false
          );
        }
        continue;
      }

      const rows = validBackup.tables[table.name];
      const tableMeta = tableMetadata[table.name];

      for (const rawRow of rows) {
        // معالجة الحقول ديناميكياً بدقة بحسب معايير الـ SQLite PRAGMA table_info
        const insertData = resolveRowForDatabase(rawRow, tableMeta, table.name);
        const columns = Object.keys(insertData);

        if (columns.length === 0) {
          throw new Error(`لا توجد أعمدة صالحة للاستيراد في جدول ${table.name}`);
        }

        const placeholders = columns.map(() => '?').join(',');
        const columnList = columns.map(quoteIdentifier).join(',');
        const values = columns.map((column) => insertData[column]);

        await db.run(
          `INSERT INTO ${quoteIdentifier(table.name)} (${columnList}) VALUES (${placeholders})`,
          values,
          false
        );
      }

      // ضبط عداد الـ AUTOINCREMENT بطريقة آمنة لتجنب أي تعارض في المعرفات اللاحقة
      try {
        await db.run('DELETE FROM sqlite_sequence WHERE name = ?', [table.name], false);
        await db.run(
          `INSERT INTO sqlite_sequence (name, seq) SELECT ?, COALESCE(MAX(id), 0) FROM ${quoteIdentifier(table.name)}`,
          [table.name],
          false
        );
      } catch {
        // جدول sqlite_sequence يتم إنشاؤه تلقائياً عند أول إدراج
      }
    }

    // المرحلة 4: التحقق البعدي الدقيق لمطابقة عدد السجلات
    onProgress('verifying');
    for (const table of importedTables) {
      if (table.name === 'settings') continue;
      const expectedCount = validBackup.tables[table.name].length;
      const actualCount = await getRowCount(db, table.name);

      if (actualCount !== expectedCount) {
        throw new Error(`فشل التحقق بعد الاستيراد لجدول ${table.name}: المتوقع ${expectedCount} والفعلي ${actualCount}`);
      }
    }

    await db.commitTransaction();
    transactionStarted = false;

    if (persistWebStore) {
      await persistWebStore().catch(() => {});
    }

    onProgress('completed');

    return {
      tablesCount: importedTables.length,
      recordsCount: getBackupRowsCount(validBackup.tables),
      exportedAt: validBackup.exportedAt
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await db.rollbackTransaction();
      } catch (rollbackError) {
        console.warn('Rollback failed:', getErrorMessage(rollbackError));
      }
    }

    console.error('Data import error:', error);
    throw new Error('فشل استيراد البيانات: ' + getErrorMessage(error), { cause: error });
  }
};

const downloadBackupInBrowser = async () => {
  if (typeof document === 'undefined') return false;

  const backup = await exportData();
  const backupText = JSON.stringify(backup, null, 2);
  const blob = new Blob([backupText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = BACKUP_FILE_NAME;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return true;
};

export const createBackup = async () => {
  try {
    const backup = await exportData();
    const stat = await writeLocalBackup(backup);

    return {
      success: true,
      fileName: BACKUP_FILE_NAME,
      size: stat.size || JSON.stringify(backup).length,
      tablesCount: BUSINESS_TABLES.length,
      recordsCount: getBackupRowsCount(backup.tables),
      exportedAt: backup.exportedAt,
      updatedAt: stat.mtime ? new Date(stat.mtime).toISOString() : backup.exportedAt
    };
  } catch (error) {
    console.error('Backup creation error:', error);
    throw new Error('فشل إنشاء النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const shareBackup = async () => {
  try {
    const backup = await createBackup();

    if (!Capacitor.isNativePlatform()) {
      const jsonString = JSON.stringify(backup, null, 2);
      const file = new File([jsonString], BACKUP_FILE_NAME, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            title: BACKUP_FILE_NAME,
            text: 'نسخة احتياطية من بيانات أقساطي',
            files: [file]
          });
          return {
            ...backup,
            shared: true
          };
        } catch (err) {
          if (err.name === 'AbortError') return { ...backup, shared: true };
        }
      }

      const downloaded = await downloadBackupInBrowser();
      return {
        ...backup,
        shared: false,
        downloaded: Boolean(downloaded)
      };
    }

    const { uri } = await Filesystem.getUri(getBackupFileOptions());
    const canShare = await Share.canShare().catch(() => ({ value: false }));

    if (!canShare.value) {
      const downloaded = await downloadBackupInBrowser();
      if (!downloaded) throw new Error('المشاركة غير مدعومة على هذا الجهاز');

      return {
        ...backup,
        shared: false,
        downloaded: true
      };
    }

    await Share.share({
      title: BACKUP_FILE_NAME,
      text: 'نسخة احتياطية من بيانات أقساطي',
      url: uri,
      files: [uri],
      dialogTitle: 'مشاركة النسخة الاحتياطية'
    });

    return {
      ...backup,
      shared: true
    };
  } catch (error) {
    console.error('Backup share error:', error);
    throw new Error('فشل مشاركة النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const restoreBackup = async (onProgress) => {
  try {
    return {
      success: true,
      ...(await importData(parseBackupText(await readLocalBackupText()), onProgress))
    };
  } catch (error) {
    console.error('Backup restore error:', error);
    throw new Error('فشل الاستعادة: ' + getErrorMessage(error), { cause: error });
  }
};

export const restoreBackupFromText = async (text, onProgress) => {
  try {
    return {
      success: true,
      ...(await importData(parseBackupText(text), onProgress))
    };
  } catch (error) {
    console.error('Backup file restore error:', error);
    throw new Error('فشل استيراد ملف النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const deleteBackup = async () => {
  try {
    const candidateNames = [BACKUP_FILE_NAME, ...LEGACY_BACKUP_FILE_NAMES];
    for (const name of candidateNames) {
      try {
        await Filesystem.deleteFile(getBackupFileOptions(name));
      } catch {}
    }
    if (!Capacitor.isNativePlatform()) {
      localStorage.removeItem('aqsati_web_backup_cache');
      localStorage.removeItem('fazatak_web_backup_cache');
    }
    return { success: true };
  } catch (error) {
    const message = getErrorMessage(error).toLowerCase();
    if (message.includes('exist') || message.includes('not found')) {
      return { success: true };
    }

    console.error('Backup delete error:', error);
    throw new Error('فشل حذف النسخة: ' + getErrorMessage(error), { cause: error });
  }
};

export const checkBackupExists = async () => {
  try {
    if (!Capacitor.isNativePlatform()) {
      const raw = localStorage.getItem('aqsati_web_backup_cache') || localStorage.getItem('fazatak_web_backup_cache');
      if (!raw) return null;
      const backup = parseBackupText(raw);

      return {
        name: BACKUP_FILE_NAME,
        size: raw.length,
        createdAt: backup.exportedAt,
        updatedAt: backup.exportedAt,
        exportedAt: backup.exportedAt,
        tablesCount: BUSINESS_TABLES.filter((table) => Array.isArray(backup.tables[table.name])).length,
        recordsCount: getBackupRowsCount(backup.tables)
      };
    }

    const candidateNames = [BACKUP_FILE_NAME, ...LEGACY_BACKUP_FILE_NAMES];
    for (const name of candidateNames) {
      try {
        const stat = await Filesystem.stat(getBackupFileOptions(name));
        const file = await Filesystem.readFile({
          ...getBackupFileOptions(name),
          encoding: Encoding.UTF8
        });
        const backup = parseBackupText(file.data);

        return {
          name,
          size: stat.size || JSON.stringify(backup).length,
          createdAt: stat.ctime ? new Date(stat.ctime).toISOString() : backup.exportedAt,
          updatedAt: stat.mtime ? new Date(stat.mtime).toISOString() : backup.exportedAt,
          exportedAt: backup.exportedAt,
          tablesCount: BUSINESS_TABLES.filter((table) => Array.isArray(backup.tables[table.name])).length,
          recordsCount: getBackupRowsCount(backup.tables),
          uri: stat.uri
        };
      } catch {
        // فحص الملف التالي من المرشحين
      }
    }
    return null;
  } catch (error) {
    console.warn('No readable local backup:', getErrorMessage(error));
    return null;
  }
};

export const formatFileSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const formatDate = (date) => {
  if (!date) return 'غير متوفر';
  return new Date(date).toLocaleString('ar-SA');
};

export const getBusinessRecordsCount = (backupOrPayload) => {
  if (!backupOrPayload) return 0;
  const counts = backupOrPayload.counts || {};
  const tables = backupOrPayload.tables || {};

  const getCount = (name) => {
    if (counts[name] !== undefined) return Number(counts[name]) || 0;
    if (Array.isArray(tables[name])) return tables[name].length;
    return 0;
  };

  return (
    getCount('managers') +
    getCount('customers') +
    getCount('contracts') +
    getCount('installments') +
    getCount('expenses') +
    getCount('portfolios') +
    getCount('portfolio_expenses') +
    getCount('customer_month_statuses') +
    getCount('installment_postponements')
  );
};
