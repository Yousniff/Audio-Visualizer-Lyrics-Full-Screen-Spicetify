// Lyrics rendering, sync, marquee-style word sweep, and all lyrics-related
// state. This is the single owner of lyricOffset/lyricIdx/providerIdx/
// lyricsSource — other modules (index.js) read or mutate them only through
// the accessor functions below, so there is exactly one place these are
// written.
//
// Player is referenced lazily via `Spicetify.Player` rather than a
// module-top-level destructure, since this module is evaluated before the
// client may be up.

import { root, el, flash } from "../dom.js";
import { clamp } from "../utils.js";
import { spring } from "../motion.js";
import { icons } from "../icons.js";
import {
  PROVIDERS, fromOtherExtension, fromBetterLyrics, fromClient, fromLrclib, plausible,
} from "./sources.js";

let lyrics = [];            // [{ time: seconds, text }]
let lyricsUri = null;
let lyricIdx = -1;
let lyricsSource = "none";

// Lyric type scale, remembered between sessions. 0 IS "off" — there's no
// separate enabled/disabled flag, exactly like the volume slider (0% is
// muted, not a different concept from volume). Clamped so the panel can
// always fit at least a couple of lines without spilling off screen.
let lyricScale = (() => {
  try {
    // One-time migration: this used to be a separate on/off flag. Fold
    // it into the unified model — "was disabled" becomes scale 0.
    const wasDisabled = localStorage.getItem("fsp:lyricsEnabled") === "0";
    localStorage.removeItem("fsp:lyricsEnabled");
    if (wasDisabled) return 0;
    return clamp(Number(localStorage.getItem("fsp:lyricScale")) || 1, 0, 3);
  } catch { return 1; }
})();

export const SCALE_MIN = 0, SCALE_MAX = 3;

// Remembers the last nonzero scale, so clicking the icon to turn lyrics
// back on (or dragging the slider back up from the very bottom) restores
// whatever size was in use before — the same role `lastVolume` plays for
// the mute button in controls.js.
let lastLyricScale = lyricScale > 0 ? lyricScale : 1;

function syncLyricsVisibility() {
  const box = root.querySelector(".fsp-lyrics");
  const off = lyricScale <= 0;
  if (box) box.hidden = off || !lyrics.length;
  if (el.lszIcon) {
    el.lszIcon.classList.toggle("fsp-off", off);
    el.lszIcon.innerHTML = off ? icons.lyricsNoteOff : icons.lyricsNote;
    el.lszIcon.setAttribute("aria-label", off ? "Show lyrics" : "Hide lyrics");
  }
}

// Clicking the icon toggles exactly like clicking mute: off remembers the
// current scale and drops to 0, on restores it. Dragging the slider to 0
// and back achieves the same thing directly through setLyricScale below —
// this is just the one-click shortcut.
export function toggleLyricsVisible() {
  el.lszFill?.classList.add("fsp-anim");
  el.lszKnob?.classList.add("fsp-anim");
  setTimeout(() => {
    el.lszFill?.classList.remove("fsp-anim");
    el.lszKnob?.classList.remove("fsp-anim");
  }, 260);

  setLyricScale(lyricScale > 0 ? 0 : (lastLyricScale || 1));
}

if (el.lszIcon) {
  el.lszIcon.addEventListener("click", toggleLyricsVisible);
  syncLyricsVisibility();
}

