import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { notifyDataChanged } from './dataEvents';

const DB_NAME = 'fazatak_db';
const LEGACY_WHATSAPP_TEMPLATE = 'مرحباً [الاسم]، نذكركم بموعد دفع القسط بمبلغ [المبلغ] ريال بتاريخ [التاريخ]. شكراً لتعاونكم.';
const DEFAULT_WHATSAPP_TEMPLATE = 'مرحباً [الاسم]، نذكركم بسداد قسط [العقد] بمبلغ [المبلغ] ريال بتاريخ [التاريخ]. شكراً لتعاونكم.';

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getMonthKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const getCurrentMonthBounds = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const next = new Date(date.getFullYear(), date.getMonth() + 1, 1);

  return {
    monthKey: getMonthKey(date),
    startDate: formatLocalDate(start),
    nextMonthDate: formatLocalDate(next),
    todayDate: formatLocalDate(date)
  };
};

const addLocalDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addLocalMonths = (dateInput, months) => {
  const date = new Date(dateInput);
  const originalDay = date.getDate();
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);

  if (next.getDate() !== originalDay) {
    next.setDate(0);
  }

  return next;
};

const roundCurrency = (value) => Math.round((Number(value) || 0) * 100) / 100;

const paidAmountSql = (alias = '') => {
  const prefix = alias ? `${alias}.` : '';
  return `CASE WHEN ${prefix}status = 'paid' AND (${prefix}actual_paid IS NULL OR ${prefix}actual_paid = 0) THEN ${prefix}amount ELSE COALESCE(${prefix}actual_paid, 0) END`;
};

const getPaidAmount = (installment) => {
  const actualPaid = Number(installment?.actual_paid || 0);
  const status = String(installment?.status || '').trim().toLowerCase();
  if (status === 'paid' && actualPaid <= 0) {
    return Number(installment?.amount || 0);
  }
  return actualPaid;
};

const getRemainingAmount = (installment) => {
  return Math.max(0, roundCurrency(Number(installment?.amount || 0) - getPaidAmount(installment)));
};

const buildInstallmentSchedule = ({ totalAmount, monthlyAmount, installmentCount, firstDueDate }) => {
  const total = roundCurrency(totalAmount);
  const monthly = roundCurrency(monthlyAmount);
  const months = Number(installmentCount);
  const totalMonths = Math.ceil(months);

  if (total <= 0 || monthly <= 0 || months <= 0 || totalMonths <= 0) {
    throw new Error('يرجى إدخال إجمالي العقد والقسط الشهري وعدد الأقساط بشكل صحيح');
  }

  const regularMonths = Math.max(0, totalMonths - 1);
  const lastAmount = roundCurrency(total - (monthly * regularMonths));

  if (lastAmount > monthly * 2) {
    const requiredMonths = Math.ceil((total - (monthly * 2)) / monthly) + 1;
    throw new Error(`عدد الأقساط غير كافٍ. المطلوب ${requiredMonths} أقساط على الأقل.`);
  }

  if (lastAmount < monthly) {
    const maxMonths = Math.max(1, Math.floor(total / monthly));
    throw new Error(`عدد الأقساط زائد. الحد الأقصى المناسب ${maxMonths} أقساط.`);
  }

  const firstDate = firstDueDate ? new Date(firstDueDate) : new Date();
  const rows = [];

  for (let i = 0; i < totalMonths; i++) {
    const dueDate = new Date(firstDate);
    dueDate.setMonth(dueDate.getMonth() + i);

    rows.push({
      amount: i < regularMonths ? monthly : lastAmount,
      due_date: dueDate.toISOString().split('T')[0]
    });
  }

  return rows;
};

let sqlite = null;
let db = null;
let initPromise = null;
let isWebStore = false;

let isSaving = false;
let saveQueued = false;

export const persistWebStore = async () => {
  if (!isWebStore) return;
  if (isSaving) {
    saveQueued = true;
    return;
  }

  isSaving = true;
  try {
    do {
      saveQueued = false;
      let saved = false;
      // 1. SQLiteConnection.saveToStore expects database name as string: sqlite.saveToStore(DB_NAME)
      // which internally calls CapacitorSQLite.saveToStore({ database: DB_NAME })
      if (sqlite && typeof sqlite.saveToStore === 'function') {
        try {
          await sqlite.saveToStore(DB_NAME);
          saved = true;
        } catch (e) {
          console.warn('[DB] sqlite.saveToStore warning:', e);
        }
      }
      // 2. Direct call to CapacitorSQLite plugin expects { database: DB_NAME }
      if (!saved) {
        try {
          await CapacitorSQLite.saveToStore({ database: DB_NAME });
          saved = true;
        } catch (e2) {
          console.warn('[DB] CapacitorSQLite.saveToStore warning:', e2);
        }
      }
      // 3. Fallback: call jeep-sqlite DOM element directly if available
      if (!saved && typeof document !== 'undefined') {
        try {
          const jeepEl = document.querySelector('jeep-sqlite');
          if (jeepEl && typeof jeepEl.saveToStore === 'function') {
            await jeepEl.saveToStore({ database: DB_NAME });
            saved = true;
          }
        } catch (e3) {
          console.warn('[DB] jeep-sqlite element saveToStore warning:', e3);
        }
      }
    } while (saveQueued);
  } finally {
    isSaving = false;
  }
};

// ─── حفظ تلقائي عند إغلاق/إخفاء التطبيق ────────────────
// يضمن عدم فقدان البيانات حتى لو لم يُستدعَ persistWebStore يدوياً
if (typeof window !== 'undefined') {
  const flushOnExit = () => persistWebStore().catch(() => {});

  // عند إغلاق التاب أو المتصفح
  window.addEventListener('beforeunload', flushOnExit);

  // عند إخفاء التطبيق (تبديل التاب أو الضغط على الهوم في الجوال)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushOnExit();
      }
    });
  }

  // دعم إضافي لـ iOS Safari PWA
  window.addEventListener('pagehide', flushOnExit);

  // حفظ دوري احتياطي كل 10 ثواني لضمان ثبات البيانات
  setInterval(() => {
    if (isWebStore && db) {
      persistWebStore().catch(() => {});
    }
  }, 10000);
}



const wrapDbConnection = (rawDb) => {
  if (!isWebStore || !rawDb || rawDb.__wrapped) return rawDb;

  let inTransaction = false;

  const originalRun = rawDb.run.bind(rawDb);
  const originalExecute = rawDb.execute.bind(rawDb);
  const originalExecuteSet = rawDb.executeSet ? rawDb.executeSet.bind(rawDb) : null;
  const originalBegin = rawDb.beginTransaction ? rawDb.beginTransaction.bind(rawDb) : null;
  const originalCommit = rawDb.commitTransaction ? rawDb.commitTransaction.bind(rawDb) : null;
  const originalRollback = rawDb.rollbackTransaction ? rawDb.rollbackTransaction.bind(rawDb) : null;
  const originalClose = rawDb.close ? rawDb.close.bind(rawDb) : null;

  if (originalBegin) {
    rawDb.beginTransaction = async (...args) => {
      inTransaction = true;
      return await originalBegin(...args);
    };
  }

  rawDb.run = async (...args) => {
    const res = await originalRun(...args);
    if (!inTransaction) {
      await persistWebStore();
    }
    return res;
  };

  rawDb.execute = async (...args) => {
    const res = await originalExecute(...args);
    if (!inTransaction) {
      await persistWebStore();
    }
    return res;
  };

  if (originalExecuteSet) {
    rawDb.executeSet = async (...args) => {
      const res = await originalExecuteSet(...args);
      if (!inTransaction) {
        await persistWebStore();
      }
      return res;
    };
  }

  if (originalCommit) {
    rawDb.commitTransaction = async (...args) => {
      inTransaction = false;
      const res = await originalCommit(...args);
      await persistWebStore();
      return res;
    };
  }

  if (originalRollback) {
    rawDb.rollbackTransaction = async (...args) => {
      inTransaction = false;
      return await originalRollback(...args);
    };
  }

  if (originalClose) {
    rawDb.close = async (...args) => {
      inTransaction = false;
      await persistWebStore();
      return await originalClose(...args);
    };
  }

  rawDb.__wrapped = true;
  return rawDb;
};

export const initDatabase = async () => {
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    try {
      sqlite = new SQLiteConnection(CapacitorSQLite);
    
    // 1. Consistency Check
    try { await sqlite.checkConnectionsConsistency(); } catch {}

    // 2. Identify Platform
    const isNative = Capacitor.isNativePlatform();
    const platform = isNative ? Capacitor.getPlatform() : 'web';
    
    if (platform === 'web' || !isNative) {
      isWebStore = true;
      if (typeof document !== 'undefined') {
        let jeepEl = document.querySelector('jeep-sqlite');
        if (!jeepEl && document.body) {
          jeepEl = document.createElement('jeep-sqlite');
          jeepEl.setAttribute('wasmPath', '/assets');
          jeepEl.setAttribute('autoSave', 'true');
          document.body.appendChild(jeepEl);
        } else if (jeepEl) {
          jeepEl.setAttribute('autoSave', 'true');
        }
      }
      if (typeof customElements !== 'undefined') {
        try {
          await customElements.whenDefined('jeep-sqlite');
        } catch {}
      }
      await sqlite.initWebStore();
    }
    
    // 3. Robust Connection Logic
    try {
      const isConn = await sqlite.isConnection(DB_NAME, false);
      if (isConn.result) {
        db = await sqlite.retrieveConnection(DB_NAME, false);
        console.log('Retrieved existing connection');
      } else {
        db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
        console.log('Created new connection');
      }
    } catch (err) {
      console.error('Connection error, attempting fallback...', err);
      // Fallback: try to retrieve anyway if isConnection failed
      try {
        db = await sqlite.retrieveConnection(DB_NAME, false);
      } catch {
        db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
      }
    }
    
    // 4. Guaranteed Open
    try {
      await db.open();
    } catch (e) {
      // Ignore "already open" errors as they are non-fatal
      if (!e.message.toLowerCase().includes('already open')) {
        console.warn('Database open warning (non-fatal):', e.message);
      }
    }
    
    db = wrapDbConnection(db);
    await createTables();
    await persistWebStore();
    return db;
    } catch (error) {
      console.error('Database initialization error:', error);
      initPromise = null; // Allow retry
      throw error;
    }
  })();

  return initPromise;
};

const createTables = async () => {
  const schema = `
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      is_blacklisted INTEGER DEFAULT 0,
      is_vip INTEGER DEFAULT 0,
      late_payments INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived')),
       manager_id INTEGER,
       deleted_manager_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_manually_flagged_as_overdue INTEGER DEFAULT 0,
      FOREIGN KEY (manager_id) REFERENCES managers(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS managers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
       phone TEXT,
       is_deleted INTEGER DEFAULT 0,
       deleted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      capital_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      guarantor_name TEXT,
      guarantor_phone TEXT,
      creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'cancelled')),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      due_date DATE NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'postponed')),
      actual_paid REAL DEFAULT 0,
      receipt_image_path TEXT,
      paid_at DATETIME,
      is_late INTEGER DEFAULT 0,
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT DEFAULT 'أخرى',
      date DATE DEFAULT CURRENT_DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_month_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      month_key TEXT NOT NULL,
      status TEXT DEFAULT 'none' CHECK(status IN ('none', 'paid', 'postponed', 'overdue')),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(customer_id, month_key),
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS installment_postponements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      installment_id INTEGER NOT NULL,
      contract_id INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('end', 'next')),
      postponed_amount REAL NOT NULL,
      target_installment_id INTEGER,
      target_original_amount REAL,
      generated_installment_id INTEGER,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'undone')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      undone_at DATETIME,
      FOREIGN KEY (installment_id) REFERENCES installments(id) ON DELETE CASCADE,
      FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE,
      FOREIGN KEY (target_installment_id) REFERENCES installments(id) ON DELETE SET NULL,
      FOREIGN KEY (generated_installment_id) REFERENCES installments(id) ON DELETE SET NULL
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES 
      ('whatsapp_template', '${DEFAULT_WHATSAPP_TEMPLATE}'),
      ('biometric_enabled', 'true'),
      ('quick_payment_mode', 'false'),
      ('privacy_mode', 'false'),
      ('hijri_calendar', 'false'),
      ('salary_day_sync', 'false'),
      ('friday_quiet_mode', 'false'),
      ('auto_append_iban', 'false'),
      ('iban_number', ''),
      ('account_type', 'individual'),
      ('business_name', ''),
      ('business_contact', ''),
      ('tax_number', ''),
      ('show_details_on_pdf', 'false'),
      ('pdf_stamp_enabled', 'false'),
      ('pdf_stamp_image', ''),
      ('pdf_stamp_text', ''),
      ('pdf_signature_enabled', 'false'),
      ('pdf_signature_image', ''),
      ('pdf_signature_text', ''),
      ('show_general_customers', 'true'),
      ('overdue_threshold_days', '30'),
      ('stagnancy_threshold_days', '90'),
      ('installment_notifications_enabled', 'false'),
      ('installment_notification_days_before', '1'),
      ('installment_notification_time', '09:00'),
      ('installment_overdue_notifications_enabled', 'true');

    CREATE TABLE IF NOT EXISTS portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      capital REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portfolio_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      date DATE DEFAULT CURRENT_DATE,
      entry_type TEXT NOT NULL DEFAULT 'expense',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
    );
  `;
  
  await db.execute(schema);

  // Existing installations do not have the operation type column yet.
  try {
    await db.execute(`ALTER TABLE portfolio_expenses ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'expense'`);
  } catch {}

  try {
    await db.run(`UPDATE settings SET value = ? WHERE key = 'whatsapp_template' AND value = ?`, [
      DEFAULT_WHATSAPP_TEMPLATE,
      LEGACY_WHATSAPP_TEMPLATE
    ]);
  } catch {}

  try {
    await db.run(`UPDATE installments SET actual_paid = amount WHERE status = 'paid' AND (actual_paid IS NULL OR actual_paid = 0)`);
  } catch {}

  // Ensure manager-related columns exist for existing users
  try {
    await db.execute('ALTER TABLE customers ADD COLUMN manager_id INTEGER');
  } catch {}

  try {
    await db.execute('ALTER TABLE customers ADD COLUMN deleted_manager_id INTEGER');
  } catch {}

  try {
    await db.execute('ALTER TABLE managers ADD COLUMN is_deleted INTEGER DEFAULT 0');
  } catch {}

  try {
    await db.execute('ALTER TABLE managers ADD COLUMN deleted_at DATETIME');
  } catch {}

  // Ensure is_manually_flagged_as_overdue column exists for existing users
  try {
    await db.execute('ALTER TABLE customers ADD COLUMN is_manually_flagged_as_overdue INTEGER DEFAULT 0');
  } catch {}

  // Ensure is_deleted and deleted_at columns exist
  try {
    await db.execute('ALTER TABLE customers ADD COLUMN is_deleted INTEGER DEFAULT 0');
    await db.execute('ALTER TABLE customers ADD COLUMN deleted_at DATETIME');
  } catch {}

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_customers_manager_deleted_status ON customers(manager_id, is_deleted, status);
    CREATE INDEX IF NOT EXISTS idx_customers_deleted_manager ON customers(deleted_manager_id);
    CREATE INDEX IF NOT EXISTS idx_customers_manual_overdue ON customers(is_manually_flagged_as_overdue);
    CREATE INDEX IF NOT EXISTS idx_contracts_customer_status ON contracts(customer_id, status);
    CREATE INDEX IF NOT EXISTS idx_installments_contract_status_due ON installments(contract_id, status, due_date);
    CREATE INDEX IF NOT EXISTS idx_installments_status_due ON installments(status, due_date);
    CREATE INDEX IF NOT EXISTS idx_customer_month_statuses_month_customer ON customer_month_statuses(month_key, customer_id);
    CREATE INDEX IF NOT EXISTS idx_installment_postponements_installment_status ON installment_postponements(installment_id, status);
  `);
};

export const getDatabase = async () => {
  if (!db) {
    console.log('Database not ready, initializing...');
    await initDatabase();
  }
  return db;
};

// Customer Operations
export const customerService = {
  async create(customer) {
    const database = await getDatabase();
    const sql = `INSERT INTO customers (name, phone, is_blacklisted, is_vip, status, manager_id, is_manually_flagged_as_overdue) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    const result = await database.run(sql, [
      customer.name, 
      customer.phone || null, 
      customer.is_blacklisted ? 1 : 0, 
      customer.is_vip ? 1 : 0, 
      customer.status || 'active',
      customer.manager_id || null,
      customer.is_manually_flagged_as_overdue ? 1 : 0
    ]);
    const id = result.changes?.lastId || result.lastId;
    notifyDataChanged({ scope: 'customers', action: 'create', id });
    return id;
  },

  async getAll(activeOnly = false, managerId = null, includeDeleted = false) {
    const database = await getDatabase();
    let sql = `SELECT * FROM customers WHERE 1=1`;
    const params = [];
    
    if (!includeDeleted) {
      sql += ` AND (is_deleted IS NULL OR is_deleted = 0)`;
      if (activeOnly) sql += ` AND status = 'active'`;
    }
    
    if (managerId === 'personal') {
      sql += ` AND (manager_id IS NULL OR manager_id = '' OR manager_id = 0)`;
      sql += ` AND (deleted_manager_id IS NULL OR deleted_manager_id = 0)`;
    } else if (managerId !== null && managerId !== undefined && managerId !== '') {
      sql += ` AND manager_id = ?`;
      params.push(Number(managerId) || managerId);
    }
    
    sql += ` ORDER BY created_at DESC`;
    const result = await database.query(sql, params);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM customers WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async update(id, customer, skipNotify = false) {
    const database = await getDatabase();
    // Prevent data loss by merging with existing data
    const existing = await this.getById(id);
    if (!existing) {
      console.warn(`Attempted to update non-existent customer: ${id}`);
      return;
    }

    const data = { ...existing, ...customer };
    const sql = `UPDATE customers SET name = ?, phone = ?, is_blacklisted = ?, is_vip = ?, status = ?, manager_id = ?, is_manually_flagged_as_overdue = ? WHERE id = ?`;
    
    // Crucial: preserve manager_id if not explicitly changing it
    const finalManagerId = (customer.manager_id !== undefined) ? customer.manager_id : existing.manager_id;
    const finalFlagged = (customer.is_manually_flagged_as_overdue !== undefined) ? customer.is_manually_flagged_as_overdue : existing.is_manually_flagged_as_overdue;

    await database.run(sql, [
      data.name, 
      data.phone, 
      data.is_blacklisted ? 1 : 0, 
      data.is_vip ? 1 : 0, 
      data.status || 'active', 
      finalManagerId || null,
      finalFlagged ? 1 : 0,
      id
    ]);
    if (!skipNotify) {
      notifyDataChanged({ scope: 'customers', action: 'update', id });
    }
  },

  async delete(id) {
    const isRecycleBinEnabled = await settingsService.get('recycle_bin_enabled');
    if (isRecycleBinEnabled === 'true') {
      // Soft delete
      const database = await getDatabase();
      await database.run(`UPDATE customers SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
      notifyDataChanged({ scope: 'customers', action: 'delete', id });
    } else {
      await this.hardDelete(id);
    }
  },

  async hardDelete(id) {
    const database = await getDatabase();
    // Delete all installments for all contracts of this customer
    await database.run(`DELETE FROM installments WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id = ?)`, [id]);
    // Delete all contracts for this customer
    await database.run(`DELETE FROM contracts WHERE customer_id = ?`, [id]);
    // Delete the customer
    await database.run(`DELETE FROM customers WHERE id = ?`, [id]);
    notifyDataChanged({ scope: 'customers', action: 'hard-delete', id });
  },

  async restore(id) {
    const database = await getDatabase();
    await database.run(`UPDATE customers SET is_deleted = 0, deleted_at = NULL WHERE id = ?`, [id]);
    notifyDataChanged({ scope: 'customers', action: 'restore', id });
  },

  async autoCleanupDeletedCustomers() {
    try {
      const database = await getDatabase();
      const result = await database.query(`SELECT id FROM customers WHERE is_deleted = 1 AND deleted_at <= date('now', '-7 days')`);
      if (result.values && result.values.length > 0) {
        for (const row of result.values) {
          await this.hardDelete(row.id);
        }
        console.log(`Auto-cleaned ${result.values.length} deleted customers.`);
        notifyDataChanged({ scope: 'customers', action: 'auto-cleanup' });
      }
    } catch (e) {
      console.error('Auto cleanup error:', e);
    }
  },

  async incrementLatePayments(customerId) {
    const database = await getDatabase();
    await database.run(`UPDATE customers SET late_payments = late_payments + 1 WHERE id = ?`, [customerId]);
    notifyDataChanged({ scope: 'customers', action: 'increment-late-payments', id: customerId });
  },

  async getCreditScore(customerId) {
    const customer = await this.getById(customerId);
    if (!customer) return 'C';
    const late = customer.late_payments || 0;
    if (late === 0) return 'A';
    if (late <= 2) return 'B';
    return 'C';
  },

  async setCurrentMonthStatus(customerId, status) {
    const safeStatus = ['none', 'paid', 'postponed', 'overdue'].includes(status) ? status : 'none';
    const monthKey = getMonthKey();
    const database = await getDatabase();

    const existing = await database.query(
      `SELECT id FROM customer_month_statuses WHERE customer_id = ? AND month_key = ? LIMIT 1`,
      [customerId, monthKey]
    );

    if (existing.values?.[0]?.id) {
      await database.run(
        `UPDATE customer_month_statuses SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [safeStatus, existing.values[0].id]
      );
    } else {
      await database.run(
        `INSERT INTO customer_month_statuses (customer_id, month_key, status) VALUES (?, ?, ?)`,
        [customerId, monthKey, safeStatus]
      );
    }

    notifyDataChanged({ scope: 'customer_month_statuses', action: 'update', id: customerId, monthKey });
  },

  async getCurrentMonthStatusMap(customerIds = []) {
    const ids = [...new Set(customerIds.map(id => Number(id)).filter(Boolean))];
    if (ids.length === 0) return {};

    const database = await getDatabase();
    const { monthKey, startDate, nextMonthDate, todayDate } = getCurrentMonthBounds();
    const placeholders = ids.map(() => '?').join(',');
    const statusMap = ids.reduce((map, id) => {
      map[id] = 'none';
      return map;
    }, {});

    const stored = await database.query(
      `
        SELECT customer_id, status
        FROM customer_month_statuses
        WHERE month_key = ?
        AND customer_id IN (${placeholders})
      `,
      [monthKey, ...ids]
    );

    for (const row of stored.values || []) {
      statusMap[row.customer_id] = row.status || 'none';
    }

    const paid = await database.query(
      `
        SELECT DISTINCT c.customer_id
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.status = 'active'
        AND c.customer_id IN (${placeholders})
        AND i.status = 'paid'
        AND (
          (i.due_date >= ? AND i.due_date < ?)
          OR (i.paid_at IS NOT NULL AND date(i.paid_at) >= ? AND date(i.paid_at) < ?)
        )
      `,
      [...ids, startDate, nextMonthDate, startDate, nextMonthDate]
    );

    for (const row of paid.values || []) {
      if (statusMap[row.customer_id] === 'none') {
        statusMap[row.customer_id] = 'paid';
      }
    }

    const postponed = await database.query(
      `
        SELECT DISTINCT c.customer_id
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.status = 'active'
        AND c.customer_id IN (${placeholders})
        AND i.status = 'postponed'
        AND i.due_date >= ?
        AND i.due_date < ?
      `,
      [...ids, startDate, nextMonthDate]
    );

    for (const row of postponed.values || []) {
      if (statusMap[row.customer_id] === 'none') {
        statusMap[row.customer_id] = 'postponed';
      }
    }

    const overdue = await database.query(
      `
        SELECT DISTINCT c.customer_id
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.status = 'active'
        AND c.customer_id IN (${placeholders})
        AND i.status = 'pending'
        AND i.due_date >= ?
        AND i.due_date < ?
      `,
      [...ids, startDate, todayDate]
    );

    for (const row of overdue.values || []) {
      // A pending installment past its due date overrides a stale monthly label.
      statusMap[row.customer_id] = 'overdue';
    }

    return statusMap;
  },

  // Auto-archive a customer when all their contracts are completed/paid
  async checkAndArchive(customerId) {
    try {
      const customer = await this.getById(customerId);
      if (!customer) return;

      const database = await getDatabase();
    const result = await database.query(
        `SELECT COUNT(*) as active_count FROM contracts WHERE customer_id = ? AND status = 'active'`,
        [customerId]
      );
      const activeCount = result.values?.[0]?.active_count ?? 1;

      if (activeCount === 0 && customer.status === 'active') {
        await database.run(`UPDATE customers SET status = 'archived' WHERE id = ?`, [customerId]);
        console.log(`Customer ${customerId} auto-archived after early settlement.`);
        notifyDataChanged({ scope: 'customers', action: 'archive', id: customerId });
      }
    } catch (err) {
      // Non-fatal: log but don't re-throw so the settlement still reports success
      console.warn('checkAndArchive error (non-fatal):', err);
    }
  }
};

