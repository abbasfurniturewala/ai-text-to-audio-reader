// Dependency-free: runs with the Node runtime included in the migration bundle.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(filename)) hash.update(block);
  return hash.digest('hex');
}
export function within(root, relative) {
  const base = path.resolve(root), result = path.resolve(base, relative);
  if (typeof relative !== 'string' || path.isAbsolute(relative) || !result.startsWith(base + path.sep)) throw new Error(`Unsafe migration path: ${relative}`);
  return result;
}
const settingAllowed = key => /^cadence-(?:document|engine|local-voice|eleven-voice|model|speed|startup-v2|library-open|navigation-open|voice-open|reader-session-v1|contents-v3:[\w-]+)$/.test(key);

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
export async function withReader({ app, profile }, run) {
  const port = await freePort();
  await mkdir(profile, { recursive: true });
  const env = { ...process.env, CADENCE_DATA_DIR: path.resolve(profile), CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
  const child = spawn(path.resolve(app), [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--force-device-scale-factor=1'], { cwd: path.dirname(path.resolve(app)), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let exited = false, log = '';
  child.stdout.on('data', data => { log = (log + data).slice(-3000); });
  child.stderr.on('data', data => { log = (log + data).slice(-3000); });
  const done = new Promise(resolve => { child.on('exit', code => { exited = true; resolve(code); }); child.on('error', error => { exited = true; log += error.message; resolve(-1); }); });
  let socket, sequence = 0;
  const pending = new Map();
  try {
    let target;
    for (let tries = 0; tries < 200; tries++) {
      if (exited) throw new Error(`The migration reader could not start. Close other Cadence windows and retry. ${log}`);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page' && item.url.startsWith('file:')); } catch { /* Reader is starting. */ }
      if (target) break;
      await pause(100);
    }
    if (!target) throw new Error('The migration reader did not become ready.');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    });
    const evaluate = expression => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('The library operation timed out.')); }, 120000);
      pending.set(id, { timer, reject, resolve: result => result.exceptionDetails ? reject(new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)) : resolve(result.result?.value) });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    const command = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Reader reload timed out.')); }, 15000);
      pending.set(id, { timer, resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    evaluate.reload = () => command('Page.reload', { ignoreCache: false });
    evaluate.onNewDocument = async source => {
      await command('Page.enable', {});
      return command('Page.addScriptToEvaluateOnNewDocument', { source });
    };
    for (let tries = 0; tries < 200; tries++) {
      if (await evaluate("Boolean(document.querySelector('.reader-document-heading,.library-scroll,.empty-state'))")) break;
      if (tries === 199) throw new Error('The saved library did not finish opening.');
      await pause(100);
    }
    await pause(700); // Let initial text upgrades and summary writes finish.
    await evaluate(`(${async function () {
      globalThis.__migrationDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      globalThis.__migrationGet = key => new Promise((resolve, reject) => {
        const request = __migrationDb.transaction('keyval').objectStore('keyval').get(key);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    }})()`);
    return await run(evaluate);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: ++sequence, method: 'Runtime.evaluate', params: { expression: 'window.close()' } }));
      let shutdownTimer;
      await Promise.race([done, new Promise(resolve => { shutdownTimer = setTimeout(resolve, 10000); })]);
      clearTimeout(shutdownTimer);
      socket.close();
    }
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Migration reader closed.')); }
    if (!exited) { child.kill(); await done; }
  }
}

