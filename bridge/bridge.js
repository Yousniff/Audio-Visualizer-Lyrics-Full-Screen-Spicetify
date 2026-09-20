/*
 * Spotify audio bridge
 * --------------------
 * Watches for Spotify, captures ONLY Spotify's audio (WASAPI per-process
 * loopback, so game/Discord/browser sound is excluded), runs an FFT, and
 * streams band levels to the Spicetify extension over ws://127.0.0.1:8787.
 *
 * Idle cost while Spotify is closed: one process listing every 2 seconds.
 *
 * Flags:
 *   --exit-with-spotify   quit once Spotify closes (for the wrapper launcher)
 *   --debug               print levels so you can see it working
 *   --port=8787           change the port
 */

const { execFile } = require("child_process");
const http = require("http");
const { WebSocketServer } = require("ws");
const loopback = require("loopback-capture");

const args = process.argv.slice(2);
const EXIT_WITH_SPOTIFY = args.includes("--exit-with-spotify");
const DEBUG = args.includes("--debug");
const PORT = Number((args.find((a) => a.startsWith("--port=")) || "").split("=")[1]) || 8787;

const FFT_SIZE = 2048;      // 23Hz bins — needed to resolve 28 log bands
const HOP = 256;            // ~187 frames/sec — hop keeps latency low
const BANDS = 28;           // enough resolution for a full-width spectrum
const SAMPLE_RATE = 48000;  // WASAPI mix format is 48k float32 stereo

/* ------------------------------------------------------------------ *
 * FFT (iterative radix-2, real input)
 * ------------------------------------------------------------------ */

