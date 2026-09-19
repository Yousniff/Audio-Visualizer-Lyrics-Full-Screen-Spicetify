// Visualizer settings: a small popout panel behind the gear icon (top-left
// of the artwork, above the volume slider) for customizing the ring
// visualizer and spectrum bar — color, motion, and which slice of the
// existing frequency-band data they respond to. Persisted the same way
// volume/lyric state is: one localStorage key, read once at import time.
// Follows the self-contained-module pattern of controls.js/lyrics/view.js:
// this file owns its own state and DOM wiring, and exposes plain reader
// functions for render.js/index.js to pull from each frame.

import { root, el } from "./dom.js";
import { clamp } from "./utils.js";
// Only referenced inside callbacks below (never at module top level), so
// this is safe despite track.js importing getVizSettings from this same
// file — by the time either side actually calls into the other, both
// modules have finished evaluating.
import { setupMarquee, applyMarqueeSpeed } from "./track.js";

const KEY = "fsp:vizSettings";

const DEFAULTS = {
  // --- color ---
  colorMode: "art",        // "art" (palette from the cover) | "custom"
  // True brightness (HSV value only — stays vivid, doesn't wash out).
  artValueBrightness: 1,   // 0.4 - 2
  // Multiplies RGB channels and clips them, which converges toward white
  // as it clips — kept as its own knob since it reads as a different
  // effect than artValueBrightness above (a "getting whiter" wash rather
  // than a straightforward brighter/darker).
  artTint: 1,              // 0.4 - 1.8
  paletteSpread: 1,        // biases gradient-stop spacing outward, 0.4 - 2
  // Default sits below full solid, closer to how this looked before the
  // opacity setting existed — 1.0 is available on the slider, just not
  // the out-of-the-box value.
  colorOpacity: 0.6,       // ring/spectrum fill alpha, 0.1 - 1
  customColor: "#8b5cf6",
  customColor2: "#22d3ee",
  customColor3: "#f472b6",
  useColor2: false,
  useColor3: false,

  // --- rings ---
  ringSpeed: 1,             // multiplies S.rotation's per-frame increment
  ringReactivity: 1,        // multiplies how far the rings deform
  ringsOn: [true, true, true],
  ringThickness: 1,         // multiplies each ring's line width, 0.5 - 2
  glowIntensity: 1,         // multiplies the ring glow's shadow blur, 0 - 2
  pulseStrength: 1,         // multiplies the beat pulse (art scale + ring base), 0 - 2
  lockRotationDirection: false, // force all rings to spin the same way

  // --- spectrum bar ---
  barDensity: 1,            // multiplies the spectrum's bar count
  barHeight: 1,             // multiplies the spectrum's max bar height
  barSensitivity: 1,        // multiplies the spectrum's bar amplitude
  barPosition: "both",      // "both" | "top" | "bottom"
  barShape: "rounded",      // "rounded" | "sharp"
  barMirrorFold: true,      // fold so bass sits at both edges, treble meets mid

  // --- frequencies ---
  // Which thirds of the existing band data feed the rings/spectrum bar.
  // Independent checkboxes rather than one exclusive choice, so bass and
  // treble can be combined while mids is left out, for instance. All three
  // on is equivalent to the old "full range" preset.
  freqBands: { bass: true, mids: true, treble: true },

  // --- general ---
  motionOverride: "auto",   // "auto" (respect OS setting) | "on" | "off"
  autoFullscreen: true,     // enter real fullscreen on open (same pref the F key toggles)
  // "always" (never fades) | "auto" (fades out after a few seconds idle,
  // back in on mouse move) | "off" (never shown).
  contextVisibility: "auto",  // the "Playing from" label, top-left
  // "always" (shown for the whole track, once there is a next one) |
  // "auto" (only inside nextLeadSeconds of the track ending) | "off".
  nextVisibility: "auto",     // the up-next card
  nextLeadSeconds: 20,        // how long before the end "auto" reveals it, 1 - 90
  showDebug: false,         // the debug readout starts visible without pressing D
  backgroundIntensity: 1,   // multiplies the blurred backdrop/wash opacity, 0 - 2
  artShadow: 1,             // multiplies the artwork's drop shadow, 0 - 2
  marqueeScroll: true,      // off: long titles render in full instead of scrolling
  marqueeSpeed: 1,          // multiplies marquee scroll speed, 0.5 - 2
  marqueeStyle: "bounce",   // "bounce" (scroll to the end, snap back) | "ticker" (continuous loop)
  metaTextScale: 1,         // scales title/artist/album font size, 0.7 - 1.5
};

