// Volume, heart/shuffle/repeat, hold-to-seek, and the lyric-size slider.
//
// Player/Platform are referenced lazily via `Spicetify.*` rather than a
// module-top-level destructure, since this module is evaluated before the
// client may be up. Attaching these DOM event listeners at module import
// time is safe regardless — only the handler bodies touch Spicetify, and
// those only run once the user interacts, by which point it is ready.

import { el } from "./dom.js";
import { icons } from "./icons.js";
import { clamp, fmt } from "./utils.js";
import { setLyricScale, getLyricScale, SCALE_MIN, SCALE_MAX } from "./lyrics/view.js";

/* ================================================================== *
 * Volume (Spotify's own level)
 * ================================================================== */

let lastVolume = 0.7, shownVolume = -1, volDragging = false;

export const isVolDragging = () => volDragging;

export const readVolume = () => {
  const v = Spicetify.Player.getVolume?.() ?? Spicetify.Platform?.PlaybackAPI?.getVolume?.() ?? 0.7;
  return clamp(typeof v === "number" ? v : 0.7, 0, 1);
};

export function writeVolume(v) {
  v = clamp(v, 0, 1);
  if (Spicetify.Player.setVolume) Spicetify.Player.setVolume(v);
  else Spicetify.Platform?.PlaybackAPI?.setVolume?.(v);
  paintVolume(v);
}

export function paintVolume(v) {
  const pct = clamp(v, 0, 1) * 100;
  shownVolume = v;
  el.volFill.style.height = `${pct}%`;
  el.volKnob.style.bottom = `${pct}%`;
  el.volPct.textContent = `${Math.round(pct)}%`;
  el.mute.innerHTML = v <= 0.001 ? icons.mute : icons.vol;
}

// Called once per frame from the main loop: repaint only if Spotify's own
// level drifted from what we last drew (and the user isn't dragging).
export function maybeRepaintVolume() {
  if (volDragging) return;
  const v = readVolume();
  if (Math.abs(v - shownVolume) > 0.005) paintVolume(v);
}

const volFromEvent = (e) => {
  const r = el.volTrack.getBoundingClientRect();
  return clamp((r.bottom - e.clientY) / r.height, 0, 1);
};

el.volTrack.addEventListener("mousedown", (e) => {
  volDragging = true;
  writeVolume(volFromEvent(e));
  const move = (ev) => writeVolume(volFromEvent(ev));
  const up = () => {
    volDragging = false;
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

el.volWrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  writeVolume(readVolume() + (e.deltaY < 0 ? 0.05 : -0.05));
}, { passive: false });

el.mute.addEventListener("click", () => {
  const cur = readVolume();
  if (cur > 0.001) { lastVolume = cur; writeVolume(0); }
  else writeVolume(lastVolume || 0.7);
});

/* ------------------------------------------------------------------ *
 * Heart / shuffle / repeat
 * ------------------------------------------------------------------ */

export function syncToggles() {
  // Saved to library
  try {
    const hearted = Spicetify.Player.getHeart?.() ?? false;
    el.heart.innerHTML = hearted ? icons.heartFull : icons.heart;
    el.heart.classList.toggle("fsp-on", !!hearted);
    el.heart.setAttribute("aria-label", hearted ? "Remove from your library" : "Save to your library");
  } catch {}

  // Shuffle
  try {
    const sh = Spicetify.Player.getShuffle?.() ?? false;
    el.shuffle.classList.toggle("fsp-on", !!sh);
    el.shuffle.setAttribute("aria-pressed", String(!!sh));
  } catch {}

  // Repeat: 0 off, 1 whole context, 2 this track
  try {
    const rp = Spicetify.Player.getRepeat?.() ?? 0;
    el.repeat.innerHTML = rp === 2 ? icons.repeatOne : icons.repeat;
    el.repeat.classList.toggle("fsp-on", rp !== 0);
    el.repeat.setAttribute(
      "aria-label",
      rp === 0 ? "Enable repeat" : rp === 1 ? "Repeat this track" : "Disable repeat"
    );
  } catch {}
}

el.heart.addEventListener("click", () => {
  try { Spicetify.Player.toggleHeart(); } catch {}
  setTimeout(syncToggles, 120);   // let the client update its state first
});

el.shuffle.addEventListener("click", () => {
  try { Spicetify.Player.toggleShuffle(); } catch {}
  setTimeout(syncToggles, 120);
});

el.repeat.addEventListener("click", () => {
  // Cycle off -> context -> track -> off
  try {
    const rp = Spicetify.Player.getRepeat?.() ?? 0;
    if (Spicetify.Player.setRepeat) Spicetify.Player.setRepeat((rp + 1) % 3);
    else Spicetify.Player.toggleRepeat();
  } catch {}
  setTimeout(syncToggles, 120);
});

export function syncPlayIcon() {
  const playing = Spicetify.Player.isPlaying();
  el.play.innerHTML = playing ? icons.pause : icons.play;
  el.play.setAttribute("aria-label", playing ? "Pause" : "Play");
}

/* ------------------------------------------------------------------ *
 * Hold-to-scrub: a small first step, accelerating the longer you hold
 * ------------------------------------------------------------------ */

let seekTimer = null, seekDir = 0, seekHeld = 0, seekTarget = 0;

export function startSeekHold(dir) {
  if (seekTimer && seekDir === dir) return;    // key repeat — already running
  stopSeekHold();
  seekDir = dir;
  seekHeld = 0;
  seekTarget = Spicetify.Player.getProgress();

  const step = () => {
    const dur = Spicetify.Player.getDuration() || 0;
    // 2s to start, ramping to 15s after ~2.5s of holding.
    const size = (2 + Math.min(13, seekHeld * 5.5)) * 1000;
    seekHeld += 0.13;
    seekTarget = clamp(seekTarget + seekDir * size, 0, Math.max(0, dur - 500));
    Spicetify.Player.seek(seekTarget);
    // Reflect it immediately rather than waiting for the next state push.
    if (dur) {
      const pct = clamp(seekTarget / dur, 0, 1);
      el.fill.style.width = `${pct * 100}%`;
      el.knob.style.left = `${pct * 100}%`;
      el.elapsed.textContent = fmt(seekTarget);
      el.remain.textContent = `-${fmt(dur - seekTarget)}`;
    }
  };

  step();
  seekTimer = setInterval(step, 130);
}

export function stopSeekHold() {
  clearInterval(seekTimer);
  seekTimer = null;
  seekDir = 0;
}

export function onKeyUp(e) {
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") stopSeekHold();
}

/* ------------------------------------------------------------------ *
 * Lyric-size slider — mirrors the volume slider, right of the artwork
 * ------------------------------------------------------------------ */

const scaleFromEvent = (e) => {
  const r = el.lszTrack.getBoundingClientRect();
  const t = clamp((r.bottom - e.clientY) / r.height, 0, 1);
  return SCALE_MIN + t * (SCALE_MAX - SCALE_MIN);
};

el.lszTrack.addEventListener("mousedown", (e) => {
  setLyricScale(scaleFromEvent(e));
  const move = (ev) => setLyricScale(scaleFromEvent(ev));
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

el.lszWrap.addEventListener("wheel", (e) => {
  e.preventDefault();
  setLyricScale(getLyricScale() + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });
