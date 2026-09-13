const DEFAULT_SUPABASE_URL = 'https://ehufhgulrubgnntmdhxn.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_5O9wP_WCo3zqIkNzI_8Cpg_hYFM9NGC';
const PUSH_TABLE = 'fazatak_push_subscriptions';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

const getSupabaseConfig = (env) => ({
  url: env.SUPABASE_URL || DEFAULT_SUPABASE_URL,
  key: env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY,
});

const supabaseRequest = async (env, path, init = {}) => {
  const { url, key } = getSupabaseConfig(env);
  const configs = [
    { url, key },
    { url: DEFAULT_SUPABASE_URL, key: DEFAULT_SUPABASE_KEY },
  ].filter((config, index, all) => (
    config.url && config.key && all.findIndex((item) => item.url === config.url && item.key === config.key) === index
  ));

  for (const config of configs) {
    const headers = new Headers(init.headers || {});
    headers.set('apikey', config.key);
    headers.set('Authorization', `Bearer ${config.key}`);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const response = await fetch(`${config.url}/rest/v1/${path}`, { ...init, headers });
    if (response.ok) {
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    }

    // A stale Cloudflare URL/key should not prevent Push registration.
    if (configs.length > 1 && (response.status === 401 || response.status === 403 || response.status === 404 || response.status >= 500)) {
      continue;
    }
    throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  }

  throw new Error('Supabase request failed');
};

const readJson = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const isValidSubscription = (subscription) => Boolean(
  subscription?.endpoint &&
  subscription?.keys?.p256dh &&
  subscription?.keys?.auth
);

const subscriptionRecord = (payload) => ({
  user_phone: String(payload.userPhone || '').trim(),
  endpoint: String(payload.subscription.endpoint),
  subscription: payload.subscription,
  expiration_time: payload.subscription.expirationTime || null,
  timezone: payload.timezone || payload.subscription.timezone || 'Asia/Riyadh',
  last_notification_key: null,
  updated_at: new Date().toISOString(),
});