// The fullscreen preference used to live in its own standalone localStorage
// key (set by the F shortcut), before it moved into this settings object as
// autoFullscreen — read it once so an existing preference isn't silently
// forgotten and reset to the default.
function migratedAutoFullscreen(raw) {
  if (raw && raw.autoFullscreen !== undefined) return raw.autoFullscreen;
  try {
    const old = localStorage.getItem("fsp:fullscreen");
    if (old !== null) return old !== "0";
  } catch {}
  return DEFAULTS.autoFullscreen;
}

// "freqFocus" was this same frequency selection as one exclusive string
// ("full" | "bass" | "mids" | "treble") before it became independent
// checkboxes — carry a saved single choice over as the equivalent
// single-band selection rather than silently resetting to "all three on".
function migratedFreqBands(raw) {
  if (raw && raw.freqBands && typeof raw.freqBands === "object") {
    return { ...DEFAULTS.freqBands, ...raw.freqBands };
  }
  switch (raw?.freqFocus) {
    case "bass": return { bass: true, mids: false, treble: false };
    case "mids": return { bass: false, mids: true, treble: false };
    case "treble": return { bass: false, mids: false, treble: true };
    default: return { ...DEFAULTS.freqBands };
  }
}

// showContext/showUpNext were plain on/off booleans before each grew a
// third "always" state — a saved `false` still means "off" under the new
// three-way setting, and a saved `true` (or nothing saved yet) becomes
// "auto", the equivalent of how "on" already behaved (fade with the
// cursor / only near the track's end).
function migratedContextVisibility(raw) {
  if (raw?.contextVisibility) return raw.contextVisibility;
  if (raw?.showContext === false) return "off";
  return DEFAULTS.contextVisibility;
}
function migratedNextVisibility(raw) {
  if (raw?.nextVisibility) return raw.nextVisibility;
  if (raw?.showUpNext === false) return "off";
  return DEFAULTS.nextVisibility;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || typeof raw !== "object") {
      return { ...DEFAULTS, freqBands: { ...DEFAULTS.freqBands }, autoFullscreen: migratedAutoFullscreen(null) };
    }
    return {
      ...DEFAULTS,
      ...raw,
      // "artBrightness" was this same tint-toward-white slider under its
      // old name, before artValueBrightness existed as a separate knob —
      // carry a saved value over so it doesn't silently reset to default.
      artTint: raw.artTint ?? raw.artBrightness ?? DEFAULTS.artTint,
      autoFullscreen: migratedAutoFullscreen(raw),
      freqBands: migratedFreqBands(raw),
      contextVisibility: migratedContextVisibility(raw),
      nextVisibility: migratedNextVisibility(raw),
      ringsOn:
        Array.isArray(raw.ringsOn) && raw.ringsOn.length === 3
          ? raw.ringsOn.map(Boolean)
          : [...DEFAULTS.ringsOn],
    };
  } catch {
    return { ...DEFAULTS, freqBands: { ...DEFAULTS.freqBands }, autoFullscreen: migratedAutoFullscreen(null) };
  }
}

let settings = load();

// The handful of "general" settings that aren't read per-frame by
// render.js — they're DOM/CSS side effects (visibility, CSS custom
// properties) applied here directly instead. Called once at load and
// again inside save(), so every change stays in sync automatically
// without every single listener below needing to remember to call it.
function applyGeneral() {
  if (el.context) {
    el.context.style.display = settings.contextVisibility === "off" ? "none" : "";
    // Opts this element out of .fsp-root.fsp-idle's fade — see the CSS
    // rule and the DOM comment on why .fsp-context lives outside
    // .fsp-chrome in the first place.
    el.context.classList.toggle("fsp-force-show", settings.contextVisibility === "always");
  }
  root.style.setProperty("--fsp-bg-intensity", String(settings.backgroundIntensity));
  root.style.setProperty("--fsp-art-shadow", String(settings.artShadow));
  root.style.setProperty("--fsp-meta-scale", String(settings.metaTextScale));
}
applyGeneral();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  applyGeneral();
}