export async function exportLibrary(options) {
  const output = path.resolve(options.output);
  await mkdir(path.join(output, 'books'), { recursive: true });
  return withReader(options, async evaluate => {
    const state = await evaluate(`(async () => {
      const index = await __migrationGet('cadence-library-index-v2');
      const legacy = index === undefined ? await __migrationGet('cadence-library-v1') : null;
      globalThis.__migrationLegacy = legacy;
      const items = (index ?? legacy ?? []).map(({segments,bytes,...item}) => item);
      return { items, settings: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('cadence-')).map(key => [key,localStorage.getItem(key)])) };
    })()`);
    const settings = Object.fromEntries(Object.entries(state.settings).filter(([key, value]) => settingAllowed(key) && typeof value === 'string'));
    if (settings['cadence-engine'] === 'eleven') settings['cadence-engine'] = 'local';
    await writeFile(path.join(output, 'settings.json'), JSON.stringify(settings, null, 2));
    const records = [];
    for (const item of state.items) {
      if (!/^[\w-]{1,128}$/.test(item.id)) throw new Error('The library has an unsupported document ID.');
      const book = await evaluate(`(async () => {
        const id = ${JSON.stringify(item.id)};
        const legacy = __migrationLegacy?.find(item => item.id === id);
        const segments = await __migrationGet('cadence-text:' + id) ?? legacy?.segments;
        if (!Array.isArray(segments)) throw new Error('Saved document text is missing for ' + id);
        const file = await __migrationGet('cadence-file:' + id) ?? (legacy?.bytes ? new Blob([legacy.bytes]) : undefined);
        globalThis.__migrationFile = file;
        return { segments, fileSize: file?.size || 0 };
      })()`);
      const documentFile = `books/${item.id}.json`;
      await writeFile(within(output, documentFile), JSON.stringify({ item, segments: book.segments }));
      const record = { id: item.id, documentFile, documentSha256: await sha256(within(output, documentFile)) };
      if (book.fileSize) {
        const pdfFile = `books/${item.id}.pdf`, file = await open(within(output, pdfFile), 'w');
        try {
          for (let offset = 0; offset < book.fileSize; offset += 1024 * 1024) {
            const base64 = await evaluate(`(async () => { const bytes = new Uint8Array(await __migrationFile.slice(${offset},${offset + 1024 * 1024}).arrayBuffer()); let text = ''; for(let i=0;i<bytes.length;i+=16384) text += String.fromCharCode(...bytes.subarray(i,i+16384)); return btoa(text); })()`);
            await file.write(Buffer.from(base64, 'base64'));
          }
        } finally { await file.close(); }
        record.pdfFile = pdfFile; record.pdfSize = book.fileSize; record.pdfSha256 = await sha256(within(output, pdfFile));
      }
      records.push(record);
      console.log(`Exported document ${records.length}/${state.items.length}`);
    }
    const manifest = { format: 'cadence-portable-library', version: 1, appVersion: options.version || '1.0.12', created: new Date().toISOString(), settingsSha256: await sha256(path.join(output, 'settings.json')), documents: records, credentialsIncluded: false };
    await writeFile(path.join(output, 'library-manifest.json'), JSON.stringify(manifest, null, 2));
    return { documents: records.length, pdfBytes: records.reduce((sum, record) => sum + (record.pdfSize || 0), 0), lastId: JSON.parse(settings['cadence-reader-session-v1'] || '{}').lastId || settings['cadence-document'] || '' };
  });
}

export async function validateLibrary(input) {
  const root = path.resolve(input), manifest = JSON.parse(await readFile(path.join(root, 'library-manifest.json'), 'utf8'));
  if (manifest.format !== 'cadence-portable-library' || manifest.version !== 1 || !Array.isArray(manifest.documents)) throw new Error('Unsupported library backup format.');
  if (await sha256(path.join(root, 'settings.json')) !== manifest.settingsSha256) throw new Error('Settings checksum mismatch.');
  const seen = new Set();
  for (const record of manifest.documents) {
    if (!/^[\w-]{1,128}$/.test(record.id) || seen.has(record.id)) throw new Error('Invalid or duplicate library ID.');
    seen.add(record.id);
    if (await sha256(within(root, record.documentFile)) !== record.documentSha256) throw new Error('Document checksum mismatch.');
    if (record.pdfFile && (await sha256(within(root, record.pdfFile)) !== record.pdfSha256 || (await stat(within(root, record.pdfFile))).size !== record.pdfSize)) throw new Error('PDF checksum mismatch.');
    const book = JSON.parse(await readFile(within(root, record.documentFile), 'utf8'));
    if (book.item?.id !== record.id || !Array.isArray(book.segments)) throw new Error('Invalid document backup.');
  }
  return manifest;
}

