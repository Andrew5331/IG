# Instagram Clone: App (Expo Go) + Backend (Node) + Supabase

```
instagram-project/
├─ app/        App móvil (Expo Go)
├─ backend/    API Node/Express (seguir, aprobar, borrar posts, purgar historias)
└─ supabase/   schema.sql (tablas, RLS, realtime, storage)
```

## 1. Supabase (una sola vez)
1. Crea el proyecto en supabase.com.
2. **SQL Editor** → pega TODO `supabase/schema.sql` → Run. (Si ya lo habías ejecutado antes en este proyecto, NO lo repitas: dará "already exists".)
3. **Authentication → Providers → Email**: apaga **Confirm email**.
4. Si ya tenías cuentas sin confirmar: `update auth.users set email_confirmed_at = now() where email_confirmed_at is null;`
5. Si en una instalación anterior programaste `pg_cron`: `select cron.unschedule('purge-stories');` (ahora lo hace el backend).

## 2. Configuración (dos archivos .env)
| Archivo | Contenido | De dónde sale |
|---|---|---|
| `app/.env` (copia `app/.env.example`) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API (Project URL y **anon public**) |
| `backend/.env` (copia `backend/.env.example`) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | Project Settings → API (**service_role**, SECRETA). `CRON_SECRET` es una clave que inventas |

La `service_role` solo va en `backend/.env`; nunca en la app ni en git.

## 3. Instalar y ejecutar
```
npm run setup          # instala todo (raíz, backend y app)
npm run upgrade-expo   # alinea la app con el SDK de tu Expo Go (solo si Expo Go te dice que el SDK no coincide)
npm run dev            # backend + app en la misma terminal
```
O por separado en dos terminales: `npm run backend` y `npm run app`.

- Comprueba el backend: abre `http://localhost:3000/health` → `{"ok":true}`.
- Escanea el QR con Expo Go. **PC y celular en la misma red Wi‑Fi**: la app deduce sola la IP del backend.
- Windows: permite el puerto 3000 en el firewall (Node.js → redes privadas).
- Si usas `expo start --tunnel` o otra red: abre un túnel al backend (`npx cloudflared tunnel --url http://localhost:3000`) y pon la URL en `app/.env` como `EXPO_PUBLIC_API_URL`. Reinicia con `npm --prefix app start -- -c`.

## 4. Pruebas rápidas
1. Crea dos cuentas (dos dispositivos o cerrar sesión). 2. Publica una imagen con ➕ y desliza el feed para refrescar. 3. Like y comentario (instantáneos). 4. Modo avión: like/comentario/mensaje/post, apaga el modo avión y comprueba que sincronizan en orden. 5. Cuenta privada: B pide seguir a A, A acepta en Actividad. 6. Chat: "Escribiendo…", Enviado/Entregado/Visto. 7. Historia con ➕ (switch 24 h): pausa al mantener presionado. 8. Deep link `exp://TU_IP:8081/--/post/UUID`.
Si `npm run backend` no está corriendo, seguir/aprobar mostrarán un error; el resto funciona directo con Supabase.

## 5. Errores frecuentes
| Mensaje | Causa y solución |
|---|---|
| Database error saving new user | Trigger `handle_new_user` sin `search_path`; ya está corregido en `schema.sql` |
| Email not confirmed | Paso 1.3 y 1.4 |
| Feed vacío, `[feed] more than one relationship` | Ya corregido (`profiles!posts_user_id_fkey`) |
| Post no se publica | Falta política `st_upd` en Storage; ya está en `schema.sql`. Mira líneas `[sync]` en la terminal |
| Falta app/.env | Crea `app/.env` desde `app/.env.example` y reinicia con `-c` |
| Network request failed al seguir | Backend apagado, IP/puerto bloqueado o redes distintas |

## 6. Para la defensa
Caché RAM+disco LRU y cancelación (`app/src/imageCache.js`, `CachedImage.js`) · cola offline idempotente en SQLite (`app/src/offline.js`) · RLS y `can_view` (`supabase/schema.sql`) · Realtime: `postgres_changes` vs `broadcast` (`app/src/screens/Chat.js`) · un Stack por pestaña + deep link (`app/App.js`) · por qué el backend usa `service_role` y valida el JWT (`backend/src/index.js`).
