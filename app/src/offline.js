// Cola de sincronización offline-first en SQLite + caché de lecturas (kv) + historias vistas.
import * as SQLite from 'expo-sqlite';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as FS from 'expo-file-system/legacy';
import { supabase } from './supabase';
const db = SQLite.openDatabaseSync('app.db');
db.execSync(`CREATE TABLE IF NOT EXISTS queue(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT,payload TEXT);
CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY,v TEXT);
CREATE TABLE IF NOT EXISTS seen(id TEXT PRIMARY KEY);`);
export const uuid = () => Crypto.randomUUID();
export const kvSet = (k, v) => db.runSync('INSERT OR REPLACE INTO kv VALUES(?,?)', k, JSON.stringify(v));
export const kvGet = (k) => { const r = db.getFirstSync('SELECT v FROM kv WHERE k=?', k); return r ? JSON.parse(r.v) : null; };
export const markSeen = (id) => db.runSync('INSERT OR IGNORE INTO seen VALUES(?)', id);
export const isSeen = (id) => !!db.getFirstSync('SELECT 1 x FROM seen WHERE id=?', id);

// Operaciones idempotentes => reintentar nunca duplica ni corrompe el estado remoto.
const ops = {
  like: (p) => supabase.from('likes').upsert(p, { onConflict: 'post_id,user_id', ignoreDuplicates: true }),
  unlike: (p) => supabase.from('likes').delete().match(p),
  comment: (p) => supabase.from('comments').upsert(p, { onConflict: 'id', ignoreDuplicates: true }), // id generado en cliente
};
const media = async (table, p) => { // sube la imagen (idempotente con upsert) y luego crea la fila con id de cliente
  const path = `${p.user_id}/${p.id}.jpg`;
  const b64 = await FS.readAsStringAsync(p.uri, { encoding: 'base64' }); // fetch(uri).arrayBuffer() puede subir 0 bytes en RN
  const bin = atob(b64); const buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  if (buf.length < 100) return { error: { code: 'EMPTY', message: 'la imagen local está vacía (' + buf.length + ' bytes)' } }; // no subir basura
  const up = await supabase.storage.from('media').upload(path, buf, { contentType: 'image/jpeg', upsert: true });
  if (up.error) return up;
  const row = { id: p.id, user_id: p.user_id, image_url: supabase.storage.from('media').getPublicUrl(path).data.publicUrl };
  if (table === 'posts') row.caption = p.caption;
  return supabase.from(table).upsert(row, { onConflict: 'id', ignoreDuplicates: true });
};
ops.message = (p) => supabase.from('messages').upsert(p, { onConflict: 'id', ignoreDuplicates: true });
ops.post = (p) => media('posts', p);
ops.story = (p) => media('stories', p);
let running = false;
const subs = new Set();
export const onSync = (fn) => { subs.add(fn); return () => subs.delete(fn); }; // avisa a las pantallas cuando la cola sube algo
export function enqueue(type, payload) { db.runSync('INSERT INTO queue(type,payload) VALUES(?,?)', type, JSON.stringify(payload)); flush(); }
export async function flush() {
  if (running) return; running = true;
  try {
    for (;;) {
      const job = db.getFirstSync('SELECT * FROM queue ORDER BY id LIMIT 1'); // orden cronológico estricto
      if (!job) break;
      let res;
      try { res = await ops[job.type](JSON.parse(job.payload)); } catch (e) { console.warn('[sync] excepción', job.type, e.message); break; }
      if (res.error) console.warn('[sync]', job.type, res.error.message || res.error);
      if (res.error && !res.error.code && !res.error.statusCode) break; // error sin código = red caída: se conserva y se reintenta
      db.runSync('DELETE FROM queue WHERE id=?', job.id); // éxito o rechazo del servidor (RLS/conflicto): se descarta
      if (!res.error) subs.forEach((f) => f(job.type)); // notifica solo si se subió bien
    }
  } finally { running = false; }
}
export const startSync = () => NetInfo.addEventListener((s) => s.isConnected && flush());