function paintLyricSlider() {
  const pct = ((lyricScale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
  if (el.lszFill) el.lszFill.style.height = `${pct}%`;
  if (el.lszKnob) el.lszKnob.style.bottom = `${pct}%`;
  if (el.lszVal) el.lszVal.textContent = `${Math.round(lyricScale * 100)}%`;
}

export function getLyricScale() {
  return lyricScale;
}

export function setLyricScale(value) {
  const next = clamp(Math.round(value * 20) / 20, SCALE_MIN, SCALE_MAX);
  if (lyricScale > 0) lastLyricScale = lyricScale;   // remember before it drops to 0
  lyricScale = next;
  root.style.setProperty("--fsp-lyric-scale", String(lyricScale));
  paintLyricSlider();
  syncLyricsVisibility();
  try { localStorage.setItem("fsp:lyricScale", String(lyricScale)); } catch {}
  lyricIdx = -1;
}

export function applyLyricScale(delta) {
  if (delta) lyricScale = clamp(Math.round((lyricScale + delta) * 20) / 20, SCALE_MIN, SCALE_MAX);

  // Guard against the type growing past what the panel can show: cap so a
  // single line can never exceed a third of the panel height.
  const box = root.querySelector(".fsp-lyrics");
  if (box?.clientHeight) {
    const line = root.querySelector(".fsp-line");
    if (line && line.offsetHeight > box.clientHeight / 3 && delta > 0) {
      lyricScale = clamp(lyricScale - delta, SCALE_MIN, SCALE_MAX);
      flash("lyrics at maximum size");
    }
  }

  if (lyricScale > 0) lastLyricScale = lyricScale;
  root.style.setProperty("--fsp-lyric-scale", String(lyricScale));
  paintLyricSlider();
  syncLyricsVisibility();
  try { localStorage.setItem("fsp:lyricScale", String(lyricScale)); } catch {}
  lyricIdx = -1;             // re-centre on the next frame
}

let providerIdx = 0;

export function cycleProvider() {
  providerIdx = (providerIdx + 1) % PROVIDERS.length;
  return PROVIDERS[providerIdx];
}

export function getProviderName() {
  return PROVIDERS[providerIdx];
}

export async function loadLyrics(item) {
  const uri = item.uri;
  lyricsUri = uri;
  lyrics = [];
  lyricIdx = -1;
  lyricsSource = "none";
  loadOffset(uri);
  renderLyrics(null);

  const mode = PROVIDERS[providerIdx];
  let result;

  if (mode === "lrclib") {
    result = await fromLrclib(item);
  } else if (mode === "betterlyrics") {
    result = await fromBetterLyrics(item);
  } else {
    // Priority order: real per-word timing beats any line-level result,
    // and — since unsynced results are hidden outright (see below) — any
    // *synced* line-level result has to beat an unsynced one too, from
    // whichever provider it came from. Without that second distinction, an
    // early unsynced hit (say, LRCLIB's plain text) would lock in as
    // "found something" even if a later provider had a synced result that
    // would've been fetched and thrown away for no reason. Only settles
    // for unsynced text if literally nothing synced turned up anywhere in
    // the chain.
    let bestSynced = null;
    let bestUnsynced = null;
    for (const fn of [fromOtherExtension, fromBetterLyrics, fromClient, fromLrclib]) {
      const r = await fn(item);
      if (!r?.lines?.length) continue;
      if (r.words) { result = r; break; }
      if (r.synced) bestSynced = bestSynced || r;
      else bestUnsynced = bestUnsynced || r;
    }
    result = result || bestSynced || bestUnsynced;
  }
  if (Spicetify.Player.data?.item?.uri !== uri) return;      // track changed meanwhile

  if (result?.lines?.length && !plausible(result.lines)) {
    console.info("[fsp] rejected lyrics — timings don't fit this track:", result.via);
    lyricsSource = `rejected (${result.via})`;
    return;
  }

  if (result?.lines?.length && result.synced) {
    lyrics = withGapMarkers(result.lines.filter((l) => l.text));
    lyricsSource = `${result.via}${result.words ? " · per-word" : ""}`;
    renderLyrics(true);
  } else if (result?.lines?.length) {
    // Found lyrics, but with no timings to line up against playback —
    // static text with nothing ever highlighting reads as broken, not as
    // "lyrics, just plain," so this is treated the same as not finding
    // any: stays hidden (renderLyrics(null) above already did that; lyrics
    // stays empty). Left in lyricsSource so the debug overlay still shows
    // that something was actually found, just suppressed.
    lyricsSource = `${result.via} (unsynced, hidden)`;
  }
}

// A long instrumental stretch gets its own "line" of three dots.
function withGapMarkers(lines) {
  const GAP = 5;
  const out = [];
  if (lines[0]?.time >= GAP) {
    out.push({ time: 0.2, end: lines[0].time, text: "", dots: true, words: null });
  }
  lines.forEach((l, i) => {
    out.push(l);
    const next = lines[i + 1];
    if (!next) return;
    const finish = l.end || l.time;
    if (next.time - finish >= GAP) {
      out.push({ time: finish, end: next.time, text: "", dots: true, words: null });
    }
  });
  return out;
}

function renderLyrics(synced) {
  const inner = root.querySelector(".fsp-lyrics-inner");
  const box = root.querySelector(".fsp-lyrics");
  inner.innerHTML = "";
  scrollTarget = scrollPos = scrollVel = 0;
  inner.style.transform = "translate3d(0,0,0)";

  if (!lyrics.length) { box.hidden = true; return; }
  box.hidden = lyricScale <= 0;

  lyrics.forEach((line, idx) => {
    const el2 = document.createElement("div");
    el2.className = "fsp-line";

    // The click target used to be the whole row (el2), which is a
    // full-width block even though the text inside is right-aligned —
    // so clicking the blank space to the left of a short line (which can
    // be most of the panel's width) still fired a seek for that line. The
    // listener now goes on each rendered word/dot instead, so only the
    // actual visible text is clickable.
    const seek = () => Spicetify.Player.seek(line.time * 1000);
    const wireHit = (node) => {
      // .fsp-lyrics has pointer-events: none (see its CSS) so the panel's
      // empty space doesn't intercept clicks meant for whatever's behind
      // it; each word/dot has to explicitly opt back in to be hoverable
      // at all, even ones that (below) don't get a click action.
      node.style.pointerEvents = "auto";
      if (!synced) return;
      node.style.cursor = "pointer";
      node.addEventListener("click", seek);
    };

    if (line.dots) {
      el2.classList.add("fsp-dots");
      for (let k = 0; k < 3; k++) {
        const d = document.createElement("span");
        d.className = "fsp-dot";
        wireHit(d);
        el2.appendChild(d);
      }
    } else if (line.words) {
      // Real syllable timing from the provider.
      for (const w of line.words) {
        const span = document.createElement("span");
        span.className = "fsp-w";
        span.textContent = w.text;
        span.dataset.start = String(w.t);
        span.dataset.end = String(w.end || w.t);
        wireHit(span);
        el2.appendChild(span);
      }
    } else {
      // No word timing — interpolate across the line by word length.
      const words = (line.text || "♪").split(/(\s+)/);
      let weight = 0;
      const weights = [];
      for (const w of words) {
        const ww = w.trim() ? w.trim().length + 1 : 0;
        weights.push(ww);
        weight += ww;
      }
      let acc = 0;
      words.forEach((w, k) => {
        if (!w.trim()) { el2.appendChild(document.createTextNode(w)); return; }
        const span = document.createElement("span");
        span.className = "fsp-w";
        span.textContent = w;
        acc += weights[k];
        span.dataset.at = String(weight ? acc / weight : 1);
        wireHit(span);
        el2.appendChild(span);
      });
    }

    inner.appendChild(el2);
  });
  if (!synced) inner.querySelectorAll(".fsp-line").forEach((n) => n.classList.add("fsp-active"));
}

// Keep the current line centred.
export function syncLyrics(posSec) {
  if (!lyrics.length || lyrics.every((l) => l.time === 0)) return;

  let i = lyricIdx;
  if (i >= lyrics.length || i < 0 || lyrics[i].time > posSec) i = 0;
  while (i + 1 < lyrics.length && lyrics[i + 1].time <= posSec) i++;
  if (i === lyricIdx) return;
  lyricIdx = i;

  const inner = root.querySelector(".fsp-lyrics-inner");
  const nodes = inner.children;
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    n.classList.toggle("fsp-active", k === i);
    n.classList.toggle("fsp-n1", k === i + 1);
    n.classList.toggle("fsp-n2", k === i + 2);
    n.classList.toggle("fsp-n3", k === i + 3);
    if (k < i) n.querySelectorAll(".fsp-w").forEach((w) => w.classList.remove("fsp-said"));
  }
  const node = nodes[i];
  if (!node) return;
  const box = root.querySelector(".fsp-lyrics");

  // Measure where the line actually is on screen versus where we want it.
  // offsetTop alone is wrong here: the container centres its content with
  // flexbox, so the layout origin moves as the block grows.
  const nRect = node.getBoundingClientRect();
  const bRect = box.getBoundingClientRect();
  const want = bRect.top + bRect.height * 0.45;
  const have = nRect.top + nRect.height / 2;
  scrollTarget = scrollPos - (have - want);   // relative: current transform included
}

// The scroll is sprung rather than eased, so it settles with a little weight
// instead of a fixed curve.
let scrollTarget = 0, scrollPos = 0, scrollVel = 0;

export function stepScroll(dt) {
  const inner = root.querySelector(".fsp-lyrics-inner");
  if (!inner) return;
  const steps = Math.max(1, Math.ceil(dt / 0.02));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    [scrollPos, scrollVel] = spring(scrollPos, scrollVel, scrollTarget, h, 420, 0.9);
  }
  inner.style.transform = `translate3d(0, ${scrollPos.toFixed(1)}px, 0)`;
}

