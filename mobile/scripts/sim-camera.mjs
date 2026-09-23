#!/usr/bin/env node
// Development only: the iOS Simulator has no camera, so this serves the Mac
// webcam over HTTP and the app (in __DEV__ on the simulator) shows it instead.
// The webcam is opened only while a camera screen is polling and released
// after a few idle seconds, so the camera light is not left on.
//
//   npm run sim-camera            # FaceTime/USB webcam (macOS asks for camera access once)
//   npm run sim-camera -- --test  # synthetic test pattern, no camera needed
//
// GET /health         → 200 (also wakes the camera)
// GET /snapshot.jpg   → latest frame, 720x1280 portrait JPEG (503 while warming up)
import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.SIM_CAMERA_PORT || 8090);
const DEVICE = process.env.SIM_CAMERA_DEVICE || '0';
const IDLE_MS = 8000;
const test = process.argv.includes('--test');

const input = test
  ? ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=15']
  : ['-f', 'avfoundation', '-framerate', '30', '-video_size', '1280x720', '-pixel_format', 'uyvy422', '-i', DEVICE];

let ffmpeg = null;
let latest = null;
let idleTimer = null;

function wake() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(sleep, IDLE_MS);
  if (ffmpeg) return;
  let buffer = Buffer.alloc(0);
  ffmpeg = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'fatal', ...input, '-vf', 'fps=12,crop=ih*9/16:ih,scale=720:1280', '-c:v', 'mjpeg', '-q:v', '5', '-f', 'image2pipe', 'pipe:1'],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  console.log('camera on');
  ffmpeg.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // JPEG frames start with FFD8 and end with FFD9.
    for (;;) {
      const start = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      const end = buffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
      if (start < 0 || end < 0) break;
      latest = buffer.subarray(start, end + 2);
      buffer = buffer.subarray(end + 2);
    }
  });
  ffmpeg.on('exit', (code) => {
    if (code) console.error(`ffmpeg exited (${code}). Allow camera access for your terminal in System Settings → Privacy & Security → Camera.`);
    ffmpeg = null;
    latest = null;
  });
}

function sleep() {
  if (!ffmpeg) return;
  // A plain kill is fine: frames are independent JPEGs, there is no file to finalise.
  ffmpeg.kill('SIGKILL');
  console.log('camera off (idle)');
}

http
  .createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path === '/health') {
      wake();
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else if (path === '/snapshot.jpg') {
      wake();
      if (!latest) return res.writeHead(503, { 'Retry-After': '1' }).end();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': latest.length, 'Cache-Control': 'no-store' }).end(latest);
    } else {
      res.writeHead(404).end();
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`sim camera on http://127.0.0.1:${PORT} (${test ? 'test pattern' : `avfoundation device ${DEVICE}`}), idle until the app asks for frames`));

process.on('SIGINT', () => {
  sleep();
  process.exit(0);
});
