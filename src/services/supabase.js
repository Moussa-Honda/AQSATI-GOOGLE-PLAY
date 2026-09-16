import { createClient } from '@supabase/supabase-js';

const sanitizeSupabaseUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  let trimmed = url.trim();
  if (!trimmed) return null;

  // Extract from markdown link if pasted as [url](url) or similar
  const markdownMatch = trimmed.match(/\((https?:\/\/[^\)]+)\)/) || trimmed.match(/\[(https?:\/\/[^\]]+)\]/);
  if (markdownMatch) {
    trimmed = markdownMatch[1];
  }
  trimmed = trimmed.replace(/[\[\]\(\)\s]/g, '');

  // Auto-prepend https:// if protocol was omitted
  const withProtocol = (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))
    ? `https://${trimmed}`
    : trimmed;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
};

const sanitizeSupabaseKey = (key) => {
  if (!key || typeof key !== 'string') return null;
  const cleaned = key.trim().replace(/[\[\]\(\)\`\'\"\s]/g, '');
  return cleaned.length > 10 ? cleaned : null;
};

const DEFAULT_SUPABASE_URL = 'https://ehufhgulrubgnntmdhxn.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_5O9wP_WCo3zqIkNzI_8Cpg_hYFM9NGC';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

const supabaseUrl = sanitizeSupabaseUrl(rawUrl);
const supabaseKey = sanitizeSupabaseKey(rawKey);

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseKey && supabaseKey.length > 10);

let client = null;
if (isSupabaseConfigured()) {
  try {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });
  } catch (err) {
    console.warn('[Supabase] Failed to initialize Supabase client:', err);
    client = null;
  }
}

export const supabase = client;

/**
 * اختبار الاتصال بمشروع Supabase
 */
export const testSupabaseConnection = async () => {
  if (!supabase) {
    return { ok: false, error: 'لم يتم تكوين بيانات Supabase في متغيرات البيئة.' };
  }

  try {
    // محاولة قراءة خفيفة للتحقق من الاتصال
    const { error } = await supabase.from('fazatak_backups').select('id').limit(1);
    if (error && error.code !== 'PGRST116' && error.code !== '42P01') {
      // 42P01 يعني أن الجدول غير منشأ بعد لكن الاتصال والتوثيق سليم 100%
      return { ok: false, error: error.message };
    }
    return { ok: true, tableReady: error?.code !== '42P01' };
  } catch (err) {
    return { ok: false, error: err.message || 'فشل الاتصال بـ Supabase' };
  }
};

/**
 * حفظ نسخة احتياطية سحابية كاملة في Supabase
 */
export const saveCloudBackup = async (backupPayload) => {
  if (!supabase) {
    throw new Error('Supabase غير مهيأ، يرجى ضبط VITE_SUPABASE_URL و VITE_SUPABASE_PUBLISHABLE_KEY');
  }

  const record = {
    file_name: backupPayload.fileName || 'أقساطي_Backup.json',
    version: backupPayload.version || '2.0-offline',
    records_count: Object.values(backupPayload.counts || {}).reduce((a, b) => a + b, 0),
    tables_count: Object.keys(backupPayload.tables || {}).length,
    backup_data: backupPayload,
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('fazatak_backups')
    .insert([record])
    .select();

  if (error) {
    console.error('Supabase backup error:', error);
    throw new Error(`فشل رفع النسخة إلى Supabase: ${error.message}`);
  }

  return { success: true, record: data?.[0] };
};

/**
 * جلب قائمة النسخ الاحتياطية السحابية من Supabase
 */
export const listCloudBackups = async (limit = 10) => {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('fazatak_backups')
    .select('id, file_name, version, records_count, tables_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Failed to list cloud backups:', error.message);
    return [];
  }

  return data || [];
};

/**
 * استعادة نسخة احتياطية سحابية محددة بالمعرف
 */
export const getCloudBackupById = async (id) => {
  if (!supabase) throw new Error('Supabase غير مهيأ');

  const { data, error } = await supabase
    .from('fazatak_backups')
    .select('backup_data')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(`فشل استرجاع النسخة: ${error.message}`);
  }

  return data.backup_data;
};
