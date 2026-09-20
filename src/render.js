// Rings and full-width spectrum, plus the resize handler that sizes both
// against the artwork.

import { S } from "./state.js";
import { root, el, ctx } from "./dom.js";
import { clamp, lerp } from "./utils.js";
import { getVizSettings, freqRanges, customColors } from "./settings.js";

const CANVAS_RATIO = 1.62;  // canvas side vs artwork — smaller = bigger art

// "Tint" — multiplies RGB channels and clips them, which converges toward
// white as channels clip (the "getting whiter" effect). Accepts any valid
// CSS color (the palette's "rgb(r,g,b)" strings, or S.accent, whatever
// format that happens to be in) by round-tripping it through a scratch
// canvas's fillStyle, which the browser normalizes to "#rrggbb" — cheaper
// and more robust than hand-parsing every color syntax.
const shadeCtx = document.createElement("canvas").getContext("2d");
function tint(css, factor) {
  if (!css || factor === 1) return css;
  shadeCtx.fillStyle = css;
  const norm = shadeCtx.fillStyle;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(norm);
  if (!m) return css;
  const [r, g, b] = [1, 2, 3].map((i) => clamp(Math.round(parseInt(m[i], 16) * factor), 0, 255));
  return `rgb(${r},${g},${b})`;
}

// True brightness: scales HSV "value" only, leaving hue and saturation
// alone. Unlike tint() above (which multiplies RGB channels and clips
// them, converging toward white as it clips), this keeps saturated colors
// looking vivid-but-brighter instead of washed out — the two are
// deliberately separate knobs (see settings.js's artValueBrightness vs
// artTint) because they read as visually different effects.
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function brighten(css, factor) {
  if (!css || factor === 1) return css;
  shadeCtx.fillStyle = css;
  const norm = shadeCtx.fillStyle;
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(norm);
  if (!m) return css;
  const [h, s, v] = rgbToHsv(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16));
  const [r, g, b] = hsvToRgb(h, s, clamp(v * factor, 0, 1));
  return `rgb(${r},${g},${b})`;
}

// The two color-adjustment knobs applied together, in order: brighten
// (value only) first, then tint (toward white) on top of that.
function paintColor(css, viz) {
  return tint(brighten(css, viz.artValueBrightness), viz.artTint);
}

// "Artwork color spread" — pulls gradient stops away from (>1) or toward
// (<1) the middle, so the extracted hues read as more or less spread out
// across the ring/spectrum gradient without re-running color extraction.
function warp(t, spread) {
  return clamp(0.5 + (t - 0.5) * spread, 0, 1);
}

// Builds the ordered list of [position, color] gradient stops for either
// paint mode: the artwork palette (tinted + spread) or the custom color
// list (flat if it's just one color, an even gradient if more).
function gradientStops(viz) {
  if (viz.colorMode === "custom") {
    const colors = customColors();
    return colors.map((c, i) => [colors.length > 1 ? i / (colors.length - 1) : 0, c]);
  }
  if (!S.palette || S.palette.length < 2) return null;
  return S.palette.map((c, i) => [
    warp(i / (S.palette.length - 1), viz.paletteSpread),
    paintColor(c, viz),
  ]);
}

