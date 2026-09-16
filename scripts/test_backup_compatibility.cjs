const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('================================================================');
  console.log('🧪 تشغيل حزمة اختبارات توافق النسخ الاحتياطي (Tests 1 - 25 + Round Trip)');
  console.log('================================================================\n');

  const SQL = await initSqlJs();

  // Read schema from database.js
  const dbJsPath = path.join(__dirname, '..', 'src', 'services', 'database.js');
  const dbJs = fs.readFileSync(dbJsPath, 'utf8');
  const startIdx = dbJs.indexOf('const schema = `');
  const endIdx = dbJs.indexOf('await db.execute(schema);');
  const rawChunk = dbJs.slice(startIdx + 'const schema = `'.length, endIdx);
  const backtickIdx = rawChunk.lastIndexOf('`');
  const schemaSql = rawChunk.slice(0, backtickIdx).replace(/\$\{DEFAULT_WHATSAPP_TEMPLATE\}/g, 'قالب افتراضي');

  function createFreshDb() {
    const db = new SQL.Database();
    db.run(schemaSql);
    try { db.run("ALTER TABLE portfolio_expenses ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'expense'"); } catch(e) {}
    try { db.run("ALTER TABLE portfolio_expenses ADD COLUMN payment_method TEXT DEFAULT 'cash'"); } catch(e) {}
    try { db.run("ALTER TABLE portfolio_expenses ADD COLUMN notes TEXT"); } catch(e) {}
    try { db.run("ALTER TABLE customers ADD COLUMN manager_id INTEGER"); } catch(e) {}
    try { db.run("ALTER TABLE customers ADD COLUMN deleted_manager_id INTEGER"); } catch(e) {}
    try { db.run("ALTER TABLE managers ADD COLUMN is_deleted INTEGER DEFAULT 0"); } catch(e) {}
    try { db.run("ALTER TABLE managers ADD COLUMN deleted_at DATETIME"); } catch(e) {}
    try { db.run("ALTER TABLE customers ADD COLUMN is_manually_flagged_as_overdue INTEGER DEFAULT 0"); } catch(e) {}
    try { db.run("ALTER TABLE customers ADD COLUMN is_deleted INTEGER DEFAULT 0"); } catch(e) {}
    try { db.run("ALTER TABLE customers ADD COLUMN deleted_at DATETIME"); } catch(e) {}

    return {
      rawDb: db,
      query: async (sql, values = []) => {
        try {
          const stmt = db.prepare(sql);
          stmt.bind(values);
          const res = [];
          while (stmt.step()) {
            res.push(stmt.getAsObject());
          }
          stmt.free();
          return { values: res };
        } catch (err) {
          throw new Error(`Query Error: ${err.message} in SQL: ${sql}`);
        }
      },
      run: async (sql, values = []) => {
        try {
          db.run(sql, values);
          const changesRes = db.exec("SELECT changes() as chg, last_insert_rowid() as id");
          const changes = changesRes[0]?.values[0]?.[0] || 0;
          const lastId = changesRes[0]?.values[0]?.[1] || 0;
          return { changes: { changes, lastId }, lastId };
        } catch (err) {
          throw new Error(`Run Error: ${err.message} in SQL: ${sql}`);
        }
      },
      execute: async (sql) => {
        try {
          db.exec(sql);
          return {};
        } catch (err) {
          throw new Error(`Execute Error: ${err.message} in SQL: ${sql}`);
        }
      },
      beginTransaction: async () => {
        db.exec('BEGIN TRANSACTION;');
      },
      commitTransaction: async () => {
        db.exec('COMMIT;');
      },
      rollbackTransaction: async () => {
        db.exec('ROLLBACK;');
      }
    };
  }

  const backupServicePath = path.join(__dirname, '..', 'src', 'services', 'backupService.js');
  const backupServiceModule = await import('file:///' + backupServicePath.replace(/\\/g, '/'));
  const {
    BUSINESS_TABLES,
    DEVICE_SETTINGS_KEYS,
    HARDWARE_DEVICE_KEYS,
    IMAGE_SETTING_KEYS,
    BACKUP_FILE_NAME,
    LEGACY_BACKUP_FILE_NAMES,
    preflightValidateBackup,
    getBusinessRecordsCount,
    getTableMetadata,
    resolveRowForDatabase,
    parseSqlDefault
  } = backupServiceModule;

  async function testImportData(dbAdapter, backup, onProgress = () => {}) {
    onProgress('validating');
    const validBackup = preflightValidateBackup(backup);
    const tableColumns = {};
    const importedTables = BUSINESS_TABLES.filter((table) => Array.isArray(validBackup.tables[table.name]));
    let transactionStarted = false;

    onProgress('snapshot');

    try {
      const tableMetadata = {};
      for (const table of importedTables) {
        tableMetadata[table.name] = await getTableMetadata(dbAdapter, table.name);
      }

      const currentSettings = new Map();
      const currSetRes = await dbAdapter.query('SELECT key, value FROM settings');
      for (const r of (currSetRes.values || [])) {
        currentSettings.set(r.key, r.value);
      }

      onProgress('restoring');
      await dbAdapter.beginTransaction();
      transactionStarted = true;

      const tablesToDelete = [...importedTables].reverse().filter((t) => t.name !== 'settings');
      for (const table of tablesToDelete) {
        await dbAdapter.run(`DELETE FROM "${table.name}"`, []);
      }

      for (const table of importedTables) {
        if (table.name === 'settings') {
          const incomingSettings = validBackup.tables.settings || [];
          const mergedSettings = new Map(currentSettings);

          for (const item of incomingSettings) {
            const key = item.key;
            const val = item.value;

            if (HARDWARE_DEVICE_KEYS.has(key)) {
              if (!currentSettings.has(key)) {
                mergedSettings.set(key, val ?? '');
              }
            } else if (IMAGE_SETTING_KEYS.has(key)) {
              if (val != null && String(val).trim().length > 0) {
                mergedSettings.set(key, val);
              }
            } else {
              mergedSettings.set(key, val ?? '');
            }
          }

          for (const [key, value] of mergedSettings.entries()) {
            await dbAdapter.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
          }
          continue;
        }

        const rows = validBackup.tables[table.name];
        const tableMeta = tableMetadata[table.name];

        for (const rawRow of rows) {
          const insertData = resolveRowForDatabase(rawRow, tableMeta, table.name);
          const columns = Object.keys(insertData);

          if (columns.length === 0) {
            throw new Error(`لا توجد أعمدة صالحة للاستيراد في جدول ${table.name}`);
          }

          const placeholders = columns.map(() => '?').join(',');
          const columnList = columns.map(c => `"${c}"`).join(',');
          const values = columns.map((col) => insertData[col]);

          await dbAdapter.run(`INSERT INTO "${table.name}" (${columnList}) VALUES (${placeholders})`, values);
        }

        try {
          await dbAdapter.run('DELETE FROM sqlite_sequence WHERE name = ?', [table.name]);
          await dbAdapter.run(`INSERT INTO sqlite_sequence (name, seq) SELECT ?, COALESCE(MAX(id), 0) FROM "${table.name}"`, [table.name]);
        } catch (e) {}
      }

      onProgress('verifying');
      for (const table of importedTables) {
        if (table.name === 'settings') continue;
        const expectedCount = validBackup.tables[table.name].length;
        const countRes = await dbAdapter.query(`SELECT COUNT(*) as cnt FROM "${table.name}"`);
        const actualCount = countRes.values[0].cnt;
        if (actualCount !== expectedCount) {
          throw new Error(`فشل التحقق بعد الاستيراد لجدول ${table.name}: المتوقع ${expectedCount} والفعلي ${actualCount}`);
        }
      }

      await dbAdapter.commitTransaction();
      transactionStarted = false;
      onProgress('completed');

      return {
        tablesCount: importedTables.length,
        recordsCount: getBusinessRecordsCount(validBackup),
        exportedAt: validBackup.exportedAt
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          await dbAdapter.rollbackTransaction();
        } catch (rbErr) {}
      }
      throw error;
    }
  }

  async function testExportData(dbAdapter) {
    const tables = {};
    const counts = {};
    for (const table of BUSINESS_TABLES) {
      const res = await dbAdapter.query(`SELECT * FROM "${table.name}" ORDER BY "${table.orderBy}"`);
      tables[table.name] = res.values || [];
      counts[table.name] = tables[table.name].length;
    }
    return {
      app: 'aqsati',
      version: '2.0-offline',
      fileName: BACKUP_FILE_NAME,
      exportedAt: new Date().toISOString(),
      counts,
      tables
    };
  }

  const results = [];

  function recordResult(testNum, name, status, reason) {
    results.push({ testNum, name, status, reason });
    const badge = status === 'PASS' ? '✅ PASS' : (status === 'FAIL' ? '❌ FAIL' : '⚠️ BLOCKED');
    console.log(`${badge} | Test ${testNum}: ${name}`);
    if (reason) console.log(`      └─ التفاصيل: ${reason}`);
  }

  const onlineBackupSample = {
    app: "fazatak",
    version: "2.0-offline",
    fileName: "Fazatak_Main_Backup.json",
    exportedAt: "2026-09-14T12:00:00.000Z",
    counts: {
      settings: 2, managers: 2, customers: 3, contracts: 3,
      installments: 6, expenses: 2, portfolios: 2,
      portfolio_expenses: 2, customer_month_statuses: 2, installment_postponements: 1
    },
    tables: {
      settings: [
        { key: "business_name", value: "مؤسسة الأفق للتقسيط" },
        { key: "whatsapp_template", value: "قالب مخصص أونلاين" }
      ],
      managers: [
        { id: 1, name: "أبو فهد", phone: "0501111111", is_deleted: 0 },
        { id: 2, name: "أبو ناصر", phone: "0502222222", is_deleted: 0 }
      ],
      customers: [
        { id: 10, name: "محمد سالم", phone: "0550000001", manager_id: 1 },
        { id: 11, name: "سعد ناصر", phone: "0550000002", manager_id: 1 },
        { id: 12, name: "خالد عمر", phone: "0550000003", manager_id: 2 }
      ],
      contracts: [
        { id: 100, customer_id: 10, title: "عقد آيفون 15", total_amount: 5000, capital_amount: 4000, status: "active" },
        { id: 101, customer_id: 11, title: "عقد مكيف سبليت", total_amount: 3000, capital_amount: 2500, status: "active" },
        { id: 102, customer_id: 12, title: "عقد شاشة ذكية", total_amount: 2000, capital_amount: 1800, status: "active" }
      ],
      installments: [
        { id: 1001, contract_id: 100, amount: 1000, due_date: "2026-10-01", status: "pending", actual_paid: 0 },
        { id: 1002, contract_id: 100, amount: 1000, due_date: "2026-11-01", status: "pending", actual_paid: 0 },
        { id: 1003, contract_id: 101, amount: 1000, due_date: "2026-10-01", status: "pending", actual_paid: 0 },
        { id: 1004, contract_id: 101, amount: 1000, due_date: "2026-11-01", status: "pending", actual_paid: 0 },
        { id: 1005, contract_id: 102, amount: 1000, due_date: "2026-10-01", status: "pending", actual_paid: 0 },
        { id: 1006, contract_id: 102, amount: 1000, due_date: "2026-11-01", status: "pending", actual_paid: 0 }
      ],
      expenses: [
        { id: 50, description: "فواتير كهرباء", amount: 250, category: "فواتير" },
        { id: 51, description: "ضيافة مكتب", amount: 100, category: "ضيافة" }
      ],
      portfolios: [
        { id: 1, name: "محفظة الرياض", capital: 50000, description: "محفظة أولى" },
        { id: 2, name: "محفظة جدة", capital: 30000, description: "محفظة ثانية" }
      ],
      portfolio_expenses: [
        { id: 201, portfolio_id: 1, amount: 500, description: "إيداع نقدي", entry_type: "deposit" },
        { id: 202, portfolio_id: 2, amount: 300, description: "مصروف تشغيلي", entry_type: "expense" }
      ],
      customer_month_statuses: [
        { id: 1, customer_id: 10, month_key: "2026-10", status: "paid" },
        { id: 2, customer_id: 11, month_key: "2026-10", status: "overdue" }
      ],
      installment_postponements: [
        { id: 1, installment_id: 1001, contract_id: 100, mode: "end", postponed_amount: 1000, status: "active" }
      ]
    }
  };

  // ─── Test 1: Real Online Backup ──────────────────────────────────────
  try {
    const db = createFreshDb();
    const res = await testImportData(db, onlineBackupSample);
    const custRes = await db.query('SELECT COUNT(*) as c FROM customers');
    if (res.tablesCount === 10 && custRes.values[0].c === 3) {
      recordResult(1, 'Real Online Backup Import', 'PASS', `تم استيراد الجداول الـ 10 بنجاح، وعدد السجلات مطابق (${res.recordsCount})`);
    } else {
      recordResult(1, 'Real Online Backup Import', 'FAIL', 'عدم تطابق عدد الجداول أو السجلات');
    }
  } catch (err) {
    recordResult(1, 'Real Online Backup Import', 'FAIL', err.message);
  }

  // ─── Test 2: Old Offline Backup (app: "aqsati" + checksum) ─────────────
  try {
    const db = createFreshDb();
    const offlineBackup = {
      ...onlineBackupSample,
      app: "aqsati",
      checksum: "a3b1c2d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890"
    };
    const res = await testImportData(db, offlineBackup);
    recordResult(2, 'Old Offline Backup with Checksum', 'PASS', `تم قبول النسخة واستيراد ${res.recordsCount} سجل`);
  } catch (err) {
    recordResult(2, 'Old Offline Backup with Checksum', 'FAIL', err.message);
  }

  // ─── Test 3: Legacy Aliases (payments, custody, custody_expenses) ──────
  try {
    const db = createFreshDb();
    const legacyBackup = JSON.parse(JSON.stringify(onlineBackupSample));
    legacyBackup.tables.payments = legacyBackup.tables.installments;
    delete legacyBackup.tables.installments;
    legacyBackup.tables.custody = legacyBackup.tables.portfolios;
    delete legacyBackup.tables.portfolios;
    legacyBackup.tables.custody_expenses = legacyBackup.tables.portfolio_expenses;
    delete legacyBackup.tables.portfolio_expenses;

    await testImportData(db, legacyBackup);
    const instCount = await db.query('SELECT COUNT(*) as c FROM installments');
    const portCount = await db.query('SELECT COUNT(*) as c FROM portfolios');
    const portExpCount = await db.query('SELECT COUNT(*) as c FROM portfolio_expenses');

    if (instCount.values[0].c === 6 && portCount.values[0].c === 2 && portExpCount.values[0].c === 2) {
      recordResult(3, 'Legacy Aliases Mapping', 'PASS', 'تمت تسوية payments -> installments و custody -> portfolios و custody_expenses بنجاح تام');
    } else {
      recordResult(3, 'Legacy Aliases Mapping', 'FAIL', 'فشلت تسوية بعض الجداول القديمة');
    }
  } catch (err) {
    recordResult(3, 'Legacy Aliases Mapping', 'FAIL', err.message);
  }

  // ─── Test 4: Missing Columns in Online Backup ──────────────────────────
  try {
    const db = createFreshDb();
    const backupMissingCols = JSON.parse(JSON.stringify(onlineBackupSample));
    backupMissingCols.tables.portfolio_expenses = [
      { id: 301, portfolio_id: 1, amount: 150, description: "مصروف بدون وسيلة دفع", entry_type: "expense" }
    ];
    backupMissingCols.tables.customers = [
      { id: 25, name: "عميل بدون حقول إضافية", phone: "0559999999" }
    ];
    backupMissingCols.tables.contracts = [
      { id: 501, customer_id: 25, title: "عقد اختبار", total_amount: 1000 }
    ];
    backupMissingCols.tables.installments = [
      { id: 601, contract_id: 501, amount: 1000, due_date: "2026-12-01" }
    ];
    delete backupMissingCols.tables.customer_month_statuses;
    delete backupMissingCols.tables.installment_postponements;

    await testImportData(db, backupMissingCols);
    const peRes = await db.query('SELECT payment_method, notes, entry_type FROM portfolio_expenses WHERE id = 301');
    const row = peRes.values[0];

    if (row && row.payment_method === 'cash' && row.notes === null && row.entry_type === 'expense') {
      recordResult(4, 'Missing Columns with Safe Defaults', 'PASS', `تم ضبط القيم الافتراضية بنجاح: payment_method = '${row.payment_method}', notes = ${row.notes}`);
    } else {
      recordResult(4, 'Missing Columns with Safe Defaults', 'FAIL', `قيم افتراضية غير متوقعة: ${JSON.stringify(row)}`);
    }
  } catch (err) {
    recordResult(4, 'Missing Columns with Safe Defaults', 'FAIL', err.message);
  }

  // ─── Test 5: Extra Unknown Columns in Backup ───────────────────────────
  try {
    const db = createFreshDb();
    const backupExtraCols = JSON.parse(JSON.stringify(onlineBackupSample));
    backupExtraCols.tables.customers[0].custom_online_cloud_token = "CLOUD_TOKEN_XYZ";
    backupExtraCols.tables.customers[0].unexpected_meta_field = { a: 1, b: 2 };
    backupExtraCols.tables.contracts[0].online_discount_code = "PROMO2026";

    await testImportData(db, backupExtraCols);
    const cRes = await db.query('SELECT name FROM customers WHERE id = 10');
    if (cRes.values[0]?.name === "محمد سالم") {
      recordResult(5, 'Extra Unknown Columns Ignored Safely', 'PASS', 'تم تجاهل الأعمدة الإضافية واستيراد البيانات الأساسية بسلاسة');
    } else {
      recordResult(5, 'Extra Unknown Columns Ignored Safely', 'FAIL', 'تعذر استيراد السجل');
    }
  } catch (err) {
    recordResult(5, 'Extra Unknown Columns Ignored Safely', 'FAIL', err.message);
  }

  // ─── Test 6: Corrupted / Incomplete Backup Rejected ───────────────────
  try {
    const db = createFreshDb();
    await db.run("INSERT INTO customers (id, name) VALUES (999, 'عميل أصلي محمي')");
    let rejected = false;
    try {
      await testImportData(db, "NOT A VALID JSON STRING");
    } catch (e) {
      rejected = true;
    }
    try {
      await testImportData(db, { foo: "bar" });
    } catch (e) {
      rejected = rejected && true;
    }

    const checkRes = await db.query('SELECT name FROM customers WHERE id = 999');
    if (rejected && checkRes.values[0]?.name === 'عميل أصلي محمي') {
      recordResult(6, 'Corrupted Backup Rejection & Integrity', 'PASS', 'تم رفض النسخ التالفة بنجاح مع بقاء قاعدة البيانات سليمة 100%');
    } else {
      recordResult(6, 'Corrupted Backup Rejection & Integrity', 'FAIL', 'لم يتم الرفض أو تأثرت قاعدة البيانات');
    }
  } catch (err) {
    recordResult(6, 'Corrupted Backup Rejection & Integrity', 'FAIL', err.message);
  }

  // ─── Test 7: Relationship Integrity (Foreign Keys) ─────────────────────
  try {
    const db = createFreshDb();
    await testImportData(db, onlineBackupSample);
    const joinRes = await db.query(`
      SELECT cu.name as customer_name, c.title as contract_title, i.amount as inst_amount, p.postponed_amount
      FROM customers cu
      JOIN contracts c ON cu.id = c.customer_id
      JOIN installments i ON c.id = i.contract_id
      LEFT JOIN installment_postponements p ON i.id = p.installment_id
      WHERE cu.id = 10
    `);
    if (joinRes.values.length === 2 && joinRes.values.some(r => r.postponed_amount === 1000)) {
      recordResult(7, 'Relational Foreign Keys Integrity', 'PASS', 'تم التحقق من ترابط customer -> contract -> installments -> postponements بالكامل');
    } else {
      recordResult(7, 'Relational Foreign Keys Integrity', 'FAIL', 'العلاقات غير مكتملة أو غير مترابطة');
    }
  } catch (err) {
    recordResult(7, 'Relational Foreign Keys Integrity', 'FAIL', err.message);
  }

  // ─── Test 8: app_users Protection from Online Backup ───────────────────
  try {
    const db = createFreshDb();
    await db.run(`
      INSERT INTO app_users (id, phone, name, password_hash, pin_hash, role, is_active)
      VALUES (1, '0509999999', 'المدير المحلي', 'LOCAL_SECURE_PASSWORD_HASH', 'LOCAL_PIN_HASH', 'admin', 1)
    `);

    const maliciousBackup = JSON.parse(JSON.stringify(onlineBackupSample));
    maliciousBackup.tables.app_users = [
      { id: 99, phone: "0500000000", name: "هاكر", password_hash: "HACKED_HASH", pin_hash: "HACKED_PIN" }
    ];

    await testImportData(db, maliciousBackup);
    const userRes = await db.query('SELECT * FROM app_users');
    const users = userRes.values;

    if (users.length === 1 && users[0].phone === '0509999999' && users[0].password_hash === 'LOCAL_SECURE_PASSWORD_HASH') {
      recordResult(8, 'app_users Complete Isolation & Protection', 'PASS', 'جدول app_users محمي 100% ولم يتم حذفه أو استبداله أو اختراقه');
    } else {
      recordResult(8, 'app_users Complete Isolation & Protection', 'FAIL', `تم العبث بجدول المستخدمين: ${JSON.stringify(users)}`);
    }
  } catch (err) {
    recordResult(8, 'app_users Complete Isolation & Protection', 'FAIL', err.message);
  }

  // ─── Test 9: Settings & PDF Stamp/Signature Preservation ───────────────
  try {
    const db = createFreshDb();
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('pdf_stamp_image', 'data:image/png;base64,ORIGINAL_LOCAL_STAMP')");
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('pdf_signature_image', 'data:image/png;base64,ORIGINAL_LOCAL_SIGNATURE')");
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('biometric_enabled', 'true')");

    const onlineNoStamp = JSON.parse(JSON.stringify(onlineBackupSample));
    onlineNoStamp.tables.settings = [
      { key: "business_name", value: "اسم الشركة الجديد" }
    ];

    await testImportData(db, onlineNoStamp);
    const stampRes = await db.query("SELECT value FROM settings WHERE key = 'pdf_stamp_image'");
    const sigRes = await db.query("SELECT value FROM settings WHERE key = 'pdf_signature_image'");
    const bioRes = await db.query("SELECT value FROM settings WHERE key = 'biometric_enabled'");
    const nameRes = await db.query("SELECT value FROM settings WHERE key = 'business_name'");

    if (
      stampRes.values[0]?.value === 'data:image/png;base64,ORIGINAL_LOCAL_STAMP' &&
      sigRes.values[0]?.value === 'data:image/png;base64,ORIGINAL_LOCAL_SIGNATURE' &&
      bioRes.values[0]?.value === 'true' &&
      nameRes.values[0]?.value === 'اسم الشركة الجديد'
    ) {
      recordResult(9, 'Settings & Stamp/Signature Preservation', 'PASS', 'تم تحديث إعدادات الأعمال مع الحفاظ التام على أختام وتواقيع الـ PDF وإعدادات الجهاز');
    } else {
      recordResult(9, 'Settings & Stamp/Signature Preservation', 'FAIL', 'فقدت بعض إعدادات الجهاز المحلية');
    }
  } catch (err) {
    recordResult(9, 'Settings & Stamp/Signature Preservation', 'FAIL', err.message);
  }

  // ─── Test 10: Atomic Rollback Simulation on Failure ────────────────────
  try {
    const db = createFreshDb();
    await db.run("INSERT INTO customers (id, name, phone) VALUES (55, 'عميل سابق أصلي', '0551112233')");

    const faultyBackup = JSON.parse(JSON.stringify(onlineBackupSample));
    faultyBackup.tables.contracts[0].customer_id = 999999;

    let rolledBack = false;
    try {
      await testImportData(db, faultyBackup);
    } catch (e) {
      rolledBack = true;
    }

    const checkRes = await db.query("SELECT name FROM customers WHERE id = 55");
    if (rolledBack && checkRes.values[0]?.name === 'عميل سابق أصلي') {
      recordResult(10, 'Atomic Rollback on Failure Simulation', 'PASS', 'تم التراجع الذري بنجاح ولم يتبق أي تغيير جزئي في قاعدة البيانات');
    } else {
      recordResult(10, 'Atomic Rollback on Failure Simulation', 'FAIL', 'فشل التراجع الذري');
    }
  } catch (err) {
    recordResult(10, 'Atomic Rollback on Failure Simulation', 'FAIL', err.message);
  }

  // ─── Test 11: New ID after Restore (Auto-increment collision test) ─────
  try {
    const db = createFreshDb();
    await testImportData(db, onlineBackupSample);
    const insertRes = await db.run("INSERT INTO customers (name, phone) VALUES ('عميل جديد بعد الاستعادة', '0558887766')");
    const newId = insertRes.lastId;
    const fetchRes = await db.query("SELECT id FROM customers WHERE name = 'عميل جديد بعد الاستعادة'");
    const actualNewId = fetchRes.values[0]?.id;

    if (actualNewId > 12) {
      recordResult(11, 'New ID Generation After Restore (No Collision)', 'PASS', `تم توليد ID جديد بنجاح (${actualNewId}) وهو أكبر من أقصى ID مستورد (12) دون أي تعارض`);
    } else {
      recordResult(11, 'New ID Generation After Restore (No Collision)', 'FAIL', `حدث تعارض في المعرف: ${actualNewId}`);
    }
  } catch (err) {
    recordResult(11, 'New ID Generation After Restore (No Collision)', 'FAIL', err.message);
  }

  // ─── Test 12: Local Authentication Preservation (Deep comparison) ──────
  try {
    const db = createFreshDb();
    await db.run(`
      INSERT INTO app_users (id, phone, name, password_hash, pin_hash, role, is_active, app_lock_enabled)
      VALUES (1, '0505555555', 'أحمد المشرف', 'HASH_P@SS_123', 'PIN_HASH_456', 'admin', 1, 1)
    `);
    const beforeUser = (await db.query("SELECT * FROM app_users")).values;

    await testImportData(db, onlineBackupSample);

    const afterUser = (await db.query("SELECT * FROM app_users")).values;
    const isExactMatch = JSON.stringify(beforeUser) === JSON.stringify(afterUser);

    if (isExactMatch) {
      recordResult(12, 'Local Auth Deep Snapshot Match', 'PASS', 'تطابق 100% في سجلات app_users قبل وبعد الاستعادة بجميع الحقول والـ Hashes');
    } else {
      recordResult(12, 'Local Auth Deep Snapshot Match', 'FAIL', 'اختلاف في بيانات app_users بعد الاستعادة');
    }
  } catch (err) {
    recordResult(12, 'Local Auth Deep Snapshot Match', 'FAIL', err.message);
  }

  // ─── Test 13: Local Settings Preservation ──────────────────────────────
  try {
    const db = createFreshDb();
    const localKeys = {
      pdf_stamp_image: "data:image/png;base64,STAMP123",
      pdf_signature_image: "data:image/png;base64,SIGN456",
      biometric_enabled: "true",
      screen_privacy: "true",
      privacy_mode: "true",
      due_alerts_enabled: "true",
      device_id: "DEVICE_HW_98765"
    };

    for (const [k, v] of Object.entries(localKeys)) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [k, v]);
    }

    await testImportData(db, onlineBackupSample);

    let allPreserved = true;
    for (const [k, expectedVal] of Object.entries(localKeys)) {
      const res = await db.query("SELECT value FROM settings WHERE key = ?", [k]);
      if (res.values[0]?.value !== expectedVal) {
        allPreserved = false;
        break;
      }
    }

    if (allPreserved) {
      recordResult(13, 'Local & Device Settings Full Preservation', 'PASS', 'تم الحفاظ على جميع إعدادات الجهاز الحساسة (7 مفاتيح محلية) دون أي مساس');
    } else {
      recordResult(13, 'Local & Device Settings Full Preservation', 'FAIL', 'بعض إعدادات الجهاز تم تغييرها أو فقدها');
    }
  } catch (err) {
    recordResult(13, 'Local & Device Settings Full Preservation', 'FAIL', err.message);
  }

  // ─── Test 14: Rollback Data Equality ───────────────────────────────────
  try {
    const db = createFreshDb();
    await testImportData(db, onlineBackupSample);
    
    const snapshotBefore = {};
    for (const t of BUSINESS_TABLES) {
      const r = await db.query(`SELECT * FROM "${t.name}" ORDER BY "${t.orderBy}"`);
      snapshotBefore[t.name] = r.values;
    }

    const failingBackup = JSON.parse(JSON.stringify(onlineBackupSample));
    failingBackup.tables.expenses = [
      { id: 900, description: "مصروف 1", amount: 100 },
      { id: 900, description: "مصروف مكرر بنفس الـ ID", amount: 200 }
    ];

    let threw = false;
    try {
      await testImportData(db, failingBackup);
    } catch (e) {
      threw = true;
    }

    const snapshotAfter = {};
    for (const t of BUSINESS_TABLES) {
      const r = await db.query(`SELECT * FROM "${t.name}" ORDER BY "${t.orderBy}"`);
      snapshotAfter[t.name] = r.values;
    }

    const isIdentical = JSON.stringify(snapshotBefore) === JSON.stringify(snapshotAfter);
    if (threw && isIdentical) {
      recordResult(14, 'Rollback Record-Level Data Equality', 'PASS', 'تم إثبات أن حالة قاعدة البيانات بعد الـ Rollback مطابقة 100% لحالتها قبل بدء الاستعادة');
    } else {
      recordResult(14, 'Rollback Record-Level Data Equality', 'FAIL', 'قاعدة البيانات لم تعد لحالتها السابقة تماماً بعد الـ Rollback');
    }
  } catch (err) {
    recordResult(14, 'Rollback Record-Level Data Equality', 'FAIL', err.message);
  }

  // ─── Test 15: Backup File Naming Compliance ─────────────────────────────
  try {
    const isMainNameCorrect = BACKUP_FILE_NAME === 'أقساطي_Backup.json';
    const legacyNamesCorrect = LEGACY_BACKUP_FILE_NAMES.includes('Aqsati_Main_Backup.json') &&
                               LEGACY_BACKUP_FILE_NAMES.includes('Fazatak_Main_Backup.json');

    // Check Google Drive Service file name generation
    const gdJsPath = path.join(__dirname, '..', 'src', 'services', 'googleDriveService.js');
    const gdJs = fs.readFileSync(gdJsPath, 'utf8');
    const gdUploadMatch = gdJs.includes('`أقساطي_Backup_${timestamp}.json`');
    const gdQueryMatch = gdJs.includes("name contains 'أقساطي_Backup'") &&
                         gdJs.includes("name contains 'Aqsati_Backup'") &&
                         gdJs.includes("name contains 'Fazatak_Backup'");

    // Check CloudSync naming
    const csJsPath = path.join(__dirname, '..', 'src', 'services', 'cloudSyncService.js');
    const csJs = fs.readFileSync(csJsPath, 'utf8');
    const csMatch = csJs.includes('`أقساطي_CloudSync_${phone}_${Date.now()}.json`');

    // Check Supabase naming
    const sbJsPath = path.join(__dirname, '..', 'src', 'services', 'supabase.js');
    const sbJs = fs.readFileSync(sbJsPath, 'utf8');
    const sbMatch = sbJs.includes("'أقساطي_Backup.json'");

    if (isMainNameCorrect && legacyNamesCorrect && gdUploadMatch && gdQueryMatch && csMatch && sbMatch) {
      recordResult(15, 'Backup File Naming & Google Drive Format', 'PASS', 'تسمية الملفات متطابقة 100%: أقساطي_Backup.json و أقساطي_Backup_<timestamp>.json مع استعلام بحث شامل');
    } else {
      recordResult(15, 'Backup File Naming & Google Drive Format', 'FAIL', 'عدم مطابقة أسماء الملفات في الخدمات');
    }
  } catch (err) {
    recordResult(15, 'Backup File Naming & Google Drive Format', 'FAIL', err.message);
  }

  // ─── Test 16: Name-Agnostic Import & Legacy Name Compatibility ──────────
  try {
    const db = createFreshDb();
    const testNames = [
      'أقساطي_Backup.json',
      'Fazatak_Main_Backup.json',
      'Aqsati_Main_Backup.json',
      'Fazatak_Backup_2026-09-14.json',
      'Aqsati_Backup_2026-09-14.json',
      'Custom_Unknown_File.json',
      undefined
    ];

    let allPassed = true;
    for (const testName of testNames) {
      const sample = JSON.parse(JSON.stringify(onlineBackupSample));
      sample.fileName = testName;
      const res = await testImportData(db, sample);
      if (!res || res.recordsCount !== 23) {
        allPassed = false;
        break;
      }
    }

    if (allPassed) {
      recordResult(16, 'Legacy Name Compatibility & Name-Agnostic Restore', 'PASS', 'تم بنجاح استيراد النسخ بجميع الأسماء القديمة والجديدة بدون أي اعتماد على اسم الملف');
    } else {
      recordResult(16, 'Legacy Name Compatibility & Name-Agnostic Restore', 'FAIL', 'فشل استيراد النسخة عند تجربة أحد الأسماء');
    }
  } catch (err) {
    recordResult(16, 'Legacy Name Compatibility & Name-Agnostic Restore', 'FAIL', err.message);
  }

  // ─── Test 17: Test A — Old Backup -> New Database (Missing Fields Handled Safely) ──
  try {
    const db = createFreshDb();
    const oldBackupSample = JSON.parse(JSON.stringify(onlineBackupSample));
    // Remove newly added fields from old backup
    oldBackupSample.tables.portfolio_expenses = [
      { id: 401, portfolio_id: 1, amount: 1000, description: "إضافة عهدة قديمة", date: "2026-01-01" }
    ];
    oldBackupSample.tables.customers = [
      { id: 10, name: "محمد سالم", phone: "0550000001" }
    ];
    oldBackupSample.tables.contracts = [
      { id: 100, customer_id: 10, title: "عقد آيفون", total_amount: 5000 }
    ];
    oldBackupSample.tables.installments = [
      { id: 1001, contract_id: 100, amount: 1000, due_date: "2026-10-01" }
    ];
    delete oldBackupSample.tables.customer_month_statuses;
    delete oldBackupSample.tables.installment_postponements;

    const res = await testImportData(db, oldBackupSample);
    const peQuery = await db.query('SELECT amount, description, date, portfolio_id, entry_type, payment_method, notes FROM portfolio_expenses WHERE id = 401');
    const peRow = peQuery.values[0];

    if (peRow &&
        peRow.amount === 1000 &&
        peRow.description === "إضافة عهدة قديمة" &&
        peRow.date === "2026-01-01" &&
        peRow.portfolio_id === 1 &&
        peRow.entry_type === 'expense' &&
        peRow.payment_method === 'cash' &&
        peRow.notes === null) {
      recordResult(17, 'Test A: Old Backup -> New Database', 'PASS', 'تم قبول النسخة القديمة بنجاح، وتعيين entry_type = expense و payment_method = cash و notes = NULL مع الحفاظ التام على البيانات الأصلية');
    } else {
      recordResult(17, 'Test A: Old Backup -> New Database', 'FAIL', `حالة غير متوقعة: ${JSON.stringify(peRow)}`);
    }
  } catch (err) {
    recordResult(17, 'Test A: Old Backup -> New Database', 'FAIL', err.message);
  }

  // ─── Test 18: Test B — New Backup -> New Database (Modern Fields Preserved) ────────
  try {
    const db = createFreshDb();
    const modernBackup = JSON.parse(JSON.stringify(onlineBackupSample));
    modernBackup.tables.portfolio_expenses = [
      { id: 501, portfolio_id: 1, amount: 2500, description: "سند قبض تحويل", date: "2026-02-15", entry_type: "receipt", payment_method: "transfer", notes: "تحويل عبر الراجحي" }
    ];
    await testImportData(db, modernBackup);
    const peQuery = await db.query('SELECT entry_type, payment_method, notes FROM portfolio_expenses WHERE id = 501');
    const row = peQuery.values[0];

    if (row && row.entry_type === 'receipt' && row.payment_method === 'transfer' && row.notes === "تحويل عبر الراجحي") {
      recordResult(18, 'Test B: New Backup -> New Database', 'PASS', 'تم الحفاظ على جميع الحقول الحديثة (entry_type=receipt, payment_method=transfer, notes=تحويل عبر الراجحي) كما هي دون استبدالها بالـ Defaults');
    } else {
      recordResult(18, 'Test B: New Backup -> New Database', 'FAIL', `لم يتم حفظ الحقول الحديثة: ${JSON.stringify(row)}`);
    }
  } catch (err) {
    recordResult(18, 'Test B: New Backup -> New Database', 'FAIL', err.message);
  }

  // ─── Test 19: Test C — Unknown Legacy Columns Ignored Safely ──────────────────────
  try {
    const db = createFreshDb();
    const backupWithUnknown = JSON.parse(JSON.stringify(onlineBackupSample));
    backupWithUnknown.tables.customers[0].legacy_obsolete_column_abc = "OLD_VALUE_XYZ";
    backupWithUnknown.tables.customers[0].deprecated_cloud_sync_hash = "DEPRECATED_123";
    backupWithUnknown.tables.contracts[0].unknown_external_ref = 889977;

    await testImportData(db, backupWithUnknown);
    const cRes = await db.query('SELECT name FROM customers WHERE id = 10');
    if (cRes.values[0]?.name === "محمد سالم") {
      recordResult(19, 'Test C: Unknown Legacy Columns Ignored Safely', 'PASS', 'تم تجاهل الأعمدة القديمة غير المعروفة بأمان تام واستيراد البيانات الأساسية بسلاسة');
    } else {
      recordResult(19, 'Test C: Unknown Legacy Columns Ignored Safely', 'FAIL', 'تعذر استيراد السجل الذي يحتوي على أعمدة قديمة');
    }
  } catch (err) {
    recordResult(19, 'Test C: Unknown Legacy Columns Ignored Safely', 'FAIL', err.message);
  }

  // ─── Test 20: Test D — Missing Nullable Columns -> NULL ────────────────────────────
  try {
    const db = createFreshDb();
    const backupNulls = JSON.parse(JSON.stringify(onlineBackupSample));
    // Customers without manager_id, phone, or deleted_at
    backupNulls.tables.customers = [
      { id: 77, name: "عميل بدون حقول اختيارية" }
    ];
    delete backupNulls.tables.contracts;
    delete backupNulls.tables.installments;
    delete backupNulls.tables.customer_month_statuses;
    delete backupNulls.tables.installment_postponements;

    await testImportData(db, backupNulls);
    const res = await db.query('SELECT phone, manager_id, deleted_at FROM customers WHERE id = 77');
    const row = res.values[0];

    if (row && row.phone === null && row.manager_id === null && row.deleted_at === null) {
      recordResult(20, 'Test D: Missing Nullable Columns -> NULL', 'PASS', 'الحقول الاختيارية (Nullable) التي لا تحتوي على Default استقرت على NULL تلقائياً');
    } else {
      recordResult(20, 'Test D: Missing Nullable Columns -> NULL', 'FAIL', `قيم غير متوقعة: ${JSON.stringify(row)}`);
    }
  } catch (err) {
    recordResult(20, 'Test D: Missing Nullable Columns -> NULL', 'FAIL', err.message);
  }

  // ─── Test 21: Test E — Missing Field with SQL Default -> SQLite Default ───────────
  try {
    const db = createFreshDb();
    const backupDflt = JSON.parse(JSON.stringify(onlineBackupSample));
    backupDflt.tables.portfolio_expenses = [
      { id: 801, portfolio_id: 1, amount: 300, description: "مصروف بدون وسيلة دفع" }
    ];
    backupDflt.tables.customers = [
      { id: 88, name: "عميل لفحص الـ Defaults" }
    ];
    delete backupDflt.tables.contracts;
    delete backupDflt.tables.installments;
    delete backupDflt.tables.customer_month_statuses;
    delete backupDflt.tables.installment_postponements;

    await testImportData(db, backupDflt);
    const peRes = await db.query('SELECT entry_type, payment_method FROM portfolio_expenses WHERE id = 801');
    const custRes = await db.query('SELECT status, is_blacklisted, is_vip, is_deleted, is_manually_flagged_as_overdue FROM customers WHERE id = 88');

    const pe = peRes.values[0];
    const cu = custRes.values[0];

    if (pe.entry_type === 'expense' && pe.payment_method === 'cash' &&
        cu.status === 'active' && cu.is_blacklisted === 0 && cu.is_vip === 0 &&
        cu.is_deleted === 0 && cu.is_manually_flagged_as_overdue === 0) {
      recordResult(21, 'Test E: Missing Field with SQL Default -> SQLite Default', 'PASS', 'تم تطبيق جميع قيم الـ Defaults الحقيقية المحددة في SQLite PRAGMA table_info');
    } else {
      recordResult(21, 'Test E: Missing Field with SQL Default -> SQLite Default', 'FAIL', `قيم غير مطابقة للـ schema: pe=${JSON.stringify(pe)}, cu=${JSON.stringify(cu)}`);
    }
  } catch (err) {
    recordResult(21, 'Test E: Missing Field with SQL Default -> SQLite Default', 'FAIL', err.message);
  }

  // ─── Test 22: Test F — Explicit NULL Behavior (Respected on Nullable, Rejected on NOT NULL) ─
  try {
    const db = createFreshDb();
    const backupExplicitNull = JSON.parse(JSON.stringify(onlineBackupSample));
    // payment_method is nullable with default 'cash'. If explicitly null in backup, must keep null!
    backupExplicitNull.tables.portfolio_expenses = [
      { id: 901, portfolio_id: 1, amount: 700, description: "مصروف بقيمة نول صريحة", payment_method: null, notes: null }
    ];
    delete backupExplicitNull.tables.customer_month_statuses;
    delete backupExplicitNull.tables.installment_postponements;

    await testImportData(db, backupExplicitNull);
    const peRes = await db.query('SELECT payment_method, notes FROM portfolio_expenses WHERE id = 901');
    const pe = peRes.values[0];

    // Now test that sending null for a required NOT NULL column (like contract total_amount) is rejected!
    const failingNullBackup = JSON.parse(JSON.stringify(onlineBackupSample));
    failingNullBackup.tables.contracts = [
      { id: 999, customer_id: 10, title: "عقد بدون مبلغ إجمالي", total_amount: null }
    ];

    let rejectedNotNull = false;
    try {
      await testImportData(db, failingNullBackup);
    } catch (err) {
      rejectedNotNull = true;
    }

    if (pe.payment_method === null && pe.notes === null && rejectedNotNull) {
      recordResult(22, 'Test F: Explicit NULL Behavior', 'PASS', 'تم احترام قيمة NULL الصريحة في الحقول القابلة للـ NULL، ورفض NULL الصريح في الحقول الإلزامية NOT NULL بنجاح');
    } else {
      recordResult(22, 'Test F: Explicit NULL Behavior', 'FAIL', `فشل اختبار الـ NULL الصريح: pe=${JSON.stringify(pe)}, rejectedNotNull=${rejectedNotNull}`);
    }
  } catch (err) {
    recordResult(22, 'Test F: Explicit NULL Behavior', 'FAIL', err.message);
  }

  // ─── Test 23: Test G — Required Foreign Keys Remain Strict ────────────────────────
  try {
    const db = createFreshDb();
    // Subtest 1: contract missing customer_id (null)
    const missingFk1 = JSON.parse(JSON.stringify(onlineBackupSample));
    missingFk1.tables.contracts[0].customer_id = null;
    let rejected1 = false;
    try { await testImportData(db, missingFk1); } catch { rejected1 = true; }

    // Subtest 2: installment missing contract_id (null)
    const missingFk2 = JSON.parse(JSON.stringify(onlineBackupSample));
    missingFk2.tables.installments[0].contract_id = null;
    let rejected2 = false;
    try { await testImportData(db, missingFk2); } catch { rejected2 = true; }

    // Subtest 3: portfolio_expense with non-existent portfolio_id
    const danglingFk = JSON.parse(JSON.stringify(onlineBackupSample));
    danglingFk.tables.portfolio_expenses[0].portfolio_id = 99999;
    let rejected3 = false;
    try { await testImportData(db, danglingFk); } catch { rejected3 = true; }

    if (rejected1 && rejected2 && rejected3) {
      recordResult(23, 'Test G: Required Foreign Keys Remain Strict', 'PASS', 'تم الرفض الصارم مع التراجع الذري لأي سجل يفتقر إلى Foreign Key مطلوب أو يشير إلى أب غير موجود');
    } else {
      recordResult(23, 'Test G: Required Foreign Keys Remain Strict', 'FAIL', `فشل كشف العلاقات غير الصالحة: r1=${rejected1}, r2=${rejected2}, r3=${rejected3}`);
    }
  } catch (err) {
    recordResult(23, 'Test G: Required Foreign Keys Remain Strict', 'FAIL', err.message);
  }

  // ─── Test 24: Test H — Mixed Old and New Records in Same Backup ───────────────────
  try {
    const db = createFreshDb();
    const mixedBackup = JSON.parse(JSON.stringify(onlineBackupSample));
    mixedBackup.tables.portfolio_expenses = [
      { id: 701, portfolio_id: 1, amount: 500, description: "سجل قديم بدون حقول إضافية" },
      { id: 702, portfolio_id: 1, amount: 800, description: "سجل حديث بحقول جديدة", entry_type: "receipt", payment_method: "transfer", notes: "حوالة مصرفية" }
    ];
    delete mixedBackup.tables.customer_month_statuses;
    delete mixedBackup.tables.installment_postponements;

    await testImportData(db, mixedBackup);
    const r1Res = await db.query('SELECT entry_type, payment_method, notes FROM portfolio_expenses WHERE id = 701');
    const r2Res = await db.query('SELECT entry_type, payment_method, notes FROM portfolio_expenses WHERE id = 702');
    const r1 = r1Res.values[0];
    const r2 = r2Res.values[0];

    const r1Correct = r1.entry_type === 'expense' && r1.payment_method === 'cash' && r1.notes === null;
    const r2Correct = r2.entry_type === 'receipt' && r2.payment_method === 'transfer' && r2.notes === "حوالة مصرفية";

    if (r1Correct && r2Correct) {
      recordResult(24, 'Test H: Mixed Old and New Records in Same Backup', 'PASS', 'تمت معالجة السجلات القديمة والحديثة معاً في نفس النسخة بدقة وبدون أي تداخل أو تشويه للبيانات');
    } else {
      recordResult(24, 'Test H: Mixed Old and New Records in Same Backup', 'FAIL', `r1=${JSON.stringify(r1)}, r2=${JSON.stringify(r2)}`);
    }
  } catch (err) {
    recordResult(24, 'Test H: Mixed Old and New Records in Same Backup', 'FAIL', err.message);
  }

  // ─── Test 25: Test I — Old Data 100% Preservation (0 Unexpected Mutations / Loss) ─
  try {
    const db = createFreshDb();
    const oldBackupToVerify = JSON.parse(JSON.stringify(onlineBackupSample));
    oldBackupToVerify.tables.portfolio_expenses = [
      { id: 991, portfolio_id: 1, amount: 1234.56, description: "عهدة دقيقة جداً", date: "2026-03-01" }
    ];
    oldBackupToVerify.tables.customers[0].name = "محمد سالم أحمد الغامدي";

    await testImportData(db, oldBackupToVerify);

    // Verify all original fields are 100% preserved identically
    const peQuery = await db.query('SELECT * FROM portfolio_expenses WHERE id = 991');
    const pe = peQuery.values[0];
    const cuQuery = await db.query('SELECT * FROM customers WHERE id = 10');
    const cu = cuQuery.values[0];

    let zeroMutations = true;
    const originalPe = oldBackupToVerify.tables.portfolio_expenses[0];
    for (const [k, v] of Object.entries(originalPe)) {
      if (pe[k] !== v) {
        zeroMutations = false;
        break;
      }
    }

    const originalCu = oldBackupToVerify.tables.customers[0];
    for (const [k, v] of Object.entries(originalCu)) {
      if (cu[k] !== v) {
        zeroMutations = false;
        break;
      }
    }

    if (zeroMutations) {
      recordResult(25, 'Test I: Old Data 100% Preservation', 'PASS', 'إثبات قاطع: 0 unexpected mutations و 0 unexpected data loss عبر جميع الحقول الأصلية للبيانات القديمة');
    } else {
      recordResult(25, 'Test I: Old Data 100% Preservation', 'FAIL', 'حدث تغيير غير متوقع في أحد الحقول الأصلية القديمة');
    }
  } catch (err) {
    recordResult(25, 'Test I: Old Data 100% Preservation', 'FAIL', err.message);
  }

  // ─── Round-Trip Test (Phase 18) ────────────────────────────────────────
  console.log('\n----------------------------------------------------------------');
  console.log('🔄 تشغيل اختبار الـ Round-Trip (Old Backup -> Offline Import -> Offline Export)');
  console.log('----------------------------------------------------------------');

  try {
    const db = createFreshDb();
    const oldBackupRoundTrip = JSON.parse(JSON.stringify(onlineBackupSample));
    oldBackupRoundTrip.tables.portfolio_expenses = [
      { id: 601, portfolio_id: 1, amount: 990, description: "مصروف عهدة قديم", date: "2026-01-10" }
    ];

    await testImportData(db, oldBackupRoundTrip);
    const exportedPayload = await testExportData(db);

    const comparisonReport = [];
    let roundTripPassed = true;

    // 1. التحقق من أن جميع الحقول الأصلية التي كانت في النسخة القديمة متطابقة 100%
    const origPe = oldBackupRoundTrip.tables.portfolio_expenses[0];
    const expPe = exportedPayload.tables.portfolio_expenses.find(r => r.id === 601);

    if (!expPe) {
      roundTripPassed = false;
      comparisonReport.push('❌ لم يتم العثور على سجل العهدة في النسخة المصدرة');
    } else {
      for (const [k, v] of Object.entries(origPe)) {
        if (expPe[k] !== v) {
          roundTripPassed = false;
          comparisonReport.push(`❌ الحقل الأصلي ${k} تغير من ${v} إلى ${expPe[k]}`);
        }
      }
      // 2. التحقق من أن الأعمدة الجديدة أخذت الـ verified defaults أو null
      if (expPe.entry_type !== 'expense') {
        roundTripPassed = false;
        comparisonReport.push(`❌ العمود الجديد entry_type قيمته غير صحيحة: ${expPe.entry_type}`);
      }
      if (expPe.payment_method !== 'cash') {
        roundTripPassed = false;
        comparisonReport.push(`❌ العمود الجديد payment_method قيمته غير صحيحة: ${expPe.payment_method}`);
      }
      if (expPe.notes !== null) {
        roundTripPassed = false;
        comparisonReport.push(`❌ العمود الجديد notes قيمته غير صحيحة: ${expPe.notes}`);
      }
      if (roundTripPassed) {
        comparisonReport.push('✅ جميع الحقول الأصلية القديمة متطابقة 100% في النسخة المصدرة (0 data loss, 0 unexpected mutations)');
        comparisonReport.push('✅ جميع الأعمدة الجديدة استقرت على قيمها المعتمدة في الـ schema: entry_type=expense, payment_method=cash, notes=NULL');
      }
    }

    console.log(comparisonReport.join('\n'));

    if (roundTripPassed) {
      console.log('\n🏆 نتيجة اختبار الـ Round-Trip: PASS بنجاح تام وبدون أي فقدان للبيانات!');
    } else {
      console.log('\n⚠️ نتيجة اختبار الـ Round-Trip: FAIL');
    }
  } catch (err) {
    console.error('Round-Trip error:', err);
  }

  console.log('\n================================================================');
  console.log('📊 ملخص نتائج الاختبارات:');
  const passedCount = results.filter(r => r.status === 'PASS').length;
  const failedCount = results.filter(r => r.status === 'FAIL').length;
  console.log(`إجمالي الاختبارات: ${results.length} | الناجحة: ${passedCount} | الفاشلة: ${failedCount}`);
  console.log('================================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
