# Guía de Estudio y Funcionamiento del Proyecto - SocIAl (Instagram Clone)

Este documento contiene la explicación paso a paso de la arquitectura, componentes, flujo de datos, backend y base de datos de la aplicación **SocIAl**. Ha sido creado para facilitar su estudio y la exposición/defensa de su funcionamiento.

---

## 📋 Índice
1. **Resumen y Tecnologías Principales**
2. **Arquitectura General de la Aplicación**
3. **Módulos y Componentes Clave de la App Mobile (React Native / Expo)**
   - `App.js`: Enrutamiento y Nivel Superior
   - `ui.js`: Sistema de Diseño Móvil
   - `PostCard.js`: Tarjeta de Publicación
   - `CachedImage.js` y `imageCache.js`: Gestión y Caché de Imágenes (LRU)
   - `offline.js`: Sincronización Offline y Cola Operativa (SQLite)
   - `screens/`: Pantallas principales (`Feed`, `Social`, `Post`, `Reels`, `Chat`)
4. **Backend Express (Node.js)**
   - Autenticación mediante JWT
   - Lógica de Seguidores y Solicitudes Pendientes
   - Limpieza Automática de Historias (Purgado de 24 Horas)
5. **Base de Datos y Seguridad en Supabase (PostgreSQL)**
   - Modelado de Datos
   - Políticas de Seguridad RLS (Row Level Security)
   - Realtime (Subscriptions vs Broadcast)
6. **Flujo Paso a Paso de las Funcionalidades Clave**
   - Publicar Foto / Reel / Historia
   - Dar Like / Comentar (Optimistic Updates & Offline First)
   - Sistema de Cuentas Privadas y Seguimiento
   - Chat Directo en Tiempo Real
7. **Puntos Clave para Explicar y Defender el Proyecto**

---

## 1. Resumen y Tecnologías Principales

**SocIAl** es una aplicación móvil multiplataforma inspirada en Instagram, construida con:
- **Cliente Móvil:** React Native con Expo (Expo Go, Navigation Native & Stack, Expo Video, Expo SQLite).
- **Backend:** Node.js con Express, actuando como microservicio para operaciones privilegiadas.
- **BaaS (Backend as a Service):** Supabase (PostgreSQL, Authentication, Realtime y Storage).

---

## 2. Arquitectura General de la Aplicación

```
                             ┌──────────────────────────────────────┐
                             │       Cliente Móvil (Expo Go)        │
                             └──────────┬────────────────┬──────────┘
                                        │                │
                      Peticiones Directas (DB/Storage)  Peticiones Privilegiadas / Admin
                                        │                │
                                        ▼                ▼
                             ┌──────────────────┐    ┌────────────────────┐
                             │     Supabase     │◄───│   Backend Node.js  │
                             │ (DB, Auth, S3)   │    │  (Express + JWT)   │
                             └──────────────────┘    └────────────────────┘
```

1. **Lectura y Operaciones Básicas:** La app interactúa directamente con Supabase mediante el cliente oficial de JS utilizando la clave pública (`anon key`), respaldada por Row Level Security (RLS).
2. **Operaciones Privilegiadas:** Las acciones delicadas (aprobar seguidores en cuentas privadas, eliminar archivos en Storage del autor, purga periódica de historias) se realizan llamando al backend Node.js que autentica las peticiones con JWT y utiliza la clave administrativa `service_role`.

---

## 3. Módulos y Componentes Clave de la App Mobile

### 3.1. `App.js`
- **Navegación:** Define un `Tab.Navigator` en la parte inferior con 5 pestañas principales: **Home**, **Explorar**, **Reels**, **Actividad** y **Perfil**.
- **Stacks Independientes:** Cada pestaña cuenta con su propia pila de navegación (`Stack.Navigator`) para mantener el estado de navegación aislado por pestaña.
- **Cierre/Inicio de Sesión:** Maneja `supabase.auth.onAuthStateChange` para alternar dinámicamente entre la pantalla de Login/Registro (`Auth`) y la app principal.

### 3.2. `src/ui.js`
- Proporciona constantes de temas visuales (modo oscuro estricto `#000` estilo Instagram) y componentes primitivos (`Text`, `TextInput`, `Button`) con tipografía y comportamiento uniforme.

### 3.3. `src/PostCard.js`
- Componente optimizado (`memo`) encargado de renderizar publicaciones en el feed.
- Soporta **Actualizaciones Optimistas (Optimistic UI)**: cuando el usuario presiona "Me Gusta", el contador y el icono cambian de forma instantánea en la interfaz antes de confirmar con el servidor.

### 3.4. `src/CachedImage.js` y `src/imageCache.js`
- **Caché en Memoria y Disco:** Utiliza una estrategia LRU (Least Recently Used) respaldada por el sistema de archivos de Expo (`expo-file-system`). Evita volver a descargar imágenes ya cargadas, ahorrando ancho de banda y ofreciendo velocidad instantánea.

### 3.5. `src/offline.js`
- **Arquitectura Offline-First:** Implementa una cola de operaciones persistente en una base de datos local **SQLite**.
- Si el usuario se queda sin conexión a Internet (por ejemplo, activa modo avión), las acciones como *likes*, comentarios, o publicaciones se guardan en la base local. Cuando recupera la conexión, `flush()` procesa y reintenta las tareas pendientes respetando el orden.