export function getVizSettings() {
  return settings;
}

// The fullscreen-on-open preference is also flipped by the F keyboard
// shortcut in index.js, outside the settings panel — routed through here
// (rather than index.js touching localStorage itself) so there's one
// source of truth and the panel's checkbox stays in sync either way.
export function setAutoFullscreen(value) {
  settings.autoFullscreen = value;
  save();
  if (inputs) inputs.autoFullscreen.checked = value;
}

// Each band takes a third of the existing band array rather than asking
// for finer frequency resolution — the raw FFT data comes from an external
// bridge process (see bridge.js) and isn't something this extension
// controls; this just remaps which slice(s) of what's already there feed
// the rings and the spectrum bar. Returns one [lo, hi] fractional range per
// checked band, in order, so render.js can concatenate whichever bands are
// selected — bass and treble with mids excluded, say — rather than being
// limited to one contiguous slice.
const FREQ_THIRDS = { bass: [0, 1 / 3], mids: [1 / 3, 2 / 3], treble: [2 / 3, 1] };
export function freqRanges() {
  // No fallback when nothing's checked: unchecking all three is a way of
  // asking for the rings/bar to go still, not a state to second-guess by
  // quietly substituting the full range back in.
  return ["bass", "mids", "treble"]
    .filter((k) => settings.freqBands[k])
    .map((k) => FREQ_THIRDS[k]);
}

// The list of colors a "custom" gradient should use, in order — one color
// if the extra slots are off (renders as a flat fill, same as before),
// two or three if enabled, for a custom gradient instead of the artwork's.
export function customColors() {
  const list = [settings.customColor];
  if (settings.useColor2) list.push(settings.customColor2);
  if (settings.useColor3) list.push(settings.customColor3);
  return list;
}

/* ------------------------------------------------------------------ *
 * Panel wiring
 * ------------------------------------------------------------------ */

const wrap = el.settingsWrap;
const panel = root.querySelector(".fsp-settings-panel");

// Every open listbox, so the outside-click handler and panel close can
// find and shut them all without walking the DOM for them (the list is no
// longer inside the panel's own subtree — see the portal note below).
const openSelectLists = new Set();
function closeAllSelectLists() {
  for (const entry of openSelectLists) entry.close();
}

