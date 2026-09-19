// Lifecycle, frame loop, keybinds, wiring, and debug readout.
//
// Everything in this file that only touches the DOM/CSS/local state runs at
// module import time (style injection, root creation, and event listeners
// on `root`/`el` all happened already, in the modules imported below).
// Statements that call into `Spicetify.*` directly — Topbar button
// registration, Player.addEventListener, and the keyboard shortcut — are
// deferred into register(), which self-retries with setTimeout until the
// client is actually ready. Everywhere else, Player/Platform/Topbar are
// referenced lazily as `Spicetify.Player` etc rather than destructured at
// module top level, since ES module top-level code runs once at import
// time and the client may not be up yet.

import { VERSION } from "./config.js";
import { S } from "./state.js";
import { root, el, flash } from "./dom.js";
import { icons } from "./icons.js";
import { clamp, fmt, reduced } from "./utils.js";
import { loadTrack, setupMarquee, paintUpNext } from "./track.js";
import { getVisualSource } from "./visuals.js";
import { connectBridge, disconnectBridge, bridgeLive, socketStateLabel } from "./bridge.js";
import { sample } from "./motion.js";
import { resize, draw, drawSpectrum } from "./render.js";
import { getVizSettings, setAutoFullscreen } from "./settings.js";
import {
  readVolume, writeVolume, paintVolume, maybeRepaintVolume,
  syncToggles, syncPlayIcon, startSeekHold, stopSeekHold, onKeyUp,
} from "./controls.js";
import {
  applyLyricScale, syncLyrics, sweepWords, stepScroll, loadLyrics,
  getLyricOffset, nudgeOffset, resetOffset, cycleProvider, debugInfo,
} from "./lyrics/view.js";

/* ================================================================== *
 * Open / close
 * ================================================================== */

let open = false, raf = null;
// During an interactive OS window-resize drag, the `window` "resize" DOM
// event is commonly coalesced by the host and only dispatched once the
// drag ends (a CEF/Electron quirk), which is why the layout used to sit
// frozen until mouseup. ResizeObserver is driven off layout/paint instead
// of the input-event queue, so it keeps firing throughout the drag.
let resizeObserver = null;
// While a resize is actively landing, skip the ring/spectrum animation
// (the expensive per-frame canvas work) so whatever few frames the host
// does give us during the drag go toward layout, not toward drawing a
// visualizer nobody's watching mid-drag. Cleared a short beat after the
// last observed size change; see frame() and pollViewportSize() below.
let isResizing = false, resizeSettleTimer = null;
function markResizing() {
  isResizing = true;
  clearTimeout(resizeSettleTimer);
  resizeSettleTimer = setTimeout(() => { isResizing = false; }, 220);
}
function onViewportResize() {
  markResizing();
  resize();
  setupMarquee();
}
let idleTimer = null;
function poke() {
  root.classList.remove("fsp-idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => root.classList.add("fsp-idle"), 2200);
}

// "Motion" setting overrides the OS-level prefers-reduced-motion signal
// that `reduced` (from utils.js) reads once at load — "auto" defers to it,
// "on"/"off" force one way regardless of the system setting.
function motionReduced() {
  const m = getVizSettings().motionOverride;
  if (m === "on") return true;
  if (m === "off") return false;
  return reduced;
}

// Ask Chromium for real fullscreen — this is what removes Spotify's title
// bar and window buttons. Needs a user gesture, which the click/shortcut is.
async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
  } catch (err) {
    console.info("[fsp] fullscreen refused:", err?.message || err);
  }
}

async function exitFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {}
}

function show() {
  if (open) return;
  open = true;
  root.classList.add("fsp-open");
  if (getVizSettings().autoFullscreen) enterFullscreen();
  resize();
  requestAnimationFrame(() => requestAnimationFrame(resize));
  loadTrack();
  syncPlayIcon();
  syncToggles();
  paintVolume(readVolume());
  applyLyricScale(0);
  const debugBox = root.querySelector(".fsp-debug");
  debugBox.hidden = !getVizSettings().showDebug;
  if (!debugBox.hidden) paintDebug();
  connectBridge();
  requestAnimationFrame(() => root.classList.add("fsp-shown"));
  last = performance.now();
  raf = requestAnimationFrame(frame);
  poke();
  document.addEventListener("fullscreenchange", resize);
  resizeObserver = new ResizeObserver(onViewportResize);
  resizeObserver.observe(document.documentElement);
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
}

function hide() {
  if (!open) return;
  open = false;
  root.classList.remove("fsp-shown", "fsp-idle");
  setTimeout(() => root.classList.remove("fsp-open"), 300);
  exitFullscreen();
  cancelAnimationFrame(raf);
  clearTimeout(idleTimer);
  disconnectBridge();
  document.removeEventListener("fullscreenchange", resize);
  resizeObserver?.disconnect();
  resizeObserver = null;
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("keyup", onKeyUp);
  stopSeekHold();
}

function onKey(e) {
  if (e.key === "Escape") return hide();
  if (e.key === "f" || e.key === "F") {
    const wantFullscreen = !document.fullscreenElement;
    setAutoFullscreen(wantFullscreen);
    wantFullscreen ? enterFullscreen() : exitFullscreen();
    return;
  }
  if (e.key === " " && e.target === document.body) { e.preventDefault(); Spicetify.Player.togglePlay(); }
  // Shift skips tracks; plain arrows scrub, accelerating while held.
  if (e.key === "ArrowRight" && e.shiftKey) { Spicetify.Player.next(); return; }
  if (e.key === "ArrowLeft" && e.shiftKey) { Spicetify.Player.back(); return; }
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    startSeekHold(e.key === "ArrowRight" ? 1 : -1);
    return;
  }
  // [ and ] nudge lyric sync, \ resets.
  if (e.key === "[" || e.key === "]" || e.key === "\\") {
    const uri = Spicetify.Player.data?.item?.uri || "";
    const offset = e.key === "\\" ? resetOffset(uri) : nudgeOffset(e.key === "]" ? 0.25 : -0.25, uri);
    flash(`lyrics ${offset >= 0 ? "+" : ""}${offset.toFixed(2)}s (this track)`);
    return;
  }
  // + and - resize the lyrics.
  if (e.key === "+" || e.key === "=") { applyLyricScale(0.1); return; }
  if (e.key === "-" || e.key === "_") { applyLyricScale(-0.1); return; }

  // L cycles the lyrics provider for this track.
  if (e.key === "l" || e.key === "L") {
    const name = cycleProvider();
    flash(`lyrics source: ${name}`);
    if (Spicetify.Player.data?.item) loadLyrics(Spicetify.Player.data.item);
    return;
  }
  if (e.key === "d" || e.key === "D") {
    const box = root.querySelector(".fsp-debug");
    box.hidden = !box.hidden;
    if (!box.hidden) paintDebug();
    return;
  }
  if (e.key === "ArrowUp") { e.preventDefault(); writeVolume(readVolume() + 0.05); }
  if (e.key === "ArrowDown") { e.preventDefault(); writeVolume(readVolume() - 0.05); }
}

/* ================================================================== *
 * Debug readout
 * ================================================================== */

function paintDebug() {
  const box = root.querySelector(".fsp-debug");
  if (!box || box.hidden) return;
  const info = window.fsp();
  box.textContent = Object.entries(info)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
    .join("\n");
}

/* ================================================================== *
 * Frame loop
 * ================================================================== */

let last = 0, lastDebug = 0, scrubbing = false, nextSoon = false;

// Player.getProgress() only refreshes every few hundred ms, so reading it
// each frame gives a stepped value that visibly lags. Track when it last
// changed and run the clock forward ourselves between updates.
let repPos = 0, repAt = 0;

// After we call Player.seek(), getProgress() keeps reporting the OLD
// position for a beat (it's not synchronous). If we let smoothProgress()
// trust it during that window, `p !== repPos` fires on the very next
// frame and immediately snaps repPos back to the stale value — which is
// exactly the glitch we're trying to kill. So while a seek is pending we
// extrapolate from the seek target ourselves and ignore getProgress()
// until it actually reports something close to where we sent it (or a
// grace period runs out, in case the update never comes for some reason).
let seekOverride = null; // { target, at }
const SEEK_CATCHUP_MS = 900;   // treat getProgress() as "caught up" within this
const SEEK_GRACE_MS = 1500;    // give up waiting after this long regardless