export function resize() {
  root.classList.toggle("fsp-fs", !!document.fullscreenElement);
  resizeSpectrum();
  const vw = window.innerWidth, vh = window.innerHeight;
  // The card is pinned bottom-left and the transport is as wide as the
  // artwork, so they share horizontal space — the card's height has to be
  // reserved or the controls land on the text.
  const cardH = (el.meta?.offsetHeight || 110) + 22;
  // The transport overlaps the ring band now, so it costs almost nothing.
  const below = 18;
  const region = Math.max(200, vh - cardH);
  root.style.setProperty("--fsp-stage-top", `${Math.round(region / 2)}px`);

  // Width available is the left column only — the right half stays clear.
  let side = Math.min(vw * 0.48, region - below);
  side = clamp(side, 150, 980);
  S.artSize = Math.floor(clamp(side / CANVAS_RATIO, 90, 560));
  root.style.setProperty("--fsp-art", `${S.artSize}px`);

  side = Math.floor(S.artSize * CANVAS_RATIO);
  // Empty band between the artwork edge and the canvas edge — the transport
  // is pulled up into it.
  root.style.setProperty("--fsp-band", `${Math.round((side - S.artSize) / 2)}px`);
  const dpr = window.devicePixelRatio || 1;
  el.wrap.style.width = el.wrap.style.height = `${side}px`;
  el.canvas.width = side * dpr;
  el.canvas.height = side * dpr;
  el.canvas.style.width = el.canvas.style.height = `${side}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Place the lyric slider a fixed distance right of the artwork, and the
  // volume slider the same distance left of it (mirrored), so the two sit
  // symmetrically around the art at any window size. Measured after layout
  // so both follow the artwork wherever it ends up. The volume slider's
  // own width is measured too, since it's positioned by its left edge —
  // without accounting for its width, mirroring the same offset used for
  // the (also left-edge-positioned) lyric slider wouldn't actually line
  // the two slider *tracks* up around the art.
  requestAnimationFrame(() => {
    const art = el.art?.getBoundingClientRect();
    if (!art?.width) return;
    root.style.setProperty("--fsp-lsz-left", `${Math.round(art.right + 30)}px`);
    const volW = el.volWrap?.getBoundingClientRect().width || 0;
    root.style.setProperty("--fsp-vol-left", `${Math.round(art.left - 30 - volW)}px`);
    // The gear sits directly above the volume slider (same left offset).
    // 48px clear of the artwork's top edge is the normal gap — plenty of
    // room on most screens, since the "Playing from" card sits well above
    // that on its own fixed 14px offset. But on a short window/monitor,
    // the artwork (and everything centered on it) sits much closer to the
    // top, and that same fixed 48px gap can push the gear up underneath —
    // or past — the card instead of just getting a little cozier with the
    // volume slider like it should. Clamp it to never go above the card's
    // actual bottom edge (plus a small margin), whatever that card's
    // height happens to be; short of that floor, the gear naturally slides
    // down toward the volume slider's top as the window shrinks, exactly
    // as it should.
    const contextBottom = el.context?.getBoundingClientRect().bottom || 0;
    const minGearTop = contextBottom + 10;
    const idealGearTop = art.top - 48;
    root.style.setProperty("--fsp-gear-top", `${Math.round(Math.max(idealGearTop, minGearTop))}px`);
  });
}

// The frequency-bands setting narrows both the rings and the spectrum to
// one or more thirds of the existing band array (see settings.js's
// freqRanges) — this resolves those fractional ranges to actual array
// index ranges once per call so bandAt and bandLerp read the same windows.
function focusedIndexRanges() {
  return freqRanges().map(([lo, hi]) => {
    const iLo = Math.floor(lo * (S.N - 1));
    const iHi = Math.max(iLo + 1, Math.min(S.N - 1, Math.ceil(hi * (S.N - 1))));
    return [iLo, iHi];
  });
}

// Maps t in [0,1] across however many bands are selected, concatenated in
// order — with mids excluded, say, t sweeps across bass then picks straight
// up at treble rather than leaving a dead gap in the middle of the sweep.
function sampleBand(t) {
  const ranges = focusedIndexRanges();
  const lens = ranges.map(([iLo, iHi]) => iHi - iLo);
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let pos = clamp(t, 0, 1) * total;
  for (let r = 0; r < ranges.length; r++) {
    const [iLo, iHi] = ranges[r];
    const len = lens[r];
    if (pos <= len || r === ranges.length - 1) {
      const local = iLo + clamp(pos, 0, len);
      const i = Math.floor(local), j = Math.min(iHi, i + 1);
      return lerp(S.bands[i] ?? 0, S.bands[j] ?? 0, local - i);
    }
    pos -= len;
  }
  return 0;
}

// Spectrum mirrored across the vertical axis: bass at the top, treble low.
function bandAt(angle) {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a = Math.PI * 2 - a;
  const v = sampleBand(a / Math.PI);
  // A Set, not a running sum, because adjacent selected thirds share a
  // boundary index (bass's last index is mids' first) — summing per range
  // would count that shared band twice and skew the mean it's meant to
  // remove, tilting the ring's rest position slightly off-center.
  const indices = new Set();
  for (const [iLo, iHi] of focusedIndexRanges()) {
    for (let k = iLo; k <= iHi; k++) indices.add(k);
  }
  let mean = 0;
  for (const k of indices) mean += S.bands[k];
  return v - mean / (indices.size || 1);
}

// gap and amp are fractions of the space between the artwork edge and the
// canvas edge, so the rings always fit whatever size the artwork ends up.
const RINGS = [
  { gap: 0.08, amp: 0.30, width: 2.2, alpha: 0.9, speed: 0.22, lobes: 1 },
  { gap: 0.28, amp: 0.36, width: 1.5, alpha: 0.5, speed: -0.14, lobes: 2 },
  { gap: 0.46, amp: 0.32, width: 1.1, alpha: 0.26, speed: 0.08, lobes: 3 },
];

// A gradient across the ring built from the artwork's palette, rotated
// slowly so the colours travel around it.
function ringPaint(ctx2, c, radius, ring) {
  const viz = getVizSettings();
  const stops = gradientStops(viz);
  if (!stops) return paintColor(S.accent, viz);
  if (stops.length === 1) return stops[0][1];
  // Lock-rotation-direction forces every ring's gradient to sweep the
  // same way instead of alternating with the ring's own (sometimes
  // negative) speed sign.
  const dir = viz.lockRotationDirection ? 1 : (ring.speed > 0 ? 1 : -1);
  const a = S.rotation * 0.25 * dir;
  const g = ctx2.createLinearGradient(
    c + Math.cos(a) * radius, c + Math.sin(a) * radius,
    c - Math.cos(a) * radius, c - Math.sin(a) * radius
  );
  stops.forEach(([pos, col]) => g.addColorStop(pos, col));
  return g;
}

/* ------------------------------------------------------------------ *
 * Full-width spectrum: mirrored bars along the top and bottom edges
 * ------------------------------------------------------------------ */

const specCanvas = root.querySelector(".fsp-spectrum");
const sctx = specCanvas.getContext("2d");
const BAR_GAP = 3;
const hasRoundRect = typeof sctx.roundRect === "function";

function resizeSpectrum() {
  const dpr = window.devicePixelRatio || 1;
  specCanvas.width = window.innerWidth * dpr;
  specCanvas.height = window.innerHeight * dpr;
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Smooth interpolation across the band array, so 28 values read as a
// continuous spectrum rather than 28 steps.
function bandLerp(t) {
  return sampleBand(t);
}

export function drawSpectrum() {
  const viz = getVizSettings();
  const w = window.innerWidth, h = window.innerHeight;
  sctx.clearRect(0, 0, w, h);

  const bars = Math.max(24, Math.min(160, Math.floor((w / 16) * viz.barDensity)));
  const barW = w / bars - BAR_GAP;
  const maxH = Math.min(h * 0.22, 230) * viz.barHeight;

  // Horizontal gradient from the artwork palette (or custom colors), or a
  // flat fallback when there's nothing to build a gradient from yet.
  const stops = gradientStops(viz);
  let paint = paintColor(S.accent, viz);
  if (stops) {
    if (stops.length === 1) {
      paint = stops[0][1];
    } else {
      const g = sctx.createLinearGradient(0, 0, w, 0);
      stops.forEach(([pos, col]) => g.addColorStop(pos, col));
      paint = g;
    }
  }
  sctx.fillStyle = paint;

  const round = hasRoundRect && viz.barShape !== "sharp";
  const showTop = viz.barPosition !== "bottom";
  const showBottom = viz.barPosition !== "top";

  for (let b = 0; b < bars; b++) {
    const t = b / (bars - 1);
    // Fold the spectrum so bass sits at both edges and treble meets in the
    // middle — a straight left-to-right ramp looks lopsided full-width.
    // Turning the fold off reads the band array left-to-right instead.
    const foldT = viz.barMirrorFold ? (t < 0.5 ? t * 2 : (1 - t) * 2) : t;
    const v = Math.pow(bandLerp(foldT), 1.1);
    const bh = Math.max(2, v * maxH * (0.25 + S.energy * 0.95) * viz.barSensitivity);
    const x = b * (w / bars) + BAR_GAP / 2;

    // Opacity is just opacity — it no longer rides on how loud the music
    // is (that was the bug: alpha used to be tied to `v`, which almost
    // never sits at its exact max in real playback, so 100% only ever
    // looked solid at one theoretical peak). Loudness already drives the
    // bar's height above; alpha is now only the slider's own value, so
    // 100% is solid all the time and every other setting is a fixed,
    // predictable amount of transparency.
    sctx.globalAlpha = viz.colorOpacity;
    if (round) {
      if (showTop) {
        sctx.beginPath();
        sctx.roundRect(x, 0, barW, bh, [0, 0, 2, 2]);        // top, hanging down
        sctx.fill();
      }
      if (showBottom) {
        sctx.beginPath();
        sctx.roundRect(x, h - bh, barW, bh, [2, 2, 0, 0]);   // bottom, rising
        sctx.fill();
      }
    } else {
      if (showTop) sctx.fillRect(x, 0, barW, bh);
      if (showBottom) sctx.fillRect(x, h - bh, barW, bh);
    }
  }
  sctx.globalAlpha = 1;
}

export function draw() {
  const viz = getVizSettings();
  const w = el.canvas.width / (window.devicePixelRatio || 1);
  const c = w / 2;
  ctx.clearRect(0, 0, w, w);

  const artR = S.artSize / 2;
  const beat = 1 + S.pulse * 0.13 * viz.pulseStrength;
  const STEPS = 220;
  const stops = gradientStops(viz);

  for (const ring of RINGS) {
    if (viz.ringsOn[RINGS.indexOf(ring)] === false) continue;
    const width = ring.width * viz.ringThickness;
    const maxR = w / 2 - width - 2;
    const avail = Math.max(1, maxR - artR);          // room outside the art
    const drive = Math.min(1, S.energy);
    // Beat scales the artwork-hugging part only; scaling the whole radius
    // pushed the outer ring off the canvas at peaks.
    const base = artR * beat + avail * (ring.gap + drive * 0.05 * ring.lobes);
    const amp = avail * ring.amp * (0.15 + 0.85 * drive) * viz.ringReactivity;
    // Lock-rotation-direction runs every ring's band-sampling angle
    // forward, instead of some rings sampling backward off their own
    // (sometimes negative) speed — that's what made them look like they
    // spun opposite ways.
    const speed = viz.lockRotationDirection ? Math.abs(ring.speed) : ring.speed;

    ctx.beginPath();
    for (let s = 0; s <= STEPS; s++) {
      const a = (s / STEPS) * Math.PI * 2;
      const mod = bandAt((a * ring.lobes + S.rotation * speed) % (Math.PI * 2));
      const r = clamp(base + amp * mod, artR * 0.6, maxR);
      const x = c + Math.cos(a - Math.PI / 2) * r;
      const y = c + Math.sin(a - Math.PI / 2) * r;
      s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = ringPaint(ctx, c, base + amp, ring);
    // Same principle as the spectrum bars: opacity is the slider's value,
    // not something that rides on how loud the music is at this instant.
    // Each ring's own base alpha (0.9/0.5/0.26) is a deliberate depth cue
    // — the foreground ring stays stronger than the background ones even
    // at 100% — so that part is intentionally kept, just no longer also
    // multiplied by a loudness factor that could push it below its own
    // cap unpredictably.
    ctx.globalAlpha = ring.alpha * viz.colorOpacity;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.shadowBlur = 20 * S.energy * viz.glowIntensity;
    ctx.shadowColor = stops
      ? stops[Math.min(stops.length - 1, RINGS.indexOf(ring))][1]
      : paintColor(S.accent, viz);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  el.art.style.transform = `scale(${1 + S.pulse * 0.012 * viz.pulseStrength})`;
}
