# CamMonitor Prototype — SPEC (single source of truth)

> **v2 update — split portals.** Admin and customers are now fully separate:
> - **Admin Console at `/admin/`** (staff `User` accounts, `/api/auth/admin/login`,
>   `/api/admin/**` oversight: customers, issues, password resets, activity).
> - **Customer Portal at `/portal/`** (customers self-register via
>   `/api/auth/customer/register`, sign in via `/api/auth/customer/login`, manage
>   only their own sites — name, area/location, owner — and cameras via
>   `/api/portal/**`, report support issues, request password resets).
> - `Customer` gained `email`/`passwordHash`/`lastLoginAt`; `Site` gained `owner`;
>   new entities `SupportIssue`, `PasswordResetRequest`, `ActivityLog`; a global
>   `RolesGuard` enforces `admin`/`viewer`/`customer` roles. The rest of this
>   document still applies as written.

Remote camera monitoring prototype: NestJS + PostgreSQL + MediaMTX + FFmpeg + Docker + ngrok.
**Golden rule: adding a camera NEVER requires editing mediamtx.yml — all path config via MediaMTX Control API.**

## Stack & layout
```
cam-monitor/                     (repo root = /mnt/agents/output/cam-monitor)
├── docker-compose.yml
├── .env.example
├── README.md
├── postman/cam-monitor.postman_collection.json
├── backend/                     (NestJS 10, TypeScript, TypeORM, class-validator)
│   ├── Dockerfile
│   ├── package.json  tsconfig.json
│   └── src/
│       ├── main.ts  app.module.ts  app.controller.ts  app.service.ts
│       ├── config/env.ts
│       ├── database/database.module.ts
│       ├── auth/        (controller, service, module, jwt guard, public decorator, dto, user entity)
│       ├── customers/   (controller, service, module, dto, entity)
│       ├── sites/       (controller, service, module, dto, entity)
│       ├── cameras/     (controller, service, module, dto, entity)
│       └── streaming/   (module, mediamtx.service, ffmpeg-runner.service, video-sources.service, camera-lifecycle.service, hls-proxy.controller)
├── frontend/                    (vanilla HTML/CSS/JS, served by Nest ServeStatic at /)
│   ├── index.html  styles.css  app.js
│   └── vendor/hls.min.js        (vendored, NO CDN)
├── mediamtx/mediamtx.yml        (generic only — zero camera-specific paths)
└── videos/                      (front-gate.mp4 living-room.mp4 backyard.mp4)
```

## Domain model (TypeORM, synchronize:true for prototype)
- **User** { id uuid PK, email varchar unique, passwordHash varchar, role varchar('admin'|'viewer'), createdAt }
- **Customer** { id uuid PK, name varchar, contactEmail varchar nullable, contactPhone varchar nullable, notes text nullable, createdAt, sites OneToMany }
- **Site** { id uuid PK, name varchar, address varchar nullable, customerId uuid FK→Customer onDelete CASCADE, createdAt, cameras OneToMany }
- **Camera** { id uuid PK, name varchar, siteId uuid FK→Site onDelete CASCADE, sourceType varchar('demo'|'rtsp') default 'demo', demoSource varchar nullable, rtspUrl varchar nullable, path varchar unique, status varchar('online'|'offline'|'pending') default 'offline', createdAt }
- `path` = unique MediaMTX path, generated: `<slug(site.name)>/<slug(camera.name)>-<shortid>` (MediaMTX supports nested paths). slug = lowercase, non-alnum→`-`.

## Environment variables (single source; `.env` at repo root, `env_file: .env` in compose)
```
PORT=3000
DB_HOST=postgres  DB_PORT=5432  DB_USER=camadmin  DB_PASS=camplexpass  DB_NAME=camerasdb
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=12h
MEDIAMTX_API_URL=http://mediamtx:9997
MEDIAMTX_API_USER=admin
MEDIAMTX_API_PASSWORD=admin123
MEDIAMTX_RTSP_URL=rtsp://mediamtx:8554
MEDIAMTX_HLS_INTERNAL=http://mediamtx:8888
VIDEOS_DIR=/videos
```
Local dev defaults in env.ts must match DB_NAME=camerasdb etc. (localhost hosts). TypeORM options MUST include `retryAttempts: 20, retryDelay: 3000` so backend survives postgres boot.

