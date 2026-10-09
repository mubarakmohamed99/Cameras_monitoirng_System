# CamMonitor Prototype — Rescue & Rebuild Plan

## Diagnosis of current state (cam-monitor-step1.zip)
- **DB/Docker**: compose has postgres+healthcheck, but fragile wiring (DB name default mismatch `camdb` vs `camerasdb`, no mediamtx readiness wait, no startup reconciliation, no `.env` handling). Backend crashes loop => "no DB" symptom for user.
- **Frontend**: terrible design — inline `<style>` with clashing colors (orange panels, green text, blue gradient) + a separate conflicting styles.css; hardcoded `HLS_BASE: http://localhost:8890` => HLS dead via ngrok.
- **Flow bugs**: status is static DB column (never re-polled), backend restart orphans cameras, no path re-add retry, junk duplicate video files, missing living-room.mp4/backyard.mp4, no Postman collection, weak README.
- **Architecture to keep**: NestJS + TypeORM + PostgreSQL + MediaMTX API-driven paths + FFmpeg demo publishers. Backend structure is salvageable; frontend will be fully redesigned.

## Stage 0 — Environment prep (Orchestrator)
- Skill: `vibecoding-general-swarm` (read SKILL.md, follow its orchestration rules).
- Verify local testability without Docker: install postgresql via apt (or portable), download mediamtx binary, node 20 + ffmpeg available.
- Clean workspace: /mnt/agents/output/cam-monitor/ as canonical project root (git init).

## Stage 1 — Backend fixes (coder subagent: "backend-fixer")
Mission:
1. Robust DB config: single source of truth, `.env` support, retry-on-boot connection loop.
2. **HLS proxy endpoint** `GET /api/hls/:path/*` (public) streaming from MediaMTX internal HLS — makes ONE ngrok tunnel serve UI+API+HLS. Kills the localhost:8890 problem.
3. Camera lifecycle hardening: addPath with retry; `onModuleInit` reconciliation (re-register paths, restart demo publishers for cameras marked online); periodic status poller (every 10s) syncing DB status from MediaMTX path `ready` state.
4. Deterministic camera path slug (site-slug/camera-name style, collision-safe).
5. Public `/api/health` endpoint; seed admin + viewer users.
6. Keep demo|rtsp sourceType abstraction (RTSP swap-in path for real cameras).
Gate: `npm run build` passes; module boots against local postgres+mediamtx.

## Stage 2 — Frontend redesign (coder subagent: "frontend-redesigner")
Mission: throw away current UI. New professional dark security-console design:
- Login screen, sidebar (Customers → Sites tree), main area with camera grid + live HLS (hls.js via proxy URL), modals for Add Customer / Add Site / Add Camera (with demo-source dropdown), Start/Stop buttons, online/offline badges, auto-refresh.
- Low-saturation slate palette, Inter/system font, clean cards, no gradients.
- Everything relative to `window.location.origin` (ngrok-safe). No hardcoded hosts.
Gate: serves from Nest static, all acceptance flows clickable.

## Stage 3 — DevOps, demo assets, docs (coder subagent: "devops-docs")
Mission:
1. Fix `docker-compose.yml`: postgres (healthcheck), mediamtx (pinned version, healthcheck), backend (depends_on healthy, env via `.env`, videos volume), named volumes; add `docker-compose.dev.yml` optional.
2. Fix backend Dockerfile (npm ci, build, runtime w/ ffmpeg; serve frontend).
3. Generate 3 synthetic demo cameras with FFmpeg (front-gate/living-room/backyard, timestamped test feeds), delete junk duplicates.
4. README.md (quickstart, ngrok remote-testing steps, credentials, architecture), `.env.example`, Postman collection JSON.
Gate: compose file lints; docs match real endpoints.

## Stage 4 — E2E verification (verifier subagent + orchestrator)
Run the full stack natively (postgres local, mediamtx binary, backend dist) and execute the user's 11-step acceptance test with curl + HLS playlist checks:
login → create customer → create site → add camera (demo source) → camera online → HLS playlist returns 200 with segments → add 2nd camera → both independent → stop camera → status offline.
Gate: all 11 steps pass; screenshot-level frontend sanity check via browser tools if possible.

## Stage 5 — Packaging & delivery (Orchestrator)
- Zip final project to /mnt/agents/output/cam-monitor-prototype.zip + REF tag.
- Final response: what was fixed, how to run, ngrok instructions.