// Contract Operations
export const contractService = {
  async create(contract) {
    const database = await getDatabase();
    const sql = `INSERT INTO contracts (customer_id, title, capital_amount, total_amount, discount_amount, guarantor_name, guarantor_phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const result = await database.run(sql, [
      contract.customer_id, 
      contract.title, 
      contract.capital_amount || 0, 
      contract.total_amount,
      contract.discount_amount || 0, 
      contract.guarantor_name || null, 
      contract.guarantor_phone || null, 
      contract.status || 'active'
    ]);
    const id = result.changes?.lastId || result.lastId;
    notifyDataChanged({ scope: 'contracts', action: 'create', id, customerId: contract.customer_id });
    return id;
  },

  async getByCustomerId(customerId) {
    const database = await getDatabase();
    const sql = `
      SELECT c.*, 
        (SELECT COALESCE(SUM(amount), 0) FROM installments WHERE contract_id = c.id) as total_installments,
        (SELECT COALESCE(SUM(${paidAmountSql()}), 0) FROM installments WHERE contract_id = c.id) as total_paid
      FROM contracts c
      WHERE c.customer_id = ?
      ORDER BY CASE WHEN c.status = 'active' THEN 0 ELSE 1 END, c.creation_date DESC
    `;
    const result = await database.query(sql, [customerId]);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const sql = `
      SELECT c.*,
        (SELECT COALESCE(SUM(amount), 0) FROM installments WHERE contract_id = c.id) as total_installments,
        (SELECT COALESCE(SUM(${paidAmountSql()}), 0) FROM installments WHERE contract_id = c.id) as total_paid
      FROM contracts c
      WHERE c.id = ?
    `;
    const result = await database.query(sql, [id]);
    return result.values?.[0] || null;
  },

  async update(id, contract) {
    const database = await getDatabase();
    // Prevent data loss by merging with existing data
    const existing = await this.getById(id);
    if (!existing) return;

    const data = { ...existing, ...contract };
    const sql = `UPDATE contracts SET title = ?, capital_amount = ?, total_amount = ?, discount_amount = ?, guarantor_name = ?, guarantor_phone = ?, status = ? WHERE id = ?`;
    await database.run(sql, [
      data.title, 
      data.capital_amount, 
      data.total_amount, 
      data.discount_amount || 0, 
      data.guarantor_name, 
      data.guarantor_phone, 
      data.status || 'active', 
      id
    ]);
    notifyDataChanged({ scope: 'contracts', action: 'update', id, customerId: data.customer_id });
  },

  async reschedule(id, contract, schedule) {
    const database = await getDatabase();
    const existing = await this.getById(id);
    if (!existing) throw new Error('تعذر العثور على العقد');

    const data = { ...existing, ...contract };
    const rows = buildInstallmentSchedule({
      totalAmount: data.total_amount,
      monthlyAmount: schedule.monthly_amount,
      installmentCount: schedule.installment_count,
      firstDueDate: schedule.first_due_date
    });

    const oldInstallments = await installmentService.getByContractId(id);
    const totalPaid = roundCurrency(oldInstallments.reduce((sum, item) => sum + getPaidAmount(item), 0));
    const paidAt = oldInstallments
      .filter(item => getPaidAmount(item) > 0 && item.paid_at)
      .map(item => item.paid_at)
      .sort()
      .pop() || null;

    if (totalPaid > Number(data.total_amount || 0)) {
      throw new Error('المدفوع الحالي أكبر من إجمالي العقد الجديد');
    }

    let remainingCredit = totalPaid;
    const rescheduledRows = rows.map((row) => {
      const applied = roundCurrency(Math.min(remainingCredit, row.amount));
      remainingCredit = roundCurrency(remainingCredit - applied);

      return {
        ...row,
        actual_paid: applied,
        status: applied >= row.amount ? 'paid' : 'pending',
        paid_at: applied > 0 ? paidAt : null
      };
    });

    let transactionStarted = false;

    try {
      await database.beginTransaction();
      transactionStarted = true;

      await database.run(
        `UPDATE contracts SET title = ?, capital_amount = ?, total_amount = ?, discount_amount = 0, guarantor_name = ?, guarantor_phone = ?, status = ? WHERE id = ?`,
        [
          data.title,
          data.capital_amount || 0,
          data.total_amount,
          data.guarantor_name || null,
          data.guarantor_phone || null,
          totalPaid >= Number(data.total_amount || 0) ? 'completed' : 'active',
          id
        ],
        false
      );

      await database.run(`DELETE FROM installments WHERE contract_id = ?`, [id], false);

      for (const row of rescheduledRows) {
        await database.run(
          `INSERT INTO installments (contract_id, amount, due_date, status, actual_paid, paid_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [id, row.amount, row.due_date, row.status, row.actual_paid, row.paid_at],
          false
        );
      }

      await database.commitTransaction();
      transactionStarted = false;

      notifyDataChanged({ scope: 'contracts', action: 'reschedule', id, customerId: data.customer_id });

      return {
        totalPaid,
        installmentsCount: rescheduledRows.length,
        remaining: roundCurrency(Number(data.total_amount || 0) - totalPaid)
      };
    } catch (error) {
      if (transactionStarted) {
        try {
          await database.rollbackTransaction();
        } catch (rollbackError) {
          console.warn('Reschedule rollback failed:', rollbackError);
        }
      }

      throw error;
    }
  },

  async delete(id) {
    const database = await getDatabase();
    // Delete all installments for this contract
    await database.run(`DELETE FROM installments WHERE contract_id = ?`, [id]);
    // Delete the contract
    await database.run(`DELETE FROM contracts WHERE id = ?`, [id]);
    notifyDataChanged({ scope: 'contracts', action: 'delete', id });
  },

  async applyEarlySettlement(contractId, discountAmount) {
    const database = await getDatabase();
    // Get contract
    const contract = await this.getById(contractId);
    if (!contract) throw new Error('Contract not found: ' + contractId);

    const safeDiscount = Math.max(0, Number(discountAmount) || 0);

    let transactionStarted = false;
    try {
      await database.beginTransaction();
      transactionStarted = true;

      // 1. Update contract with discount and mark as completed
      await database.run(
        `UPDATE contracts SET discount_amount = ?, status = 'completed' WHERE id = ?`,
        [safeDiscount, contractId],
        false
      );

      // 2. Mark all unpaid/postponed installments as paid in one atomic statement
      await database.run(
        `UPDATE installments SET status = 'paid', actual_paid = amount, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP) WHERE contract_id = ? AND status != 'paid'`,
        [contractId],
        false
      );

      await database.commitTransaction();
      transactionStarted = false;
    } catch (txErr) {
      if (transactionStarted) {
        try {
          await database.rollbackTransaction();
        } catch (rbErr) {
          console.warn('applyEarlySettlement rollback failed:', rbErr);
        }
      }
      throw txErr;
    }

    // 3. Post-settlement status updates (non-fatal)
    try {
      if (contract.customer_id) {
        await customerService.setCurrentMonthStatus(contract.customer_id, 'paid');
      }
    } catch (statusError) {
      console.warn('Monthly status update failed:', statusError);
    }

    // Auto-archive customer if no more active contracts (non-fatal if it fails)
    try {
      if (contract.customer_id) {
        await customerService.checkAndArchive(contract.customer_id);
      }
    } catch (archiveError) {
      console.warn('checkAndArchive failed:', archiveError);
    }

    notifyDataChanged({ scope: 'contracts', action: 'early-settlement', id: contractId, customerId: contract.customer_id });
  },

  async getRemainingBalance(contractId) {
    const contract = await this.getById(contractId);
    if (!contract) return 0;

    const installments = await installmentService.getByContractId(contractId);
    const totalPaid = installments.reduce((sum, i) => sum + getPaidAmount(i), 0);
    const discount = contract.discount_amount || 0;

    return Math.max(0, roundCurrency((contract.total_amount || 0) - totalPaid - discount));
  },

  async getCustomerBalanceSummaries(customerIds = []) {
    const ids = [...new Set(customerIds.map(id => Number(id)).filter(Boolean))];
    if (ids.length === 0) return {};

    const database = await getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const summaries = {};

    ids.forEach(id => {
      summaries[id] = {
        contract_count: 0,
        active_contract_count: 0,
        total_contracts: 0,
        total_discounts: 0,
        total_paid: 0,
        total_remaining: 0
      };
    });

    const contractResult = await database.query(
      `
        SELECT
          customer_id,
          COUNT(*) as contract_count,
          COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) as active_contract_count,
          COALESCE(SUM(CASE WHEN status = 'active' THEN total_amount ELSE 0 END), 0) as total_contracts,
          COALESCE(SUM(CASE WHEN status = 'active' THEN COALESCE(discount_amount, 0) ELSE 0 END), 0) as total_discounts
        FROM contracts
        WHERE customer_id IN (${placeholders})
        GROUP BY customer_id
      `,
      ids
    );

    for (const row of contractResult.values || []) {
      const id = Number(row.customer_id);
      summaries[id] = {
        ...summaries[id],
        contract_count: Number(row.contract_count || 0),
        active_contract_count: Number(row.active_contract_count || 0),
        total_contracts: Number(row.total_contracts || 0),
        total_discounts: Number(row.total_discounts || 0)
      };
    }

    const paidResult = await database.query(
      `
        SELECT
          c.customer_id,
          COALESCE(SUM(${paidAmountSql('i')}), 0) as total_paid
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.status = 'active'
        AND c.customer_id IN (${placeholders})
        GROUP BY c.customer_id
      `,
      ids
    );

    for (const row of paidResult.values || []) {
      const id = Number(row.customer_id);
      summaries[id].total_paid = Number(row.total_paid || 0);
    }

    Object.values(summaries).forEach(summary => {
      summary.total_remaining = Math.max(
        0,
        roundCurrency(summary.total_contracts - summary.total_paid - summary.total_discounts)
      );
    });

    return summaries;
  },

  async getCustomerReportSummaries(customerIds = []) {
    const ids = [...new Set(customerIds.map(id => Number(id)).filter(Boolean))];
    if (ids.length === 0) return {};

    const database = await getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const summaries = {};

    ids.forEach(id => {
      summaries[id] = {
        total_contracts: 0,
        total_discounts: 0,
        total_paid: 0,
        total_remaining: 0
      };
    });

    const contractResult = await database.query(
      `
        SELECT
          customer_id,
          COALESCE(SUM(total_amount), 0) as total_contracts,
          COALESCE(SUM(COALESCE(discount_amount, 0)), 0) as total_discounts
        FROM contracts
        WHERE customer_id IN (${placeholders})
        GROUP BY customer_id
      `,
      ids
    );

    for (const row of contractResult.values || []) {
      const id = Number(row.customer_id);
      summaries[id] = {
        ...summaries[id],
        total_contracts: Number(row.total_contracts || 0),
        total_discounts: Number(row.total_discounts || 0)
      };
    }

    const paidResult = await database.query(
      `
        SELECT
          c.customer_id,
          COALESCE(SUM(${paidAmountSql('i')}), 0) as total_paid
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.customer_id IN (${placeholders})
        GROUP BY c.customer_id
      `,
      ids
    );

    for (const row of paidResult.values || []) {
      const id = Number(row.customer_id);
      summaries[id].total_paid = Number(row.total_paid || 0);
    }

    Object.values(summaries).forEach(summary => {
      summary.total_remaining = Math.max(
        0,
        roundCurrency(summary.total_contracts - summary.total_paid - summary.total_discounts)
      );
    });

    return summaries;
  },

  async getOverdueCustomerMap(customerIds = [], overdueThreshold = 30) {
    const ids = [...new Set(customerIds.map(id => Number(id)).filter(Boolean))];
    if (ids.length === 0) return {};

    const database = await getDatabase();
    const days = Math.max(0, parseInt(overdueThreshold, 10) || 30);
    const cutoffText = formatLocalDate(addLocalDays(new Date(), -days));
    const placeholders = ids.map(() => '?').join(',');
    const result = await database.query(
      `
        SELECT DISTINCT c.customer_id
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.status = 'active'
        AND i.status = 'pending'
        AND i.due_date < ?
        AND c.customer_id IN (${placeholders})
      `,
      [cutoffText, ...ids]
    );

    return (result.values || []).reduce((map, row) => {
      map[row.customer_id] = true;
      return map;
    }, {});
  },

  async getLateCustomerMap(customerIds = []) {
    const ids = [...new Set(customerIds.map(id => Number(id)).filter(Boolean))];
    if (ids.length === 0) return {};

    const database = await getDatabase();
    const todayText = formatLocalDate(new Date());
    const placeholders = ids.map(() => '?').join(',');
    const result = await database.query(
      `
        SELECT DISTINCT c.customer_id
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.status = 'active'
        AND i.status = 'pending'
        AND i.due_date < ?
        AND c.customer_id IN (${placeholders})
      `,
      [todayText, ...ids]
    );

    return (result.values || []).reduce((map, row) => {
      map[row.customer_id] = true;
      return map;
    }, {});
  },

  async getPostponedCustomerMap(customerIds = []) {
    const ids = [...new Set(customerIds.map(id => Number(id)).filter(Boolean))];
    if (ids.length === 0) return {};

    const database = await getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const result = await database.query(
      `
        SELECT DISTINCT c.customer_id
        FROM contracts c
        JOIN installments i ON i.contract_id = c.id
        WHERE c.status = 'active'
        AND i.status = 'postponed'
        AND c.customer_id IN (${placeholders})
      `,
      ids
    );

    return (result.values || []).reduce((map, row) => {
      map[row.customer_id] = true;
      return map;
    }, {});
  },

  async getTotalRemainingByCustomer(customerId) {
    const contracts = await this.getByCustomerId(customerId);
    let totalRemaining = 0;
    for (const contract of contracts) {
      if (contract.status === 'active') {
        totalRemaining += await this.getRemainingBalance(contract.id);
      }
    }
    return totalRemaining;
  }
};

