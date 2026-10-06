import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, PORT = 3000 } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Falta configurar el archivo .env');

// service_role: salta RLS. Vive SOLO en el servidor, jamás dentro de la app móvil.
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 })); // 120 peticiones/min por IP

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'Error interno' }); });
const storagePath = (url) => { const i = (url || '').indexOf('/media/'); return i < 0 ? null : url.slice(i + 7); };

// Valida el JWT que Supabase le dio al usuario en la app.
async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'No autorizado' });
  req.user = data.user; next();
}

app.get('/health', (_, res) => res.json({ ok: true }));

// Seguir: el SERVIDOR decide si queda pendiente (cuenta privada) o aceptado.
app.post('/follow/:id', auth, wrap(async (req, res) => {
  const me = req.user.id, target = req.params.id;
  if (!isUuid(target) || target === me) return res.status(400).json({ error: 'Usuario inválido' });
  const { data: p } = await db.from('profiles').select('is_private').eq('id', target).maybeSingle();
  if (!p) return res.status(404).json({ error: 'El usuario no existe' });
  const { data: prev } = await db.from('follows').select('status').match({ follower: me, following: target }).maybeSingle();
  if (prev) return res.json({ status: prev.status });
  const status = p.is_private ? 'pending' : 'accepted';
  const { error } = await db.from('follows').insert({ follower: me, following: target, status });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ status });
}));

// Dejar de seguir / cancelar solicitud.
app.delete('/follow/:id', auth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Usuario inválido' });
  await db.from('follows').delete().match({ follower: req.user.id, following: req.params.id });
  res.json({ ok: true });
}));

// Aprobar o rechazar: solo el dueño de la cuenta (el "seguido") puede hacerlo.
app.post('/follow/:id/respond', auth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Usuario inválido' });
  const where = { follower: req.params.id, following: req.user.id };
  const q = req.body?.accept ? db.from('follows').update({ status: 'accepted' }).match(where).eq('status', 'pending') : db.from('follows').delete().match(where);
  const { data, error } = await q.select();
  if (error) return res.status(400).json({ error: error.message });
  if (!data?.length) return res.status(404).json({ error: 'No hay solicitud' });
  res.json({ ok: true });
}));

// Borrar publicación + su imagen en Storage (solo el autor).
app.delete('/posts/:id', auth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Id inválido' });
  const { data: post } = await db.from('posts').select('user_id,image_url').eq('id', req.params.id).maybeSingle();
  if (!post) return res.status(404).json({ error: 'No existe' });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: 'No eres el autor' });
  const path = storagePath(post.image_url);
  if (path) await db.storage.from('media').remove([path]);
  await db.from('posts').delete().eq('id', req.params.id);
  res.json({ ok: true });
}));

// Editar la descripción de una publicación (solo el autor).
app.patch('/posts/:id', auth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Id inválido' });
  const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 2200) : null;
  if (caption === null) return res.status(400).json({ error: 'Falta la descripción' });
  const { data, error } = await db.from('posts').update({ caption }).match({ id: req.params.id, user_id: req.user.id }).select();
  if (error) return res.status(400).json({ error: error.message });
  if (!data?.length) return res.status(403).json({ error: 'No eres el autor o no existe' });
  res.json({ ok: true });
}));
// Editar la descripción de un reel (solo el autor).
app.patch('/reels/:id', auth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Id inválido' });
  const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 2200) : null;
  if (caption === null) return res.status(400).json({ error: 'Falta la descripción' });
  const { data, error } = await db.from('reels').update({ caption }).match({ id: req.params.id, user_id: req.user.id }).select();
  if (error) return res.status(400).json({ error: error.message });
  if (!data?.length) return res.status(403).json({ error: 'No eres el autor o no existe' });
  res.json({ ok: true });
}));

// Borrar un reel y su video en Storage (solo el autor).
app.delete('/reels/:id', auth, wrap(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Id inválido' });
  const { data: reel } = await db.from('reels').select('user_id,video_url').eq('id', req.params.id).maybeSingle();
  if (!reel) return res.status(404).json({ error: 'No existe' });
  if (reel.user_id !== req.user.id) return res.status(403).json({ error: 'No eres el autor' });
  const path = storagePath(reel.video_url);
  if (path) await db.storage.from('media').remove([path]);
  await db.from('reels').delete().eq('id', req.params.id);
  res.json({ ok: true });
}));

// Historias de más de 24 h: borra la fila Y la imagen de Storage.
async function purgeStories() {
  const cutoff = new Date(Date.now() - 24 * 3600e3).toISOString();
  const { data } = await db.from('stories').select('id,image_url').lt('created_at', cutoff).limit(500);
  if (!data?.length) return 0;
  const paths = data.map((s) => storagePath(s.image_url)).filter(Boolean);
  if (paths.length) await db.storage.from('media').remove(paths);
  await db.from('stories').delete().in('id', data.map((s) => s.id));
  return data.length;
}
setInterval(() => purgeStories().then((n) => n && console.log('Historias purgadas:', n)).catch(console.error), 15 * 60_000);
app.post('/admin/purge-stories', (req, res, next) => (CRON_SECRET && req.headers['x-cron-secret'] === CRON_SECRET ? next() : res.status(403).json({ error: 'Prohibido' })),
  wrap(async (_, res) => res.json({ purged: await purgeStories() })));

app.listen(PORT, '0.0.0.0', () => console.log(`Backend en http://0.0.0.0:${PORT}`));
