/** Display-only history. Nothing in this module is evidence of current authority. */
export type CacheOwner = { id: string; label: string };
export type CacheRead = {
  key: string; ownerId: string; ownerLabel: string; action: string;
  params: Record<string, unknown>; data: unknown; route: string; savedAt: string; bytes: number;
};
export const LOCAL_READ_CACHE_EVENT = 'crm:local-read-cache';

const DATABASE = 'agri-workspace-read-history-v1';
const MAX_BYTES = 80 * 1024 * 1024;
const MAX_RECORD_BYTES = 30 * 1024 * 1024;
const MAX_RECORDS = 400;
const ALLOWED_ACTIONS = new Set([
  'products', 'product', 'product-search-index', 'product-search-page', 'lcl', 'knowledge', 'status', 'settings',
  'crm-dashboard', 'sales-analysis', 'exchange-rates', 'workspace-state', 'customs-evidence',
  'customs-official-candidate', 'customs-evidence-versions', 'freight-data-summary', 'partner-forwarders',
  'forwarder-versions', 'quotation-ledger', 'quotation-detail', 'trade-order-ledger',
  'product-commercial-evidence', 'sales-bindings',
]);
const PRIVATE_KEY = /(?:password|passwd|credential|token|secret|cookie|csrf|challenge|captcha|authorization|permission|capabilit|session|fingerprint|privatekey|accesskey|apikey|signature)/i;
const PRIVATE_EXACT = /^(?:pwd|auth|authkey|authenticated|authorized|isauthenticated|isauthorized|loggedin|isloggedin|context|upstreamcontext|principal|currentuser|role|allowedfeatures|features|canwrite|cancreate|canedit|candelete|canmanage|cansync|canaccess|gatewayurl|loginurl|logouturl|otp|nonce|sig)$/i;
const PARAM_NOISE = /^(?:readback|cache|cachebust|cachebuster|nocache|timestamp|requestid|requestnonce|r|_)$/i;
const OWNER_ID = /^scope-[a-f0-9]{64}$/;
type Summary = Omit<CacheRead, 'data'> & { lastAccessedAt: number; routes: string[] };
type Settings = { key: 'settings'; enabled: boolean; lastOwner: CacheOwner | null; generation: number };

