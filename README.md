# CamMonitor — Remote Camera Monitoring Prototype

NestJS + PostgreSQL + MediaMTX + FFmpeg + Docker + ngrok.

A small prototype of a camera-monitoring platform: you organize **Customers →
Sites → Cameras**, attach each camera to either a demo `.mp4` file or a real
RTSP source, and watch live HLS video in the browser. All camera-path
configuration in MediaMTX happens **dynamically through its Control API** —
adding a camera never requires editing `mediamtx.yml` or restarting anything.

## Architecture

```
                          (one public tunnel)
  Browser ── HTTPS ──>  ngrok  ──>  :3000 NestJS backend ──┬──> PostgreSQL  (customers/sites/cameras/users)
     ▲                                (UI + REST API       │
     │                                 + HLS proxy)        └──> MediaMTX  (Control API :9997, Basic admin:admin123)
     │                                                          ▲   │
     │                                            RTSP publish ─┘   │ RTSP pull (real cameras)
     │                                            FFmpeg publishers │
     │                                            loop videos/*.mp4 │
     └──── live video: GET /api/hls/<path>/index.m3u8 ──────────────┘  (proxied by the backend :8888)
```

- The browser only ever talks to the **backend on port 3000**: static UI,
  `/api/*` REST endpoints, and `/api/hls/**` which the backend proxies to
  MediaMTX's internal HLS server (`http://mediamtx:8888`).
- Because HLS is proxied, **one ngrok tunnel on port 3000 carries UI + API +
  live video** — no extra tunnels or exposed ports needed for remote demos.
- Demo cameras are simulated by an FFmpeg process inside the backend container
  that loops the chosen `.mp4` and publishes it over RTSP to MediaMTX.
- Real RTSP cameras are pulled directly by MediaMTX (no FFmpeg involved).

## Quickstart

Prerequisites: **Docker** with the **Compose v2** plugin (`docker compose version`).

```bash
cp .env.example .env          # step 1 — then edit .env if you like (it's gitignored)
docker compose up --build     # step 2 — builds the backend image, starts all 3 services
```

Then open **http://localhost:3000** — the landing page links to the **two
separate portals**:

| Portal | URL | Who |
|--------|-----|-----|
| **Customer Portal** | **http://localhost:3000/portal/** | Customers — self-register, sign in, manage *their own* sites/cameras, get support |
| **Admin Console** | **http://localhost:3000/admin/** | Staff only — oversees *all* customers, sites, cameras, issues, resets, activity |

Seeded staff accounts (Admin Console):

| Role   | Email            | Password  |
|--------|------------------|-----------|
| admin  | `admin@local.com`  | `admin123`  |
| viewer | `viewer@local.com` | `viewer123` |

Customers are **not** seeded — they create their own account on the Customer
Portal (**Create account** tab). Staff credentials and customer credentials are
completely separate: a customer token can only reach `/api/portal/**` (its own
data), and only staff tokens can reach `/api/admin/**` and the legacy
`/api/customers` / `/api/sites` / `/api/cameras` routes.

### Customer journey (`/portal/`)

1. **Create account** (name, email, password) or **Sign in**.
2. **My Sites** → *Create Site* with **site name**, **site area / location**
   and **site owner**.
3. **My Cameras** → *＋ Add Camera* on one of their sites — same demo/RTSP
   flow as before, including live HLS playback.
4. **Support** → report problems ("cannot view camera", "cannot sign in",
   "cannot edit", …) and see the admin's resolution notes.
5. **Account** → edit profile or change password. **Forgot password** on the
   sign-in page files a reset request the admin resolves (the prototype has no
   mail server).

### Admin journey (`/admin/`)

- **Overview** — totals plus a "needs attention" list (open issues, pending
  password resets, customers inactive for 14+ days, offline cameras).
- **Customers** — every customer with portal-login email, site/camera counts,
  **last sign-in**, and flags (`inactive`, `no login`). *View* shows their
  sites/cameras, issues and activity; **Set password** creates or resets a
  customer's login when they lose it or can't sign up themselves; **Delete**
  removes a customer with all their sites/cameras.
- **Issues** — everything customers report, resolved with a note the customer
  sees in their portal.
- **Password Resets** — pending forgot-password requests; resolve by setting a
  new password and sharing it with the customer.
- **Activity** — audit log of logins, registrations, site/camera changes,
  support actions (who did what, when).
- **Camera Console** — the original all-customers camera grid.

The backend waits for PostgreSQL to become healthy (TypeORM `retryAttempts: 20,
retryDelay: 3000`), so a cold start may take a few extra seconds.

## Remote testing with ngrok

```bash
ngrok http 3000
```

Share the printed `https://<random>.ngrok-free.app` URL — the entire app,
including **live HLS playback**, works through this single tunnel because the
HLS proxy and all API calls are same-origin relative URLs. No extra tunnels,
no extra ports, no config changes.

## Database UI (Adminer)

The compose stack includes [Adminer](https://www.adminer.org) for browsing the
PostgreSQL database. Open **http://localhost:8080** and log in with:

| Field    | Value         |
|----------|---------------|
| System   | `PostgreSQL`  |
| Server   | `postgres`    |
| Username | `camadmin`    |
| Password | `camplexpass` |
| Database | `camerasdb`   |

(Credentials come from `.env` — `DB_USER` / `DB_PASS` / `DB_NAME`.)

## Acceptance walkthrough (11 steps)

1. **Login** — open the app, sign in as `admin@local.com` / `admin123`.
2. **Create customer** — sidebar → **＋ Customer** → name `Acme GmbH` → Save.
3. **Create site** — select the customer → **＋ Site** → name `HQ Berlin` → Save.
4. **Add camera with demo source** — **＋ Add Camera** → site `HQ Berlin`,
   name `Front Gate`, source type **demo**, demo source `front-gate.mp4` → Save.
5. **Auto-configuration** — the backend registers the path
   `hq-berlin/front-gate-xxxxxx` in MediaMTX via its Control API and spawns an
   FFmpeg publisher; the camera shows **◌ pending** (amber).
6. **Online in dashboard** — within ~10 s the poller sees the MediaMTX path
   become ready and the badge flips to **● online** (green).
7. **HLS playback** — the card's 16:9 player starts playing the looping video
   via `GET /api/hls/<path>/index.m3u8` (proxied by the backend).
8. **Second camera, zero config edits** — **＋ Add Camera** again with
   `living-room.mp4`; nothing in `mediamtx/` or compose is touched.
9. **Independent streams** — both cards play their own streams simultaneously.
10. **Stop camera** — click **Stop** on one card; the FFmpeg publisher is
    killed and playback halts.
11. **Offline status** — within the next poll (≤ 10 s) that camera's badge
    flips to **○ offline**; the other camera keeps streaming.

## Demo video sources

Demo cameras loop a video file from the `./videos/` folder (bind-mounted into
the backend container at `/videos`). There are two ways to manage these files:

- **Drop files in manually** — copy any `.mp4` / `.mov` / `.mkv` / `.webm`
  into `./videos/` on the host; it shows up automatically in the **Add Camera**
  demo-source dropdown (the list is read live from the directory).
- **Manage from the UI** — click **Demo Videos** next to **＋ Add Camera** to
  open the *Demo Video Sources* modal: list all files, upload new ones, or
  delete unused ones. Uploads are **re-encoded to H.264** (yuv420p, faststart)
  for streaming compatibility. A file that is currently used by a camera
  cannot be deleted (the API returns `409 Conflict`).

## API reference

Base URL: `/api`. All endpoints require `Authorization: Bearer <token>`
except `/auth/login`, `/health`, and the public `/hls/**` proxy.
(For `<video>`/HLS clients that can't set headers, `?access_token=` is also
accepted.)

| Method | Path | Auth | Body | Response notes |
|---|---|---|---|---|
| POST | `/auth/login` | public | `{email, password}` | `{access_token, user:{id,email,role}}` |
| GET | `/health` | public | — | `{status:'ok', db:'up', mediamtx:'up'\|'down', time}` |
| POST | `/customers` | bearer | `{name, contactEmail?, contactPhone?, notes?}` | created customer |
| GET | `/customers` | bearer | — | customer array |
| GET | `/customers/:id` | bearer | — | customer |
| PATCH | `/customers/:id` | bearer | partial customer fields | updated customer |
| DELETE | `/customers/:id` | bearer | — | deletes customer (cascades to sites/cameras) |
| POST | `/sites` | bearer | `{name, customerId, address?}` | created site |
| GET | `/sites` | bearer | — | sites with `customer` + `cameras` relations |
| GET | `/sites/:id` | bearer | — | site |
| PATCH | `/sites/:id` | bearer | partial site fields | updated site |
| DELETE | `/sites/:id` | bearer | — | deletes site (cascades to cameras) |
| POST | `/cameras` | bearer | `{name, siteId, sourceType?: 'demo'\|'rtsp', demoSource?, rtspUrl?}` | created camera (auto-provisioned) |
| GET | `/cameras` | bearer | — | camera array sorted by name, each with `site.customer` and `hlsUrl` |
| GET | `/cameras/:id` | bearer | — | camera |
| PATCH | `/cameras/:id` | bearer | partial camera fields | updated camera |
| DELETE | `/cameras/:id` | bearer | — | deprovisions MediaMTX path, removes camera |
| POST | `/cameras/:id/start` | bearer | — | (re)provisions path + publisher |
| POST | `/cameras/:id/stop` | bearer | — | stops publisher, status → offline (path kept) |
| GET | `/cameras/demo-sources` | bearer | — | `string[]` of `.mp4` filenames in `/videos` |
| POST | `/cameras/demo-sources/upload` | bearer | multipart field `file` | adds an `.mp4` to `/videos` |
| DELETE | `/cameras/demo-sources/:filename` | bearer | — | deletes a file from `/videos`; `409` if in use by a camera |
| GET | `/hls/**` | public | — | proxied HLS playlist/segments from MediaMTX |

Camera JSON shape (flat, always with a relative, ngrok-safe `hlsUrl`):

```json
{ "id": "…", "name": "Front Gate", "siteId": "…", "sourceType": "demo",
  "demoSource": "front-gate.mp4", "rtspUrl": null,
  "path": "hq-berlin/front-gate-a1b2c3", "status": "online", "createdAt": "…",
  "site": { "id": "…", "name": "HQ Berlin", "customer": { "id": "…", "name": "Acme GmbH" } },
  "hlsUrl": "/api/hls/hq-berlin/front-gate-a1b2c3/index.m3u8" }
```

## Entity model

```
Customer 1 ────< Site 1 ────< Camera
  name            name           name
  email?          address?       sourceType: demo | rtsp
  passwordHash?   owner?         demoSource?  (must exist in /videos when demo)
  contactEmail?   customerId FK  rtspUrl?     (required when rtsp)
  contactPhone?   (CASCADE)      path         (unique MediaMTX path, auto-generated:
  notes?                                       <slug(site)>/<slug(camera)>-<shortid>)
  lastLoginAt?                   status: online | offline | pending
```

- `Customer.email` + `passwordHash` are the **customer portal login** — set at
  self-registration, or by the admin (*Set password*). Null = record-only
  customer with no login yet.
- `User { email, passwordHash, role: admin|viewer }` — **staff** accounts for
  the admin console. Completely separate from customers.
- `SupportIssue { customerId FK, category, subject, message,
  status: open|resolved, adminNote?, resolvedAt? }` — customer support tickets.
- `PasswordResetRequest { customerId FK, email, status: pending|resolved,
  resolvedAt? }` — forgot-password requests resolved by the admin.
- `ActivityLog { actorRole, actorId, actorEmail, action, detail }` — audit
  trail of logins, registrations, site/camera/support actions.

TypeORM runs with `synchronize: true` (prototype only) — tables are created
automatically on first boot.

## Testing RTSP cameras without owning one (mock camera)

The stack ships with an optional **fake IP camera**: a second MediaMTX
container (with FFmpeg baked in) that acts exactly like a real network camera —
an RTSP **server** that the main MediaMTX **pulls** from. No code or config
changes are involved; it exercises the identical code path a real camera will.

```bash
docker compose --profile mock up --build
```

Then in the UI: **＋ Add Camera** → source type **RTSP URL** → enter one of:

| Mock camera URL | Serves |
|---|---|
| `rtsp://camera-mock:8554/gate` | front-gate.mp4 |
| `rtsp://camera-mock:8554/lobby` | living-room.mp4 |
| `rtsp://camera-mock:8554/yard` | backyard.mp4 |

The camera flips to **● online** within seconds and plays over HLS like any
other camera. Stop the mock container (`docker stop cameras-mock`) to simulate
an unplugged camera — the dashboard shows **○ offline** within ~10 s. You can
also open the mock streams directly in VLC at `rtsp://localhost:8555/gate`.

Mock camera paths are defined in `mediamtx/mock-camera.yml` — add more entries
there if you want more fake cameras (this file belongs to the *mock camera*,
not to the platform; the platform's own `mediamtx.yml` still stays untouched).

## Using your phone as a test camera

Any phone app that **serves or pushes RTSP** works with zero changes — the
phone on the same Wi-Fi as your laptop:

- **Android — IP Webcam** (free): start the server, then use
  `rtsp://<phone-ip>:8080/h264_pcm.sdp` as the camera's RTSP URL.
- **Android/iOS — Larix Broadcaster**: can serve/pull or push RTSP; use its
  RTSP URL.
- Find the phone IP in the app or your router; make sure the laptop firewall
  allows the connection.

Add it with source type **RTSP URL** — same flow as the mock and as a real
IP camera later. (HLS playback needs H.264/H.265 video, which both apps and
virtually all IP cameras produce.)

## Using real RTSP cameras later

No infrastructure changes needed:

1. **＋ Add Camera** → set source type to **rtsp** and enter the camera URL,
   e.g. `rtsp://192.168.1.50:554/stream1` (or `POST /api/cameras` with
   `sourceType: "rtsp"` + `rtspUrl`).
2. The backend registers the path in MediaMTX with `{ "source": "<rtspUrl>" }`
   — MediaMTX **pulls** the stream directly (no FFmpeg publisher).
3. HLS playback, start/stop, and status polling work exactly the same.

The host running the stack must be able to reach the camera's RTSP endpoint.

## Troubleshooting

- **Backend restarts / DB connection errors on cold start** — expected; the
  backend retries PostgreSQL for ~60 s (`retryAttempts: 20, retryDelay: 3000`)
  while the `postgres` container finishes its healthcheck. Watch
  `docker compose logs -f backend`.
- **Camera stuck in `pending`** — check `docker compose logs mediamtx` and
  `docker compose logs backend`; the usual cause is a demo source that doesn't
  exist in `videos/` (only files listed by `GET /api/cameras/demo-sources` are
  valid) or FFmpeg failing to publish.
- **No video in the player but status is online** — verify
  `curl http://localhost:3000/api/hls/<camera-path>/index.m3u8` returns a
  playlist; check the browser console for hls.js errors.
- **Port already in use** — change the left side of the port mapping in
  `docker-compose.yml` (e.g. `"3001:3000"`), or free the host port.
- **Reset everything (wipe DB + containers):**

  ```bash
  docker compose down -v
  docker compose up --build
  ```

## Project structure

```
cam-monitor/
├── docker-compose.yml            # postgres + mediamtx + backend
├── .env.example                  # copy to .env (gitignored)
├── .gitignore
├── README.md
├── postman/
│   └── cam-monitor.postman_collection.json
├── backend/                      # NestJS 10 + TypeORM + class-validator
│   ├── Dockerfile                # multi-stage: npm ci → nest build → runtime + ffmpeg
│   ├── package.json  package-lock.json  tsconfig.json
│   └── src/
│       ├── main.ts  app.module.ts  app.controller.ts  app.service.ts
│       ├── config/env.ts
│       ├── database/database.module.ts
│       ├── auth/                 # controller, service, module, jwt guard,
│       │                         #   roles guard + decorator, dtos, user entity
│       ├── customers/            # controller, service, module, dto, entity
│       ├── sites/                # controller, service, module, dto, entity
│       ├── cameras/              # controller, service, module, dto, entity
│       ├── portal/               # /api/portal/** — customer self-service
│       ├── admin/                # /api/admin/** — staff oversight & support
│       ├── support/              # support-issue + password-reset entities/service
│       ├── activity/             # activity-log entity + global audit service
│       └── streaming/            # mediamtx.service, ffmpeg-runner.service,
│                                 #   video-sources.service, camera-lifecycle.service,
│                                 #   hls-proxy.controller
├── frontend/                     # vanilla HTML/CSS/JS, served by Nest
│   ├── index.html                # landing page — links to both portals
│   ├── styles.css                # shared styles
│   ├── admin/                    # /admin/ — staff console (index.html + app.js)
│   ├── portal/                   # /portal/ — customer portal (index.html + portal.js)
│   └── vendor/hls.min.js         # vendored — no CDN
├── mediamtx/
│   └── mediamtx.yml              # generic only — zero camera-specific paths
└── videos/                       # front-gate.mp4 living-room.mp4 backyard.mp4
```

## Postman collection

Import `postman/cam-monitor.postman_collection.json`. Set `{{baseUrl}}`
(default `http://localhost:3000`), run **Auth → Login** once — a test script
stores the returned token in `{{token}}`, which all other requests use as
bearer auth automatically.