### 3.6. Estructura de Pantallas (`src/screens/`)
- **`Feed.js`:** Despliega historias efímeras en un carrusel horizontal superior y un listado unificado de publicaciones e historias.
- **`Social.js`:**
  - `Profile`: Perfil del usuario autenticado (publicaciones, reels, contadores de seguidores/seguidos y botón de editar perfil).
  - `UserProfile`: Perfil público o privado de otros usuarios.
  - `FollowList`: Pantalla que consulta y muestra los seguidores o seguidos de una cuenta.
  - `Explore`: Buscador de usuarios por username y cuadrícula de exploración.
  - `Activity`: Gestión de solicitudes de seguimiento pendientes.
- **`Post.js`:**
  - `PostDetail`: Detalle de publicación con comentarios en tiempo real y soporte para responder/dar me gusta a comentarios.
  - `Create`: Selector de imágenes con filtros y subida de publicaciones.
- **`Reels.js`:**
  - Carrete vertical de videos a pantalla completa (estilo Reels/TikTok) utilizando `expo-video`, gestionando reproducción/pausa eficiente del reproductor activo.
- **`Chat.js`:**
  - `Inbox`: Lista de conversaciones recientes.
  - `Chat`: Sala de chat privado directo entre dos usuarios con estados de mensaje (Enviado, Entregado, Visto) e indicador de "Escribiendo...".

---

## 4. Backend Express (Node.js)

Ubicado en `backend/src/index.js`:
1. **Middleware de Autenticación (`auth`):** Intercepta la cabecera `Authorization: Bearer <token>` y valida el JWT utilizando `supabase.auth.getUser(token)`.
2. **Endpoint `/follow/:id`:** Comprueba si la cuenta destino es privada (`is_private: true`). Si es privada, registra la solicitud con estado `pending`. Si es pública, establece directamente el estado `accepted`.
3. **Endpoint `/follow/:id/respond`:** Permite al receptor aprobar (`accepted`) o rechazar la solicitud de seguimiento.
4. **Endpoint `/posts/:id` y `/reels/:id`:** Permiten la edición de descripciones o eliminación completa de recursos (registros en la DB y archivos multimedia asociados en Storage).
5. **Tarea Programada (`purgeStories`):** Un temporizador (`setInterval`) ejecuta cada 15 minutos la eliminación de historias con antigüedad mayor a 24 horas, liberando también los archivos de imágenes en Supabase Storage.

---

## 5. Base de Datos y Seguridad en Supabase (PostgreSQL)

### Tablas Principales:
- `profiles`: Datos de usuario (username, bio, avatar, `is_private`).
- `posts` / `reels` / `stories`: Publicaciones multimedia y contenido efímero.
- `follows`: Relación entre seguidores con estado (`pending`, `accepted`).
- `likes` / `reel_likes` / `comments` / `comment_likes`: Interacciones de contenido.
- `messages`: Mensajería privada entre usuarios con marcas de tiempo (`delivered_at`, `read_at`).

### Seguridad RLS (Row Level Security):
- Cada tabla cuenta con políticas RLS para garantizar que usuarios no autorizados no puedan leer publicaciones o historias de perfiles privados que no siguen.

### Realtime:
- **`postgres_changes`:** Escucha cambios en la base de datos (nuevos comentarios o mensajes) para actualizar la UI en vivo.
- **`broadcast`:** Utilizado en el Chat para transmitir eventos volátiles que no se persisten en base de datos (por ejemplo, el evento "Escribiendo...").

---

## 6. Flujo Paso a Paso de las Funcionalidades Clave

### Flujo: Dar Like a una Publicación
1. El usuario presiona el icono de corazón en `PostCard`.
2. **Actualización Optimista:** La interfaz cambia instantáneamente el estado visual del corazón y suma +1 al contador local.
3. Se invoca `enqueue('like', { post_id, user_id })`.
4. `offline.js` guarda la acción en SQLite y procesa la petición HTTP a Supabase. Si falla por falta de internet, se sincronizará automáticamente al reconectarse.

### Flujo: Seguir a una Cuenta Privada
1. El usuario A presiona "Seguir" en el perfil de B.
2. La app envía `POST /follow/B_ID` al backend Node.js.
3. El backend detecta que B es una cuenta privada y guarda la relación con `status: 'pending'`.
4. El botón en el cliente cambia a "Solicitado".
5. El usuario B recibe la notificación en la pestaña **Actividad** y presiona "Aceptar".
6. El backend actualiza la relación a `status: 'accepted'`, permitiendo a A ver el contenido de B gracias a RLS.

---

## 7. Puntos Clave para Explicar y Defender el Proyecto

Si necesitas exponer o defender este proyecto en una evaluación:

1. **Uso Responsable de la Clave Privilegiada (`service_role`):** Explica que la clave `service_role` jamás debe incluirse en la app móvil. Por eso, las operaciones sensibles (aprobación de solicitudes, eliminación física de archivos en Storage) pasan por el servidor Node.js.
2. **Resiliencia Offline (Offline-First):** Destaca el uso de SQLite para almacenar peticiones en cola. Esto garantiza que el usuario no pierda likes, mensajes ni comentarios si entra a una zona sin cobertura.
3. **Optimización de Recursos y Memoria:**
   - La caché de imágenes LRU evita consumo excesivo de red y RAM.
   - El reproductor de Reels solo instancía el video actualmente visible en pantalla (`focused && index === idx`), evitando saturar el hilo principal.
4. **Seguridad Integrada (RLS + JWT):** La app no confía solo en el frontend; la base de datos PostgreSQL rechaza lecturas no permitidas mediante políticas RLS a nivel de fila.