// Builds a themed listbox for one <select>, backed by that same element —
// the select stays in the DOM (visually hidden, not removed) so it keeps
// being the single source of truth every other line of this file already
// reads .value from and listens for "change" on; this only replaces how
// it's *drawn*. See the CSS comment on .fsp-native-select-hidden for why.
function enhanceSelect(select) {
  if (select.dataset.enhanced) return null;
  select.dataset.enhanced = "1";
  select.classList.add("fsp-native-select-hidden");
  select.tabIndex = -1;

  const wrap = document.createElement("div");
  wrap.className = "fsp-select-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fsp-select-btn";
  const label = document.createElement("span");
  const chevron = document.createElement("span");
  chevron.className = "fsp-select-chevron";
  chevron.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>';
  btn.append(label, chevron);

  // The list is appended to <body>, not to `wrap`: a "Motion"-style row
  // near the bottom of the panel has nowhere to open downward into, since
  // both .fsp-set-body (its own scroll area) and .fsp-settings-panel
  // (rounded-corner clipping) cut off anything positioned past their
  // bounds — and unlike a scrollbar, that cutoff can't be scrolled past to
  // reach the rest of the list. Living directly on <body> and positioned
  // with fixed coordinates (recomputed each time it opens) escapes both.
  const list = document.createElement("div");
  list.className = "fsp-select-list";
  list.hidden = true;
  document.body.appendChild(list);

  const options = [...select.options];
  const itemEls = options.map((opt) => {
    const item = document.createElement("div");
    item.className = "fsp-select-item";
    item.textContent = opt.textContent;
    item.addEventListener("click", (e) => {
      // Portaled onto <body>, this click would otherwise bubble past the
      // settings panel (which normally absorbs its own clicks) straight to
      // the document-level "click outside the panel closes it" handler —
      // closing the whole panel the instant an option was picked.
      e.stopPropagation();
      select.value = opt.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
      close();
    });
    list.appendChild(item);
    return item;
  });

  function sync() {
    const i = options.findIndex((o) => o.value === select.value);
    label.textContent = options[i]?.textContent ?? options[0]?.textContent ?? "";
    itemEls.forEach((el, idx) => el.classList.toggle("fsp-select-item-active", idx === i));
  }
  function close() {
    list.hidden = true;
    wrap.classList.remove("fsp-select-open");
    openSelectLists.delete(entry);
  }
  // Positions the (already-portaled) list against the button's current
  // screen position, flipping to open upward when there's more room above
  // than below — the same "Motion" row is also close enough to the
  // panel's bottom edge that opening downward would just repeat the
  // original clipping problem one level up.
  function position() {
    const r = btn.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    list.style.left = `${r.left}px`;
    list.style.width = `${r.width}px`;
    if (spaceBelow < 120 && spaceAbove > spaceBelow) {
      list.style.top = "";
      list.style.bottom = `${window.innerHeight - r.top + 6}px`;
      list.style.maxHeight = `${Math.min(220, spaceAbove)}px`;
    } else {
      list.style.bottom = "";
      list.style.top = `${r.bottom + 6}px`;
      list.style.maxHeight = `${Math.min(220, spaceBelow)}px`;
    }
  }
  function open() {
    closeAllSelectLists(); // only one listbox open at a time
    position();
    list.hidden = false;
    wrap.classList.add("fsp-select-open");
    openSelectLists.add(entry);
  }

  const entry = { close };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    list.hidden ? open() : close();
  });

  select.insertAdjacentElement("afterend", wrap);
  wrap.append(btn);
  sync();
  return { sync, close };
}

// Clicking anywhere outside an open listbox closes it — each select's own
// button, and each of its items, already stop their own click from
// reaching here, so this only ever fires for an actual "elsewhere" click.
document.addEventListener("click", closeAllSelectLists);

const inputs = panel && {
  colorMode: panel.querySelector(".fsp-set-colormode"),
  artValueBrightness: panel.querySelector(".fsp-set-vbrightness"),
  artTint: panel.querySelector(".fsp-set-tint"),
  paletteSpread: panel.querySelector(".fsp-set-spread"),
  colorOpacity: panel.querySelector(".fsp-set-opacity"),
  customColor: panel.querySelector(".fsp-set-customcolor"),
  customColor2: panel.querySelector(".fsp-set-customcolor2"),
  customColor3: panel.querySelector(".fsp-set-customcolor3"),
  useColor2: panel.querySelector(".fsp-set-usecolor2"),
  useColor3: panel.querySelector(".fsp-set-usecolor3"),

  ring0: panel.querySelector(".fsp-set-ring0"),
  ring1: panel.querySelector(".fsp-set-ring1"),
  ring2: panel.querySelector(".fsp-set-ring2"),
  ringSpeed: panel.querySelector(".fsp-set-ringspeed"),
  ringReactivity: panel.querySelector(".fsp-set-ringreact"),
  ringThickness: panel.querySelector(".fsp-set-thickness"),
  glowIntensity: panel.querySelector(".fsp-set-glow"),
  pulseStrength: panel.querySelector(".fsp-set-pulse"),
  lockRotationDirection: panel.querySelector(".fsp-set-lockdir"),

  barPosition: panel.querySelector(".fsp-set-barpos"),
  barShape: panel.querySelector(".fsp-set-barshape"),
  barMirrorFold: panel.querySelector(".fsp-set-fold"),
  barDensity: panel.querySelector(".fsp-set-density"),
  barHeight: panel.querySelector(".fsp-set-height"),
  barSensitivity: panel.querySelector(".fsp-set-sens"),

  freqBass: panel.querySelector(".fsp-set-freqbass"),
  freqMids: panel.querySelector(".fsp-set-freqmids"),
  freqTreble: panel.querySelector(".fsp-set-freqtreble"),

  motionOverride: panel.querySelector(".fsp-set-motion"),
  autoFullscreen: panel.querySelector(".fsp-set-autofs"),
  contextVisibility: panel.querySelector(".fsp-set-ctxvis"),
  nextVisibility: panel.querySelector(".fsp-set-nextvis"),
  nextLeadSeconds: panel.querySelector(".fsp-set-leadsecs"),
  nextLeadSecondsBadge: panel.querySelector(".fsp-set-leadsecs-badge"),
  showDebug: panel.querySelector(".fsp-set-showdebug"),
  backgroundIntensity: panel.querySelector(".fsp-set-bgintensity"),
  artShadow: panel.querySelector(".fsp-set-artshadow"),
  marqueeScroll: panel.querySelector(".fsp-set-marqueescroll"),
  marqueeSpeed: panel.querySelector(".fsp-set-marqueespeed"),
  marqueeStyle: panel.querySelector(".fsp-set-marqueestyle"),
  metaTextScale: panel.querySelector(".fsp-set-textsize"),
};