// Sweep the white highlight across the current line. Sources give line-level
// timing only, so word positions are interpolated by word length.
export function sweepWords(posSec) {
  if (lyricIdx < 0 || !lyrics.length) return;
  const inner = root.querySelector(".fsp-lyrics-inner");
  const node = inner.children[lyricIdx];
  if (!node) return;

  const line = lyrics[lyricIdx];

  // Instrumental gap: fill the dots across its duration.
  if (line.dots) {
    const span = Math.max(0.5, (line.end || line.time + 5) - line.time);
    const p = clamp((posSec - line.time) / span, 0, 1);
    const dots = node.querySelectorAll(".fsp-dot");
    dots.forEach((d, k) => {
      const local = clamp(p * 3 - k, 0, 1);
      d.style.background = local > 0
        ? `rgba(255,255,255,${0.22 + local * 0.7})`
        : "rgba(255,255,255,.22)";
      // A gentle breath so the screen isn't static during the gap.
      const breathe = 1 + 0.12 * Math.sin(posSec * 2.4 - k * 0.6) * (local > 0 ? 1 : 0.35);
      d.style.transform = `scale(${breathe})`;
    });
    return;
  }

  if (line.words) {
    // Real timings. Each syllable wipes across its own duration, glows as it
    // peaks, and lifts slightly — held syllables lift further.
    for (const w of node.querySelectorAll(".fsp-w")) {
      const st = Number(w.dataset.start);
      const en = Number(w.dataset.end) || st;
      const dur = Math.max(0.05, en - st);

      if (posSec < st) {
        w.classList.remove("fsp-said");
        w.style.removeProperty("color");
        w.style.textShadow = "none";
        w.style.transform = "none";
        continue;
      }

      w.classList.add("fsp-said");
      const p = clamp((posSec - st) / dur, 0, 1);

      // Envelope: rises with the syllable, decays over the following moment.
      const since = posSec - st;
      const env = since < dur
        ? Math.sin(Math.PI * clamp(since / dur, 0, 1) * 0.5) // swell in
        : Math.max(0, 1 - (since - dur) / 0.55);             // fade out
      if (env <= 0.01) {
        w.style.textShadow = "none";
        w.style.transform = "none";
        continue;
      }

      // Brighten across the syllable rather than snapping to white.
      const lit = 0.34 + 0.66 * clamp(p, 0, 1);
      w.style.color = posSec >= en ? "" : `rgba(255,255,255,${lit.toFixed(3)})`;

      const held = clamp(dur / 0.6, 0.6, 1.8);     // long syllables lift more
      w.style.textShadow =
        `0 0 ${10 + env * 20}px rgba(255,255,255,${(0.12 + env * 0.4).toFixed(3)})`;
      w.style.transform = `translateY(${(-2.6 * env * held).toFixed(2)}px)`;
    }
    return;
  }

  // No word timing: light the whole line at once. Guessing word positions
  // from line-level data looked worse than simply switching the line.
  for (const w of node.querySelectorAll(".fsp-w")) w.classList.add("fsp-said");
}