const rev = new Uint16Array(FFT_SIZE);
for (let i = 0, j = 0; i < FFT_SIZE; i++) {
  rev[i] = j;
  let bit = FFT_SIZE >> 1;
  for (; j & bit; bit >>= 1) j ^= bit;
  j |= bit;
}
const cosT = new Float32Array(FFT_SIZE / 2);
const sinT = new Float32Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosT[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  sinT[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}
const hann = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

const re = new Float32Array(FFT_SIZE);
const im = new Float32Array(FFT_SIZE);

function fft(input) {
  for (let i = 0; i < FFT_SIZE; i++) {
    re[rev[i]] = input[i] * hann[i];
    im[rev[i]] = 0;
  }
  for (let len = 2; len <= FFT_SIZE; len <<= 1) {
    const step = FFT_SIZE / len;
    for (let i = 0; i < FFT_SIZE; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const t = k * step;
        const wr = cosT[t], wi = sinT[t];
        const a = i + k, b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr;        im[a] += xi;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Band layout: log-spaced 30Hz .. 16kHz
 * ------------------------------------------------------------------ */

const edges = [];
for (let i = 0; i <= BANDS; i++) {
  const f = 40 * Math.pow(16000 / 40, i / BANDS);
  edges.push(Math.min(FFT_SIZE / 2 - 1, Math.max(1, Math.round((f / SAMPLE_RATE) * FFT_SIZE))));
}

const GATE_DB = -55;        // silence threshold
const TAU_SPEC = 0.06;      // spectrum smoothing time constant, seconds
const smoothed = new Float32Array(BANDS);
const bandGain = new Float32Array(BANDS).fill(-30);  // per-band ceiling (dB)
const bandFloor = new Float32Array(BANDS).fill(-70); // per-band floor (dB)
const prevMag = new Float32Array(BANDS);
const fluxHist = [];
let lastBeat = 0;

function analyse(frame) {
  fft(frame);

  const out = new Array(BANDS);
  let flux = 0;
  let total = 0;

  for (let b = 0; b < BANDS; b++) {
    let sum = 0;
    const lo = edges[b], hi = Math.max(edges[b] + 1, edges[b + 1]);
    for (let k = lo; k < hi; k++) sum += Math.hypot(re[k], im[k]);
    let mag = sum / (hi - lo);

    // Tilt up the highs; they carry far less energy than bass.
    mag *= 1 + (b / BANDS) * 2.5;

    // Work in dB — linear magnitude buries everything below the loudest
    // moment, which is what made the rings look static.
    const db = 20 * Math.log10(mag + 1e-9);

    // Track a per-band floor and ceiling, both decaying back toward the
    // current level so the usable range follows the track rather than the
    // loudest thing heard 30 seconds ago.
    bandGain[b] = Math.max(db, bandGain[b] - 0.08);        // ceiling falls slowly
    bandFloor[b] = Math.min(db, bandFloor[b] + 0.04);      // floor rises slowly
    const span = Math.max(12, bandGain[b] - bandFloor[b]); // at least 12dB
    let norm = (db - bandFloor[b]) / span;
    norm = Math.min(1, Math.max(0, norm));

    // Expand: push quiet parts down and loud parts up, so a drop reads as a
    // drop rather than a slightly bigger ring.
    norm = Math.pow(norm, 1.35);

    // Noise gate: below this the band is silence, not signal.
    if (db < GATE_DB) norm = 0;

    // Light exponential smoothing at the source removes FFT frame jitter
    // without adding perceptible lag (tau = 60ms).
    const a = 1 - Math.exp(-HOP / SAMPLE_RATE / TAU_SPEC);
    smoothed[b] += (norm - smoothed[b]) * a;

    flux += Math.max(0, mag - prevMag[b]);
    prevMag[b] = mag;
    total += smoothed[b];
    out[b] = +smoothed[b].toFixed(3);
  }

  // Onset detection: spectral flux against a moving median. Works on any
  // track, no database, no tempo guess.
  fluxHist.push(flux);
  if (fluxHist.length > 43) fluxHist.shift();
  const sorted = [...fluxHist].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const now = Date.now();
  let beat = 0;
  if (flux > median * 1.8 && flux > 0.01 && now - lastBeat > 110) {
    beat = Math.min(1, flux / (median * 3 || 1));
    lastBeat = now;
  }

  return { b: out, e: +(total / BANDS).toFixed(3), k: +beat.toFixed(2) };
}

/* ------------------------------------------------------------------ *
 * PCM handling
 * ------------------------------------------------------------------ */

const acc = new Float32Array(FFT_SIZE);
const ring = new Float32Array(FFT_SIZE);
let ringPos = 0;
let filled = 0;
let sinceHop = 0;

function onPcm(chunk, broadcast) {
  // loopback-capture delivers interleaved signed 16-bit LE stereo @ 48kHz.
  const frames = Math.floor(chunk.length / 4); // 2 channels * 2 bytes
  for (let f = 0; f < frames; f++) {
    const l = chunk.readInt16LE(f * 4) / 32768;
    const r = chunk.readInt16LE(f * 4 + 2) / 32768;
    const mono = (l + r) * 0.5;

    ring[ringPos] = mono;
    ringPos = (ringPos + 1) % FFT_SIZE;
    if (filled < FFT_SIZE) filled++;

    if (filled === FFT_SIZE && ++sinceHop >= HOP) {
      sinceHop = 0;
      // Unwrap the ring into a linear window for the FFT.
      for (let i = 0; i < FFT_SIZE; i++) acc[i] = ring[(ringPos + i) % FFT_SIZE];
      broadcast(analyse(acc));
    }
  }
}

/* ------------------------------------------------------------------ *
 * Finding Spotify
 * ------------------------------------------------------------------ */

function spotifyProcesses() {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='Spotify.exe'\" | " +
          "Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve([]);
        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

// The root Spotify process is the one whose parent isn't also Spotify.
// Capturing it with includeProcessTree picks up the renderer that actually
// emits audio, whichever child that happens to be.
async function spotifyRootPid() {
  const procs = await spotifyProcesses();
  if (!procs.length) return null;
  const ids = new Set(procs.map((p) => p.ProcessId));
  const root = procs.find((p) => !ids.has(p.ParentProcessId));
  return (root || procs[0]).ProcessId;
}

/* ------------------------------------------------------------------ *
 * Server + lifecycle
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Lyrics proxy
 * ------------------------------------------------------------------ *
 * The lyrics APIs don't send CORS headers, so Spotify's page can't call
 * them directly. This process has no such restriction — it fetches and
 * hands the result back with the header the browser wants.
 */

async function proxyLyrics(url, extraHeaders) {
  const r = await fetch(url, { headers: { Accept: "application/json", ...extraHeaders } });
  const body = await r.text();
  return { status: r.status, body };
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  let target = null;
  let extraHeaders = undefined;
  try {
    const u = new URL(req.url, "http://127.0.0.1");
    const q = u.searchParams;

    if (u.pathname === "/lyrics/ttml") {
      target = `https://lyrics-api.boidu.dev/getLyrics?${q}`;
    } else if (u.pathname === "/lyrics/lrclib") {
      target = `https://lrclib.net/api/get?${q}`;
    } else if (u.pathname === "/lyrics/lrclib-search") {
      target = `https://lrclib.net/api/search?${q}`;
    } else if (u.pathname === "/lyrics/netease-search") {
      // NetEase Cloud Music's own web search — no key, no login. Licenses a
      // surprising amount of Western catalog alongside its Chinese one, so
      // it's worth trying when LRCLIB/BetterLyrics come up empty or
      // unsynced. Some deployments 403 this endpoint without a same-site
      // Referer, so that's sent along even though it's worked without one
      // in testing so far.
      target = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(q.get("q") || "")}&type=1&offset=0&total=true&limit=8`;
      extraHeaders = { Referer: "https://music.163.com/" };
    } else if (u.pathname === "/lyrics/netease-lyric") {
      target = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(q.get("id") || "")}&lv=-1&kv=-1&tv=-1`;
      extraHeaders = { Referer: "https://music.163.com/" };
    } else if (u.pathname === "/health") {
      res.writeHead(200, cors);
      return res.end(JSON.stringify({ ok: true, capturing: capturedPid }));
    }
  } catch {}

  if (!target) {
    res.writeHead(404, cors);
    return res.end(JSON.stringify({ error: "unknown route" }));
  }

  try {
    const out = await proxyLyrics(target, extraHeaders);
    res.writeHead(out.status, cors);
    res.end(out.body);
  } catch (err) {
    res.writeHead(502, cors);
    res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

const wss = new WebSocketServer({ server });
server.listen(PORT, "127.0.0.1");
server.on("error", (e) => {
  console.error(
    e.code === "EADDRINUSE"
      ? `Port ${PORT} is already in use — the bridge may already be running.`
      : e
  );
  process.exit(1);
});
wss.on("error", (e) => console.error("[bridge] websocket error:", e.message));

let lastSend = 0;
function broadcast(payload) {
  const now = Date.now();
  if (now - lastSend < 8) return;    // cap at ~120Hz
  lastSend = now;
  const msg = JSON.stringify(payload);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  if (DEBUG && now % 500 < 20) {
    const bar = "#".repeat(Math.round(payload.e * 40));
    process.stdout.write(`\r${payload.k > 0 ? "*" : " "} ${bar.padEnd(40)} `);
  }
}

let capture = null;
let capturedPid = null;
let sawSpotify = false;

async function tick() {
  const pid = await spotifyRootPid();

  if (pid && pid !== capturedPid) {
    stopCapture();
    try {
      capture = new loopback.LoopbackCapture();
      capture.start(pid, true, (chunk) => onPcm(chunk, broadcast));
      capturedPid = pid;
      sawSpotify = true;
      console.log(`[bridge] capturing Spotify (pid ${pid}) -> ws://127.0.0.1:${PORT}`);
    } catch (err) {
      console.error("[bridge] capture failed:", err.message);
      capture = null;
      capturedPid = null;
    }
  } else if (!pid && capturedPid) {
    console.log("[bridge] Spotify closed");
    stopCapture();
    if (EXIT_WITH_SPOTIFY) {
      wss.close();
      server.close();
      process.exit(0);
    }
  } else if (!pid && !capturedPid && EXIT_WITH_SPOTIFY && sawSpotify) {
    process.exit(0);
  }
}

function stopCapture() {
  if (capture) {
    try { capture.stop(); } catch {}
  }
  capture = null;
  capturedPid = null;
  ringPos = 0;
  filled = 0;
  bandGain.fill(0.02);
  bandFloor.fill(-70);
  smoothed.fill(0);
}

setInterval(tick, 2000);
tick();

console.log(`[bridge] watching for Spotify. ws://127.0.0.1:${PORT}`);
console.log(`[bridge] lyrics proxy on http://127.0.0.1:${PORT}/lyrics/...`);
process.on("SIGINT", () => { stopCapture(); process.exit(0); });