// Rows that only make sense for one color mode — toggled together
// whenever the mode changes or on initial paint.
function syncColorRows() {
  const custom = settings.colorMode === "custom";
  inputs.artValueBrightness.closest(".fsp-set-vbrightness-row").style.display = custom ? "none" : "";
  inputs.artTint.closest(".fsp-set-tint-row").style.display = custom ? "none" : "";
  inputs.paletteSpread.closest(".fsp-set-spread-row").style.display = custom ? "none" : "";
  panel.querySelectorAll(".fsp-set-custom-row").forEach((row) => {
    row.style.display = custom ? "" : "none";
  });
}

// A native <input type="range"> has no idea "how full" it should look —
// that's purely a CSS trick (the slider CSS above reads --fsp-range-fill
// as the split point of a two-color gradient), so this pushes the current
// percentage in as that custom property. Applied to every range whenever a
// value is painted in (paintInputs()) and live while dragging any of them
// (the delegated listener below), independent of each range's own
// setting-specific "input" listener.
function updateRangeFill(inputEl) {
  const min = Number(inputEl.min) || 0;
  const max = Number(inputEl.max) || 100;
  const pct = ((Number(inputEl.value) - min) / (max - min)) * 100;
  inputEl.style.setProperty("--fsp-range-fill", `${clamp(pct, 0, 100)}%`);
}

// Every <select>'s custom listbox (see enhanceSelect() above), so
// paintInputs() can refresh their displayed labels after setting .value
// programmatically — assigning .value directly doesn't fire "change", so
// without this a reset-to-defaults or an initial load would leave a
// listbox showing a stale label until the person opened it themselves.
let selectEnhancers = [];

// A range slider fires "input" continuously while being dragged — calling
// setupMarquee() on every single tick restarts each row's CSS scroll
// animation from frame zero every time, so a row that only *just* became
// wide enough to scroll would keep getting reset before ever visibly
// moving, and would still be sitting in the animation's own brief opening
// pause right after you let go — looking permanently stuck. Debouncing
// so it only actually re-measures once the drag settles avoids that.
let marqueeDebounce = null;
function debouncedSetupMarquee() {
  clearTimeout(marqueeDebounce);
  marqueeDebounce = setTimeout(setupMarquee, 250);
}

// Adjusting scroll speed is meaningless once scrolling itself is off.
function syncMarqueeRow() {
  const show = settings.marqueeScroll ? "" : "none";
  inputs.marqueeSpeed.closest(".fsp-set-marqueespeed-row").style.display = show;
  inputs.marqueeStyle.closest(".fsp-set-marqueestyle-row").style.display = show;
}

// The lead-time slider only means anything for "auto" — "always" ignores
// the clock entirely and "off" never shows the card regardless of it.
function syncNextLeadRow() {
  inputs.nextLeadSeconds.closest(".fsp-set-leadsecs-row").style.display =
    settings.nextVisibility === "auto" ? "" : "none";
}