function smoothProgress() {
  const p = Spicetify.Player.getProgress();
  const now = performance.now();

  if (seekOverride) {
    const caughtUp = Math.abs(p - seekOverride.target) < SEEK_CATCHUP_MS;
    const timedOut = now - seekOverride.at > SEEK_GRACE_MS;
    if (caughtUp || timedOut) {
      // getProgress() finally agrees (or we've waited long enough) — hand
      // control back to the normal path using whichever value is freshest.
      repPos = caughtUp ? p : seekOverride.target;
      repAt = now;
      seekOverride = null;
    } else {
      const drift = now - seekOverride.at;
      return seekOverride.target + (Spicetify.Player.isPlaying() ? drift : 0);
    }
  }

  if (p !== repPos) { repPos = p; repAt = now; }
  if (!Spicetify.Player.isPlaying()) return repPos;
  const drift = now - repAt;
  // Don't extrapolate forever if updates stop coming.
  return repPos + Math.min(drift, 1200);
}

// Belt-and-braces alongside the ResizeObserver in show(): this only
// depends on a frame actually rendering, not on any particular resize
// event/observer callback being delivered promptly by the host, so it's
// the most robust source of "did the viewport change" available from a
// page script. Cheap to check every frame — it's two number compares.
let lastVW = 0, lastVH = 0;
function pollViewportSize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (vw !== lastVW || vh !== lastVH) {
    lastVW = vw; lastVH = vh;
    markResizing();
    resize();
    setupMarquee();
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000) || 0.016;
  last = now;

  pollViewportSize();
  const pos = smoothProgress();
  const dur = Spicetify.Player.getDuration() || 1;
  if (!scrubbing) {
    const pct = clamp(pos / dur, 0, 1);
    el.fill.style.width = `${pct * 100}%`;
    el.knob.style.left = `${pct * 100}%`;
    el.elapsed.textContent = fmt(pos);
    el.remain.textContent = `-${fmt(dur - pos)}`;
  }
  // "always" shows it for the whole track (paintUpNext() still hides the
  // card outright when there's no next track to name); "auto" only inside
  // the configured lead time of the track ending; "off" never.
  const nextMode = getVizSettings().nextVisibility;
  const leadMs = getVizSettings().nextLeadSeconds * 1000;
  const soon =
    nextMode === "always"
      ? true
      : nextMode === "auto" && dur > leadMs + 5000 && dur - pos <= leadMs && dur - pos > 0;
  if (soon !== nextSoon) {
    nextSoon = soon;
    if (soon) paintUpNext();          // refresh in case the queue changed
    el.nextCard.classList.toggle("fsp-soon", soon);
  }

  maybeRepaintVolume();

  if (now - lastDebug > 400) { lastDebug = now; paintDebug(); }

  const lyricPos = pos / 1000 + getLyricOffset();
  syncLyrics(lyricPos);
  sweepWords(lyricPos);
  stepScroll(dt);

  // Skip the canvas work while a resize is actively landing (see
  // markResizing) — it's the most expensive thing done per frame, and the
  // host is already stingy with frames during an interactive drag.
  if (!isResizing) {
    sample(pos / 1000, dt);
    if (!motionReduced()) S.rotation += dt * getVizSettings().ringSpeed;
    draw();
    drawSpectrum();
  }
  raf = requestAnimationFrame(frame);
}

/* ================================================================== *
 * Wiring
 * ================================================================== */

root.querySelector(".fsp-close").addEventListener("click", hide);
root.querySelector(".fsp-prev").addEventListener("click", () => Spicetify.Player.back());
root.querySelector(".fsp-next-btn").addEventListener("click", () => Spicetify.Player.next());
el.play.addEventListener("click", () => Spicetify.Player.togglePlay());
root.addEventListener("mousemove", poke);
root.querySelector(".fsp-transport").addEventListener("mouseenter", () => {
  clearTimeout(idleTimer);
  root.classList.remove("fsp-idle");
});
root.querySelector(".fsp-transport").addEventListener("mouseleave", poke);