## Auth
- JWT bearer, global guard, `@Public()` decorator for exceptions. ALSO accept `?access_token=` query param (needed for `<video>`/HLS which can't set headers) — optional convenience; HLS proxy itself is public.
- Seed on boot if users empty: `admin@local.com / admin123` (admin), `viewer@local.com / viewer123` (viewer).
- POST /api/auth/login {email,password} → {access_token, user:{id,email,role}}  (public)
- GET /api/health → {status:'ok', db:'up', mediamtx:'up'|'down', time}  (public)

## REST API (prefix /api; all JWT-protected unless noted)
Customers: POST/GET /customers, GET/PATCH/DELETE /customers/:id  (dto: name required; contactEmail/contactPhone/notes optional)
Sites:     POST/GET /sites, GET/PATCH/DELETE /sites/:id          (dto: name, customerId required; address optional). GET /sites returns relations customer + cameras.
Cameras:   POST/GET /cameras, GET/PATCH/DELETE /cameras/:id; POST /cameras/:id/start; POST /cameras/:id/stop; GET /cameras/demo-sources → string[] of mp4 filenames; POST /cameras/demo-sources/upload (multipart `file`).
CreateCameraDto: { name: string (required), siteId: uuid (required), sourceType?: 'demo'|'rtsp' (default demo), demoSource?: string (must exist in /videos list when sourceType=demo), rtspUrl?: string (required when sourceType=rtsp) }.
Validation: demo→demoSource required & whitelisted; rtsp→rtspUrl required (IsUrl require_tld:false).

### Camera JSON (flat — this exact shape)
```json
{ "id":"…","name":"Front Gate","siteId":"…","sourceType":"demo","demoSource":"front-gate.mp4",
  "rtspUrl":null,"path":"hq-berlin/front-gate-a1b2c3","status":"online","createdAt":"…",
  "site": { "id":"…","name":"HQ Berlin","customerId":"…","customer": { "id":"…","name":"Acme GmbH" } },
  "hlsUrl": "/api/hls/hq-berlin/front-gate-a1b2c3/index.m3u8" }
```
`hlsUrl` is ALWAYS the relative backend-proxy URL (ngrok-safe). GET /cameras returns array of these (sorted by name).

## Streaming behavior
### MediaMTX control (MediaMTXService) — API v3, Basic auth admin:admin123
- `addPath(path, source?)`: POST {api}/v3/config/paths/add/{path}. demo → body `{}` (publisher mode). rtsp → body `{ "source": "<rtspUrl>" }` (pull mode = future real cameras). Retry 3× with 1s backoff; 409 = ok.
- `removePath(path)`: DELETE …/delete/{path}; 404 = ok.
- `getPath(path)`: GET {api}/v3/paths/get/{path} → null | {ready:boolean}.
### FFmpeg demo publisher (FFmpegRunnerService)
`ffmpeg -re -stream_loop -1 -i /videos/<demoSource> -c copy -rtsp_transport tcp -f rtsp <MEDIAMTX_RTSP_URL>/<path>`
Track child procs by cameraId; `stop(id)` SIGKILL; respawn handled by lifecycle service.
### CameraLifecycleService (NEW — owns state machine)
- `provision(camera)`: addPath (with source if rtsp) → if demo: startDemo → status 'pending' → poller will flip to 'online' when path ready.
- `deprovision(camera)`: stop ffmpeg, removePath, status 'offline'.
- `onApplicationBootstrap`: for every camera in DB: re-add path (idempotent); if sourceType=demo AND status was 'online' → restart publisher; else set 'offline'. (Restart reconciliation.)
- Poller every 8s: for each camera compare MediaMTX `ready` vs DB status; update DB on change; if demo camera should be online but publisher process missing → respawn.
- create → provision; start → provision; stop → stop publisher + status offline (path kept); delete → deprovision + DB remove.
### HLS proxy (HlsProxyController, @Public, route `/api/hls/*`)
GET /api/hls/** → fetch `${MEDIAMTX_HLS_INTERNAL}/**` with Basic auth; pipe status, content-type, body (Node 20: `Readable.fromWeb(res.body)`). No caching headers (`Cache-Control: no-store`). This makes ONE ngrok tunnel (port 3000) serve UI+API+HLS.

## Frontend (full redesign — dark security console)
- Files: `index.html`, `styles.css`, `app.js`, vendor/hls.min.js. NO config.js, NO CDN, all URLs relative to origin.
- Palette (CSS vars): bg `#0d1420`, panel `#141d2e`, panel2 `#1a2538`, border `#243248`, text `#dde6f2`, muted `#8596ad`, accent `#38bdf8` (sky), ok `#4ade80`, warn `#fbbf24`, err `#f87171`. Font: system stack. No gradients, no saturated fills; 10-12px radius, subtle borders, generous spacing.
- Login view: centered card, email/password, error line, default creds hint text.
- App shell: topbar (logo "CamMonitor", health dot, user email, logout); sidebar (Customers→Sites tree w/ expand, "+ Customer" "+ Site" buttons); main area.
- Main: section header + "＋ Add Camera"; camera grid of cards: 16:9 video (hls.js, autoplay muted, poster placeholder when offline), name, breadcrumb Customer › Site, status badge (● online green / ○ offline gray-red / ◌ pending amber), demo-source chip, buttons Start/Stop/Edit/Delete.
- Modals: Add/Edit Customer, Add/Edit Site (customer select), Add/Edit Camera (site select, source-type toggle demo/rtsp, demo-source dropdown from /cameras/demo-sources, rtspUrl input when rtsp). HTML `<dialog>` or simple overlay divs.
- Poll GET /api/cameras every 5s → update badges/text in place; only (re)create a player when camera appears or transitions to online. Destroy Hls instances for removed/stopped cams.
- Token in localStorage `cm_token`; api() helper adds Authorization; 401 → logout to login view.
- Empty states with guidance text ("Create your first customer…").

## Docker
`docker-compose.yml` (v3 syntax optional):
- postgres:16-alpine, env from .env, volume pgdata, healthcheck pg_isready, port 5432.
- mediamtx: bluenviron/mediamtx:1.9.3, mount ./mediamtx/mediamtx.yml, ports 8554(RTSP) 8888(HLS) 9997(API) mapped to host as 8554/8888/9997 (no weird remapping), restart unless-stopped.
- backend: build ./backend context=repo-root dockerfile backend/Dockerfile; env_file .env; ports "3000:3000"; volumes ./videos:/videos; depends_on postgres:service_healthy, mediamtx:service_started; restart unless-stopped.
- volumes: pgdata.
Backend Dockerfile: node:20-alpine build stage (`npm ci`, `nest build`) → runtime node:20-alpine + `apk add ffmpeg`, copies dist+node_modules+frontend, EXPOSE 3000, CMD node dist/main.js. ServeStatic rootPath must resolve in both dev (`backend/frontend` fallback) and docker (`/app/public/frontend`) — implement robust multi-path resolution.

mediamtx.yml: api on :9997, rtsp :8554, hls :8888, hlsAlwaysRemux yes, authInternalUsers: any(read/playback) + admin:admin123(api,publish,read,playback). No paths section.

## Docs & extras
- README.md: what it is, architecture ASCII diagram, quickstart (`cp .env.example .env && docker compose up --build`), default creds, **remote testing via ngrok** (`ngrok http 3000`, one tunnel, HLS works through it thanks to proxy), full acceptance walkthrough (11 steps), API table, project structure, "swapping in real RTSP cameras" section, troubleshooting.
- postman/cam-monitor.postman_collection.json: all endpoints, {{baseUrl}}, {{token}} var auto-set by login test script.

## Acceptance (must all pass)
1 login → 2 create customer → 3 create site → 4 add camera w/ demo source → 5 backend auto-configures MediaMTX → 6 camera appears online in dashboard → 7 HLS plays via /api/hls proxy → 8 add 2nd camera, no config edits → 9 both stream independently → 10 stop camera → 11 status flips offline (≤10s).