function paintInputs() {
  if (!inputs) return;
  inputs.colorMode.value = settings.colorMode;
  inputs.artValueBrightness.value = settings.artValueBrightness;
  inputs.artTint.value = settings.artTint;
  inputs.paletteSpread.value = settings.paletteSpread;
  inputs.colorOpacity.value = settings.colorOpacity;
  inputs.customColor.value = settings.customColor;
  inputs.customColor2.value = settings.customColor2;
  inputs.customColor3.value = settings.customColor3;
  inputs.useColor2.checked = settings.useColor2;
  inputs.useColor3.checked = settings.useColor3;
  syncColorRows();

  inputs.ring0.checked = settings.ringsOn[0];
  inputs.ring1.checked = settings.ringsOn[1];
  inputs.ring2.checked = settings.ringsOn[2];
  inputs.ringSpeed.value = settings.ringSpeed;
  inputs.ringReactivity.value = settings.ringReactivity;
  inputs.ringThickness.value = settings.ringThickness;
  inputs.glowIntensity.value = settings.glowIntensity;
  inputs.pulseStrength.value = settings.pulseStrength;
  inputs.lockRotationDirection.checked = settings.lockRotationDirection;

  inputs.barPosition.value = settings.barPosition;
  inputs.barShape.value = settings.barShape;
  inputs.barMirrorFold.checked = settings.barMirrorFold;
  inputs.barDensity.value = settings.barDensity;
  inputs.barHeight.value = settings.barHeight;
  inputs.barSensitivity.value = settings.barSensitivity;

  inputs.freqBass.checked = settings.freqBands.bass;
  inputs.freqMids.checked = settings.freqBands.mids;
  inputs.freqTreble.checked = settings.freqBands.treble;

  inputs.motionOverride.value = settings.motionOverride;

  inputs.autoFullscreen.checked = settings.autoFullscreen;
  inputs.contextVisibility.value = settings.contextVisibility;
  inputs.nextVisibility.value = settings.nextVisibility;
  inputs.nextLeadSeconds.value = settings.nextLeadSeconds;
  inputs.nextLeadSecondsBadge.textContent = `${settings.nextLeadSeconds}s`;
  syncNextLeadRow();
  inputs.showDebug.checked = settings.showDebug;
  inputs.backgroundIntensity.value = settings.backgroundIntensity;
  inputs.artShadow.value = settings.artShadow;
  inputs.marqueeScroll.checked = settings.marqueeScroll;
  inputs.marqueeSpeed.value = settings.marqueeSpeed;
  inputs.marqueeStyle.value = settings.marqueeStyle;
  inputs.metaTextScale.value = settings.metaTextScale;
  syncMarqueeRow();

  panel.querySelectorAll('input[type="range"]').forEach(updateRangeFill);
  selectEnhancers.forEach((e) => e.sync());
}

