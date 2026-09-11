import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Transactional IndexedDB model: asynchronous requests, atomic commit/abort and
// injected quota errors. It never talks to a browser profile or production API.
const stores = { reads: new Map(), summaries: new Map(), meta: new Map() };
let quotaFailure = false;
let settingsFailure = false;
let blockReads = false;
let pendingRead;
let jobs = [];
const events = [];
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const database = {
  close() {},
  transaction(names, mode = 'readonly') {
    names = Array.isArray(names) ? names : [names];
    const copies = Object.fromEntries(names.map((name) => [name, mode === 'readwrite' ? new Map([...stores[name]].map(([key, value]) => [key, clone(value)])) : stores[name]]));
    let active = true;
    let pending = 0;
    let finishing;
    const transaction = {
      error: null,
      abort() {
        if (!active) return;
        active = false; clearTimeout(finishing);
        queueMicrotask(() => transaction.onabort?.());
      },
      objectStore(name) {
        const request = (operation, blocked = false) => {
          const item = { result: undefined, error: null };
          pending++; clearTimeout(finishing);
          const run = () => {
            if (!active) return;
            try { item.result = operation(); item.onsuccess?.(); }
            catch (cause) { item.error = cause; transaction.error = cause; item.onerror?.(); transaction.abort(); }
            pending--; finish();
          };
          if (blocked) pendingRead = run;
          else setTimeout(run, 0);
          return item;
        };
        return {
          get: (key) => request(() => clone(copies[name].get(key)), blockReads && name === 'reads'),
          getAll: () => request(() => [...copies[name].values()].map(clone)),
          put(value) {
            const snapshot = clone(value);
            return request(() => {
              if (quotaFailure && name === 'reads') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
              if (settingsFailure && name === 'meta') throw Object.assign(new Error('settings quota'), { name: 'QuotaExceededError' });
              copies[name].set(snapshot.key, snapshot);
            });
          },
          delete: (key) => request(() => copies[name].delete(key)),
          clear: () => request(() => copies[name].clear()),
          index: () => ({ getAll: (ownerId) => {
            if (!blockReads) return request(() => [...copies[name].values()].filter((row) => row.ownerId === ownerId).map(clone));
            const result = {};
            pendingRead = () => { result.result = [...copies[name].values()].filter((row) => row.ownerId === ownerId).map(clone); result.onsuccess?.(); };
            return result;
          } }),
        };
      },
    };
    function finish() {
      if (!active || pending) return;
      finishing = setTimeout(() => {
        if (!active || pending) return;
        active = false;
        if (mode === 'readwrite') for (const name of names) stores[name] = copies[name];
        transaction.oncomplete?.();
      }, 0);
    }
    finish();
    return transaction;
  },
};
globalThis.indexedDB = {
  open() { const request = { result: database }; setTimeout(() => request.onsuccess?.(), 0); return request; },
};
globalThis.window = {
  dispatchEvent(event) { events.push(event); },
  requestIdleCallback(job) { jobs.push(job); },
};
globalThis.document = { querySelector() { return null; } };
if (!globalThis.CustomEvent) globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
const source = fs.readFileSync(new URL('../src/lib/local-read-cache.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
let moduleId = 0;
async function load() { return import(`data:text/javascript;base64,${Buffer.from(`${code}\n// instance ${moduleId++}`).toString('base64')}`); }
const sleep = (ms = 35) => new Promise((resolve) => setTimeout(resolve, ms));
async function flush() { const running = jobs; jobs = []; for (const job of running) job(); await sleep(150); }
const api = await load();
const A = { id: `scope-${'a'.repeat(64)}`, label: '测试账号 A' };
const B = { id: `scope-${'b'.repeat(64)}`, label: '测试账号 B' };

api.captureLocalRead('products', {}, { items: ['anonymous'] }, '/');
assert.equal(jobs.length, 0, 'anonymous pages can never create history');
api.setLocalCacheOwner({ id: 'untrusted-user-id', label: 'wrong' });
api.captureLocalRead('products', {}, [], '/');
assert.equal(jobs.length, 0, 'only opaque authenticated dataScopeId is accepted');
api.setLocalCacheOwner(A);
await sleep();
let traversed = false;
const data = { productId: 'DEMO-CACHE-TRACTOR', sourceObservedAt: '2026-09-11T01:00:00Z', price: 123,
  nested: { accessToken: 'fake', password: 'fake', csrf: 'fake', currentUser: { id: 'private-login-id' },
    permissions: ['write'], context: 'nonce', url: 'https://www.w3.org/image.jpg',
    signedUrl: 'https://www.w3.org/image.jpg?signature=fake',
    encodedUrl: 'https://www.w3.org/file?%74oken=fake',
    unsafeUrl: 'https://user:password@www.w3.org/',
  },
};
Object.defineProperty(data, 'measured', { enumerable: true, get() { traversed = true; return 'deferred'; } });
api.captureLocalRead('product', { productId: 'DEMO-CACHE-TRACTOR', readback: 'one' }, data, '/product/detail/DEMO-CACHE-TRACTOR');
assert.equal(traversed, false, 'sanitizing and serialization never delay the successful GET');
await flush();
let rows = await api.getLocalCachedReads();
assert.equal(rows.length, 1);
assert.equal(rows[0].ownerId, A.id);
assert.equal(rows[0].data.sourceObservedAt, data.sourceObservedAt, 'source time is not replaced by cache savedAt');
assert.equal(rows[0].data.price, 123);
assert.equal(rows[0].data.nested.url, data.nested.url);
assert.equal(JSON.stringify(rows).includes('fake'), false);
assert.equal(JSON.stringify(rows).includes('private-login-id'), false);
assert.deepEqual(rows[0].params, { productId: 'DEMO-CACHE-TRACTOR' });
assert.equal((await api.getLocalCachedReads('/wrong')).length, 0);
assert.equal((await api.getLocalCacheInfo()).count, 1);
assert.ok((await api.getLocalCacheInfo()).bytes > 0);
const catalog = await api.getLocalCacheCatalog();
assert.equal(catalog.length, 1);
assert.equal('data' in catalog[0], false, 'catalog is metadata only, never megabytes of payload');
assert.equal((await api.getLocalCachedRead(catalog[0].key)).data.price, 123);
assert.equal(await api.getLocalCachedRead('someone-elses-key'), null);

api.captureLocalRead('product', { readback: 'two', productId: 'DEMO-CACHE-TRACTOR' }, { price: 456 }, '/product/detail/DEMO-CACHE-TRACTOR');
await flush();
assert.equal((await api.getLocalCachedReads()).length, 1, 'readback changes update one canonical record');
assert.equal((await api.getLocalCachedReads())[0].data.price, 456);
api.captureLocalRead('product', { productId: 'DEMO-CACHE-TRACTOR' }, { price: 456 }, '/product/search');
await flush();
assert.equal((await api.getLocalCachedReads('/product/detail/DEMO-CACHE-TRACTOR')).length, 1, 'one payload remains linked to an earlier route');
assert.equal((await api.getLocalCachedReads('/product/search'))[0].route, '/product/search');
assert.equal((await api.getLocalCacheCatalog()).length, 1, 'route aliases do not duplicate payloads');
assert.equal((await api.getLocalCacheCatalog('/product/detail/DEMO-CACHE-TRACTOR')).length, 1);
assert.equal((await api.getLocalCacheCatalog('/product/search'))[0].route, '/product/search');
for (const action of ['upstream-sessions', 'copilot-account', 'upstream-account', 'olink-captcha', 'create-quotation', 'save-settings', 'quotation-create-capability']) {
  api.captureLocalRead(action, {}, { token: 'x', authenticated: true }, '/');
}
assert.equal(jobs.length, 0, 'authentication, capability and write actions are excluded');
api.captureLocalRead('product', { productId: 'secret-request', token: 'x' }, { price: 99 }, '/');
await flush();
assert.equal((await api.getLocalCacheInfo()).count, 1, 'credential-like params reject the whole capture');
api.captureLocalRead('status', {}, { products: { count: 3, authenticated: true }, lcl: { count: 2 }, knowledge: { count: 1 }, generatedAt: 'source-time', copilot: { connected: true }, upstreamSessions: { tokenAvailable: true }, authorized: true }, '/');
await flush();
assert.deepEqual((await api.getLocalCachedReads('/'))[0].data, { products: { count: 3 }, lcl: { count: 2 }, knowledge: { count: 1 }, generatedAt: 'source-time' });

api.setLocalCacheOwner(null);
assert.equal((await api.getLocalCacheInfo()).ownerLabel, A.label);
assert.equal((await api.getLocalCachedReads()).length, 2, '401 keeps explicitly requested offline history');
api.setLocalCacheOwner(null, { allowHistory: false });
assert.equal((await api.getLocalCachedReads()).length, 0, '403 hides history without deletion');
api.setLocalCacheOwner(A);
assert.equal((await api.getLocalCachedReads()).length, 2);
api.setLocalCacheOwner({ id: 'invalid-new-owner', label: 'invalid' });
assert.deepEqual(await api.getLocalCachedReads(), [], 'invalid explicit owner cannot expose the previous owner');
api.setLocalCacheOwner(A);
api.captureLocalRead('product', { productId: 'stale-write' }, { price: 111 }, '/');
api.setLocalCacheOwner(B);
await flush();
assert.equal((await api.getLocalCachedReads()).length, 0, 'new account cannot see previous account records');
assert.equal([...stores.reads.values()].some((row) => row.params.productId === 'stale-write'), false);
api.captureLocalRead('product', { productId: 'B-product' }, { price: 222 }, '/');
await flush();
assert.equal((await api.getLocalCacheInfo()).ownerLabel, B.label);
assert.equal((await api.getLocalCachedReads()).length, 1);
blockReads = true;
const oldRead = api.getLocalCachedReads();
await sleep(15);
api.setLocalCacheOwner(A);
pendingRead(); blockReads = false;
assert.deepEqual(await oldRead, [], 'late read from previous owner is discarded');

// Quota failure cannot delete the previous useful generation.
await sleep();
const beforeQuota = [...stores.reads.values()].map(clone);
quotaFailure = true;
api.captureLocalRead('product', { productId: 'DEMO-CACHE-TRACTOR' }, { price: 999 }, '/');
await flush();
quotaFailure = false;
assert.deepEqual([...stores.reads.values()], beforeQuota, 'failed replacement atomically preserves existing rows');
assert.match((await api.getLocalCacheInfo()).error, /空间不足/);

// Size/count eviction is global, while visible totals are always owner-scoped.
await api.clearLocalReadCache();
for (let i = 0; i < 400; i++) {
  const row = { key: `seed-${i}`, ownerId: B.id, ownerLabel: B.label, action: 'product', params: { i }, data: {}, route: '/', savedAt: new Date(i * 1000).toISOString(), bytes: 1024 };
  stores.reads.set(row.key, row); stores.summaries.set(row.key, { key: row.key, ownerId: B.id, savedAt: row.savedAt, bytes: row.bytes, lastAccessedAt: i });
}
quotaFailure = true;
api.captureLocalRead('product', { productId: 'failed-eviction' }, { price: 2 }, '/');
await flush(); quotaFailure = false;
assert.equal(stores.reads.size, 400);
assert.equal(stores.reads.has('seed-0'), true, 'quota failure rolls back LRU deletion together with failed insert');
api.captureLocalRead('product', { productId: 'LRU' }, { price: 1 }, '/');
await flush();
assert.equal(stores.reads.size, 400);
assert.equal(stores.reads.has('seed-0'), false);
assert.equal((await api.getLocalCacheInfo()).count, 1, 'other account totals are not exposed');
api.captureLocalRead('product', { productId: 'oversize' }, { content: 'x'.repeat(30 * 1024 * 1024) }, '/');
await flush();
assert.equal(stores.reads.size, 400, 'oversized entry leaves the previous generation intact');
assert.match((await api.getLocalCacheInfo()).error, /30 MB/);

settingsFailure = true;
await assert.rejects(api.clearLocalReadCache(), /settings quota/);
assert.equal(stores.reads.size, 400, 'failed clear rolls back data deletion');
assert.equal((await api.getLocalCacheInfo()).count, 1, 'failed clear restores display of retained data');
await assert.rejects(api.setLocalCacheEnabled(false), /settings quota/);
settingsFailure = false;
await api.setLocalCacheEnabled(true);

await api.clearLocalReadCache();
for (let i = 0; i < 3; i++) {
  const row = { key: `byte-seed-${i}`, ownerId: B.id, ownerLabel: B.label, action: 'product', params: { i }, data: {}, route: '/', savedAt: new Date(i * 1000).toISOString(), bytes: 28 * 1024 * 1024 };
  stores.reads.set(row.key, row); stores.summaries.set(row.key, { ...row, data: undefined, routes: ['/'], lastAccessedAt: i });
}
api.captureLocalRead('settings', {}, { forwarders: [{ name: '业务货代配置' }], accessToken: 'fake' }, '/system/settings');
await flush();
assert.equal(stores.reads.has('byte-seed-0'), false, '80 MB budget evicts the oldest record even below count limit');
assert.equal([...stores.summaries.values()].reduce((sum, row) => sum + row.bytes, 0) < 80 * 1024 * 1024, true);
assert.equal((await api.getLocalCachedReads())[0].data.forwarders[0].name, '业务货代配置');
assert.equal(JSON.stringify(await api.getLocalCachedReads()).includes('fake'), false);

api.captureLocalRead('product', { productId: 'after-clear-must-not-return' }, {}, '/');
const clear = api.clearLocalReadCache();
assert.deepEqual(await api.getLocalCachedReads(), [], 'clear hides history immediately');
await clear; await flush();
assert.equal(stores.reads.size, 0, 'queued pre-clear jobs cannot resurrect cleared records');
api.captureLocalRead('product', { productId: 'disabled-write' }, {}, '/');
await api.setLocalCacheEnabled(false); await flush();
assert.equal(stores.reads.size, 0);
assert.equal((await api.getLocalCacheInfo()).enabled, false);
const reloadedDisabled = await load();
assert.equal((await reloadedDisabled.getLocalCacheInfo()).enabled, false, 'opt-out survives reload');
await api.setLocalCacheEnabled(true);
api.captureLocalRead('product', { productId: 'persisted-history' }, { price: 777 }, '/');
await flush();
api.setLocalCacheOwner(null);
const reloaded = await load();
assert.equal((await reloaded.getLocalCachedReads())[0].data.price, 777, 'anonymous next visit reads last-owner history');
globalThis.document.querySelector = () => ({ content: 'new-authenticated-shell' });
const waitingForNewOwner = await load();
assert.deepEqual(await waitingForNewOwner.getLocalCachedReads(), [], 'new authenticated shell waits for its own data scope');
waitingForNewOwner.setLocalCacheOwner(B);
assert.deepEqual(await waitingForNewOwner.getLocalCachedReads(), []);
assert.ok(events.some((event) => event.detail.reason === 'owner'));
assert.ok(events.some((event) => event.detail.reason === 'saved'));

delete globalThis.indexedDB;
const unavailable = await load();
assert.deepEqual(await unavailable.getLocalCachedReads(), []);
assert.match((await unavailable.getLocalCacheInfo()).error, /浏览器暂不能/);
await assert.rejects(unavailable.clearLocalReadCache(), /storage unavailable/, 'failed clear is never reported as success');
await assert.rejects(unavailable.setLocalCacheEnabled(false), /storage unavailable/, 'failed settings persistence is exposed to the button handler');
assert.equal(source.includes('localStorage'), false, 'large private data never goes into synchronous web storage');
console.log('local-read-cache: contract assertions passed (deferred capture, redaction, owner isolation, lightweight catalog, shared route aliases, atomic quota recovery, LRU, opt-out and reload).');