// Installment Operations
export const installmentService = {
  async create(installment) {
    const database = await getDatabase();
    const sql = `INSERT INTO installments (contract_id, amount, due_date, status) VALUES (?, ?, ?, ?)`;
    const result = await database.run(sql, [
      installment.contract_id, 
      installment.amount, 
      installment.due_date, 
      installment.status || 'pending'
    ]);
    const id = result.changes?.lastId || result.lastId;
    notifyDataChanged({ scope: 'installments', action: 'create', id, contractId: installment.contract_id });
    return id;
  },

  async getByContractId(contractId) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM installments WHERE contract_id = ? ORDER BY due_date ASC`, [contractId]);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM installments WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async pay(id, actualPaid, receiptPath = null, discount = 0) {
    const installment = await this.getById(id);
    if (!installment) return;

    const database = await getDatabase();
    let remainingPayment = roundCurrency((Number(actualPaid) || 0) + (Number(discount) || 0));
    if (remainingPayment <= 0) return;

    const applyPayment = async (target, amountToApply, includeReceipt = false) => {
      const due = Number(target.amount || 0);
      const paidBefore = getPaidAmount(target);
      const remainingDue = Math.max(0, roundCurrency(due - paidBefore));
      const applied = roundCurrency(Math.min(amountToApply, remainingDue));
      const paidAfter = roundCurrency(paidBefore + applied);
      const isPaid = paidAfter + 0.009 >= due;
      const finalPaid = isPaid ? due : paidAfter;

      if (includeReceipt) {
        await database.run(
          `UPDATE installments SET status = ?, actual_paid = ?, receipt_image_path = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [isPaid ? 'paid' : 'pending', finalPaid, receiptPath, target.id]
        );
      } else {
        await database.run(
          `UPDATE installments SET status = ?, actual_paid = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [isPaid ? 'paid' : 'pending', finalPaid, target.id]
        );
      }

      return applied;
    };

    const paidCurrent = await applyPayment(installment, remainingPayment, true);
    remainingPayment = roundCurrency(remainingPayment - paidCurrent);

    if (remainingPayment > 0) {
      const pending = await database.query(
        `SELECT * FROM installments WHERE contract_id = ? AND status = 'pending' AND id != ? ORDER BY due_date DESC, id DESC`,
        [installment.contract_id, id]
      );

      for (const next of pending.values || []) {
        if (remainingPayment <= 0) break;
        const applied = await applyPayment(next, remainingPayment);
        remainingPayment = roundCurrency(remainingPayment - applied);
      }
    }

    const updatedInstallment = await this.getById(id);
    const contract = await contractService.getById(installment.contract_id);
    if (contract && updatedInstallment && getRemainingAmount(updatedInstallment) <= 0) {
      try {
        await customerService.setCurrentMonthStatus(contract.customer_id, 'paid');
      } catch (statusError) {
        console.warn('Monthly status update failed:', statusError);
      }
    }

    notifyDataChanged({ scope: 'installments', action: 'pay', id, contractId: installment.contract_id });
  },

  async postpone(id, mode = 'end') {
    const installment = await this.getById(id);
    if (!installment || installment.status !== 'pending') return;

    const database = await getDatabase();
    const remainingAmount = getRemainingAmount(installment);
    if (remainingAmount <= 0) {
      await database.run(
        `UPDATE installments SET status = 'paid', actual_paid = ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [installment.amount, id]
      );
      const contract = await contractService.getById(installment.contract_id);
      if (contract) {
        try {
          await customerService.setCurrentMonthStatus(contract.customer_id, 'paid');
        } catch (statusError) {
          console.warn('Monthly status update failed:', statusError);
        }
      }
      notifyDataChanged({ scope: 'installments', action: 'postpone', id, contractId: installment.contract_id });
      return;
    }

    let transactionStarted = false;
    let generatedInstallmentId = null;
    let targetInstallmentId = null;
    let targetOriginalAmount = null;

    try {
      await database.beginTransaction();
      transactionStarted = true;

      await database.run(`UPDATE installments SET status = 'postponed', is_late = 0 WHERE id = ?`, [id], false);

      if (mode === 'next') {
        const nextResult = await database.query(
          `SELECT * FROM installments WHERE contract_id = ? AND status = 'pending' AND due_date > ? ORDER BY due_date ASC, id ASC LIMIT 1`,
          [installment.contract_id, installment.due_date]
        );

        const next = nextResult.values?.[0];
        if (next) {
          targetInstallmentId = next.id;
          targetOriginalAmount = Number(next.amount || 0);
          await database.run(`UPDATE installments SET amount = amount + ? WHERE id = ?`, [remainingAmount, next.id], false);
        } else {
          const lastResult = await database.query(
            `SELECT due_date FROM installments WHERE contract_id = ? ORDER BY due_date DESC, id DESC LIMIT 1`,
            [installment.contract_id]
          );
          const lastDate = lastResult.values?.[0]?.due_date || installment.due_date;
          const insertResult = await database.run(
            `INSERT INTO installments (contract_id, amount, due_date, status, actual_paid) VALUES (?, ?, ?, 'pending', 0)`,
            [installment.contract_id, remainingAmount, formatLocalDate(addLocalMonths(lastDate, 1))],
            false
          );
          generatedInstallmentId = insertResult.changes?.lastId || insertResult.lastId;
        }
      } else {
        const lastResult = await database.query(
          `SELECT due_date FROM installments WHERE contract_id = ? ORDER BY due_date DESC, id DESC LIMIT 1`,
          [installment.contract_id]
        );
        const lastDate = lastResult.values?.[0]?.due_date || installment.due_date;
        const insertResult = await database.run(
          `INSERT INTO installments (contract_id, amount, due_date, status, actual_paid) VALUES (?, ?, ?, 'pending', 0)`,
          [installment.contract_id, remainingAmount, formatLocalDate(addLocalMonths(lastDate, 1))],
          false
        );
        generatedInstallmentId = insertResult.changes?.lastId || insertResult.lastId;
      }

      await database.run(
        `INSERT INTO installment_postponements
          (installment_id, contract_id, mode, postponed_amount, target_installment_id, target_original_amount, generated_installment_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          installment.contract_id,
          mode === 'next' ? 'next' : 'end',
          remainingAmount,
          targetInstallmentId,
          targetOriginalAmount,
          generatedInstallmentId
        ],
        false
      );

      await database.commitTransaction();
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          await database.rollbackTransaction();
        } catch (rollbackError) {
          console.warn('Postpone rollback failed:', rollbackError);
        }
      }

      throw error;
    }

    const contract = await contractService.getById(installment.contract_id);
    if (contract) {
      try {
        await customerService.setCurrentMonthStatus(contract.customer_id, 'postponed');
      } catch (statusError) {
        console.warn('Monthly status update failed:', statusError);
      }
    }

    notifyDataChanged({ scope: 'installments', action: 'postpone', id, contractId: installment.contract_id });
  },

  async undoPostpone(id) {
    const installment = await this.getById(id);
    if (!installment || installment.status !== 'postponed') {
      throw new Error('لا يمكن إلغاء التأجيل إلا لقسط مؤجل');
    }

    const database = await getDatabase();
    const actionResult = await database.query(
      `
        SELECT *
        FROM installment_postponements
        WHERE installment_id = ?
        AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `,
      [id]
    );
    const action = actionResult.values?.[0];

    if (!action) {
      throw new Error('لا يمكن إلغاء هذا التأجيل بأمان لأنه تم قبل إضافة سجل الرجوع');
    }

    const deferredAmount = roundCurrency(action.postponed_amount);
    let transactionStarted = false;

    try {
      await database.beginTransaction();
      transactionStarted = true;

      if (action.generated_installment_id) {
        const generatedResult = await database.query(
          `SELECT * FROM installments WHERE id = ? LIMIT 1`,
          [action.generated_installment_id]
        );
        const generated = generatedResult.values?.[0];

        if (!generated) {
          throw new Error('لا يمكن إلغاء التأجيل لأن القسط الناتج غير موجود');
        }

        if (generated.status !== 'pending' || getPaidAmount(generated) > 0) {
          throw new Error('لا يمكن إلغاء التأجيل لأن القسط الناتج تم دفعه أو تعديله');
        }

        if (Math.abs(roundCurrency(Number(generated.amount || 0) - deferredAmount)) > 0.009) {
          throw new Error('لا يمكن إلغاء التأجيل لأن مبلغ القسط الناتج تغير بعد التأجيل');
        }

        await database.run(`DELETE FROM installments WHERE id = ?`, [generated.id], false);
      } else if (action.target_installment_id) {
        const targetResult = await database.query(
          `SELECT * FROM installments WHERE id = ? LIMIT 1`,
          [action.target_installment_id]
        );
        const target = targetResult.values?.[0];

        if (!target) {
          throw new Error('لا يمكن إلغاء التأجيل لأن القسط التالي غير موجود');
        }

        if (target.status !== 'pending' || getPaidAmount(target) > 0) {
          throw new Error('لا يمكن إلغاء التأجيل لأن القسط التالي تم دفعه أو تعديله');
        }

        const expectedAmount = roundCurrency(Number(action.target_original_amount || 0) + deferredAmount);
        if (Math.abs(roundCurrency(Number(target.amount || 0) - expectedAmount)) > 0.009) {
          throw new Error('لا يمكن إلغاء التأجيل لأن مبلغ القسط التالي تغير بعد التأجيل');
        }

        await database.run(
          `UPDATE installments SET amount = ? WHERE id = ?`,
          [roundCurrency(action.target_original_amount), target.id],
          false
        );
      } else {
        throw new Error('لا يمكن إلغاء التأجيل لأن سجل التأجيل غير مكتمل');
      }

      await database.run(
        `UPDATE installments SET status = 'pending', is_late = 0 WHERE id = ?`,
        [id],
        false
      );
      await database.run(
        `UPDATE installment_postponements SET status = 'undone', undone_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [action.id],
        false
      );

      await database.commitTransaction();
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          await database.rollbackTransaction();
        } catch (rollbackError) {
          console.warn('Undo postpone rollback failed:', rollbackError);
        }
      }

      throw error;
    }

    const contract = await contractService.getById(installment.contract_id);
    if (contract) {
      try {
        await customerService.setCurrentMonthStatus(contract.customer_id, 'none');
      } catch (statusError) {
        console.warn('Monthly status update failed:', statusError);
      }
    }

    notifyDataChanged({ scope: 'installments', action: 'undo-postpone', id, contractId: installment.contract_id });
  },

  async undoPay(id) {
    const database = await getDatabase();
    
    // Get installment details first
    const installment = await this.getById(id);
    if (!installment) return;

    // 1. Reset installment status
    const sql = `UPDATE installments SET status = 'pending', actual_paid = 0, paid_at = NULL, receipt_image_path = NULL WHERE id = ?`;
    await database.run(sql, [id]);

    // 2. Reactivate the contract
    await database.run(`UPDATE contracts SET status = 'active' WHERE id = ?`, [installment.contract_id]);

    // 3. Reactivate the customer
    const contract = await contractService.getById(installment.contract_id);
    if (contract) {
      await database.run(`UPDATE customers SET status = 'active' WHERE id = ?`, [contract.customer_id]);
      console.log(`Customer ${contract.customer_id} and Contract ${contract.id} reactivated after undo payment.`);
      try {
        await customerService.setCurrentMonthStatus(contract.customer_id, 'none');
      } catch (statusError) {
        console.warn('Monthly status update failed:', statusError);
      }
    }
    notifyDataChanged({ scope: 'installments', action: 'undo-pay', id, contractId: installment.contract_id });
  },

  async getUpcoming(rangeDays = 7) {
    const database = await getDatabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayText = formatLocalDate(today);
    const horizonText = formatLocalDate(addLocalDays(today, Math.max(0, parseInt(rangeDays, 10) || 7)));
    const sql = `
      SELECT i.*, c.title as contract_title, cu.name as customer_name, cu.phone as customer_phone, m.name as manager_name
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN managers m ON cu.manager_id = m.id
      WHERE i.status = 'pending' 
       AND c.status = 'active'
       AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
       AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
       AND (cu.deleted_manager_id IS NULL OR cu.deleted_manager_id = 0)
       AND (m.id IS NULL OR m.is_deleted IS NULL OR m.is_deleted = 0)
       AND i.due_date BETWEEN ? AND ?
      ORDER BY i.due_date ASC
    `;
    const result = await database.query(sql, [todayText, horizonText]);
    return result.values || [];
  },

  async getOverdue() {
    const database = await getDatabase();
    const todayText = formatLocalDate(new Date());
    const sql = `
      SELECT i.*, c.title as contract_title, cu.name as customer_name, cu.phone as customer_phone, m.name as manager_name
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN managers m ON cu.manager_id = m.id
      WHERE i.status = 'pending' 
       AND c.status = 'active'
       AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
       AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
       AND (cu.deleted_manager_id IS NULL OR cu.deleted_manager_id = 0)
       AND (m.id IS NULL OR m.is_deleted IS NULL OR m.is_deleted = 0)
       AND i.due_date < ?
      ORDER BY i.due_date ASC
    `;
    const result = await database.query(sql, [todayText]);
    return result.values || [];
  },

  async getHomeAlerts(days = 3) {
    const database = await getDatabase();
    const overdueThreshold = parseInt(await settingsService.get('overdue_threshold_days'), 10) || 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayText = formatLocalDate(today);
    const horizonText = formatLocalDate(addLocalDays(today, Math.max(1, parseInt(days, 10) || 3)));
    const debtorCutoffText = formatLocalDate(addLocalDays(today, -overdueThreshold));

    const sql = `
      SELECT i.*, c.title as contract_title, cu.id as customer_id, cu.name as customer_name, cu.phone as customer_phone, m.name as manager_name
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      LEFT JOIN managers m ON cu.manager_id = m.id
      WHERE i.status = 'pending'
      AND c.status = 'active'
       AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
       AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
       AND (cu.deleted_manager_id IS NULL OR cu.deleted_manager_id = 0)
       AND (m.id IS NULL OR m.is_deleted IS NULL OR m.is_deleted = 0)
       AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND NOT EXISTS (
        SELECT 1
        FROM installments oi
        JOIN contracts oc ON oi.contract_id = oc.id
        WHERE oc.customer_id = cu.id
        AND oc.status = 'active'
        AND oi.status = 'pending'
        AND oi.due_date < ?
      )
      AND i.due_date <= ?
      ORDER BY i.due_date ASC, i.id ASC
    `;

    const result = await database.query(sql, [debtorCutoffText, horizonText]);
    const rows = result.values || [];
    const alerts = {
      late: [],
      today: [],
      upcoming: [],
      totalAmount: 0
    };

    rows.forEach((item) => {
      const remaining = Math.max(0, (item.amount || 0) - (item.actual_paid || 0));
      alerts.totalAmount += remaining || item.amount || 0;

      if (item.due_date < todayText) {
        alerts.late.push(item);
      } else if (item.due_date === todayText) {
        alerts.today.push(item);
      } else {
        alerts.upcoming.push(item);
      }
    });

    return {
      ...alerts,
      total: rows.length
    };
  }
};