let owner: CacheOwner | null = null;
let lastOwner: CacheOwner | null = null;
let allowHistory = typeof document === 'undefined' || !document.querySelector(
  'meta[name="crm-workbench-principal"],meta[name="crm-csrf"],meta[name="crm-upstream-context"]',
);
let enabled = true;
let epoch = 0;
let settingRevision = 0;
let generation = 0;
let clearing = false;
let error = '';
let connection: Promise<IDBDatabase | null> | null = null;
let initialized: Promise<void> | null = null;
let serial: Promise<unknown> = Promise.resolve();
const activeWrites = new Set<IDBTransaction>();
let channel: BroadcastChannel | null = null;
try { if (typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function') channel = new window.BroadcastChannel(DATABASE); } catch { /* browser privacy policy */ }

function emit(reason: 'owner' | 'saved' | 'settings' | 'cleared' | 'error') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCAL_READ_CACHE_EVENT, {
    detail: { reason, ownerId: owner?.id || (allowHistory ? lastOwner?.id : '') || '' },
  }));
}
function fail(value: unknown) {
  const name = String((value as { name?: unknown })?.name || '');
  const next = name === 'QuotaExceededError' ? '浏览器空间不足，已保留原有快照；可清理本地记录后重试。' :
    '当前浏览器暂不能保存或读取本地快照；线上读取不受影响。';
  if (next !== error) { error = next; emit('error'); }
}
function broadcast(reason: 'saved' | 'settings' | 'cleared') { try { channel?.postMessage({ reason }); } catch { /* disconnected tab */ } }
function invalidate() {
  epoch++;
  for (const transaction of activeWrites) { try { transaction.abort(); } catch { /* already committed */ } }
}
function enqueue<T>(operation: () => Promise<T>): Promise<T | undefined> {
  const pending = serial.then(operation).catch((cause) => { fail(cause); return undefined; });
  serial = pending;
  return pending;
}
function enqueueRequired<T>(operation: () => Promise<T>): Promise<T> {
  const pending = serial.then(operation).catch((cause) => { fail(cause); throw cause; });
  serial = pending.catch(() => undefined);
  return pending;
}
function open(): Promise<IDBDatabase | null> {
  if (connection) return connection;
  connection = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { fail(null); resolve(null); return; }
    let request: IDBOpenDBRequest;
    let finished = false;
    const complete = (database: IDBDatabase | null) => {
      if (finished) { database?.close(); return; }
      finished = true; clearTimeout(timeout); resolve(database);
    };
    const timeout = setTimeout(() => { fail(null); complete(null); }, 5000);
    try { request = indexedDB.open(DATABASE, 1); } catch (cause) { fail(cause); complete(null); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      const reads = db.createObjectStore('reads', { keyPath: 'key' });
      reads.createIndex('ownerId', 'ownerId');
      db.createObjectStore('summaries', { keyPath: 'key' });
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      complete(request.result);
    };
    request.onerror = () => { fail(request.error); complete(null); };
    request.onblocked = () => { fail(null); complete(null); };
  });
  return connection;
}
function read<T>(db: IDBDatabase, store: string, key?: IDBValidKey): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, 'readonly');
    const request = key === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function validOwner(value: CacheOwner | null | undefined): CacheOwner | null {
  return value && OWNER_ID.test(value.id) ? { id: value.id, label: String(value.label || '上次登录账号').slice(0, 120) } : null;
}
async function initialize() {
  if (initialized) return initialized;
  const revision = settingRevision;
  initialized = (async () => {
    const db = await open();
    if (!db) return;
    const stored = await read<Settings | undefined>(db, 'meta', 'settings');
    if (stored) {
      if (revision === settingRevision) enabled = stored.enabled !== false;
      if (!lastOwner) lastOwner = validOwner(stored.lastOwner);
      generation = Number(stored.generation) || 0;
    }
  })().catch(fail);
  return initialized;
}
function settings(): Settings { return { key: 'settings', enabled, lastOwner, generation }; }
function putSettings(db: IDBDatabase, updateEnabled = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('meta', 'readwrite');
    let nextGeneration = generation;
    const store = transaction.objectStore('meta');
    const request = store.get('settings');
    request.onsuccess = () => {
      const stored = request.result as Settings | undefined;
      nextGeneration = Math.max(generation, Number(stored?.generation) || 0) + (updateEnabled ? 1 : 0);
      if (!updateEnabled && stored) enabled = stored.enabled !== false;
      store.put({ ...settings(), generation: nextGeneration });
    };
    transaction.oncomplete = () => { generation = nextGeneration; if (updateEnabled) broadcast('settings'); resolve(); };
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => { /* abort handler preserves existing settings */ };
  });
}
if (channel) channel.onmessage = (event) => {
  const reason = event.data?.reason;
  if (!['saved', 'settings', 'cleared'].includes(reason)) return;
  if (reason === 'saved') { emit('saved'); return; }
  invalidate();
  void enqueue(async () => {
    const db = await open();
    if (!db) return;
    const stored = await read<Settings | undefined>(db, 'meta', 'settings');
    if (stored) {
      enabled = stored.enabled !== false; generation = Number(stored.generation) || 0;
      if (!owner) lastOwner = validOwner(stored.lastOwner);
    }
    emit(reason);
  });
};

/** A null owner never permits a write. 403 may hide history without deleting it. */
export function setLocalCacheOwner(value: CacheOwner | null, options: { allowHistory?: boolean } = {}): void {
  const next = validOwner(value);
  const nextHistory = next || value ? false : options.allowHistory !== false;
  const changed = owner?.id !== next?.id || owner?.label !== next?.label || allowHistory !== nextHistory;
  owner = next; allowHistory = nextHistory;
  if (next) lastOwner = next;
  if (!changed) return;
  invalidate(); emit('owner');
  if (next) void enqueue(async () => {
    await initialize();
    if (lastOwner?.id !== next.id) return;
    const db = await open();
    if (db) await putSettings(db);
  });
}

function privateKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, '');
  return PRIVATE_KEY.test(normalized) || PRIVATE_EXACT.test(normalized);
}
function unsafeText(value: string) {
  if (/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]{8,}|\b(?:password|authorization|cookie|csrf|access[_-]?token)\s*[:=]|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./i.test(value)) return true;
  if (/^(?:data|javascript|vbscript):/i.test(value.trim())) return true;
  if (/(?:https?:)?\/\/[^\s/?#]*@/i.test(value)) return true;
  for (const match of value.matchAll(/(?:\?|&|&amp;)([^=&#\s]+)=/gi)) {
    let name = match[1];
    try { name = decodeURIComponent(name); } catch { return true; }
    if (privateKey(name) || /^(?:key|authkey|signature|sig)$/i.test(name)) return true;
  }
  return false;
}
function sanitize(value: unknown, strict: boolean, budget: { nodes: number }, depth = 0): unknown {
  if (++budget.nodes > 1_000_000 || depth > 32) throw new Error('Local snapshot too complex');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (unsafeText(value)) { if (strict) throw new Error('Secret query rejected'); return undefined; }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item, strict, budget, depth + 1)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (privateKey(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
        if (strict) throw new Error('Secret query rejected');
        continue;
      }
      if (strict && PARAM_NOISE.test(key.replace(/[^a-z0-9_]/gi, ''))) continue;
      const cleaned = sanitize((value as Record<string, unknown>)[key], strict, budget, depth + 1);
      if (cleaned !== undefined) result[key] = cleaned;
    }
    return result;
  }
  return undefined;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function routePath(route: string) {
  const trimmed = String(route || '/').trim().slice(0, 4096);
  const hashRoute = trimmed.includes('#/') ? trimmed.slice(trimmed.indexOf('#/') + 1) : trimmed;
  return hashRoute.startsWith('/') && !hashRoute.startsWith('//') && !unsafeText(hashRoute) ? hashRoute : '/';
}
function defer(work: () => void) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(work, { timeout: 2000 });
  else setTimeout(work, 0);
}

/** Non-blocking side channel. The caller must already have a successful authenticated GET. */
export function captureLocalRead(action: string, params: Record<string, unknown>, data: unknown, route: string): void {
  if (!owner || !enabled || !ALLOWED_ACTIONS.has(action)) return;
  const capturedOwner = { ...owner };
  const capturedEpoch = epoch;
  const current = () => enabled && epoch === capturedEpoch && owner?.id === capturedOwner.id;
  defer(() => {
    if (!current()) return;
    void enqueue(async () => {
      await initialize();
      if (!current()) return;
      let cleanParams: Record<string, unknown>;
      let cleanData: unknown;
      try {
        cleanParams = sanitize(params || {}, true, { nodes: 0 }) as Record<string, unknown>;
        const projected = action === 'status' && data && typeof data === 'object' ? Object.fromEntries(
          ['products', 'lcl', 'knowledge', 'generatedAt'].filter((key) => key in data).map((key) => [key, (data as Record<string, unknown>)[key]]),
        ) : data;
        cleanData = sanitize(projected, false, { nodes: 0 });
      } catch { return; }
      if (cleanData === undefined) return;
      const parameterKey = canonical(cleanParams);
      if (parameterKey.length > 64 * 1024) return;
      const record: CacheRead = {
        key: `${capturedOwner.id}:${action}:${parameterKey}`, ownerId: capturedOwner.id, ownerLabel: capturedOwner.label,
        action, params: cleanParams, data: cleanData, route: routePath(route), savedAt: new Date().toISOString(), bytes: 0,
      };
      record.bytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
      if (record.bytes > MAX_RECORD_BYTES) { error = '此项数据超过单条 30 MB 本地缓存上限，已保留原有快照。'; emit('error'); return; }
      const db = await open();
      if (!db || !current()) return;
      await new Promise<void>((resolve) => {
        const transaction = db.transaction(['reads', 'summaries', 'meta'], 'readwrite');
        activeWrites.add(transaction);
        let cancelled = false;
        const metaRequest = transaction.objectStore('meta').get('settings');
        metaRequest.onsuccess = () => {
          const stored = metaRequest.result as Settings | undefined;
          if (stored && (stored.enabled === false || (Number(stored.generation) || 0) !== generation)) {
            cancelled = true; enabled = stored.enabled !== false; generation = Number(stored.generation) || 0;
            invalidate(); emit('settings'); return;
          }
          const request = transaction.objectStore('summaries').getAll();
          request.onsuccess = () => {
          if (!current()) { cancelled = true; transaction.abort(); return; }
          const previous = (request.result as Summary[]).find((item) => item.key === record.key);
          const summaries = (request.result as Summary[]).filter((item) => item.key !== record.key)
            .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
          let bytes = summaries.reduce((total, item) => total + item.bytes, record.bytes);
          while (summaries.length + 1 > MAX_RECORDS || bytes > MAX_BYTES) {
            const oldest = summaries.shift();
            if (!oldest) { cancelled = true; transaction.abort(); return; }
            bytes -= oldest.bytes;
            transaction.objectStore('reads').delete(oldest.key);
            transaction.objectStore('summaries').delete(oldest.key);
          }
          transaction.objectStore('reads').put(record);
          const { data: _payload, ...metadata } = record;
          const routes = [...new Set([...(previous?.routes || (previous?.route ? [previous.route] : [])), record.route])].slice(-12);
          transaction.objectStore('summaries').put({ ...metadata, routes, lastAccessedAt: Date.now() } satisfies Summary);
          transaction.objectStore('meta').put(settings());
          };
        };
        transaction.oncomplete = () => { activeWrites.delete(transaction); error = ''; emit('saved'); broadcast('saved'); resolve(); };
        transaction.onabort = () => { activeWrites.delete(transaction); if (!cancelled && current()) fail(transaction.error); resolve(); };
        transaction.onerror = () => { /* all evictions and replacements roll back together */ };
      });
    });
  });
}

function visibleOwner() { return owner || (allowHistory ? lastOwner : null); }
async function selectedSummaries(): Promise<{ entries: Summary[]; requestEpoch: number; selected: CacheOwner | null }> {
  const requestEpoch = epoch;
  await initialize();
  const selected = visibleOwner();
  if (!enabled || clearing || !selected || requestEpoch !== epoch) return { entries: [], requestEpoch, selected };
  const db = await open();
  const all = db ? await read<Summary[]>(db, 'summaries') : [];
  if (!enabled || clearing || requestEpoch !== epoch || visibleOwner()?.id !== selected.id) return { entries: [], requestEpoch, selected };
  return { entries: all.filter((item) => item.ownerId === selected.id && ALLOWED_ACTIONS.has(item.action)), requestEpoch, selected };
}
export async function getLocalCacheCatalog(route?: string): Promise<Omit<CacheRead, 'data'>[]> {
  try {
    const { entries, requestEpoch, selected } = await selectedSummaries();
    if (requestEpoch !== epoch || visibleOwner()?.id !== selected?.id || !enabled || clearing) return [];
    const target = route === undefined ? undefined : routePath(route);
    return entries.filter((item) => target === undefined || (item.routes || [item.route]).includes(target))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map(({ lastAccessedAt: _access, routes: _routes, ...metadata }) => target === undefined ? metadata : { ...metadata, route: target });
  } catch (cause) { fail(cause); return []; }
}
async function selectedReads(route?: string, key?: string): Promise<CacheRead[]> {
  try {
    const { entries, requestEpoch, selected } = await selectedSummaries();
    if (!selected || requestEpoch !== epoch) return [];
    const targetRoute = route === undefined ? undefined : routePath(route);
    const selectedEntries = entries.filter((item) => (key === undefined || item.key === key) &&
      (targetRoute === undefined || (item.routes || [item.route]).includes(targetRoute)));
    if (!selectedEntries.length) return [];
    const db = await open();
    if (!db) return [];
    const records = await new Promise<CacheRead[]>((resolve, reject) => {
      const transaction = db.transaction('reads', 'readonly');
      const result: CacheRead[] = [];
      for (const entry of selectedEntries) {
        const request = transaction.objectStore('reads').get(entry.key);
        request.onsuccess = () => { if (request.result) result.push(request.result); };
        request.onerror = () => reject(request.error);
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error);
    });
    if (!enabled || clearing || requestEpoch !== epoch || visibleOwner()?.id !== selected.id) return [];
    const matches = records.filter((record) => record.ownerId === selected.id && ALLOWED_ACTIONS.has(record.action))
      .map((record) => targetRoute === undefined ? record : { ...record, route: targetRoute })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    if (matches.length) void enqueue(async () => {
      if (requestEpoch !== epoch || !enabled) return;
      await new Promise<void>((resolve) => {
        const transaction = db.transaction('summaries', 'readwrite');
        const store = transaction.objectStore('summaries');
        for (const record of matches) {
          const request = store.get(record.key);
          request.onsuccess = () => { if (request.result) store.put({ ...request.result, lastAccessedAt: Date.now() }); };
        }
        transaction.oncomplete = () => resolve(); transaction.onabort = () => resolve();
      });
    });
    return matches;
  } catch (cause) { fail(cause); return []; }
}
export function getLocalCachedReads(route?: string): Promise<CacheRead[]> { return selectedReads(route); }
export async function getLocalCachedRead(key: string): Promise<CacheRead | null> { return (await selectedReads(undefined, key))[0] || null; }

export async function getLocalCacheInfo(): Promise<{ enabled: boolean; count: number; bytes: number; ownerLabel: string; error: string }> {
  const requestEpoch = epoch;
  await initialize();
  const selected = visibleOwner();
  let entries: Summary[] = [];
  try {
    const db = await open();
    if (db && enabled && !clearing && selected) entries = (await read<Summary[]>(db, 'summaries')).filter((entry) => entry.ownerId === selected.id);
  } catch (cause) { fail(cause); }
  if (requestEpoch !== epoch) entries = [];
  return { enabled, count: entries.length, bytes: entries.reduce((total, entry) => total + entry.bytes, 0), ownerLabel: requestEpoch === epoch ? selected?.label || '' : '', error };
}

export async function setLocalCacheEnabled(value: boolean): Promise<void> {
  settingRevision++; enabled = value === true; invalidate(); emit('settings');
  await enqueueRequired(async () => {
    await initialize();
    const db = await open();
    if (!db) throw new Error('Local cache storage unavailable');
    await putSettings(db, true);
  });
}

/** Clear every local account partition; never touches server data or current login. */
export async function clearLocalReadCache(): Promise<void> {
  const previousLastOwner = lastOwner;
  invalidate(); clearing = true; error = ''; lastOwner = owner; emit('cleared');
  try { await enqueueRequired(async () => {
    await initialize();
    lastOwner = owner;
    const db = await open();
    if (!db) throw new Error('Local cache storage unavailable');
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['reads', 'summaries', 'meta'], 'readwrite');
      let nextGeneration = generation;
      transaction.objectStore('reads').clear(); transaction.objectStore('summaries').clear();
      const store = transaction.objectStore('meta');
      const request = store.get('settings');
      request.onsuccess = () => {
        const stored = request.result as Settings | undefined;
        nextGeneration = Math.max(generation, Number(stored?.generation) || 0) + 1;
        if (stored) enabled = stored.enabled !== false;
        store.put({ ...settings(), generation: nextGeneration });
      };
      transaction.oncomplete = () => { generation = nextGeneration; resolve(); }; transaction.onabort = () => reject(transaction.error);
    });
  });
    clearing = false; emit('cleared'); broadcast('cleared');
  } catch (cause) {
    clearing = false;
    if (!owner && !lastOwner) lastOwner = previousLastOwner;
    emit('error'); throw cause;
  }
}