export async function importLibrary(options) {
  const input = path.resolve(options.input), manifest = await validateLibrary(input);
  const settings = JSON.parse(await readFile(path.join(input, 'settings.json'), 'utf8'));
  const hadProfile = await stat(path.join(options.profile, 'IndexedDB')).then(() => true, () => false);
  return withReader(options, async evaluate => {
    const original = await evaluate("(async () => ({ items: await __migrationGet('cadence-library-index-v2') || [], settings: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('cadence-')).map(key => [key,localStorage.getItem(key)])) }))()");
    const fresh = !hadProfile || original.items.length === 0;
    const existing = new Set(original.items.map(item => item.id)), imported = [];
    for (const record of manifest.documents) {
      const replaceWelcome = fresh && record.id === 'cadence-welcome';
      if (existing.has(record.id) && !replaceWelcome) continue; // Existing destination copies always win.
      const book = JSON.parse(await readFile(within(input, record.documentFile), 'utf8'));
      await evaluate('globalThis.__migrationParts = []');
      if (record.pdfFile) {
        const file = await open(within(input, record.pdfFile), 'r');
        try {
          const block = Buffer.alloc(1024 * 1024);
          for (let position = 0; position < record.pdfSize;) {
            const { bytesRead } = await file.read(block, 0, Math.min(block.length, record.pdfSize - position), position);
            if (!bytesRead) throw new Error('Unexpected end of PDF backup.');
            await evaluate(`__migrationParts.push(Uint8Array.from(atob(${JSON.stringify(block.subarray(0, bytesRead).toString('base64'))}), c => c.charCodeAt(0))); undefined`);
            position += bytesRead;
          }
        } finally { await file.close(); }
      }
      const added = await evaluate(`(${async function (book, hasPdf, replaceWelcome) {
        return new Promise((resolve, reject) => {
          const tx = __migrationDb.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval'); let added = false;
          const request = store.get('cadence-library-index-v2');
          request.onsuccess = () => {
            const items = request.result || [];
            if (items.some(item => item.id === book.item.id) && !replaceWelcome) return;
            const { segments: _segments, bytes: _bytes, ...metadata } = book.item;
            const item = { ...metadata, segmentCount: book.segments.length,
              wordCount: book.segments.reduce((sum, segment) => sum + (segment.text.match(/\S+/g)?.length || 0), 0),
              bookmarkPreviews: Object.fromEntries((metadata.bookmarks || []).filter(index => book.segments[index]).map(index => [index, book.segments[index]])) };
            store.put(book.segments, 'cadence-text:' + item.id);
            if (hasPdf) store.put(new Blob(__migrationParts, { type: 'application/pdf' }), 'cadence-file:' + item.id);
            store.put([item, ...items.filter(existing => existing.id !== item.id)], 'cadence-library-index-v2'); added = true;
          };
          tx.oncomplete = () => { globalThis.__migrationParts = []; resolve(added); };
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      }})(${JSON.stringify(book)},${!!record.pdfFile},${replaceWelcome})`);
      if (added) imported.push(record.id);
      console.log(`Imported document ${imported.length}/${manifest.documents.length}`);
    }
    const allowed = Object.fromEntries(Object.entries(settings).filter(([key, value]) => settingAllowed(key) && typeof value === 'string'));
    const applySettings = `(${function (source, fresh, imported, original) {
      if (fresh) {
        for (const [key, value] of Object.entries(source)) localStorage.setItem(key, value);
      } else {
        const sourceSession = JSON.parse(source['cadence-reader-session-v1'] || '{"books":{}}');
        const targetSession = JSON.parse(original['cadence-reader-session-v1'] || '{"books":{}}');
        const newcomers = Object.fromEntries(Object.entries(sourceSession.books || {}).filter(([id]) => imported.includes(id)));
        targetSession.books = Object.fromEntries(Object.entries({ ...newcomers, ...(targetSession.books || {}) }).slice(-64));
        localStorage.setItem('cadence-reader-session-v1', JSON.stringify(targetSession));
        for (const [key, value] of Object.entries(source)) if (key.startsWith('cadence-contents-v3:') && imported.some(id => key.endsWith(':' + id))) localStorage.setItem(key, value);
      }
      const session = JSON.parse(localStorage.getItem('cadence-reader-session-v1') || '{}');
      return { lastId: session.lastId || localStorage.getItem('cadence-document') || '', checkpoint: session.books?.[session.lastId] };
    }})(${JSON.stringify(allowed)},${fresh},${JSON.stringify(imported)},${JSON.stringify(original.settings)})`;
    const result = await evaluate(applySettings);
    // Read the imported library in React before closing; its close handler then
    // saves the transferred selection, not the temporary welcome screen.
    await evaluate('globalThis.__migrationReloadMarker = true; undefined');
    // The old screen flushes its own checkpoint during beforeunload. Reapply
    // transferred settings after that flush and before the new React app starts.
    const initSettings = `${applySettings}; globalThis.__migrationInitialId = localStorage.getItem('cadence-document');`;
    await evaluate.onNewDocument(initSettings);
    await evaluate.reload();
    for (let tries = 0; tries < 200; tries++) {
      try {
        const ready = await evaluate(`!globalThis.__migrationReloadMarker && Boolean(document.querySelector('.reader-document-heading,.library-scroll,.empty-state')) && localStorage.getItem('cadence-document') === ${JSON.stringify(result.lastId)}`);
        if (ready) break;
      } catch { /* The renderer is reloading. */ }
      if (tries === 199) {
        const state = await evaluate("({reloadPending:!!globalThis.__migrationReloadMarker,initial:globalThis.__migrationInitialId,active:localStorage.getItem('cadence-document'),session:JSON.parse(localStorage.getItem('cadence-reader-session-v1')||'{}').lastId,header:!!document.querySelector('.reader-document-heading'),library:!!document.querySelector('.library-scroll')})");
        throw new Error('The restored library did not finish reopening: ' + JSON.stringify(state));
      }
      await pause(100);
    }
    await pause(500);
    return { imported: imported.length, keptExisting: manifest.documents.length - imported.length, freshDestination: fresh, lastId: result.lastId };
  });
}

async function cli() {
  const [action, ...args] = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) options[args[index].replace(/^--/, '')] = args[index + 1];
  if (action === 'validate') { const manifest = await validateLibrary(options.input); console.log(JSON.stringify({ valid: true, documents: manifest.documents.length })); return; }
  if (!options.app || !options.profile) throw new Error('Supply --app and --profile.');
  const result = action === 'export' ? await exportLibrary(options) : action === 'import' ? await importLibrary(options) : (() => { throw new Error('Use export, import or validate.'); })();
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli().catch(error => { console.error(error.message); process.exitCode = 1; });