function seekFromEvent(e) {
  const r = el.track.getBoundingClientRect();
  const pct = clamp((e.clientX - r.left) / r.width, 0, 1);
  el.fill.style.width = `${pct * 100}%`;
  el.knob.style.left = `${pct * 100}%`;
  return pct;
}
el.track.addEventListener("mousedown", (e) => {
  scrubbing = true;
  seekFromEvent(e);
  const move = (ev) => seekFromEvent(ev);
  const up = (ev) => {
    seekTo(seekFromEvent(ev) * (Spicetify.Player.getDuration() || 0));
    scrubbing = false;
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

// See smoothProgress()'s seekOverride handling: this is what actually
// suppresses the post-seek glitch, by telling the frame loop to hold at
// `target` (extrapolating forward if playing) until getProgress() agrees.
function seekTo(target) {
  Spicetify.Player.seek(target);
  seekOverride = { target, at: performance.now() };
}

console.info(`[fsp] loaded ${VERSION}`);

window.fsp = () => {
  const info = debugInfo();
  return {
    version: VERSION,
    bridge: bridgeLive() ? "live" : "not connected (ambient fallback)",
    socket: socketStateLabel(),
    energy: +S.energy.toFixed(3),
    visual: getVisualSource(),
    lyrics: `${info.source} (${info.count} lines)`,
    lyricOffset: `${info.offset.toFixed(2)}s (${info.providerName})`,
    posReported: `${(repPos / 1000).toFixed(2)}s`,
    posSmoothed: `${(smoothProgress() / 1000).toFixed(2)}s`,
    posStaleFor: `${Math.round(performance.now() - repAt)}ms`,
    lyricLine: info.lineIdx >= 0 ? `${info.lineIdx} @ ${info.lineTime?.toFixed(2)}s` : "-",
    artSize: S.artSize,
    bands: S.bands.slice(0, 12).map((b) => +b.toFixed(2)),
  };
};

/* ================================================================== *
 * Readiness guard — module top-level code above only touches DOM/CSS/local
 * state, so it can run before Spicetify is up. Anything that calls into
 * Spicetify.* directly is deferred here, self-retrying until it's ready.
 * ================================================================== */

function register() {
  if (!Spicetify.Player?.data || !Spicetify.Platform || !Spicetify.Playbar || !Spicetify.React) {
    setTimeout(register, 300);
    return;
  }

  Spicetify.Player.addEventListener("songchange", () => {
    nextSoon = false;
    el.nextCard.classList.remove("fsp-soon");
    if (open) { loadTrack(); syncToggles(); setTimeout(paintDebug, 1200); }
  });
  Spicetify.Player.addEventListener("onplaypause", syncPlayIcon);

  // Playbar.Button ("create buttons next to the player extra control
  // buttons — queue, lyrics, Now Playing View, etc.") drops this into
  // that same native row instead of the top-right corner, so it's sized,
  // spaced and themed exactly like Spotify's own controls there, and
  // folds into that row's overflow/scroll behavior along with them
  // rather than needing its own hand-rolled button styling.
  const playbarBtn = new Spicetify.Playbar.Button(
    "Fullscreen player",
    icons.expand,
    () => { open ? hide() : show(); },
    false,
    false
  );
  // Belt-and-braces: if the `icon` constructor arg needs one of
  // Spicetify's predefined icon keys rather than accepting raw SVG
  // markup directly, this guarantees our own glyph renders either way.
  // Replacing the button's contents this way apparently also strips
  // whatever internal class made it match its transparent-background,
  // native-sized neighbors (it rendered with a leftover grey box, notably
  // smaller than the icons either side) — fsp-playbar-btn below corrects
  // both rather than relying on whatever's left of Spotify's own styling.
  playbarBtn.element.classList.add("fsp-playbar-btn");
  playbarBtn.element.innerHTML = icons.expand;
  playbarBtn.register();

  try {
    Spicetify.Keyboard.registerShortcut({ key: "f", ctrl: true, shift: true }, () =>
      open ? hide() : show()
    );
  } catch {
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") open ? hide() : show();
    });
  }
}

register();