const handlePushApi = async (request, env) => {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  if (url.pathname === '/api/push/config' && request.method === 'GET') {
    if (!env.VAPID_PUBLIC_KEY) return jsonResponse({ error: 'push_not_configured' }, 503);
    if (url.searchParams.get('diag') === '1') {
      try {
        const { privateKey } = await getVapidKeys(env);
        const data = utf8('fazatak-vapid-diagnostic');
        const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
        const publicKey = await crypto.subtle.importKey(
          'raw',
          base64UrlToBytes(env.VAPID_PUBLIC_KEY),
          { name: 'ECDSA', namedCurve: 'P-256' },
          false,
          ['verify']
        );
        const normalizedSignature = normalizeEcdsaSignature(signature);
        const valid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          publicKey,
          signature,
          data
        );
        const normalizedValid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          publicKey,
          normalizedSignature,
          data
        );
        return jsonResponse({
          vapidPublicKey: env.VAPID_PUBLIC_KEY,
          vapidKeyPairValid: valid,
          signatureLength: signature.byteLength,
          normalizedSignatureLength: normalizedSignature.byteLength,
          normalizedSignatureValid: normalizedValid,
        });
      } catch (error) {
        return jsonResponse({ error: 'vapid_diagnostic_failed', detail: error.message }, 500);
      }
    }
    return jsonResponse({ vapidPublicKey: env.VAPID_PUBLIC_KEY });
  }

  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!payload?.userPhone || !isValidSubscription(payload.subscription)) {
      return jsonResponse({ error: 'invalid_subscription' }, 400);
    }

    await supabaseRequest(env, `${PUSH_TABLE}?on_conflict=endpoint`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([subscriptionRecord(payload)]),
    });
    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!payload?.endpoint) return jsonResponse({ error: 'invalid_endpoint' }, 400);

    await supabaseRequest(env, `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(payload.endpoint)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    return jsonResponse({ ok: true });
  }

  if (url.pathname === '/api/push/test' && request.method === 'POST') {
    const payload = await readJson(request);
    if (!payload?.endpoint) return jsonResponse({ error: 'invalid_endpoint' }, 400);

    const rows = await supabaseRequest(
      env,
      `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(payload.endpoint)}&select=endpoint,subscription`
    );
    const record = rows?.[0];
    if (!record) return jsonResponse({ error: 'subscription_not_found' }, 404);

    const result = await sendWebPush(env, record.subscription, {
      title: 'تجربة تنبيهات أقساطي',
      body: 'تم تفعيل Push على هذا الجهاز بنجاح ✅',
      tag: 'fazatak-test',
      data: { url: '/' },
    });
    if (result.expired) await deleteSubscription(env, record.endpoint);
    return jsonResponse(
      result.sent
        ? { ok: true }
        : { ok: false, error: 'push_send_failed', providerStatus: result.status, providerError: result.error },
      result.sent ? 200 : 502
    );
  }

  return jsonResponse({ error: 'not_found' }, 404);
};

const base64UrlToBytes = (value) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const bytesToBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const utf8 = (value) => new TextEncoder().encode(value);

const concatBytes = (...parts) => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const hmac = async (keyBytes, data) => {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
};

const hkdfExtract = (salt, input) => hmac(salt.length ? salt : new Uint8Array(32), input);

const hkdfExpand = async (prk, info, length) => {
  const chunks = [];
  let previous = new Uint8Array(0);
  for (let counter = 1; chunks.reduce((total, chunk) => total + chunk.length, 0) < length; counter += 1) {
    previous = await hmac(prk, concatBytes(previous, info, new Uint8Array([counter])));
    chunks.push(previous);
  }
  return concatBytes(...chunks).slice(0, length);
};

const uint32Bytes = (value) => new Uint8Array([
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]);

const normalizeEcdsaSignature = (signature) => {
  const bytes = new Uint8Array(signature);
  if (bytes.length === 64) return bytes;
  if (bytes[0] !== 0x30) throw new Error('Invalid VAPID signature');

  let offset = 2;
  if (bytes[offset] !== 0x02) throw new Error('Invalid VAPID signature');
  const rLength = bytes[offset + 1];
  const r = bytes.slice(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  if (bytes[offset] !== 0x02) throw new Error('Invalid VAPID signature');
  const sLength = bytes[offset + 1];
  const s = bytes.slice(offset + 2, offset + 2 + sLength);
  const raw = new Uint8Array(64);
  raw.set(r.slice(-32), 32 - Math.min(32, r.length));
  raw.set(s.slice(-32), 64 - Math.min(32, s.length));
  return raw;
};

const getVapidKeys = async (env) => {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
    throw new Error('VAPID keys are not configured');
  }

  const publicBytes = base64UrlToBytes(env.VAPID_PUBLIC_KEY);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4) throw new Error('Invalid VAPID public key');

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: bytesToBase64Url(publicBytes.slice(1, 33)),
      y: bytesToBase64Url(publicBytes.slice(33, 65)),
      d: env.VAPID_PRIVATE_KEY,
      ext: true,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  return { privateKey, publicKey: env.VAPID_PUBLIC_KEY };
};

const createVapidAuthorization = async (env, endpoint) => {
  const { privateKey, publicKey } = await getVapidKeys(env);
  const endpointUrl = new URL(endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const encodeJson = (value) => bytesToBase64Url(utf8(JSON.stringify(value)));
  const header = encodeJson({ typ: 'JWT', alg: 'ES256' });
  const payload = encodeJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + (12 * 60 * 60),
    sub: env.VAPID_SUBJECT || 'https://fazatak.pages.dev',
  });
  const signed = utf8(`${header}.${payload}`);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    signed
  );
  return `vapid t=${bytesToBase64Url(normalizeEcdsaSignature(signature))}, k=${publicKey}`;
};

const encryptPayload = async (subscription, payload) => {
  const receiverPublicBytes = base64UrlToBytes(subscription.keys.p256dh);
  const receiverPublic = await crypto.subtle.importKey(
    'raw',
    receiverPublicBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const serverKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const serverPublicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPublic },
    serverKeys.privateKey,
    256
  ));
  const authSecret = base64UrlToBytes(subscription.keys.auth);
  const keyPrk = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concatBytes(utf8('WebPush: info\0'), receiverPublicBytes, serverPublicBytes);
  const ikm = await hkdfExpand(keyPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentPrk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(contentPrk, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(contentPrk, utf8('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plaintext = concatBytes(utf8(JSON.stringify(payload)), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    aesKey,
    plaintext
  ));

  return concatBytes(salt, uint32Bytes(4096), new Uint8Array([serverPublicBytes.length]), serverPublicBytes, ciphertext);
};

const sendWebPush = async (env, subscription, payload) => {
  try {
    const body = await encryptPayload(subscription, payload);
    const authorization = await createVapidAuthorization(env, subscription.endpoint);
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        TTL: '86400',
        Urgency: 'normal',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
      },
      body,
    });
    const responseBody = response.ok ? '' : (await response.text()).slice(0, 240);
    return {
      sent: response.ok,
      expired: response.status === 404 || response.status === 410,
      status: response.status,
      error: responseBody,
    };
  } catch (error) {
    console.warn('[Push] Send failed:', error);
    return { sent: false, expired: false, status: null, error: error.message || 'send_failed' };
  }
};

const deleteSubscription = async (env, endpoint) => {
  await supabaseRequest(env, `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
};

const getLocalDateParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
};