// Manual sync offset in seconds, stored per track — different sources match
// different masters, so one global value can't fit every song.
const OFFSETS = "fsp:offsets";
let lyricOffset = 0;

function offsetMap() {
  try { return JSON.parse(localStorage.getItem(OFFSETS) || "{}"); } catch { return {}; }
}
function loadOffset(uri) {
  lyricOffset = Number(offsetMap()[uri]) || 0;
}
function saveOffset(uri) {
  try {
    const m = offsetMap();
    if (lyricOffset) m[uri] = lyricOffset; else delete m[uri];
    localStorage.setItem(OFFSETS, JSON.stringify(m));
  } catch {}
}

export function getLyricOffset() {
  return lyricOffset;
}

// [ and ] nudge lyric sync, \ resets — called from index.js's key handler.
export function nudgeOffset(delta, uri) {
  lyricOffset += delta;
  lyricOffset = Math.round(lyricOffset * 100) / 100;
  saveOffset(uri);
  lyricIdx = -1;             // force a re-sync on the next frame
  return lyricOffset;
}

export function resetOffset(uri) {
  lyricOffset = 0;
  saveOffset(uri);
  lyricIdx = -1;
  return lyricOffset;
}

// Everything window.fsp()'s debug readout needs about lyrics state.
export function debugInfo() {
  return {
    source: lyricsSource,
    count: lyrics.length,
    offset: lyricOffset,
    providerName: PROVIDERS[providerIdx],
    lineIdx: lyricIdx,
    lineTime: lyricIdx >= 0 ? lyrics[lyricIdx]?.time : undefined,
  };
}
