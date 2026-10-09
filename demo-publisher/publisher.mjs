/**
 * CamMonitor standalone demo "site" publisher.
 *
 * This is a COMPLETELY SEPARATE PROCESS from the backend (its own
 * container). It simulates a real customer site sitting behind NAT:
 *
 *   1. It polls the backend's internal work-list endpoint to learn
 *      which demo cameras should be streaming.
 *   2. For each one, it OPENS AN OUTBOUND RTSP CONNECTION to MediaMTX
 *      and pushes the video — exactly like a real edge device would.
 *      No port forwarding, no public address on the "site" side.
 *   3. When a camera is stopped/removed, it tears the stream down.
 *      When ffmpeg dies, it respawns it on the next poll.
 *
 * The backend container never runs FFmpeg in this mode
 * (DEMO_PUBLISHER=external).
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

const API_URL = (process.env.API_URL || 'http://backend:3000').replace(/\/+$/, '');
const PUBLISHER_KEY = process.env.PUBLISHER_KEY || 'dev-publisher-key';
const VIDEOS_DIR = process.env.VIDEOS_DIR || '/videos';
const POLL_MS = parseInt(process.env.POLL_MS || '10000', 10);

/** RTSP ingest URL with publish credentials embedded (MediaMTX requires auth to publish). */
function buildPublishBase() {
  const base = (process.env.MEDIAMTX_RTSP_URL || 'rtsp://mediamtx:8554').replace(/\/+$/, '');
  const user = process.env.MEDIAMTX_API_USER || 'admin';
  const password = process.env.MEDIAMTX_API_PASSWORD || 'admin123';
  try {
    const url = new URL(base);
    if (!url.username) {
      url.username = encodeURIComponent(user);
      url.password = encodeURIComponent(password);
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return base;
  }
}
const PUBLISH_BASE = buildPublishBase();

/** cameraId -> ChildProcess */
const processes = new Map();

function log(msg) {
  console.log(`[demo-publisher ${new Date().toISOString()}] ${msg}`);
}

function isAlive(id) {
  const proc = processes.get(id);
  return Boolean(proc && proc.exitCode === null && !proc.killed);
}

function startPushing(cam) {
  const target = `${PUBLISH_BASE}/${cam.path}`;
  const args = [
    '-hide_banner', '-loglevel', 'warning',
    '-re',                      // realtime pace — behaves like a live camera
    '-stream_loop', '-1',       // loop the demo file forever
    '-i', join(VIDEOS_DIR, cam.demoSource),
    '-c', 'copy',               // remux only, no transcoding
    '-rtsp_transport', 'tcp',
    '-f', 'rtsp',
    target,
  ];

  log(`opening outbound RTSP connection: ${cam.demoSource} -> ${target}`);
  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

  proc.stderr?.on('data', (d) => {
    const line = String(d).trim();
    if (line) log(`ffmpeg[${cam.path}]: ${line}`);
  });
  proc.on('error', (err) => {
    processes.delete(cam.id);
    log(`ffmpeg[${cam.path}] spawn error: ${err.message} (will retry next poll)`);
  });
  proc.on('exit', (code) => {
    processes.delete(cam.id);
    log(`ffmpeg[${cam.path}] exited (code ${code}) — will respawn if still wanted`);
  });

  processes.set(cam.id, proc);
}

function stopPushing(id) {
  const proc = processes.get(id);
  if (proc) {
    log(`stopping stream for camera ${id}`);
    proc.kill('SIGKILL');
    processes.delete(id);
  }
}

async function fetchWorkList() {
  const res = await fetch(`${API_URL}/api/internal/demo-cameras`, {
    headers: { 'x-publisher-key': PUBLISHER_KEY },
  });
  if (!res.ok) throw new Error(`work-list HTTP ${res.status}`);
  return res.json();
}

async function tick() {
  let list;
  try {
    list = await fetchWorkList();
  } catch (err) {
    log(`cannot reach backend work-list (${err.message}) — keeping current streams`);
    return;
  }
  if (!Array.isArray(list)) return;

  const wanted = new Set(list.map((c) => c.id));

  // Start streams for cameras that should be live but aren't.
  for (const cam of list) {
    if (!isAlive(cam.id)) startPushing(cam);
  }
  // Stop streams for cameras that were stopped or deleted in the portal.
  for (const id of [...processes.keys()]) {
    if (!wanted.has(id)) stopPushing(id);
  }
}

function shutdown() {
  log('shutting down — killing all streams');
  for (const id of [...processes.keys()]) stopPushing(id);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

log(`site publisher started. work-list: ${API_URL}/api/internal/demo-cameras, ingest: ${PUBLISH_BASE}`);
await tick();
setInterval(() => {
  tick().catch((err) => log(`poll failed: ${err.message}`));
}, POLL_MS);