// Expense Operations
export const expenseService = {
  async create(expense) {
    const database = await getDatabase();
    const sql = `INSERT INTO expenses (description, amount, category, date) VALUES (?, ?, ?, ?)`;
    const result = await database.run(sql, [
      expense.description, 
      expense.amount, 
      expense.category || 'أخرى', 
      expense.date || new Date().toISOString().split('T')[0]
    ]);
    const id = result.changes?.lastId || result.lastId;
    notifyDataChanged({ scope: 'expenses', action: 'create', id });
    return id;
  },

  async getAll() {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM expenses ORDER BY date DESC, created_at DESC`);
    return result.values || [];
  },

  async getByCategory(category) {
    const database = await getDatabase();
    if (category === 'الكل') return await this.getAll();
    const result = await database.query(`SELECT * FROM expenses WHERE category = ? ORDER BY date DESC`, [category]);
    return result.values || [];
  },

  async update(id, expense) {
    const database = await getDatabase();
    const existing = await database.query(`SELECT * FROM expenses WHERE id = ?`, [id]);
    const current = existing.values?.[0];
    if (!current) return;

    const data = { ...current, ...expense };
    await database.run(`UPDATE expenses SET description = ?, amount = ?, category = ?, date = ? WHERE id = ?`,
      [data.description, data.amount, data.category, data.date, id]);
    notifyDataChanged({ scope: 'expenses', action: 'update', id });
  },

  async delete(id) {
    const database = await getDatabase();
    await database.run(`DELETE FROM expenses WHERE id = ?`, [id]);
    notifyDataChanged({ scope: 'expenses', action: 'delete', id });
  },

  async getTotal() {
    const database = await getDatabase();
    const result = await database.query(`SELECT SUM(amount) as total FROM expenses`);
    return Math.round(result.values?.[0]?.total || 0);
  },

  async getTotalByCategory(category) {
    const result = await db.query(`SELECT SUM(amount) as total FROM expenses WHERE category = ?`, [category]);
    return Math.round(result.values?.[0]?.total || 0);
  }
};

// Settings Operations
export const settingsService = {
  async get(key) {
    const database = await getDatabase();
    const result = await database.query(`SELECT value FROM settings WHERE key = ?`, [key]);
    return result.values?.[0]?.value || null;
  },

  async set(key, value) {
    const database = await getDatabase();
    await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value]);
    notifyDataChanged({ scope: 'settings', action: 'set', key });
  },

  async getWhatsAppTemplate() {
    return await this.get('whatsapp_template') || DEFAULT_WHATSAPP_TEMPLATE;
  },

  async isBiometricEnabled() {
    return (await this.get('biometric_enabled')) !== 'false';
  }
};

// Dashboard Statistics
export const dashboardService = {
  async getStats() {
    const database = await getDatabase();
    // Only sum total_amount for contracts that are still 'active'
    const totalInstallments = await database.query(`
      SELECT SUM(c.total_amount) as total 
      FROM contracts c
      JOIN customers cu ON c.customer_id = cu.id
      WHERE c.status = 'active' 
      AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
      AND (cu.deleted_manager_id IS NULL OR cu.deleted_manager_id = 0)
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    // Include partial payments on active contracts.
    const totalPaid = await database.query(`
      SELECT SUM(${paidAmountSql('i')}) as total
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      WHERE c.status = 'active'
      AND (cu.manager_id IS NULL OR cu.manager_id = 0 OR cu.manager_id = '')
      AND (cu.deleted_manager_id IS NULL OR cu.deleted_manager_id = 0)
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    const totalInstallmentsValue = totalInstallments.values?.[0]?.total || 0;
    const totalPaidValue = totalPaid.values?.[0]?.total || 0;

    return {
      totalInstallments: totalInstallmentsValue,
      totalPaid: totalPaidValue,
      totalRemaining: Math.max(0, totalInstallmentsValue - totalPaidValue)
    };
  },

  async getManagerStats() {
    const database = await getDatabase();
    
    // Get stats only from active contracts linked to managers (visible in UI)
    // This ensures stats match what's actually displayed in the managers section
    const totalInstallments = await database.query(`
      SELECT SUM(c.total_amount) as total 
      FROM contracts c
      JOIN customers cu ON c.customer_id = cu.id
      JOIN managers m ON cu.manager_id = m.id
      WHERE c.status = 'active' 
      AND cu.manager_id IS NOT NULL 
      AND cu.manager_id != 0 
      AND cu.manager_id != ''
      AND (m.is_deleted IS NULL OR m.is_deleted = 0)
      AND cu.status != 'archived'
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    const totalPaid = await database.query(`
      SELECT SUM(${paidAmountSql('i')}) as total
      FROM installments i
      JOIN contracts c ON i.contract_id = c.id
      JOIN customers cu ON c.customer_id = cu.id
      JOIN managers m ON cu.manager_id = m.id
      WHERE c.status = 'active'
      AND cu.manager_id IS NOT NULL 
      AND cu.manager_id != 0 
      AND cu.manager_id != ''
      AND (m.is_deleted IS NULL OR m.is_deleted = 0)
      AND cu.status != 'archived'
      AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
      AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
    `);
    
    const totalInstallmentsValue = totalInstallments.values?.[0]?.total || 0;
    const totalPaidValue = totalPaid.values?.[0]?.total || 0;

    return {
      managerTotalInstallments: totalInstallmentsValue,
      managerTotalPaid: totalPaidValue,
      managerTotalRemaining: Math.max(0, totalInstallmentsValue - totalPaidValue)
    };
  }

};

// Portfolio Operations
export const portfolioService = {
  async create(portfolio) {
    const database = await getDatabase();
    const sql = `INSERT INTO portfolios (name, capital, description) VALUES (?, ?, ?)`;
    const result = await database.run(sql, [
      portfolio.name, 
      portfolio.capital, 
      portfolio.description || null
    ]);
    const id = result.changes?.lastId || result.lastId;
    notifyDataChanged({ scope: 'portfolios', action: 'create', id });
    return id;
  },

  async getAll() {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM portfolios ORDER BY created_at DESC`);
    return result.values || [];
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM portfolios WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async update(id, portfolio) {
    const database = await getDatabase();
    const existing = await this.getById(id);
    if (!existing) return;

    const data = { ...existing, ...portfolio };
    const sql = `UPDATE portfolios SET name = ?, capital = ?, description = ? WHERE id = ?`;
    await database.run(sql, [data.name, data.capital, data.description, id]);
    notifyDataChanged({ scope: 'portfolios', action: 'update', id });
  },

  async addCapital(id, amount, receipt = {}) {
    const value = roundCurrency(amount);
    if (value <= 0) return;

    const database = await getDatabase();
    await database.run(
      `UPDATE portfolios SET capital = COALESCE(capital, 0) + ? WHERE id = ?`,
      [value, id]
    );
    const receiptResult = await database.run(
      `INSERT INTO portfolio_expenses (portfolio_id, amount, description, date, entry_type)
       VALUES (?, ?, ?, ?, 'receipt')`,
      [id, value, receipt.description || 'سند قبض - إضافة مبلغ', receipt.date || new Date().toISOString().split('T')[0]]
    );
    const receiptId = receiptResult.changes?.lastId || receiptResult.lastId;
    notifyDataChanged({ scope: 'portfolios', action: 'add-capital', id, amount: value, receiptId });
  },

  async delete(id) {
    const database = await getDatabase();
    await database.run(`DELETE FROM portfolios WHERE id = ?`, [id]);
    notifyDataChanged({ scope: 'portfolios', action: 'delete', id });
  }
};

// Portfolio Expense Operations
export const portfolioExpenseService = {
  async create(expense) {
    const database = await getDatabase();
    const sql = `INSERT INTO portfolio_expenses (portfolio_id, amount, description, date, entry_type) VALUES (?, ?, ?, ?, ?)`;
    const result = await database.run(sql, [
      expense.portfolio_id, 
      expense.amount, 
      expense.description || null, 
      expense.date || new Date().toISOString().split('T')[0],
      expense.entry_type || 'expense'
    ]);
    const id = result.changes?.lastId || result.lastId;
    notifyDataChanged({ scope: 'portfolio_expenses', action: 'create', id, portfolioId: expense.portfolio_id });
    return id;
  },

  async getByPortfolioId(portfolioId) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM portfolio_expenses WHERE portfolio_id = ? ORDER BY date DESC, created_at DESC`, [portfolioId]);
    return result.values || [];
  },

  async delete(id) {
    const database = await getDatabase();
    const existingResult = await database.query(
      `SELECT portfolio_id, amount, entry_type FROM portfolio_expenses WHERE id = ?`,
      [id]
    );
    const existing = existingResult.values?.[0];

    if (existing?.entry_type === 'receipt') {
      await database.run(
        `UPDATE portfolios SET capital = COALESCE(capital, 0) - ? WHERE id = ?`,
        [existing.amount, existing.portfolio_id]
      );
    }

    await database.run(`DELETE FROM portfolio_expenses WHERE id = ?`, [id]);
    notifyDataChanged({
      scope: 'portfolio_expenses',
      action: 'delete',
      id,
      portfolioId: existing?.portfolio_id
    });
  },

  async update(id, expense) {
    const database = await getDatabase();
    const value = roundCurrency(expense.amount);
    if (value <= 0) throw new Error('Expense amount must be greater than zero');

    const existingResult = await database.query(
      `SELECT portfolio_id, amount, entry_type FROM portfolio_expenses WHERE id = ?`,
      [id]
    );
    const existing = existingResult.values?.[0];
    if (!existing) return;

    if (existing.entry_type === 'receipt') {
      const delta = roundCurrency(value - Number(existing.amount || 0));
      if (delta !== 0) {
        await database.run(
          `UPDATE portfolios SET capital = COALESCE(capital, 0) + ? WHERE id = ?`,
          [delta, existing.portfolio_id]
        );
      }
    }

    await database.run(
      `UPDATE portfolio_expenses
       SET amount = ?, description = ?, date = ?
       WHERE id = ?`,
      [value, expense.description || null, expense.date || new Date().toISOString().split('T')[0], id]
    );
    notifyDataChanged({
      scope: 'portfolio_expenses',
      action: 'update',
      id,
      portfolioId: existing.portfolio_id
    });
  },

  async getStats(portfolioId) {
    const database = await getDatabase();
    const result = await database.query(
      `SELECT SUM(amount) as total
       FROM portfolio_expenses
       WHERE portfolio_id = ? AND COALESCE(entry_type, 'expense') = 'expense'`,
      [portfolioId]
    );
    return result.values?.[0]?.total || 0;
  }
};