const dateNumber = (dateText) => {
  const [year, month, day] = String(dateText || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
};

const getSettingsMap = (rows = []) => Object.fromEntries(rows.map((row) => [row.key, row.value]));

const getDueCandidate = (backupPayload, now, timezone) => {
  const tables = backupPayload?.tables || {};
  const settings = getSettingsMap(tables.settings || []);
  if (settings.due_alerts_enabled !== 'true') return null;

  const localNow = getLocalDateParts(now, timezone);
  const todayNumber = dateNumber(`${localNow.year}-${localNow.month}-${localNow.day}`);
  if (todayNumber === null) return null;

  const customers = new Map((tables.customers || []).map((row) => [row.id, row]));
  const contracts = new Map((tables.contracts || []).map((row) => [row.id, row]));
  const groups = new Map();

  for (const installment of tables.installments || []) {
    if (installment.status !== 'pending') continue;
    const contract = contracts.get(installment.contract_id);
    const customer = contract ? customers.get(contract.customer_id) : null;
    if (!contract || contract.status !== 'active' || !customer) continue;
    if (customer.status && customer.status !== 'active') continue;
    if (customer.is_deleted || customer.deleted_at) continue;

    const dueNumber = dateNumber(installment.due_date);
    if (dueNumber === null || dueNumber > todayNumber) continue;
    const bucket = dueNumber < todayNumber ? 'late' : 'today';
    const key = `${customer.id}:${bucket}`;
    const existing = groups.get(key) || {
      customerId: customer.id,
      customerName: customer.name || 'عميل',
      bucket,
      count: 0,
      amount: 0,
      firstDueDate: installment.due_date,
      daysLate: Math.max(0, Math.round((todayNumber - dueNumber) / 86400000)),
    };
    existing.count += 1;
    existing.amount += Math.max(0, Number(installment.amount || 0) - Number(installment.actual_paid || 0));
    if (String(installment.due_date) < String(existing.firstDueDate)) existing.firstDueDate = installment.due_date;
    existing.daysLate = Math.max(existing.daysLate, Math.max(0, Math.round((todayNumber - dueNumber) / 86400000)));
    groups.set(key, existing);
  }

  const entries = [...groups.values()].sort((left, right) => (
    right.daysLate - left.daysLate || right.amount - left.amount || left.customerName.localeCompare(right.customerName)
  ));
  if (entries.length === 0) return null;

  const late = entries.filter((entry) => entry.bucket === 'late');
  const today = entries.filter((entry) => entry.bucket === 'today');
  const totalAmount = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const names = entries.slice(0, 3).map((entry) => entry.customerName).join('، ');
  const parts = [];
  if (late.length) parts.push(`${late.length} عميل متأخر`);
  if (today.length) parts.push(`${today.length} عميل مستحق اليوم`);
  const dateKey = `${localNow.year}-${localNow.month}-${localNow.day}`;
  const signature = entries.map((entry) => `${entry.customerId}:${entry.bucket}:${entry.count}:${Math.round(entry.amount)}`).join('|');
  const title = late.length ? 'عملاء متأخرون عن السداد' : 'أقساط مستحقة اليوم';
  const body = `${parts.join(' • ')} — الإجمالي ${Math.round(totalAmount).toLocaleString('en-US')} ريال${names ? `\n${names}` : ''}`;

  return {
    key: `${dateKey}:${signature}`,
    title,
    body,
    tag: `fazatak-due-alerts-${dateKey}`,
    data: { url: '/' },
  };
};

const runScheduledNotifications = async (env) => {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  const subscriptions = await supabaseRequest(env, `${PUSH_TABLE}?select=endpoint,user_phone,subscription,timezone,last_notification_key`);
  for (const record of subscriptions || []) {
    try {
      const rows = await supabaseRequest(
        env,
        `fazatak_user_data?user_phone=eq.${encodeURIComponent(record.user_phone)}&select=backup_payload&limit=1`
      );
      const candidate = getDueCandidate(rows?.[0]?.backup_payload, new Date(), record.timezone);
      if (!candidate || candidate.key === record.last_notification_key) continue;

      const result = await sendWebPush(env, record.subscription, candidate);
      if (result.expired) {
        await deleteSubscription(env, record.endpoint);
      } else if (result.sent) {
        await supabaseRequest(env, `${PUSH_TABLE}?endpoint=eq.${encodeURIComponent(record.endpoint)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ last_notification_key: candidate.key, updated_at: new Date().toISOString() }),
        });
      }
    } catch (error) {
      console.warn('[Push] Scheduled notification failed:', error);
    }
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/push/')) {
      try {
        return await handlePushApi(request, env);
      } catch (error) {
        console.error('[Push API] Request failed:', error);
        return jsonResponse({ error: 'push_service_unavailable' }, 503);
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledNotifications(env));
  },
};

export { handlePushApi, runScheduledNotifications, getDueCandidate };