if (inputs) {
  selectEnhancers = [...panel.querySelectorAll("select")].map(enhanceSelect).filter(Boolean);

  inputs.colorMode.addEventListener("change", () => {
    settings.colorMode = inputs.colorMode.value;
    syncColorRows();
    save();
  });
  inputs.artValueBrightness.addEventListener("input", () => {
    settings.artValueBrightness = Number(inputs.artValueBrightness.value);
    save();
  });
  inputs.artTint.addEventListener("input", () => {
    settings.artTint = Number(inputs.artTint.value);
    save();
  });
  inputs.paletteSpread.addEventListener("input", () => {
    settings.paletteSpread = Number(inputs.paletteSpread.value);
    save();
  });
  inputs.colorOpacity.addEventListener("input", () => {
    settings.colorOpacity = Number(inputs.colorOpacity.value);
    save();
  });
  inputs.customColor.addEventListener("input", () => {
    settings.customColor = inputs.customColor.value;
    save();
  });
  inputs.customColor2.addEventListener("input", () => {
    settings.customColor2 = inputs.customColor2.value;
    save();
  });
  inputs.customColor3.addEventListener("input", () => {
    settings.customColor3 = inputs.customColor3.value;
    save();
  });
  inputs.useColor2.addEventListener("change", () => {
    settings.useColor2 = inputs.useColor2.checked;
    save();
  });
  inputs.useColor3.addEventListener("change", () => {
    settings.useColor3 = inputs.useColor3.checked;
    save();
  });

  [["ring0", 0], ["ring1", 1], ["ring2", 2]].forEach(([key, i]) => {
    inputs[key].addEventListener("change", () => {
      settings.ringsOn[i] = inputs[key].checked;
      save();
    });
  });
  inputs.ringSpeed.addEventListener("input", () => {
    settings.ringSpeed = Number(inputs.ringSpeed.value);
    save();
  });
  inputs.ringReactivity.addEventListener("input", () => {
    settings.ringReactivity = Number(inputs.ringReactivity.value);
    save();
  });
  inputs.ringThickness.addEventListener("input", () => {
    settings.ringThickness = Number(inputs.ringThickness.value);
    save();
  });
  inputs.glowIntensity.addEventListener("input", () => {
    settings.glowIntensity = Number(inputs.glowIntensity.value);
    save();
  });
  inputs.pulseStrength.addEventListener("input", () => {
    settings.pulseStrength = Number(inputs.pulseStrength.value);
    save();
  });
  inputs.lockRotationDirection.addEventListener("change", () => {
    settings.lockRotationDirection = inputs.lockRotationDirection.checked;
    save();
  });

  inputs.barPosition.addEventListener("change", () => {
    settings.barPosition = inputs.barPosition.value;
    save();
  });
  inputs.barShape.addEventListener("change", () => {
    settings.barShape = inputs.barShape.value;
    save();
  });
  inputs.barMirrorFold.addEventListener("change", () => {
    settings.barMirrorFold = inputs.barMirrorFold.checked;
    save();
  });
  inputs.barDensity.addEventListener("input", () => {
    settings.barDensity = Number(inputs.barDensity.value);
    save();
  });
  inputs.barHeight.addEventListener("input", () => {
    settings.barHeight = Number(inputs.barHeight.value);
    save();
  });
  inputs.barSensitivity.addEventListener("input", () => {
    settings.barSensitivity = Number(inputs.barSensitivity.value);
    save();
  });

  inputs.freqBass.addEventListener("change", () => {
    settings.freqBands.bass = inputs.freqBass.checked;
    save();
  });
  inputs.freqMids.addEventListener("change", () => {
    settings.freqBands.mids = inputs.freqMids.checked;
    save();
  });
  inputs.freqTreble.addEventListener("change", () => {
    settings.freqBands.treble = inputs.freqTreble.checked;
    save();
  });

  inputs.motionOverride.addEventListener("change", () => {
    settings.motionOverride = inputs.motionOverride.value;
    save();
  });

  inputs.autoFullscreen.addEventListener("change", () => {
    settings.autoFullscreen = inputs.autoFullscreen.checked;
    save();
  });
  inputs.contextVisibility.addEventListener("change", () => {
    settings.contextVisibility = inputs.contextVisibility.value;
    save(); // applyGeneral() (called from save()) does the actual show/hide
  });
  inputs.nextVisibility.addEventListener("change", () => {
    settings.nextVisibility = inputs.nextVisibility.value;
    syncNextLeadRow();
    save();
  });
  inputs.nextLeadSeconds.addEventListener("input", () => {
    settings.nextLeadSeconds = Number(inputs.nextLeadSeconds.value);
    inputs.nextLeadSecondsBadge.textContent = `${settings.nextLeadSeconds}s`;
    save();
  });
  inputs.showDebug.addEventListener("change", () => {
    settings.showDebug = inputs.showDebug.checked;
    save();
  });
  inputs.backgroundIntensity.addEventListener("input", () => {
    settings.backgroundIntensity = Number(inputs.backgroundIntensity.value);
    save();
  });
  inputs.artShadow.addEventListener("input", () => {
    settings.artShadow = Number(inputs.artShadow.value);
    save();
  });
  inputs.marqueeScroll.addEventListener("change", () => {
    settings.marqueeScroll = inputs.marqueeScroll.checked;
    syncMarqueeRow();
    save();
    // setupMarquee() only otherwise re-runs on a track change or window
    // resize — without calling it here, toggling this looked like it did
    // nothing until one of those happened to fire next.
    setupMarquee();
  });
  inputs.marqueeSpeed.addEventListener("input", () => {
    settings.marqueeSpeed = Number(inputs.marqueeSpeed.value);
    save();
    // Just re-time whichever rows are already scrolling — no remeasuring,
    // no restarting. Doing the full setupMarquee() dance here restarted
    // every row's animation from 0% on each tick, so whichever row wasn't
    // mid-scroll at that instant looked like the speed change skipped it.
    applyMarqueeSpeed();
  });
  inputs.marqueeStyle.addEventListener("change", () => {
    settings.marqueeStyle = inputs.marqueeStyle.value;
    save();
    // Switching styles changes the DOM (the ticker clones the text; bounce
    // doesn't), so this needs the full rebuild, not just a re-time.
    setupMarquee();
  });
  inputs.metaTextScale.addEventListener("input", () => {
    settings.metaTextScale = Number(inputs.metaTextScale.value);
    save();
    // The title/artist/album boxes' scroll-vs-fits measurement depends on
    // the rendered font size, so a text-size change has to re-trigger it
    // too — otherwise a bigger font could overflow a box that was only
    // ever measured (and clipped via overflow:hidden) at the old size.
    // Debounced (see below) rather than called on every drag tick.
    debouncedSetupMarquee();
  });

  // Keeps every slider's blue fill following the thumb while dragging.
  // Delegated and separate from each setting's own "input" listener above,
  // so this doesn't have to be repeated in (or risk drifting from) each one.
  panel.addEventListener("input", (e) => {
    if (e.target.matches('input[type="range"]')) updateRangeFill(e.target);
  });

  panel.querySelector(".fsp-set-reset")?.addEventListener("click", () => {
    settings = { ...DEFAULTS, ringsOn: [...DEFAULTS.ringsOn], freqBands: { ...DEFAULTS.freqBands } };
    save();
    paintInputs();
    setupMarquee();
  });

  // Two tabs (General / Visualizer) sharing one panel — just toggling which
  // pane has `hidden` set and which tab button carries the active look.
  // Panes/tabs are matched by the same data-tab / data-pane string rather
  // than by position, so reordering either doesn't desync them.
  panel.querySelectorAll(".fsp-set-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      panel.querySelectorAll(".fsp-set-tab").forEach((t) => {
        t.classList.toggle("fsp-set-tab-active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      panel.querySelectorAll(".fsp-set-pane").forEach((pane) => {
        pane.hidden = pane.dataset.pane !== name;
      });
    });
  });

  paintInputs();
}

function isPanelOpen() {
  return !!wrap?.classList.contains("fsp-panel-open");
}
function openPanel() { wrap?.classList.add("fsp-panel-open"); }
function closePanel() {
  wrap?.classList.remove("fsp-panel-open");
  // The listbox lives on <body>, not inside the panel (see enhanceSelect),
  // so it wouldn't otherwise be hidden along with the rest of the panel.
  closeAllSelectLists();
}

el.gearBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  isPanelOpen() ? closePanel() : openPanel();
});

// Clicking the panel itself shouldn't close it (it's inside `wrap`, so a
// plain outside-click check below already handles that), but stop clicks
// on interactive controls from bubbling anywhere that might interpret
// them as something else (e.g. a seek/drag surface underneath).
panel?.addEventListener("click", (e) => e.stopPropagation());

document.addEventListener("click", (e) => {
  if (isPanelOpen() && !wrap.contains(e.target)) closePanel();
});

// Capture phase, so this runs (and can fully stop the event) before the
// bubble-phase Escape handler in index.js that closes the whole fullscreen
// view — Escape should back out of the settings panel first, not both at
// once.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && isPanelOpen()) {
      e.stopImmediatePropagation();
      closePanel();
    }
  },
  true
);
