// Caché de 2 niveles: RAM (Map con orden LRU) + disco (archivos, LRU por último acceso).
import * as FS from 'expo-file-system/legacy';
const DIR = FS.cacheDirectory + 'img/';
const MAX_RAM = 60;                 // nº de entradas en RAM
const MAX_DISK = 150 * 1024 * 1024; // bytes en disco
const ram = new Map();              // url -> uri local (Map conserva orden de inserción => LRU)
const disk = new Map();             // path -> {size, t}
let ready;
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i); return (h >>> 0).toString(36); };

const init = () => ready || (ready = (async () => {
  await FS.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  for (const f of await FS.readDirectoryAsync(DIR)) {
    const i = await FS.getInfoAsync(DIR + f);
    if (f.endsWith('.tmp')) await FS.deleteAsync(DIR + f, { idempotent: true });
    else disk.set(DIR + f, { size: i.size || 0, t: i.modificationTime || 0 });
  }
})());

async function evictDisk() {
  let total = [...disk.values()].reduce((a, b) => a + b.size, 0);
  const old = [...disk.entries()].sort((a, b) => a[1].t - b[1].t); // menos usado primero
  while (total > MAX_DISK && old.length) {
    const [p, m] = old.shift(); total -= m.size; disk.delete(p);
    await FS.deleteAsync(p, { idempotent: true });
  }
}

export async function getImage(url, signal) {
  if (ram.has(url)) { const v = ram.get(url); ram.delete(url); ram.set(url, v); return v; } // hit RAM
  await init();
  const path = DIR + hash(url);
  if (!disk.has(path)) {                                                                       // miss => red
    const dl = FS.createDownloadResumable(url, path + '.tmp');
    const onAbort = () => dl.cancelAsync().catch(() => {});
    signal?.addEventListener('abort', onAbort);
    const res = await dl.downloadAsync().catch(() => null);
    signal?.removeEventListener('abort', onAbort);
    if (signal?.aborted) { await FS.deleteAsync(path + '.tmp', { idempotent: true }); throw new Error('cancelled'); }
    if (!res || res.status !== 200) { await FS.deleteAsync(path + '.tmp', { idempotent: true }); throw new Error('descarga fallida, status ' + res?.status); }
    const t = await FS.getInfoAsync(path + '.tmp');
    if (!t.exists || !t.size) { await FS.deleteAsync(path + '.tmp', { idempotent: true }); throw new Error('imagen vacía (0 bytes) en el servidor'); }
    await FS.moveAsync({ from: path + '.tmp', to: path });
    const i = await FS.getInfoAsync(path);
    disk.set(path, { size: i.size || 0, t: Date.now() });
    evictDisk();
  } else disk.get(path).t = Date.now();                                                         // hit disco
  ram.set(url, path);
  if (ram.size > MAX_RAM) ram.delete(ram.keys().next().value);                                  // desalojo LRU RAM
  return path;
}