// Manager Operations
export const managerService = {
  async create(manager) {
    const database = await getDatabase();
    const sql = `INSERT INTO managers (name, phone) VALUES (?, ?)`;
    const result = await database.run(sql, [manager.name, manager.phone || null]);
    const id = result.changes?.lastId || result.lastId;
    notifyDataChanged({ scope: 'managers', action: 'create', id });
    return id;
  },

  async getAllWithStats(includeDeleted = false) {
    const database = await getDatabase();
    const managerStateFilter = includeDeleted
      ? `m.is_deleted = 1`
      : `(m.is_deleted IS NULL OR m.is_deleted = 0)`;
    const sql = `
      SELECT 
        m.*,
        (
          SELECT COALESCE(SUM(c.total_amount), 0)
          FROM contracts c
          JOIN customers cu ON c.customer_id = cu.id
          WHERE cu.manager_id = m.id
          AND c.status = 'active'
          AND cu.status != 'archived'
          AND (cu.is_manually_flagged_as_overdue IS NULL OR cu.is_manually_flagged_as_overdue = 0)
          AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
        ) as total_contracts,
        (
          SELECT COALESCE(SUM(${paidAmountSql('i')}), 0)
          FROM installments i
          JOIN contracts c2 ON i.contract_id = c2.id
          JOIN customers cu2 ON c2.customer_id = cu2.id
          WHERE cu2.manager_id = m.id 
          AND c2.status = 'active'
          AND cu2.status != 'archived'
          AND (cu2.is_manually_flagged_as_overdue IS NULL OR cu2.is_manually_flagged_as_overdue = 0)
          AND (cu2.is_deleted IS NULL OR cu2.is_deleted = 0)
        ) as total_paid
        ,(
          SELECT COUNT(DISTINCT cu3.id)
          FROM customers cu3
          WHERE cu3.manager_id = m.id
          AND cu3.status != 'archived'
          AND (cu3.is_deleted IS NULL OR cu3.is_deleted = 0)
        ) as customer_count
        ,(
          SELECT COUNT(*)
          FROM contracts c3
          JOIN customers cu4 ON c3.customer_id = cu4.id
          WHERE cu4.manager_id = m.id
          AND c3.status = 'active'
          AND cu4.status != 'archived'
          AND (cu4.is_deleted IS NULL OR cu4.is_deleted = 0)
        ) as active_contract_count
      FROM managers m
      WHERE ${managerStateFilter}
      ORDER BY m.created_at DESC
    `;
    const result = await database.query(sql);
    
    return (result.values || []).map(m => {
      const contracts = Number(m.total_contracts) || 0;
      const paid = Number(m.total_paid) || 0;
      return {
        ...m,
        total_contracts: contracts,
        total_paid: paid,
        total_remaining: Math.max(0, contracts - paid),
        customer_count: Number(m.customer_count) || 0,
        active_contract_count: Number(m.active_contract_count) || 0
      };
    });
  },

  async getById(id) {
    const database = await getDatabase();
    const result = await database.query(`SELECT * FROM managers WHERE id = ?`, [id]);
    return result.values?.[0] || null;
  },

  async delete(id) {
    const database = await getDatabase();
    await database.run(
      `UPDATE managers SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
    notifyDataChanged({ scope: 'managers', action: 'delete', id });
  },

  async restore(id) {
    const database = await getDatabase();
    await database.run(
      `UPDATE managers SET is_deleted = 0, deleted_at = NULL WHERE id = ? AND is_deleted = 1`,
      [id]
    );
    notifyDataChanged({ scope: 'managers', action: 'restore', id });
  },

  async hardDelete(id) {
    const database = await getDatabase();
    await database.run(
      `UPDATE customers
       SET deleted_manager_id = manager_id, manager_id = NULL
       WHERE manager_id = ?`,
      [id]
    );
    await database.run(`DELETE FROM managers WHERE id = ? AND is_deleted = 1`, [id]);
    notifyDataChanged({ scope: 'managers', action: 'hard-delete', id });
  },

  async cleanupDeleted() {
    const database = await getDatabase();
    const result = await database.query(
      `SELECT id FROM managers
       WHERE is_deleted = 1
       AND deleted_at IS NOT NULL
       AND deleted_at <= datetime('now', '-7 days')`
    );

    for (const manager of result.values || []) {
      await this.hardDelete(manager.id);
    }
  },

  async getManagersWithOverdueCount(overdueThreshold = 30) {
    const database = await getDatabase();
    try {
      const days = Math.max(0, parseInt(overdueThreshold, 10) || 30);
      const cutoffText = formatLocalDate(addLocalDays(new Date(), -days));
      const sql = `
        SELECT 
          m.*,
          (
            SELECT COUNT(DISTINCT cu.id)
            FROM customers cu
            LEFT JOIN contracts c ON cu.id = c.customer_id
            LEFT JOIN installments i ON c.id = i.contract_id
            WHERE cu.manager_id = m.id 
            AND c.status = 'active'
            AND cu.status != 'archived'
            AND (
              cu.is_manually_flagged_as_overdue = 1
               OR (i.status = 'pending' AND i.due_date < ?)
            )
            AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
          ) as overdue_customer_count,
          (
            SELECT COUNT(DISTINCT cu0.id)
            FROM customers cu0
            WHERE cu0.manager_id = m.id
            AND cu0.status != 'archived'
            AND (cu0.is_deleted IS NULL OR cu0.is_deleted = 0)
          ) as customer_count,
          (
            SELECT COUNT(*)
            FROM contracts c0
            JOIN customers cu0 ON c0.customer_id = cu0.id
            WHERE cu0.manager_id = m.id
            AND c0.status = 'active'
            AND cu0.status != 'archived'
            AND (cu0.is_deleted IS NULL OR cu0.is_deleted = 0)
          ) as active_contract_count,
          (
            SELECT COALESCE(SUM(c.total_amount), 0)
            FROM contracts c
            JOIN customers cu ON c.customer_id = cu.id
            WHERE cu.manager_id = m.id
            AND c.status = 'active'
            AND cu.status != 'archived'
            AND EXISTS (
              SELECT 1 FROM installments i 
              WHERE i.contract_id = c.id 
              AND (
                cu.is_manually_flagged_as_overdue = 1
                 OR (i.status = 'pending' AND i.due_date < ?)
              )
            )
            AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
          ) as total_contracts,
          (
            SELECT COALESCE(SUM(${paidAmountSql('i')}), 0)
            FROM installments i
            JOIN contracts c ON i.contract_id = c.id
            JOIN customers cu ON c.customer_id = cu.id
            WHERE cu.manager_id = m.id
            AND c.status = 'active'
            AND cu.status != 'archived'
            AND EXISTS (
              SELECT 1 FROM installments i2
              WHERE i2.contract_id = c.id
              AND (
                cu.is_manually_flagged_as_overdue = 1
                 OR (i2.status = 'pending' AND i2.due_date < ?)
              )
            )
            AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
          ) as total_paid
        FROM managers m
        WHERE (
          SELECT COUNT(*) 
          FROM customers cu 
          LEFT JOIN contracts c ON cu.id = c.customer_id
          LEFT JOIN installments i ON c.id = i.contract_id
          WHERE cu.manager_id = m.id 
          AND c.status = 'active'
          AND cu.status != 'archived'
          AND (
            cu.is_manually_flagged_as_overdue = 1
             OR (i.status = 'pending' AND i.due_date < ?)
          )
          AND (cu.is_deleted IS NULL OR cu.is_deleted = 0)
        ) > 0
        AND (m.is_deleted IS NULL OR m.is_deleted = 0)
      `;
      const result = await database.query(sql, [cutoffText, cutoffText, cutoffText, cutoffText]);
      return (result.values || []).map(m => ({
        ...m,
        total_remaining: Math.max(0, (m.total_contracts || 0) - (m.total_paid || 0))
      }));
    } catch (error) {
      console.error('getManagersWithOverdueCount error:', error);
      return [];
    }
  }
};
