// fullscreenPlayer.js — fullscreen now-playing view for Spicetify
//
// Artwork left with a live ring visualizer, blurred artwork backdrop,
// context label, vertical volume, up-next card. Right half is deliberately
// left empty for lyrics later.
//
// Reactivity comes from the local audio bridge (ws://127.0.0.1:8787), which
// FFTs Spotify's own output. Without it the rings fall back to ambient motion.
//
// Install:
//   copy to %appdata%\spicetify\Extensions\
//   spicetify config extensions fullscreenPlayer.js
//   spicetify apply
//
// Open with the topbar button or Ctrl+Shift+F. Esc closes.
(() => {
  // src/config.js
  var VERSION = "2026.09.20-settings43";
  var PROXY = "http://127.0.0.1:8787";

  // src/state.js
  var S = {
    N: 12,
    // band count, set by the bridge
    liveBands: new Array(12).fill(0.3),
    liveEnergy: 0.3,
    bands: new Array(12).fill(0.3),
    bandVel: new Array(12).fill(0),
    energy: 0.3,
    energyVel: 0,
    pulse: 0,
    accent: "#ffffff",
    palette: null,
    // colours sampled from the current artwork
    rotation: 0,
    artSize: 300
  };
  function resizeBands(n) {
    if (n === S.N) return;
    S.N = n;
    S.bands = new Array(S.N).fill(0.3);
    S.bandVel = new Array(S.N).fill(0);
  }

  // src/styles.js
  var CSS = `
  /* Spotify's own page never sets this, so without it every padded/bordered
     box in here (a select button, say: padding + a 1px border, at
     width:100%) renders a few pixels WIDER than its container instead of
     fitting inside it \u2014 content-box adds padding/border on top of the
     width instead of eating into it. That was quietly pushing the whole
     settings panel a hair past its own edge, wide enough to force a
     horizontal scrollbar the full height of the panel body on every tab
     (it's a shared container, not something either tab does on its own).
     Scoped to .fsp-root's own subtree so it can't affect the rest of
     Spotify's UI underneath it. */
  .fsp-root, .fsp-root * { box-sizing: border-box; }

  .fsp-root {
    position: fixed; inset: 0; z-index: 10000;
    display: none;
    background: var(--fsp-bg, #14161c);
    color: #fff;
    font-family: var(--font-family, CircularSp, "Helvetica Neue", sans-serif);
    opacity: 0; transition: opacity .3s ease;
    overflow: hidden;
  }
  .fsp-root.fsp-open  { display: block; }
  .fsp-root.fsp-shown { opacity: 1; }
  /* Idle hides the cursor entirely \u2014 meant for real OS fullscreen, where
     there's nothing left to click anyway. In windowed mode it was doing
     the same thing and quietly working against dragging the window: with
     no visible cursor, the first grab attempt after being idle for a
     couple seconds is aimed blind, and if it lands a few pixels off the
     drag strip it just silently fails with no feedback \u2014 which reads as
     "sometimes it lets me grab it, sometimes it doesn't" even though
     nothing is actually random about it. Scoped to real fullscreen only. */
  .fsp-root.fsp-fs.fsp-idle { cursor: none; }
  .fsp-root.fsp-idle .fsp-chrome { opacity: 0; }

  /* Window dragging: the overlay covers Spotify's drag region, so put it back.
     Spotify's own minimise/maximise/close draw above the page in the top-right,
     so that corner is kept clear. Taller than the "Playing from" card alone
     (which was the whole visible target before) so there's real margin for
     error above/around it \u2014 anything actually clickable in this band (the
     gear button, once the panel's open) stays reachable regardless, since
     a no-drag element always wins over a draggable ancestor region behind
     it for its own bounds. */
  .fsp-drag { position: absolute; top: 0; left: 0; right: 180px; height: 90px; -webkit-app-region: drag; }
  .fsp-root button, .fsp-root .fsp-hit { -webkit-app-region: no-drag; }
  /* The "Playing from" label sits on top of .fsp-drag (same top-left
     corner) but, being a plain div with no app-region of its own, it
     was treated as non-draggable and silently ate drag attempts made
     over it \u2014 grabbing the window there did nothing. */
  .fsp-context, .fsp-context * { -webkit-app-region: drag; }

  /* Track-specific visual sits behind the blurred cover: artist imagery,
     when it's available. */
  .fsp-backdrop {
    position: absolute; inset: -6%;
    background-size: cover; background-position: center;
    opacity: 0; filter: saturate(115%);
    transition: opacity 1.2s ease;
    animation: fsp-drift 42s ease-in-out infinite alternate;
  }
  .fsp-backdrop.fsp-on { opacity: calc(.42 * var(--fsp-bg-intensity, 1)); }
  @keyframes fsp-drift {
    from { transform: scale(1.04) translate3d(0, 0, 0); }
    to   { transform: scale(1.14) translate3d(-2%, -1.5%, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .fsp-backdrop { animation: none; } }

  /* --- backdrop --- */
  .fsp-root.fsp-hasvisual .fsp-wash { opacity: calc(.22 * var(--fsp-bg-intensity, 1)); }
  .fsp-wash {
    position: absolute; inset: -15%;
    background-size: cover; background-position: center;
    filter: blur(90px) saturate(180%);
    opacity: calc(.5 * var(--fsp-bg-intensity, 1)); transform: scale(1.15);
    transition: background-image .7s ease;
  }
  .fsp-tint {
    position: absolute; inset: 0;
    background:
      radial-gradient(120% 90% at 22% 50%, rgba(0,0,0,.30), rgba(0,0,0,.72) 70%),
      linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,.15) 40%, rgba(0,0,0,.55));
  }

  /* Full-width spectrum along the top and bottom edges. */
  .fsp-spectrum {
    position: absolute; inset: 0; width: 100%; height: 100%;
    pointer-events: none; z-index: 1;
  }

  /* --- chrome (fades when idle) --- */
  .fsp-chrome { transition: opacity .35s ease; }

  /* Faded independently of .fsp-chrome (see the DOM comment on why it's a
     sibling, not a child) so the "always shown" setting can hold this at
     opacity:1 without also having to fight .fsp-chrome's own idle fade. */
  .fsp-context {
    position: absolute; top: 14px; left: 16px; z-index: 4;
    display: flex; align-items: center; gap: 12px;
    padding: 8px 16px 8px 8px; border-radius: 6px;
    background: rgba(0,0,0,.42);
    backdrop-filter: blur(12px);
    max-width: 320px;
    opacity: 1;
    transition: opacity .35s ease;
  }
  .fsp-root.fsp-idle .fsp-context:not(.fsp-force-show) {
    opacity: 0; pointer-events: none;
  }
  .fsp-context-icon {
    width: 46px; height: 46px; border-radius: 3px; flex: none;
    display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,.1);
  }
  .fsp-context-icon svg { width: 17px; height: 17px; fill: rgba(255,255,255,.75); flex: none; }
  .fsp-context-text { min-width: 0; }
  .fsp-context-kind {
    font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
    color: rgba(255,255,255,.55);
  }
  .fsp-context-name {
    font-size: 13px; font-weight: 600; margin-top: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .fsp-next {
    position: absolute; top: 14px; right: 200px; z-index: 4;
    opacity: 0; pointer-events: none;
    transform: translateY(-6px);
    transition: opacity .45s ease, transform .45s ease;
    display: flex; align-items: center; gap: 12px;
    padding: 8px 16px 8px 8px; border-radius: 6px;
    background: rgba(0,0,0,.42);
    backdrop-filter: blur(12px);
    max-width: 320px;
  }
  .fsp-next[hidden] { display: none; }
  /* Only shown in the closing seconds of a track. */
  .fsp-next.fsp-soon { opacity: 1; transform: none; }
  /* In real fullscreen there's no window chrome to avoid, so go to the corner. */
  .fsp-root.fsp-fs .fsp-next { right: 16px; }
  .fsp-root.fsp-fs .fsp-drag { right: 0; }
  .fsp-next img { width: 46px; height: 46px; border-radius: 3px; object-fit: cover; flex: none; }
  .fsp-next-kind {
    font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
    color: rgba(255,255,255,.55);
  }
  .fsp-next-title {
    font-size: 13px; font-weight: 600; margin-top: 3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* --- vertical volume, left edge --- */
  .fsp-volume {
    /* Vertically centred on the artwork, not the window: --fsp-stage-top
       is the same value the artwork/rings column centres on, recomputed
       on every resize, so this tracks it instead of drifting apart at
       aspect ratios where the stage isn't near screen-center. */
    position: absolute; left: var(--fsp-vol-left, 26px); top: var(--fsp-stage-top, 50%); transform: translateY(-50%);
    z-index: 4;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    color: rgba(255,255,255,.6);
    transition: opacity .35s ease, color .15s ease;
  }
  .fsp-volume:hover { color: rgba(255,255,255,.95); }
  /* Fixed width regardless of digit count ("0%" vs "70%" vs "100%") \u2014 this
     box is positioned by its left edge but sizes to content by default, so
     without a fixed width here, muting (which shortens the text) shrank
     the box from the right and dragged its centered children \u2014 the track,
     the knob \u2014 left along with it. Same fix applied to the lyric-scale
     slider's percentage below, for the same reason. */
  .fsp-vol-pct { font-size: 11px; font-variant-numeric: tabular-nums; width: 30px; text-align: center; }
  .fsp-vol-track {
    position: relative; width: 4px; height: 92px;
    border-radius: 3px; background: rgba(255,255,255,.18);
    cursor: pointer;
  }
  .fsp-vol-track::before { content: ""; position: absolute; inset: -6px -14px; }
  .fsp-vol-fill {
    position: absolute; left: 0; right: 0; bottom: 0;
    border-radius: 3px; background: currentColor; height: 70%;
  }
  .fsp-vol-knob {
    position: absolute; left: 50%; bottom: 70%;
    width: 10px; height: 10px; margin: 0 0 -5px -5px;
    border-radius: 50%; background: #fff;
    opacity: 0; transition: opacity .15s ease;
  }
  .fsp-volume:hover .fsp-vol-knob { opacity: 1; }
  .fsp-mute { background: none; border: 0; padding: 0; color: inherit; cursor: pointer; }
  .fsp-mute svg { width: 15px; height: 15px; fill: currentColor; display: block; }

  /* --- visualizer settings: gear + popout, top-left of the artwork,
     directly above the volume slider (same left offset, so the two line
     up the same way the volume/lyric sliders mirror each other). --- */
  .fsp-settings {
    position: absolute; left: var(--fsp-vol-left, 26px); top: var(--fsp-gear-top, 40px);
    z-index: 5;
    color: rgba(255,255,255,.55);
    opacity: 0; transition: opacity .3s ease, color .15s ease;
  }
  .fsp-root:not(.fsp-idle) .fsp-settings { opacity: 1; }
  /* Stay visible while the panel is open even if the mouse goes idle \u2014
     otherwise adjusting a slider and then pausing to look at the result
     would fade the whole panel out from under the cursor. */
  .fsp-settings.fsp-panel-open { opacity: 1 !important; }
  .fsp-settings:hover { color: rgba(255,255,255,.95); }
  .fsp-gear { background: none; border: 0; padding: 2px; color: inherit; cursor: pointer; display: block; }
  /* Sized a bit larger than the volume/lyric icons (15px) so a plain gear
     glyph doesn't read as noticeably smaller than its neighbors. */
  .fsp-gear > svg { width: 21px; height: 21px; fill: currentColor; display: block; transition: transform .3s ease; }
  .fsp-settings.fsp-panel-open .fsp-gear > svg { transform: rotate(35deg); }

  /* --- panel: "liquid glass" \u2014 a frosted, saturated blur behind a very
     translucent tinted layer, a soft bright hairline along the top/left
     edge standing in for a specular highlight, and a big soft drop shadow
     so it reads as sitting above the page rather than painted onto it. --- */
  .fsp-settings-panel {
    position: absolute; top: 30px; left: 0;
    width: 300px; max-height: 74vh;
    display: flex; flex-direction: column;
    background:
      linear-gradient(155deg, rgba(255,255,255,.14), rgba(255,255,255,.03) 40%, rgba(255,255,255,.05) 100%),
      rgba(30,30,36,.55);
    backdrop-filter: blur(30px) saturate(190%);
    -webkit-backdrop-filter: blur(30px) saturate(190%);
    border: 1px solid rgba(255,255,255,.16);
    border-radius: 20px;
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,.35),
      inset 0 0 0 1px rgba(255,255,255,.04),
      0 24px 60px rgba(0,0,0,.5);
    color: rgba(255,255,255,.9); font-size: 12px;
    opacity: 0; visibility: hidden; transform: translateY(-4px) scale(.98);
    transition: opacity .18s ease, transform .18s ease, visibility 0s linear .18s;
    -webkit-app-region: no-drag;
    overflow: hidden;
  }
  .fsp-settings.fsp-panel-open .fsp-settings-panel {
    opacity: 1; visibility: visible; transform: translateY(0) scale(1);
    transition: opacity .18s ease, transform .18s ease;
  }

  /* iOS-style segmented control for the two tabs. */
  .fsp-set-tabs {
    display: flex; gap: 2px; margin: 12px 12px 0; padding: 2px;
    background: rgba(0,0,0,.25); border-radius: 10px; flex: none;
  }
  .fsp-set-tab {
    flex: 1; padding: 6px 0; border: 0; border-radius: 8px;
    background: none; color: rgba(255,255,255,.55);
    font-size: 12px; font-weight: 600; cursor: pointer;
    transition: background .15s ease, color .15s ease;
  }
  .fsp-set-tab-active {
    background: rgba(255,255,255,.16); color: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.3);
  }

  .fsp-set-body { overflow-y: auto; overflow-x: hidden; padding: 12px; }
  .fsp-set-pane[hidden] { display: none; }

  .fsp-settings-title {
    font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
    color: rgba(255,255,255,.45); margin: 16px 2px 6px;
  }
  .fsp-settings-title:first-child { margin-top: 0; }

  /* iOS-style grouped card: rounded rect, hairline dividers between rows
     instead of gaps, no divider under the last row. */
  .fsp-set-group {
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.08);
    border-radius: 12px; overflow: hidden;
  }
  .fsp-set-group .fsp-set-row {
    margin: 0; padding: 9px 12px;
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .fsp-set-group .fsp-set-row:last-child { border-bottom: 0; }

  .fsp-set-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .fsp-set-row label { font-size: 12px; color: rgba(255,255,255,.85); display: flex; align-items: center; gap: 6px; }
  .fsp-set-row select, .fsp-set-row input[type="range"] { width: 100%; }
  /* A slider row whose current value is worth seeing at a glance without
     dragging it \u2014 label left, live value pill right, same row. */
  .fsp-set-row-head { display: flex; align-items: center; justify-content: space-between; }
  .fsp-set-badge {
    font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
    color: rgba(255,255,255,.9);
    background: rgba(10,132,255,.22); border: 1px solid rgba(10,132,255,.4);
    border-radius: 999px; padding: 2px 8px; flex: none;
  }
  .fsp-set-row input[type="color"] {
    width: 100%; height: 24px; border: 0; background: none; padding: 0; margin-top: 2px;
  }
  /* Boolean settings: label left, iOS switch right, single line. */
  .fsp-set-toggle-row {
    flex-direction: row; align-items: center; justify-content: space-between; gap: 10px;
  }
  .fsp-set-toggle-row label { flex: 1; }
  /* Three small toggles side by side ("1"/"2"/"3"), sitting where a single
     switch normally would in a toggle row. */
  .fsp-set-rings-toggles { display: flex; align-items: center; gap: 14px; flex: none; }
  .fsp-ring-toggle {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: rgba(255,255,255,.85); flex: none;
  }
  .fsp-ring-toggle .fsp-toggle { width: 30px; height: 18px; }
  .fsp-ring-toggle .fsp-toggle::before { width: 14px; height: 14px; }
  .fsp-ring-toggle .fsp-toggle:checked::before { transform: translateX(12px); }

  /* --- iOS-style switch, built from a plain checkbox --- */
  .fsp-toggle {
    -webkit-appearance: none; appearance: none;
    width: 38px; height: 22px; flex: none;
    background: rgba(120,120,128,.5);
    border-radius: 999px; position: relative;
    cursor: pointer; transition: background .18s ease;
  }
  .fsp-toggle::before {
    content: ""; position: absolute; top: 2px; left: 2px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.4);
    transition: transform .18s ease;
  }
  .fsp-toggle:checked { background: #34c759; }
  .fsp-toggle:checked::before { transform: translateX(16px); }

  /* --- iOS-style slider: a two-tone track (filled blue up to the thumb,
     dim gray past it) and a white round thumb. --fsp-range-fill is kept in
     sync with the input's own value by settings.js on "input" and whenever
     a value is painted in from stored settings, since a native range input
     has no built-in concept of "how full" to render \u2014 the gradient split
     point has to be pushed in from JS as a percentage. */
  .fsp-set-row input[type="range"] {
    -webkit-appearance: none; appearance: none;
    height: 20px; background: none; cursor: pointer; margin: 0;
    --fsp-range-fill: 50%;
  }
  .fsp-set-row input[type="range"]::-webkit-slider-runnable-track {
    height: 4px; border-radius: 2px;
    background: linear-gradient(
      to right,
      #0a84ff var(--fsp-range-fill, 50%),
      rgba(255,255,255,.22) var(--fsp-range-fill, 50%)
    );
  }
  .fsp-set-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; margin-top: -7px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.45);
  }

  /* The real <select> stays in the DOM as the source of truth (settings.js
     still reads/writes .value and listens for "change" on it) but is never
     shown \u2014 its native dropdown popup is an OS-level overlay that CSS can
     restyle only partially (the closed box, the option background) and
     can't touch at all where it matters most: Chromium always paints the
     hovered/selected option in the system's own blue, no matter what
     background/color is set on it. A fully custom listbox (built below by
     enhanceSelect()) replaces it for anyone who isn't using a screen
     reader that specifically expects a native control. */
  .fsp-native-select-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); border: 0;
  }

  .fsp-select-wrap { position: relative; width: 100%; }
  .fsp-select-btn {
    width: 100%; display: flex; align-items: center; justify-content: space-between;
    background: rgba(255,255,255,.08); color: inherit;
    border: 1px solid rgba(255,255,255,.14); border-radius: 8px;
    padding: 6px 10px; font-size: 12px; cursor: pointer;
  }
  .fsp-select-open .fsp-select-btn {
    border-color: rgba(10,132,255,.6); background: rgba(255,255,255,.12);
  }
  .fsp-select-chevron { display: flex; color: rgba(255,255,255,.5); transition: transform .15s ease; flex: none; }
  .fsp-select-open .fsp-select-chevron { transform: rotate(180deg); }

  /* Positioned in JS (enhanceSelect's position()) against the button's
     actual screen coordinates, not against .fsp-select-wrap \u2014 it's
     portaled onto <body> so it isn't clipped by the panel's own rounded
     corners or its scrollable body. position: fixed so those JS-set
     left/top/bottom coordinates read as viewport coordinates, matching
     what getBoundingClientRect() gave them.

     Living on <body> also makes it a *sibling* of .fsp-root (the whole
     fullscreen overlay), not a descendant \u2014 so it no longer inherits
     .fsp-root's stacking context and its z-index has to out-rank
     .fsp-root's own (10000) directly, not just other things inside the
     panel. Left at a panel-local value (30) it was legitimately being
     painted UNDER the fullscreen view and covered up entirely: the list
     opened (state-wise) but was invisible and unclickable, which is why
     every dropdown looked broken. */
  .fsp-select-list {
    position: fixed; z-index: 10050;
    background: rgba(40,40,46,.85);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255,255,255,.16); border-radius: 12px;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.25), 0 12px 30px rgba(0,0,0,.5);
    padding: 4px; max-height: 220px; overflow-y: auto;
  }
  .fsp-select-item {
    padding: 7px 10px; border-radius: 8px; font-size: 12px;
    color: rgba(255,255,255,.85); cursor: pointer;
  }
  .fsp-select-item:hover { background: rgba(255,255,255,.1); }
  .fsp-select-item-active { background: #0a84ff; color: #fff; }
  .fsp-select-item-active:hover { background: #0a84ff; }

  .fsp-set-reset {
    width: calc(100% - 24px); margin: 4px 12px 12px; padding: 10px 0;
    border-radius: 12px; flex: none;
    border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.06);
    color: #ff6b6b; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .fsp-set-reset:hover { background: rgba(255,255,255,.1); }
  @media (max-width: 720px) { .fsp-settings { display: none; } }

  /* --- left column: art, rings, meta, transport --- */
  /* Player occupies the left; the right half is left free for lyrics. */
  .fsp-stage {
    position: absolute; top: var(--fsp-stage-top, 50%); left: 0;
    width: 50vw; max-width: 780px;
    transform: translateY(-50%);
    display: flex; justify-content: center;
    pointer-events: none;          /* box overlaps the volume control */
  }
  .fsp-column {
    position: relative;
    display: flex; flex-direction: column; align-items: center;
    gap: 10px; flex: none; max-width: 100%;
    pointer-events: auto;
  }
  .fsp-canvas-wrap { position: relative; display: grid; place-items: center; }
  .fsp-canvas { position: absolute; inset: 0; pointer-events: none; }
  .fsp-art {
    position: relative;
    width: var(--fsp-art, 300px); height: var(--fsp-art, 300px);
    border-radius: 3px; object-fit: cover;
    box-shadow: 0 calc(26px * var(--fsp-art-shadow, 1)) calc(60px * var(--fsp-art-shadow, 1))
                rgb(0 0 0 / calc(.62 * var(--fsp-art-shadow, 1)));
  }

  /* Transport hides unless the mouse is moving. */
  .fsp-transport {
    /* Higher than .fsp-lyrics (z-index: 2) on purpose: the lyrics panel
       spans the full window height (top:0; bottom:0), not just wherever
       its visible text happens to sit \u2014 the mask-image only fades the
       paint, it doesn't shrink the hit box. On any window narrow enough
       that the transport's buttons cross into the panel's left edge
       (50vw), the panel was winning clicks there even though the
       transport comes later in the DOM at the same z-index, so prev/
       play/next/repeat looked dead while heart/shuffle (further left,
       clear of the overlap) kept working. Same reasoning applies to
       .fsp-meta below. */
    position: relative; z-index: 3;
    margin-top: calc(-1 * var(--fsp-band, 0px) + 10px);
    text-shadow: 0 2px 10px rgba(0,0,0,.75);
    display: flex; flex-direction: column; gap: 9px;
    width: var(--fsp-art, 300px);
    /* The six transport buttons plus their gaps need ~210px of min-content
       width to avoid overlapping each other. --fsp-art can clamp smaller
       than that in a short/square window, and without a floor here the
       grid below doesn't shrink the icons (they're fixed size) \u2014 it just
       lets them spill past the container's edge and pile on top of one
       another, which looked like "the controls stopped working" because
       clicks landed on the wrong overlapping button. */
    min-width: 210px;
    opacity: 1; transition: opacity .3s ease;
  }
  .fsp-root.fsp-idle .fsp-transport { opacity: 0; pointer-events: none; }

  .fsp-meta {
    position: absolute; left: 30px; bottom: 26px; z-index: 3;
    max-width: min(42vw, 430px); width: max-content; min-width: 0;
    text-align: left;
    text-shadow: 0 2px 14px rgba(0,0,0,.85), 0 1px 3px rgba(0,0,0,.9);
  }
  .fsp-row {
    display: flex; align-items: center; gap: 8px;
    min-width: 0;
  }
  .fsp-row svg {
    width: 15px; height: 15px; flex: none;
    fill: rgba(255,255,255,.5);
  }
  .fsp-row-title svg { width: 22px; height: 22px; fill: rgba(255,255,255,.9); }
  /* Each row stays on one line; overflowing text scrolls instead of wrapping. */
  .fsp-row h1, .fsp-row > span {
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    line-height: 1.2;
  }
  /* flex: 1 forces this to always claim the row's full remaining width
     (icon aside), rather than shrinking to fit its own text. Without it,
     a short-enough line just sizes the box around itself, so scrollWidth
     and clientWidth come out equal (or a hair apart) and overflow is
     never detected \u2014 which is why only the row that happens to force the
     title container to its max-width (usually the title) ever measured
     as overflowing, and every other row silently never scrolled. */
  .fsp-scroll { overflow: hidden; min-width: 0; flex: 1 1 auto; }
  /* .fsp-mqtrack wraps the actual title/artist/album element and, only in
     ticker mode, a second cloned copy right after it \u2014 inline-flex keeps
     both copies sitting side by side on one line. This is the element the
     scroll animation itself moves; the title/artist/album element inside
     it never gets recreated. */
  .fsp-mqtrack { display: inline-flex; align-items: baseline; }
  .fsp-scroll.fsp-marquee-bounce .fsp-mqtrack > *,
  .fsp-scroll.fsp-marquee-ticker .fsp-mqtrack > * { text-overflow: clip; }
  .fsp-scroll.fsp-marquee-bounce .fsp-mqtrack {
    animation: fsp-marquee-bounce var(--fsp-marquee-time, 12s) linear infinite;
  }
  /* Scrolls exactly one copy-width, so the instant the first copy scrolls
     fully out of view the trailing clone is sitting exactly where the
     first one started \u2014 a loop with no reset to notice, unlike bounce's
     deliberate snap. */
  .fsp-scroll.fsp-marquee-ticker .fsp-mqtrack {
    animation: fsp-marquee-ticker var(--fsp-marquee-time, 12s) linear infinite;
  }
  @keyframes fsp-marquee-bounce {
    0%, 12%   { transform: translateX(0); }
    88%, 100% { transform: translateX(var(--fsp-marquee-shift, 0px)); }
  }
  @keyframes fsp-marquee-ticker {
    0%   { transform: translateX(0); }
    100% { transform: translateX(var(--fsp-marquee-shift, 0px)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .fsp-scroll.fsp-marquee-bounce .fsp-mqtrack,
    .fsp-scroll.fsp-marquee-ticker .fsp-mqtrack { animation: none; }
    .fsp-scroll > * { text-overflow: ellipsis; }
  }
  .fsp-row-album span {
    color: rgba(255,255,255,.5);
    font-size: calc(clamp(13px, 1.9vh, 17px) * var(--fsp-meta-scale, 1));
    white-space: nowrap;
    display: inline-block;
  }
  .fsp-title {
    margin: 0; font-weight: 800; letter-spacing: -.015em;
    font-size: calc(clamp(24px, 4.6vh, 46px) * var(--fsp-meta-scale, 1));
    white-space: nowrap;
  }
  .fsp-artist {
    margin: 0; color: rgba(255,255,255,.65);
    font-size: calc(clamp(15px, 2.4vh, 22px) * var(--fsp-meta-scale, 1));
    white-space: nowrap;
    display: inline-block;
  }

  .fsp-bar {
    width: var(--fsp-art, 300px);
    min-width: 210px;   /* stay the same width as .fsp-controls above it */
    display: flex; align-items: center; gap: 11px;
  }
  .fsp-bar .fsp-track { flex: 1; }
  .fsp-elapsed, .fsp-remain {
    font-size: 12px; font-variant-numeric: tabular-nums;
    color: rgba(255,255,255,.55); flex: none; min-width: 34px;
  }
  .fsp-remain { text-align: right; }
  .fsp-track {
    position: relative; height: 4px; border-radius: 3px;
    min-width: 40px;
    background: rgba(255,255,255,.2); cursor: pointer;
  }
  .fsp-track::before { content: ""; position: absolute; inset: -9px 0; }
  .fsp-fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    border-radius: 2px; background: #fff; width: 0;
  }
  .fsp-knob {
    position: absolute; top: 50%; left: 0;
    width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px;
    border-radius: 50%; background: #fff;
    opacity: 0; transition: opacity .15s ease;
  }
  .fsp-track:hover .fsp-knob { opacity: 1; }
  .fsp-controls {
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    width: var(--fsp-art, 300px);
    min-width: 210px;
  }
  /* Nudge the edge toggles so they sit directly over the time labels below,
     which are inset by the same amount. */
  .fsp-ctl-side { margin-left: -5px; }
  .fsp-ctl-right { margin-left: 0; margin-right: -5px; }
  .fsp-ctl-side { display: flex; align-items: center; gap: 10px; }
  .fsp-ctl-right { justify-content: flex-end; }
  .fsp-ctl-main { display: flex; align-items: center; gap: 10px; }

  .fsp-btn {
    position: relative;
    display: grid; place-items: center;
    width: 24px; height: 24px; padding: 0;
    border: 0; border-radius: 50%;
    background: transparent; color: rgba(255,255,255,.78);
    cursor: pointer; transition: color .15s ease, transform .12s ease;
  }
  .fsp-btn:hover { color: #fff; transform: scale(1.12); }
  .fsp-btn:active { transform: scale(.94); }
  .fsp-btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .fsp-btn svg { width: 13px; height: 13px; fill: currentColor; display: block; }

  .fsp-btn.fsp-small { width: 24px; height: 24px; color: rgba(255,255,255,.5); }
  .fsp-btn.fsp-small svg { width: 12px; height: 12px; }
  .fsp-btn.fsp-small:hover { color: rgba(255,255,255,.95); }
  /* Active toggles take the artwork's accent, with a dot beneath like Spotify's */
  .fsp-btn.fsp-on { color: var(--fsp-accent, #1ed760); }
  .fsp-btn.fsp-on::after {
    content: ""; position: absolute; bottom: 0; left: 50%; margin-left: -1.5px;
    width: 3px; height: 3px; border-radius: 50%;
    background: currentColor;
  }
  .fsp-btn.fsp-heart.fsp-on { color: #ff5a6e; }

  .fsp-btn.fsp-play { width: 26px; height: 26px; color: #fff; }
  .fsp-btn.fsp-play svg { width: 16px; height: 16px; }

  .fsp-close {
    position: absolute; bottom: 22px; right: 26px; z-index: 4;
    width: 34px; height: 34px; border: 0; border-radius: 50%;
    background: rgba(255,255,255,.1); color: rgba(255,255,255,.7);
    cursor: pointer; transition: opacity .35s ease, background .15s ease;
  }
  .fsp-close:hover { background: rgba(255,255,255,.2); color: #fff; }
  .fsp-close svg { width: 14px; height: 14px; fill: currentColor; }

  /* Lyrics fill the right half, scrolling to keep the current line centred. */
  .fsp-lyrics {
    position: absolute; top: 0; bottom: 0;
    left: 50vw; right: 4vw; z-index: 2;
    display: flex; align-items: center;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent);
            mask-image: linear-gradient(180deg, transparent, #000 16%, #000 84%, transparent);
    /* This box spans the full window height, and raising the transport's
       z-index above it (see .fsp-transport) turned out not to reliably
       win clicks in this host's renderer regardless \u2014 the panel kept
       eating clicks meant for prev/play/next/repeat whenever they fell
       within its left/right span, even outside the panel's actual
       visible text. Rather than continue fighting over stacking order,
       make the panel's empty space pass clicks through by default; only
       the individual word/dot spans opt back in (see wireHit in
       view.js), so nothing but the actual lyric text is ever clickable. */
    pointer-events: none;
  }
  .fsp-lyrics[hidden] { display: none; }
  .fsp-lyrics-inner {
    width: 100%;
    will-change: transform;   /* driven by a spring in JS, not a transition */
  }
  .fsp-line {
    padding: calc(9px * var(--fsp-lyric-scale, 1)) 0;
    font-size: calc(clamp(18px, 3.1vh, 32px) * var(--fsp-lyric-scale, 1));
    overflow-wrap: anywhere;      /* never let a long word push off screen */
    font-weight: 700; line-height: 1.24;
    color: rgba(255,255,255,.32);
    text-align: right;
    transition: color .3s ease, opacity .3s ease, filter .3s ease;
    filter: blur(.6px);
  }
  .fsp-line:hover { color: rgba(255,255,255,.55); }

  /* Only the current line and the next few are visible. */
  .fsp-line { opacity: 0; transition: opacity .18s ease, color .12s ease, filter .18s ease; }
  .fsp-line.fsp-active { opacity: 1; filter: none; color: rgba(255,255,255,.34); }
  .fsp-line.fsp-n1 { opacity: .55; }
  .fsp-line.fsp-n2 { opacity: .3; }
  .fsp-line.fsp-n3 { opacity: .14; }

  /* Syllables: lit as they are reached, with a glow that swells and fades
     and a small rise, both driven per-frame from the syllable's own timing. */
  .fsp-w {
    display: inline-block;
    white-space: pre;          /* keep the spaces the provider sends */
    will-change: transform, text-shadow;
    transition: color .04s linear;
  }
  .fsp-line.fsp-active .fsp-w.fsp-said { color: #fff; }
  /* A syllable brightens as it is reached; the glow below carries the sweep. */
  .fsp-line.fsp-active .fsp-w { background: none; }
  /* Instrumental gaps get three filling dots instead of a blank screen. */
  .fsp-line.fsp-dots { display: flex; justify-content: flex-end; gap: 10px; }
  .fsp-dot {
    width: 11px; height: 11px; border-radius: 50%;
    background: rgba(255,255,255,.22);
    transform-origin: center;
    transition: background .25s ease;
  }

  /* Lyric size: mirrors the volume slider, sitting just right of the artwork. */
  .fsp-lyric-size {
    /* Centred on the artwork exactly like the volume slider (see its
       comment), so the two line up regardless of window aspect ratio.
       Horizontal position is measured from the artwork's right edge. */
    position: absolute; top: var(--fsp-stage-top, 50%); left: var(--fsp-lsz-left, 60%);
    transform: translateY(-50%);
    z-index: 4;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    color: rgba(255,255,255,.55);
    opacity: 0; transition: opacity .3s ease, color .15s ease;
    pointer-events: auto;
  }
  .fsp-root:not(.fsp-idle) .fsp-lyric-size { opacity: 1; }
  .fsp-lyric-size:hover { color: rgba(255,255,255,.95); }
  .fsp-lsz-val { font-size: 11px; font-variant-numeric: tabular-nums; width: 34px; text-align: center; }
  .fsp-lsz-track {
    position: relative; width: 4px; height: 92px;
    border-radius: 3px; background: rgba(255,255,255,.18);
    cursor: pointer;
  }
  .fsp-lsz-track::before { content: ""; position: absolute; inset: -6px -14px; }
  .fsp-lsz-fill {
    position: absolute; left: 0; right: 0; bottom: 0;
    border-radius: 3px; background: currentColor; height: 30%;
  }
  .fsp-lsz-knob {
    position: absolute; left: 50%; bottom: 30%;
    width: 10px; height: 10px; margin: 0 0 -5px -5px;
    border-radius: 50%; background: #fff;
    opacity: 0; transition: opacity .15s ease;
  }
  /* Only applied for the on/off toggle (see toggleLyricsVisible), not
     while manually dragging the slider \u2014 a transition there would make
     dragging feel laggy, chasing the cursor instead of tracking it. */
  .fsp-lsz-fill.fsp-anim { transition: height .25s ease; }
  .fsp-lsz-knob.fsp-anim { transition: opacity .15s ease, bottom .25s ease; }
  .fsp-lyric-size:hover .fsp-lsz-knob { opacity: 1; }
  /* Now an inline SVG using currentColor, exactly like .fsp-mute \u2014 so it
     inherits .fsp-lyric-size's color/hover directly (rgba(255,255,255,.55)
     \u2192 .95 on hover) the same way .fsp-mute inherits from .fsp-volume
     (rgba(255,255,255,.6) \u2192 .95). Same mechanism, not just matched
     numbers, so it can't drift out of sync again. */
  .fsp-lsz-icon { display: block; cursor: pointer; color: inherit; transition: opacity .2s ease; }
  .fsp-lsz-icon svg { width: 15px; height: 15px; fill: currentColor; display: block; }
  /* Lyrics turned off (scale at 0) via clicking this icon or dragging the
     slider down \u2014 see toggleLyricsVisible/setLyricScale in view.js. */
  .fsp-lsz-icon.fsp-off { opacity: .5; }
  @media (max-width: 720px) { .fsp-lyric-size { display: none; } }

  .fsp-lyrics-note {
    text-align: right; width: 100%;
    font-size: 13px; color: rgba(255,255,255,.3);
  }
  /* Narrow windows keep the lyrics \u2014 just tighter type and less padding.
     Only drop them when there genuinely isn't room. */
  @media (max-width: 1150px) {
    .fsp-lyrics { left: 47vw; right: 2.5vw; }
    .fsp-line { font-size: calc(clamp(15px, 2.5vh, 22px) * var(--fsp-lyric-scale, 1)); padding: calc(6px * var(--fsp-lyric-scale, 1)) 0; }
    .fsp-dot { width: 8px; height: 8px; }
  }
  @media (max-width: 900px) {
    .fsp-lyrics { left: 45vw; right: 2vw; }
    .fsp-line { font-size: calc(clamp(13px, 2.1vh, 18px) * var(--fsp-lyric-scale, 1)); padding: calc(5px * var(--fsp-lyric-scale, 1)) 0; }
  }
  @media (max-width: 720px) { .fsp-lyrics { display: none; } }
  @media (prefers-reduced-motion: reduce) {
    .fsp-lyrics-inner { transition: none; }
    .fsp-line { filter: none; }
  }

  /* Press D for a readout when devtools isn't handy. */
  .fsp-debug {
    position: absolute; right: 26px; top: 70px; z-index: 6;
    margin: 0; padding: 12px 14px; max-width: 42vw;
    border-radius: 6px; background: rgba(0,0,0,.72);
    font: 11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: rgba(255,255,255,.85); white-space: pre-wrap;
  }
  .fsp-debug[hidden] { display: none; }

  /* The Playbar.Button living in Spotify's native queue/lyrics/link row
     (see register() in index.js). Overwriting its contents with our own
     icon apparently drops whatever class made it match its transparent,
     native-sized neighbors, so this puts both back explicitly instead of
     trusting whatever's left of Spotify's own button styling. */
  .fsp-playbar-btn { background: transparent !important; }
  .fsp-playbar-btn svg { width: 20px; height: 20px; display: block; }

  @media (max-width: 820px) {
    .fsp-stage { width: 100vw; max-width: none; }
  }
  @media (prefers-reduced-motion: reduce) { .fsp-root, .fsp-wash, .fsp-btn { transition: none; } }
`;
  var style = document.createElement("style");
  style.id = "fsp-style";
  style.textContent = CSS;
  document.head.appendChild(style);

  // src/icons.js
  var GEAR_PATH = `<path d="M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z"/>`;
  var icons = {
    prev: `<svg viewBox="0 0 16 16"><path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7h1.6z"/></svg>`,
    next: `<svg viewBox="0 0 16 16"><path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-1.6z"/></svg>`,
    play: `<svg viewBox="0 0 16 16"><path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/></svg>`,
    pause: `<svg viewBox="0 0 16 16"><path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/></svg>`,
    close: `<svg viewBox="0 0 16 16"><path d="M1.47 1.47a.75.75 0 0 1 1.06 0L8 6.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L9.06 8l5.47 5.47a.75.75 0 1 1-1.06 1.06L8 9.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L6.94 8 1.47 2.53a.75.75 0 0 1 0-1.06z"/></svg>`,
    queue: `<svg viewBox="0 0 16 16"><path d="M15 15H1v-1.5h14V15zm0-4.5H1V9h14v1.5zm-14-7A2.5 2.5 0 0 1 3.5 1h9a2.5 2.5 0 0 1 0 5h-9A2.5 2.5 0 0 1 1 3.5z"/></svg>`,
    vol: `<svg viewBox="0 0 16 16"><path d="M9.7.85a.8.8 0 0 1 .4.65v13a.8.8 0 0 1-1.13.65L4.46 12H2.5A1.5 1.5 0 0 1 1 10.5v-5A1.5 1.5 0 0 1 2.5 4h1.96L8.99 1.15a.8.8 0 0 1 .71-.3zm2.33 3.65a.75.75 0 0 1 1.06 0 5 5 0 0 1 0 7.07.75.75 0 1 1-1.06-1.06 3.5 3.5 0 0 0 0-4.95.75.75 0 0 1 0-1.06z"/></svg>`,
    mute: `<svg viewBox="0 0 16 16"><path d="M9.7.85a.8.8 0 0 1 .4.65v13a.8.8 0 0 1-1.13.65L4.46 12H2.5A1.5 1.5 0 0 1 1 10.5v-5A1.5 1.5 0 0 1 2.5 4h1.96L8.99 1.15a.8.8 0 0 1 .71-.3zm2.6 4.32a.7.7 0 0 1 .99 0L14.5 6.5l1.21-1.33a.7.7 0 1 1 1 .99L15.49 7.5l1.22 1.34a.7.7 0 0 1-1 .99L14.5 8.5l-1.21 1.33a.7.7 0 1 1-1-.99L13.51 7.5l-1.22-1.34a.7.7 0 0 1 0-.99z"/></svg>`,
    heart: `<svg viewBox="0 0 16 16"><path d="M8 14.1 2.6 8.7a3.6 3.6 0 0 1 0-5.1 3.6 3.6 0 0 1 5.1 0l.3.3.3-.3a3.6 3.6 0 0 1 5.1 0 3.6 3.6 0 0 1 0 5.1L8 14.1zM4.1 4.6a2.1 2.1 0 0 0 0 3l3.9 3.9 3.9-3.9a2.1 2.1 0 0 0-3-3l-.9.9-.9-.9a2.1 2.1 0 0 0-3 0z"/></svg>`,
    heartFull: `<svg viewBox="0 0 16 16"><path d="M8 14.1 2.6 8.7a3.6 3.6 0 0 1 0-5.1 3.6 3.6 0 0 1 5.1 0l.3.3.3-.3a3.6 3.6 0 0 1 5.1 0 3.6 3.6 0 0 1 0 5.1L8 14.1z"/></svg>`,
    shuffle: `<svg viewBox="0 0 16 16"><path d="M13.15 2.2 15.6 4.3a.4.4 0 0 1 0 .6l-2.45 2.1a.4.4 0 0 1-.65-.3V5.5h-1.2c-.9 0-1.4.4-2.1 1.3l-.5.7-.95-1.25.45-.6C9.1 4.3 10 3.5 11.3 3.5h1.2V2.5a.4.4 0 0 1 .65-.3zM1 4.25h2c1.3 0 2.2.8 3.1 2l3 4c.7.9 1.2 1.3 2.1 1.3h1.3v-1a.4.4 0 0 1 .65-.3l2.45 2.1a.4.4 0 0 1 0 .6l-2.45 2.1a.4.4 0 0 1-.65-.3v-1h-1.3c-1.3 0-2.2-.8-3.1-2l-3-4c-.7-.9-1.2-1.3-2.1-1.3H1v-1.2zm0 7.5h2c.9 0 1.4-.4 2.1-1.3l.4-.55.95 1.25-.35.5c-.9 1.2-1.8 2-3.1 2H1v-1.9z"/></svg>`,
    repeat: `<svg viewBox="0 0 16 16"><path d="M4.5 2.5h7a3 3 0 0 1 3 3v1.25h-1.5V5.5a1.5 1.5 0 0 0-1.5-1.5h-7V6L1 3.25 4.5 .5v2zm7 11h-7a3 3 0 0 1-3-3V9.25H3v1.25A1.5 1.5 0 0 0 4.5 12h7v-2L15 12.75 11.5 15.5v-2z"/></svg>`,
    repeatOne: `<svg viewBox="0 0 16 16"><path d="M4.5 2.5h7a3 3 0 0 1 3 3v1.25h-1.5V5.5a1.5 1.5 0 0 0-1.5-1.5h-7V6L1 3.25 4.5 .5v2zm7 11h-7a3 3 0 0 1-3-3V9.25H3v1.25A1.5 1.5 0 0 0 4.5 12h7v-2L15 12.75 11.5 15.5v-2z"/><path d="M8.6 6.1h-.8l-1.3.62v1.02l.95-.44v3.2h1.15V6.1z"/></svg>`,
    note: `<svg viewBox="0 0 16 16"><path d="M13.5 1.5v8.75a2.75 2.75 0 1 1-1.5-2.45V3.9L6.5 5.1v6.65a2.75 2.75 0 1 1-1.5-2.45V3.9l8.5-1.9v-.5z"/></svg>`,
    person: `<svg viewBox="0 0 16 16"><path d="M8 7.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5zM2 15a6 6 0 0 1 12 0v.5H2V15z"/></svg>`,
    disc: `<svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM8 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>`,
    mic: `<svg viewBox="0 0 16 16"><path d="M8 1a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 8 1zm4.5 6.5a.75.75 0 0 1 1.5 0 6 6 0 0 1-5.25 5.954V15.5a.75.75 0 0 1-1.5 0v-2.046A6 6 0 0 1 2 7.5a.75.75 0 0 1 1.5 0 4.5 4.5 0 0 0 9 0z"/></svg>`,
    // Dedicated lyrics-toggle icons (kept separate from `note` above, which
    // is used for the track-title row) — a slashed variant for the off
    // state, matching the mute-icon convention used for volume.
    lyricsNote: `<svg viewBox="0 0 16 16"><path d="M13.5 1.5v8.75a2.75 2.75 0 1 1-1.5-2.45V3.9L6.5 5.1v6.65a2.75 2.75 0 1 1-1.5-2.45V3.9l8.5-1.9v-.5z"/></svg>`,
    lyricsNoteOff: `<svg viewBox="0 0 16 16"><path d="M13.5 1.5v8.75a2.75 2.75 0 1 1-1.5-2.45V3.9L6.5 5.1v6.65a2.75 2.75 0 1 1-1.5-2.45V3.9l8.5-1.9v-.5z"/><line x1="1.5" y1="14.5" x2="14.5" y2="1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    // Four separated corner brackets, no connecting diagonal — the
    // previous version's diagonal arrow-with-flags blurred into an
    // illegible smudge at native playbar icon size (~14-16px). This is
    // the standard "fullscreen" convention (used by video players,
    // browsers, etc.): plain right-angle corners stay crisp that small
    // because there's no fine diagonal detail to anti-alias away.
    expand: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`,
    // Kept for anything that still wants the bare gear on its own.
    gear: `<svg viewBox="0 0 24 24">${GEAR_PATH}</svg>`,
    // The visualizer-settings icon: three equalizer-style bars (evoking the
    // ring/spectrum visualizer this panel configures) with a small gear
    // tucked into the bottom-right corner. The bars stop at x=14/y=14 and
    // the gear's box starts there, so the two shapes never overlap —
    // overlapping same-color fills would have merged into one blob with
    // no visible boundary between them.
    settings: `<svg viewBox="0 0 24 24">
      <rect x="2" y="8" width="3" height="6" rx="1"/>
      <rect x="6.5" y="2" width="3" height="12" rx="1"/>
      <rect x="11" y="5" width="3" height="9" rx="1"/>
      <svg x="14" y="14" width="10" height="10" viewBox="0 0 24 24">${GEAR_PATH}</svg>
    </svg>`
  };

  // src/dom.js
  var root = document.createElement("div");
  root.className = "fsp-root";
  root.innerHTML = `
    <div class="fsp-backdrop"></div>
    <div class="fsp-wash"></div>
    <canvas class="fsp-spectrum"></canvas>
    <div class="fsp-tint"></div>
    <div class="fsp-drag"></div>

    <div class="fsp-next" hidden>
      <img class="fsp-next-art" alt="" />
      <div style="min-width:0">
        <div class="fsp-next-kind">Up next</div>
        <div class="fsp-next-title"></div>
      </div>
    </div>

    <!-- Deliberately a sibling of .fsp-chrome, not a child of it: the
         "always shown" visibility option needs to keep fading independent
         of .fsp-chrome's own idle fade, and a parent's opacity caps
         everything under it \u2014 a child stuck at opacity:1 inside a
         parent that's faded to 0 still renders invisible. Living outside
         .fsp-chrome, .fsp-context can carry its own opacity untouched by
         the rest of the chrome hiding on idle. -->
    <div class="fsp-context">
      <div class="fsp-context-icon">${icons.queue}</div>
      <div class="fsp-context-text">
        <div class="fsp-context-kind">Playing from</div>
        <div class="fsp-context-name"></div>
      </div>
    </div>

    <div class="fsp-chrome">
      <div class="fsp-volume">
        <div class="fsp-vol-pct">70%</div>
        <div class="fsp-vol-track fsp-hit"><div class="fsp-vol-fill"></div><div class="fsp-vol-knob"></div></div>
        <button class="fsp-mute" aria-label="Mute">${icons.vol}</button>
      </div>

      <button class="fsp-close" aria-label="Close fullscreen">${icons.close}</button>
      <pre class="fsp-debug" hidden></pre>
    </div>

    <div class="fsp-settings">
      <button class="fsp-gear" aria-label="Visualizer settings">${icons.gear}</button>
      <div class="fsp-settings-panel">
        <div class="fsp-set-tabs" role="tablist">
          <button class="fsp-set-tab fsp-set-tab-active" data-tab="general" role="tab" aria-selected="true">General</button>
          <button class="fsp-set-tab" data-tab="visualizer" role="tab" aria-selected="false">Visualizer</button>
        </div>

        <div class="fsp-set-body">
        <div class="fsp-set-pane fsp-set-pane-active" data-pane="general">

          <div class="fsp-settings-title">Display</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row"><label>Auto-enter fullscreen</label><input type="checkbox" class="fsp-set-autofs fsp-toggle" /></div>
            <div class="fsp-set-row">
              <label>"Playing from" label</label>
              <select class="fsp-set-ctxvis">
                <option value="always">Always shown</option>
                <option value="auto">Fade with cursor</option>
                <option value="off">Hidden</option>
              </select>
            </div>
            <div class="fsp-set-row">
              <label>"Up next" card</label>
              <select class="fsp-set-nextvis">
                <option value="always">Always shown</option>
                <option value="auto">Show near track end</option>
                <option value="off">Hidden</option>
              </select>
            </div>
            <div class="fsp-set-row fsp-set-leadsecs-row">
              <div class="fsp-set-row-head">
                <label>Lead time</label>
                <span class="fsp-set-badge fsp-set-leadsecs-badge">20s</span>
              </div>
              <input type="range" class="fsp-set-leadsecs" min="1" max="90" step="1" />
            </div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Show debug overlay on open</label><input type="checkbox" class="fsp-set-showdebug fsp-toggle" /></div>
            <div class="fsp-set-row">
              <label>Background intensity</label>
              <input type="range" class="fsp-set-bgintensity" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Artwork shadow</label>
              <input type="range" class="fsp-set-artshadow" min="0" max="2" step="0.05" />
            </div>
          </div>

          <div class="fsp-settings-title">Track info</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row"><label>Scroll long titles</label><input type="checkbox" class="fsp-set-marqueescroll fsp-toggle" /></div>
            <div class="fsp-set-row fsp-set-marqueespeed-row">
              <label>Marquee speed</label>
              <input type="range" class="fsp-set-marqueespeed" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-marqueestyle-row">
              <label>Marquee style</label>
              <select class="fsp-set-marqueestyle">
                <option value="bounce">Scroll and snap back</option>
                <option value="ticker">Continuous ticker</option>
              </select>
            </div>
            <div class="fsp-set-row">
              <label>Text size</label>
              <input type="range" class="fsp-set-textsize" min="0.7" max="1.5" step="0.05" />
            </div>
          </div>

          <div class="fsp-settings-title">Accessibility</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row">
              <label>Motion</label>
              <select class="fsp-set-motion">
                <option value="auto">Match system setting</option>
                <option value="off">Always animate</option>
                <option value="on">Always reduced</option>
              </select>
            </div>
          </div>

        </div>

        <div class="fsp-set-pane" data-pane="visualizer" hidden>

          <div class="fsp-settings-title">Color</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row">
              <label>Mode</label>
              <select class="fsp-set-colormode">
                <option value="art">From artwork</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="fsp-set-row fsp-set-vbrightness-row">
              <label>Artwork brightness</label>
              <input type="range" class="fsp-set-vbrightness" min="0.4" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-tint-row">
              <label>Artwork tint (lighten toward white)</label>
              <input type="range" class="fsp-set-tint" min="0.4" max="1.8" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-spread-row">
              <label>Artwork color spread</label>
              <input type="range" class="fsp-set-spread" min="0.4" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Opacity</label>
              <input type="range" class="fsp-set-opacity" min="0.1" max="1" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-custom-row">
              <label>Custom color 1</label>
              <input type="color" class="fsp-set-customcolor" value="#8b5cf6" />
            </div>
            <div class="fsp-set-row fsp-set-custom-row fsp-set-toggle-row">
              <label><input type="checkbox" class="fsp-set-usecolor2 fsp-toggle" /> Custom color 2</label>
              <input type="color" class="fsp-set-customcolor2" value="#22d3ee" />
            </div>
            <div class="fsp-set-row fsp-set-custom-row fsp-set-toggle-row">
              <label><input type="checkbox" class="fsp-set-usecolor3 fsp-toggle" /> Custom color 3</label>
              <input type="color" class="fsp-set-customcolor3" value="#f472b6" />
            </div>
          </div>

          <div class="fsp-settings-title">Rings</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row fsp-set-rings">
              <label>Rings on</label>
              <div class="fsp-set-rings-toggles">
                <label class="fsp-ring-toggle">1<input type="checkbox" class="fsp-set-ring0 fsp-toggle" /></label>
                <label class="fsp-ring-toggle">2<input type="checkbox" class="fsp-set-ring1 fsp-toggle" /></label>
                <label class="fsp-ring-toggle">3<input type="checkbox" class="fsp-set-ring2 fsp-toggle" /></label>
              </div>
            </div>
            <div class="fsp-set-row">
              <label>Ring speed</label>
              <input type="range" class="fsp-set-ringspeed" min="0.25" max="2.5" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Ring reactivity</label>
              <input type="range" class="fsp-set-ringreact" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Ring thickness</label>
              <input type="range" class="fsp-set-thickness" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Glow intensity</label>
              <input type="range" class="fsp-set-glow" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Beat pulse strength</label>
              <input type="range" class="fsp-set-pulse" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Rings spin the same way</label><input type="checkbox" class="fsp-set-lockdir fsp-toggle" /></div>
          </div>

          <div class="fsp-settings-title">Spectrum bar</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row">
              <label>Position</label>
              <select class="fsp-set-barpos">
                <option value="both">Top and bottom</option>
                <option value="top">Top only</option>
                <option value="bottom">Bottom only</option>
              </select>
            </div>
            <div class="fsp-set-row">
              <label>Bar shape</label>
              <select class="fsp-set-barshape">
                <option value="rounded">Rounded</option>
                <option value="sharp">Sharp</option>
              </select>
            </div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Mirror fold (bass at edges)</label><input type="checkbox" class="fsp-set-fold fsp-toggle" /></div>
            <div class="fsp-set-row">
              <label>Bar density</label>
              <input type="range" class="fsp-set-density" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Bar height</label>
              <input type="range" class="fsp-set-height" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Bar sensitivity</label>
              <input type="range" class="fsp-set-sens" min="0" max="2" step="0.05" />
            </div>
          </div>

          <div class="fsp-settings-title">Frequencies</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row"><label>Bass</label><input type="checkbox" class="fsp-set-freqbass fsp-toggle" /></div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Mids</label><input type="checkbox" class="fsp-set-freqmids fsp-toggle" /></div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Treble</label><input type="checkbox" class="fsp-set-freqtreble fsp-toggle" /></div>
          </div>

        </div>
        </div>

        <button class="fsp-set-reset">Reset to defaults</button>
      </div>
    </div>

      <div class="fsp-meta">
        <div class="fsp-row fsp-row-title">${icons.note}<div class="fsp-scroll"><div class="fsp-mqtrack"><h1 class="fsp-title"></h1></div></div></div>
        <div class="fsp-row">${icons.person}<div class="fsp-scroll"><div class="fsp-mqtrack"><span class="fsp-artist"></span></div></div></div>
        <div class="fsp-row fsp-row-album">${icons.disc}<div class="fsp-scroll"><div class="fsp-mqtrack"><span class="fsp-album"></span></div></div></div>
      </div>

    <div class="fsp-lyric-size">
      <div class="fsp-lsz-val">100%</div>
      <div class="fsp-lsz-track fsp-hit"><div class="fsp-lsz-fill"></div><div class="fsp-lsz-knob"></div></div>
      <span class="fsp-lsz-icon" role="button" aria-label="Lyrics size">${icons.lyricsNote}</span>
    </div>

    <div class="fsp-lyrics"><div class="fsp-lyrics-inner"></div></div>


    <div class="fsp-stage">
      <div class="fsp-column">
      <div class="fsp-canvas-wrap">
        <canvas class="fsp-canvas"></canvas>
        <img class="fsp-art" alt="" />
      </div>
      <div class="fsp-transport">
      <div class="fsp-controls">
        <div class="fsp-ctl-side">
          <button class="fsp-btn fsp-small fsp-heart" aria-label="Save to your library">${icons.heart}</button>
          <button class="fsp-btn fsp-small fsp-shuffle" aria-label="Shuffle">${icons.shuffle}</button>
        </div>
        <div class="fsp-ctl-main">
          <button class="fsp-btn fsp-prev" aria-label="Previous track">${icons.prev}</button>
          <button class="fsp-btn fsp-play" aria-label="Play or pause">${icons.play}</button>
          <button class="fsp-btn fsp-next-btn" aria-label="Next track">${icons.next}</button>
        </div>
        <div class="fsp-ctl-side fsp-ctl-right">
          <button class="fsp-btn fsp-small fsp-repeat" aria-label="Repeat">${icons.repeat}</button>
        </div>
      </div>
      <div class="fsp-bar">
        <span class="fsp-elapsed">0:00</span>
        <div class="fsp-track fsp-hit"><div class="fsp-fill"></div><div class="fsp-knob"></div></div>
        <span class="fsp-remain">-0:00</span>
      </div>
      </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  var el = {
    wash: root.querySelector(".fsp-wash"),
    stage: root.querySelector(".fsp-stage"),
    wrap: root.querySelector(".fsp-canvas-wrap"),
    canvas: root.querySelector(".fsp-canvas"),
    art: root.querySelector(".fsp-art"),
    title: root.querySelector(".fsp-title"),
    artist: root.querySelector(".fsp-artist"),
    album: root.querySelector(".fsp-album"),
    meta: root.querySelector(".fsp-meta"),
    bar: root.querySelector(".fsp-bar"),
    controls: root.querySelector(".fsp-controls"),
    track: root.querySelector(".fsp-track"),
    fill: root.querySelector(".fsp-fill"),
    knob: root.querySelector(".fsp-knob"),
    elapsed: root.querySelector(".fsp-elapsed"),
    remain: root.querySelector(".fsp-remain"),
    play: root.querySelector(".fsp-play"),
    heart: root.querySelector(".fsp-heart"),
    shuffle: root.querySelector(".fsp-shuffle"),
    repeat: root.querySelector(".fsp-repeat"),
    ctxName: root.querySelector(".fsp-context-name"),
    ctxKind: root.querySelector(".fsp-context-kind"),
    nextCard: root.querySelector(".fsp-next"),
    nextArt: root.querySelector(".fsp-next-art"),
    nextTitle: root.querySelector(".fsp-next-title"),
    volPct: root.querySelector(".fsp-vol-pct"),
    volTrack: root.querySelector(".fsp-vol-track"),
    volFill: root.querySelector(".fsp-vol-fill"),
    volKnob: root.querySelector(".fsp-vol-knob"),
    volWrap: root.querySelector(".fsp-volume"),
    mute: root.querySelector(".fsp-mute"),
    lszTrack: root.querySelector(".fsp-lsz-track"),
    lszFill: root.querySelector(".fsp-lsz-fill"),
    lszKnob: root.querySelector(".fsp-lsz-knob"),
    lszVal: root.querySelector(".fsp-lsz-val"),
    lszWrap: root.querySelector(".fsp-lyric-size"),
    lszIcon: root.querySelector(".fsp-lsz-icon"),
    settingsWrap: root.querySelector(".fsp-settings"),
    gearBtn: root.querySelector(".fsp-gear"),
    context: root.querySelector(".fsp-context")
  };
  var ctx = el.canvas.getContext("2d");
  var flashTimer = null;
  function flash(text) {
    let n = root.querySelector(".fsp-flash");
    if (!n) {
      n = document.createElement("div");
      n.className = "fsp-flash";
      n.style.cssText = "position:absolute;bottom:26px;right:78px;z-index:6;font-size:12px;letter-spacing:.04em;color:rgba(255,255,255,.6);font-variant-numeric:tabular-nums;transition:opacity .25s ease;";
      root.appendChild(n);
    }
    n.textContent = text;
    n.style.opacity = "1";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => n.style.opacity = "0", 1300);
  }

  // src/utils.js
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  var lerp = (a, b, t) => a + (b - a) * t;
  var fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1e3));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  function toUrl(raw) {
    if (!raw) return "";
    return raw.startsWith("spotify:image:") ? `https://i.scdn.co/image/${raw.slice("spotify:image:".length)}` : raw;
  }
  function shade(hex, amount) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return "#14161c";
    const [r, g, b] = m.slice(1).map((h) => Math.round(parseInt(h, 16) * amount));
    return `rgb(${r},${g},${b})`;
  }

  // src/trackinfo.js
  function artOf(item) {
    if (!item) return "";
    return toUrl(
      item.album?.images?.at(-1)?.url || item.metadata?.image_xlarge_url || item.metadata?.image_large_url || item.metadata?.image_url || ""
    );
  }
  function artistOf(item) {
    if (!item) return "";
    if (Array.isArray(item.artists) && item.artists.length)
      return item.artists.map((a) => a.name).join(", ");
    return item.metadata?.artist_name || "";
  }
  function titleOf(item) {
    return item?.name || item?.metadata?.title || "";
  }

  // src/palette.js
  var swatchCanvas = document.createElement("canvas");
  swatchCanvas.width = swatchCanvas.height = 40;
  var swatchCtx = swatchCanvas.getContext("2d", { willReadFrequently: true });
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, sat, l];
  }
  function paletteFromArt(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          swatchCtx.drawImage(img, 0, 0, 40, 40);
          const { data } = swatchCtx.getImageData(0, 0, 40, 40);
          const buckets = /* @__PURE__ */ new Map();
          for (let i = 0; i < data.length; i += 4) {
            const [h, sat, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (l < 0.12 || l > 0.94) continue;
            const key = Math.round(h * 11);
            const score = sat * (1 - Math.abs(l - 0.55));
            const prev = buckets.get(key);
            if (!prev || score > prev.score) {
              buckets.set(key, { score, css: `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`, h, sat });
            }
          }
          let list = [...buckets.values()].filter((c) => c.sat > 0.12);
          if (list.length < 2) return resolve(null);
          list.sort((a, b) => a.h - b.h);
          if (list.length > 5) {
            const step = list.length / 5;
            list = [0, 1, 2, 3, 4].map((i) => list[Math.floor(i * step)]);
          }
          resolve(list.map((c) => c.css));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // src/visuals.js
  var visualSource = "none";
  var getVisualSource = () => visualSource;
  async function fetchArtistImage(item) {
    const artistUri = item?.artists?.[0]?.uri || item?.metadata?.artist_uri || "";
    if (!artistUri) return null;
    try {
      const defs = Spicetify.GraphQL?.Definitions || {};
      const name = defs.queryArtistOverview ? "queryArtistOverview" : Object.keys(defs).find((k) => /artistOverview/i.test(k));
      if (!name) return null;
      const r = await Spicetify.GraphQL.Request(defs[name], {
        uri: artistUri,
        locale: "",
        includePrerelease: false
      });
      const v = r?.data?.artistUnion?.visuals;
      const url = v?.headerImage?.sources?.[0]?.url || v?.imageGroup?.sources?.[0]?.url || v?.avatarImage?.sources?.[0]?.url || null;
      return url ? { url, via: `GraphQL.${name}` } : null;
    } catch {
      return null;
    }
  }
  async function loadVisual(item) {
    const back = root.querySelector(".fsp-backdrop");
    back.classList.remove("fsp-on");
    root.classList.remove("fsp-hasvisual");
    visualSource = "none";
    const uri = item.uri;
    const art = await fetchArtistImage(item);
    if (art && Spicetify.Player.data?.item?.uri === uri) {
      back.style.backgroundImage = `url("${art.url}")`;
      back.classList.add("fsp-on");
      root.classList.add("fsp-hasvisual");
      visualSource = `artist image (${art.via})`;
    }
  }

  // src/render.js
  var CANVAS_RATIO = 1.62;
  var shadeCtx = document.createElement("canvas").getContext("2d");
  function tint(css, factor) {
    if (!css || factor === 1) return css;
    shadeCtx.fillStyle = css;
    const norm = shadeCtx.fillStyle;
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(norm);
    if (!m) return css;
    const [r, g, b] = [1, 2, 3].map((i) => clamp(Math.round(parseInt(m[i], 16) * factor), 0, 255));
    return `rgb(${r},${g},${b})`;
  }
  function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = (g - b) / d % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
  }
  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = v - c;
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
  function paintColor(css, viz) {
    return tint(brighten(css, viz.artValueBrightness), viz.artTint);
  }
  function warp(t, spread) {
    return clamp(0.5 + (t - 0.5) * spread, 0, 1);
  }
  function gradientStops(viz) {
    if (viz.colorMode === "custom") {
      const colors = customColors();
      return colors.map((c, i) => [colors.length > 1 ? i / (colors.length - 1) : 0, c]);
    }
    if (!S.palette || S.palette.length < 2) return null;
    return S.palette.map((c, i) => [
      warp(i / (S.palette.length - 1), viz.paletteSpread),
      paintColor(c, viz)
    ]);
  }
  function resize() {
    root.classList.toggle("fsp-fs", !!document.fullscreenElement);
    resizeSpectrum();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cardH = (el.meta?.offsetHeight || 110) + 22;
    const below = 18;
    const region = Math.max(200, vh - cardH);
    root.style.setProperty("--fsp-stage-top", `${Math.round(region / 2)}px`);
    let side = Math.min(vw * 0.48, region - below);
    side = clamp(side, 150, 980);
    S.artSize = Math.floor(clamp(side / CANVAS_RATIO, 90, 560));
    root.style.setProperty("--fsp-art", `${S.artSize}px`);
    side = Math.floor(S.artSize * CANVAS_RATIO);
    root.style.setProperty("--fsp-band", `${Math.round((side - S.artSize) / 2)}px`);
    const dpr = window.devicePixelRatio || 1;
    el.wrap.style.width = el.wrap.style.height = `${side}px`;
    el.canvas.width = side * dpr;
    el.canvas.height = side * dpr;
    el.canvas.style.width = el.canvas.style.height = `${side}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestAnimationFrame(() => {
      const art = el.art?.getBoundingClientRect();
      if (!art?.width) return;
      root.style.setProperty("--fsp-lsz-left", `${Math.round(art.right + 30)}px`);
      const volW = el.volWrap?.getBoundingClientRect().width || 0;
      root.style.setProperty("--fsp-vol-left", `${Math.round(art.left - 30 - volW)}px`);
      const contextBottom = el.context?.getBoundingClientRect().bottom || 0;
      const minGearTop = contextBottom + 10;
      const idealGearTop = art.top - 48;
      root.style.setProperty("--fsp-gear-top", `${Math.round(Math.max(idealGearTop, minGearTop))}px`);
    });
  }
  function focusedIndexRanges() {
    return freqRanges().map(([lo, hi]) => {
      const iLo = Math.floor(lo * (S.N - 1));
      const iHi = Math.max(iLo + 1, Math.min(S.N - 1, Math.ceil(hi * (S.N - 1))));
      return [iLo, iHi];
    });
  }
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
  function bandAt(angle) {
    let a = angle % (Math.PI * 2);
    if (a > Math.PI) a = Math.PI * 2 - a;
    const v = sampleBand(a / Math.PI);
    const indices = /* @__PURE__ */ new Set();
    for (const [iLo, iHi] of focusedIndexRanges()) {
      for (let k = iLo; k <= iHi; k++) indices.add(k);
    }
    let mean = 0;
    for (const k of indices) mean += S.bands[k];
    return v - mean / (indices.size || 1);
  }
  var RINGS = [
    { gap: 0.08, amp: 0.3, width: 2.2, alpha: 0.9, speed: 0.22, lobes: 1 },
    { gap: 0.28, amp: 0.36, width: 1.5, alpha: 0.5, speed: -0.14, lobes: 2 },
    { gap: 0.46, amp: 0.32, width: 1.1, alpha: 0.26, speed: 0.08, lobes: 3 }
  ];
  function ringPaint(ctx2, c, radius, ring) {
    const viz = getVizSettings();
    const stops = gradientStops(viz);
    if (!stops) return paintColor(S.accent, viz);
    if (stops.length === 1) return stops[0][1];
    const dir = viz.lockRotationDirection ? 1 : ring.speed > 0 ? 1 : -1;
    const a = S.rotation * 0.25 * dir;
    const g = ctx2.createLinearGradient(
      c + Math.cos(a) * radius,
      c + Math.sin(a) * radius,
      c - Math.cos(a) * radius,
      c - Math.sin(a) * radius
    );
    stops.forEach(([pos, col]) => g.addColorStop(pos, col));
    return g;
  }
  var specCanvas = root.querySelector(".fsp-spectrum");
  var sctx = specCanvas.getContext("2d");
  var BAR_GAP = 3;
  var hasRoundRect = typeof sctx.roundRect === "function";
  function resizeSpectrum() {
    const dpr = window.devicePixelRatio || 1;
    specCanvas.width = window.innerWidth * dpr;
    specCanvas.height = window.innerHeight * dpr;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function bandLerp(t) {
    return sampleBand(t);
  }
  function drawSpectrum() {
    const viz = getVizSettings();
    const w = window.innerWidth, h = window.innerHeight;
    sctx.clearRect(0, 0, w, h);
    const bars = Math.max(24, Math.min(160, Math.floor(w / 16 * viz.barDensity)));
    const barW = w / bars - BAR_GAP;
    const maxH = Math.min(h * 0.22, 230) * viz.barHeight;
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
      const foldT = viz.barMirrorFold ? t < 0.5 ? t * 2 : (1 - t) * 2 : t;
      const v = Math.pow(bandLerp(foldT), 1.1);
      const bh = Math.max(2, v * maxH * (0.25 + S.energy * 0.95) * viz.barSensitivity);
      const x = b * (w / bars) + BAR_GAP / 2;
      sctx.globalAlpha = viz.colorOpacity;
      if (round) {
        if (showTop) {
          sctx.beginPath();
          sctx.roundRect(x, 0, barW, bh, [0, 0, 2, 2]);
          sctx.fill();
        }
        if (showBottom) {
          sctx.beginPath();
          sctx.roundRect(x, h - bh, barW, bh, [2, 2, 0, 0]);
          sctx.fill();
        }
      } else {
        if (showTop) sctx.fillRect(x, 0, barW, bh);
        if (showBottom) sctx.fillRect(x, h - bh, barW, bh);
      }
    }
    sctx.globalAlpha = 1;
  }
  function draw() {
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
      const avail = Math.max(1, maxR - artR);
      const drive = Math.min(1, S.energy);
      const base = artR * beat + avail * (ring.gap + drive * 0.05 * ring.lobes);
      const amp = avail * ring.amp * (0.15 + 0.85 * drive) * viz.ringReactivity;
      const speed = viz.lockRotationDirection ? Math.abs(ring.speed) : ring.speed;
      ctx.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const a = s / STEPS * Math.PI * 2;
        const mod = bandAt((a * ring.lobes + S.rotation * speed) % (Math.PI * 2));
        const r = clamp(base + amp * mod, artR * 0.6, maxR);
        const x = c + Math.cos(a - Math.PI / 2) * r;
        const y = c + Math.sin(a - Math.PI / 2) * r;
        s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = ringPaint(ctx, c, base + amp, ring);
      ctx.globalAlpha = ring.alpha * viz.colorOpacity;
      ctx.lineWidth = width;
      ctx.lineJoin = "round";
      ctx.shadowBlur = 20 * S.energy * viz.glowIntensity;
      ctx.shadowColor = stops ? stops[Math.min(stops.length - 1, RINGS.indexOf(ring))][1] : paintColor(S.accent, viz);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    el.art.style.transform = `scale(${1 + S.pulse * 0.012 * viz.pulseStrength})`;
  }

  // src/settings.js
  var KEY = "fsp:vizSettings";
  var DEFAULTS = {
    // --- color ---
    colorMode: "art",
    // "art" (palette from the cover) | "custom"
    // True brightness (HSV value only — stays vivid, doesn't wash out).
    artValueBrightness: 1,
    // 0.4 - 2
    // Multiplies RGB channels and clips them, which converges toward white
    // as it clips — kept as its own knob since it reads as a different
    // effect than artValueBrightness above (a "getting whiter" wash rather
    // than a straightforward brighter/darker).
    artTint: 1,
    // 0.4 - 1.8
    paletteSpread: 1,
    // biases gradient-stop spacing outward, 0.4 - 2
    // Default sits below full solid, closer to how this looked before the
    // opacity setting existed — 1.0 is available on the slider, just not
    // the out-of-the-box value.
    colorOpacity: 0.6,
    // ring/spectrum fill alpha, 0.1 - 1
    customColor: "#8b5cf6",
    customColor2: "#22d3ee",
    customColor3: "#f472b6",
    useColor2: false,
    useColor3: false,
    // --- rings ---
    ringSpeed: 1,
    // multiplies S.rotation's per-frame increment
    ringReactivity: 1,
    // multiplies how far the rings deform
    ringsOn: [true, true, true],
    ringThickness: 1,
    // multiplies each ring's line width, 0.5 - 2
    glowIntensity: 1,
    // multiplies the ring glow's shadow blur, 0 - 2
    pulseStrength: 1,
    // multiplies the beat pulse (art scale + ring base), 0 - 2
    lockRotationDirection: false,
    // force all rings to spin the same way
    // --- spectrum bar ---
    barDensity: 1,
    // multiplies the spectrum's bar count
    barHeight: 1,
    // multiplies the spectrum's max bar height
    barSensitivity: 1,
    // multiplies the spectrum's bar amplitude
    barPosition: "both",
    // "both" | "top" | "bottom"
    barShape: "rounded",
    // "rounded" | "sharp"
    barMirrorFold: true,
    // fold so bass sits at both edges, treble meets mid
    // --- frequencies ---
    // Which thirds of the existing band data feed the rings/spectrum bar.
    // Independent checkboxes rather than one exclusive choice, so bass and
    // treble can be combined while mids is left out, for instance. All three
    // on is equivalent to the old "full range" preset.
    freqBands: { bass: true, mids: true, treble: true },
    // --- general ---
    motionOverride: "auto",
    // "auto" (respect OS setting) | "on" | "off"
    autoFullscreen: true,
    // enter real fullscreen on open (same pref the F key toggles)
    // "always" (never fades) | "auto" (fades out after a few seconds idle,
    // back in on mouse move) | "off" (never shown).
    contextVisibility: "auto",
    // the "Playing from" label, top-left
    // "always" (shown for the whole track, once there is a next one) |
    // "auto" (only inside nextLeadSeconds of the track ending) | "off".
    nextVisibility: "auto",
    // the up-next card
    nextLeadSeconds: 20,
    // how long before the end "auto" reveals it, 1 - 90
    showDebug: false,
    // the debug readout starts visible without pressing D
    backgroundIntensity: 1,
    // multiplies the blurred backdrop/wash opacity, 0 - 2
    artShadow: 1,
    // multiplies the artwork's drop shadow, 0 - 2
    marqueeScroll: true,
    // off: long titles render in full instead of scrolling
    marqueeSpeed: 1,
    // multiplies marquee scroll speed, 0.5 - 2
    marqueeStyle: "bounce",
    // "bounce" (scroll to the end, snap back) | "ticker" (continuous loop)
    metaTextScale: 1
    // scales title/artist/album font size, 0.7 - 1.5
  };
  function migratedAutoFullscreen(raw) {
    if (raw && raw.autoFullscreen !== void 0) return raw.autoFullscreen;
    try {
      const old = localStorage.getItem("fsp:fullscreen");
      if (old !== null) return old !== "0";
    } catch {
    }
    return DEFAULTS.autoFullscreen;
  }
  function migratedFreqBands(raw) {
    if (raw && raw.freqBands && typeof raw.freqBands === "object") {
      return { ...DEFAULTS.freqBands, ...raw.freqBands };
    }
    switch (raw?.freqFocus) {
      case "bass":
        return { bass: true, mids: false, treble: false };
      case "mids":
        return { bass: false, mids: true, treble: false };
      case "treble":
        return { bass: false, mids: false, treble: true };
      default:
        return { ...DEFAULTS.freqBands };
    }
  }
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
        ringsOn: Array.isArray(raw.ringsOn) && raw.ringsOn.length === 3 ? raw.ringsOn.map(Boolean) : [...DEFAULTS.ringsOn]
      };
    } catch {
      return { ...DEFAULTS, freqBands: { ...DEFAULTS.freqBands }, autoFullscreen: migratedAutoFullscreen(null) };
    }
  }
  var settings = load();
  function applyGeneral() {
    if (el.context) {
      el.context.style.display = settings.contextVisibility === "off" ? "none" : "";
      el.context.classList.toggle("fsp-force-show", settings.contextVisibility === "always");
    }
    root.style.setProperty("--fsp-bg-intensity", String(settings.backgroundIntensity));
    root.style.setProperty("--fsp-art-shadow", String(settings.artShadow));
    root.style.setProperty("--fsp-meta-scale", String(settings.metaTextScale));
  }
  applyGeneral();
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
    }
    applyGeneral();
  }
  function getVizSettings() {
    return settings;
  }
  function setAutoFullscreen(value) {
    settings.autoFullscreen = value;
    save();
    if (inputs) inputs.autoFullscreen.checked = value;
  }
  var FREQ_THIRDS = { bass: [0, 1 / 3], mids: [1 / 3, 2 / 3], treble: [2 / 3, 1] };
  function freqRanges() {
    return ["bass", "mids", "treble"].filter((k) => settings.freqBands[k]).map((k) => FREQ_THIRDS[k]);
  }
  function customColors() {
    const list = [settings.customColor];
    if (settings.useColor2) list.push(settings.customColor2);
    if (settings.useColor3) list.push(settings.customColor3);
    return list;
  }
  var wrap = el.settingsWrap;
  var panel = root.querySelector(".fsp-settings-panel");
  var openSelectLists = /* @__PURE__ */ new Set();
  function closeAllSelectLists() {
    for (const entry of openSelectLists) entry.close();
  }
  function enhanceSelect(select) {
    if (select.dataset.enhanced) return null;
    select.dataset.enhanced = "1";
    select.classList.add("fsp-native-select-hidden");
    select.tabIndex = -1;
    const wrap2 = document.createElement("div");
    wrap2.className = "fsp-select-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fsp-select-btn";
    const label = document.createElement("span");
    const chevron = document.createElement("span");
    chevron.className = "fsp-select-chevron";
    chevron.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>';
    btn.append(label, chevron);
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
      itemEls.forEach((el2, idx) => el2.classList.toggle("fsp-select-item-active", idx === i));
    }
    function close() {
      list.hidden = true;
      wrap2.classList.remove("fsp-select-open");
      openSelectLists.delete(entry);
    }
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
    function open2() {
      closeAllSelectLists();
      position();
      list.hidden = false;
      wrap2.classList.add("fsp-select-open");
      openSelectLists.add(entry);
    }
    const entry = { close };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      list.hidden ? open2() : close();
    });
    select.insertAdjacentElement("afterend", wrap2);
    wrap2.append(btn);
    sync();
    return { sync, close };
  }
  document.addEventListener("click", closeAllSelectLists);
  var inputs = panel && {
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
    metaTextScale: panel.querySelector(".fsp-set-textsize")
  };
  function syncColorRows() {
    const custom = settings.colorMode === "custom";
    inputs.artValueBrightness.closest(".fsp-set-vbrightness-row").style.display = custom ? "none" : "";
    inputs.artTint.closest(".fsp-set-tint-row").style.display = custom ? "none" : "";
    inputs.paletteSpread.closest(".fsp-set-spread-row").style.display = custom ? "none" : "";
    panel.querySelectorAll(".fsp-set-custom-row").forEach((row) => {
      row.style.display = custom ? "" : "none";
    });
  }
  function updateRangeFill(inputEl) {
    const min = Number(inputEl.min) || 0;
    const max = Number(inputEl.max) || 100;
    const pct = (Number(inputEl.value) - min) / (max - min) * 100;
    inputEl.style.setProperty("--fsp-range-fill", `${clamp(pct, 0, 100)}%`);
  }
  var selectEnhancers = [];
  var marqueeDebounce = null;
  function debouncedSetupMarquee() {
    clearTimeout(marqueeDebounce);
    marqueeDebounce = setTimeout(setupMarquee, 250);
  }
  function syncMarqueeRow() {
    const show2 = settings.marqueeScroll ? "" : "none";
    inputs.marqueeSpeed.closest(".fsp-set-marqueespeed-row").style.display = show2;
    inputs.marqueeStyle.closest(".fsp-set-marqueestyle-row").style.display = show2;
  }
  function syncNextLeadRow() {
    inputs.nextLeadSeconds.closest(".fsp-set-leadsecs-row").style.display = settings.nextVisibility === "auto" ? "" : "none";
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
      save();
      resize();
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
      setupMarquee();
    });
    inputs.marqueeSpeed.addEventListener("input", () => {
      settings.marqueeSpeed = Number(inputs.marqueeSpeed.value);
      save();
      applyMarqueeSpeed();
    });
    inputs.marqueeStyle.addEventListener("change", () => {
      settings.marqueeStyle = inputs.marqueeStyle.value;
      save();
      setupMarquee();
    });
    inputs.metaTextScale.addEventListener("input", () => {
      settings.metaTextScale = Number(inputs.metaTextScale.value);
      save();
      debouncedSetupMarquee();
    });
    panel.addEventListener("input", (e) => {
      if (e.target.matches('input[type="range"]')) updateRangeFill(e.target);
    });
    panel.querySelector(".fsp-set-reset")?.addEventListener("click", () => {
      settings = { ...DEFAULTS, ringsOn: [...DEFAULTS.ringsOn], freqBands: { ...DEFAULTS.freqBands } };
      save();
      paintInputs();
      setupMarquee();
    });
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
  function openPanel() {
    wrap?.classList.add("fsp-panel-open");
  }
  function closePanel() {
    wrap?.classList.remove("fsp-panel-open");
    closeAllSelectLists();
  }
  el.gearBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    isPanelOpen() ? closePanel() : openPanel();
  });
  panel?.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => {
    if (isPanelOpen() && !wrap.contains(e.target)) closePanel();
  });
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

  // src/bridge.js
  var BRIDGE_URL = "ws://127.0.0.1:8787";
  var sock = null;
  var bridgeSeen = 0;
  var retryTimer = null;
  function connectBridge() {
    if (sock && (sock.readyState === 0 || sock.readyState === 1)) return;
    try {
      sock = new WebSocket(BRIDGE_URL);
    } catch {
      return scheduleRetry();
    }
    sock.onopen = () => console.info("[fsp] audio bridge connected");
    sock.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (Array.isArray(d.b)) {
          resizeBands(d.b.length);
          S.liveBands = d.b;
        }
        if (typeof d.e === "number") S.liveEnergy = d.e;
        if (d.k > 0) S.pulse = Math.max(S.pulse, 0.5 + 0.5 * d.k);
        bridgeSeen = performance.now();
      } catch {
      }
    };
    sock.onclose = () => scheduleRetry();
    sock.onerror = () => {
      try {
        sock.close();
      } catch {
      }
    };
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectBridge, 4e3);
  }
  function disconnectBridge() {
    clearTimeout(retryTimer);
    try {
      sock?.close();
    } catch {
    }
  }
  var bridgeLive = () => performance.now() - bridgeSeen < 1e3;
  function socketStateLabel() {
    return ["connecting", "open", "closing", "closed"][sock?.readyState] ?? "none";
  }

  // src/motion.js
  var SPR_K = 800;
  var SPR_ZETA = 0.65;
  var ENERGY_K = 450;
  var ENERGY_ZETA = 0.75;
  function spring(x, v, target, dt, k, zeta) {
    const d = 2 * zeta * Math.sqrt(k);
    v += (-k * (x - target) - d * v) * dt;
    x += v * dt;
    return [x, v];
  }
  function sample(tSec, dt) {
    let targetEnergy, targetBands;
    if (bridgeLive()) {
      targetEnergy = Math.pow(S.liveEnergy, 1.25);
      targetBands = S.liveBands;
    } else {
      targetEnergy = 0.4 + 0.12 * Math.sin(tSec * 1.1);
      targetBands = S.bands.map((_, i) => 0.45 + 0.3 * Math.sin(tSec * 0.8 + i * 0.55));
    }
    const steps = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      [S.energy, S.energyVel] = spring(S.energy, S.energyVel, targetEnergy, h, ENERGY_K, ENERGY_ZETA);
      for (let i = 0; i < S.N; i++) {
        [S.bands[i], S.bandVel[i]] = spring(S.bands[i], S.bandVel[i], targetBands[i] ?? 0, h, SPR_K, SPR_ZETA);
      }
    }
    S.energy = clamp(S.energy, 0, 1.4);
    S.pulse *= Math.pow(0.03, dt);
  }

  // src/lyrics/parse.js
  function parseLRC(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, "").trim();
      for (const m of stamps) {
        const time = parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(":", "."));
        out.push({ time, text: body });
      }
    }
    return out.sort((a, b) => a.time - b.time);
  }
  function normalizeLines(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    const lines = raw.map((l) => {
      if (typeof l === "string") return null;
      const t = l.startTimeMs ?? l.time ?? l.startTime ?? l.ts ?? null;
      const txt = l.words ?? l.text ?? l.line ?? l.content ?? "";
      if (txt == null) return null;
      const secs = t == null ? 0 : Number(t) > 1e3 ? Number(t) / 1e3 : Number(t);
      return { time: Number.isFinite(secs) ? secs : 0, text: String(txt).trim() };
    }).filter(Boolean);
    return lines.length ? lines : null;
  }
  function linesFromUnknown(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    const container = obj.Content || obj.content || obj.lines || obj.Lines;
    if (Array.isArray(container) && container.length) {
      const lines = [];
      for (const entry of container) {
        const lead = entry?.Lead || entry?.lead || entry;
        const syl = lead?.Syllables || lead?.syllables || entry?.Syllables;
        const start = Number(
          entry?.StartTime ?? lead?.StartTime ?? entry?.startTimeMs ?? entry?.time ?? 0
        );
        const finish = Number(entry?.EndTime ?? lead?.EndTime ?? 0);
        const toSec = (v) => v > 1e3 ? v / 1e3 : v;
        if (Array.isArray(syl) && syl.length) {
          const words = syl.map((w) => ({
            t: toSec(Number(w.StartTime ?? w.startTime ?? w.time ?? 0)),
            end: toSec(Number(w.EndTime ?? w.endTime ?? 0)),
            text: String(w.Text ?? w.text ?? "") + (w.IsPartOfWord || w.isPartOfWord ? "" : " ")
          }));
          lines.push({
            time: toSec(start) || words[0]?.t || 0,
            end: toSec(finish) || words.at(-1)?.end || 0,
            text: words.map((w) => w.text).join("").trim(),
            words
          });
        } else {
          const text = String(entry?.Text ?? entry?.text ?? lead?.Text ?? "").trim();
          if (!text && !start) continue;
          lines.push({ time: toSec(start), end: toSec(finish), text, words: null });
        }
      }
      if (lines.length) return lines.sort((a, b) => a.time - b.time);
    }
    for (const v of Object.values(obj)) {
      const r = linesFromUnknown(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  function ttmlTime(v) {
    if (!v) return 0;
    const parts = String(v).split(":").map(parseFloat);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }
  function parseTTML(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return null;
    const out = [];
    for (const p of doc.getElementsByTagName("p")) {
      const words = [];
      for (const node of p.childNodes) {
        if (node.nodeType === 3) {
          const ws = node.textContent;
          if (!ws) continue;
          if (words.length) words[words.length - 1].text += ws;
          continue;
        }
        if (node.nodeType !== 1) continue;
        if (node.tagName?.toLowerCase() !== "span") continue;
        if (!node.getAttribute("begin")) {
          for (const inner of node.getElementsByTagName("span")) {
            if (!inner.getAttribute("begin")) continue;
            words.push({
              t: ttmlTime(inner.getAttribute("begin")),
              end: ttmlTime(inner.getAttribute("end")),
              text: inner.textContent
            });
          }
          continue;
        }
        words.push({
          t: ttmlTime(node.getAttribute("begin")),
          end: ttmlTime(node.getAttribute("end")),
          text: node.textContent
        });
      }
      if (words.length > 1 && !words.some((w) => /\s$/.test(w.text))) {
        for (let i = 0; i < words.length - 1; i++) words[i].text += " ";
      }
      const text = words.length ? words.map((w) => w.text).join("") : p.textContent;
      out.push({
        time: ttmlTime(p.getAttribute("begin")),
        end: ttmlTime(p.getAttribute("end")),
        text: (text || "").trim(),
        words: words.length ? words : null
      });
    }
    return out.length ? out.sort((a, b) => a.time - b.time) : null;
  }

  // src/lyrics/sources.js
  async function fromOtherExtension(item) {
    const uri = item.uri;
    const id = uri.split(":").pop();
    for (const key of Object.getOwnPropertyNames(window)) {
      if (!/lyric/i.test(key)) continue;
      let val;
      try {
        val = window[key];
      } catch {
        continue;
      }
      if (!val) continue;
      const candidates = [
        val.currentLyrics,
        val.lyrics,
        val.CACHE?.[uri],
        val.cache?.[uri],
        val.CACHE?.[id],
        val.cache?.[id],
        val.state?.lyrics,
        val.data?.lyrics
      ];
      for (const c of candidates) {
        const lines = linesFromUnknown(c) || normalizeLines(c?.lines || c?.synced || c);
        if (lines) {
          return {
            lines,
            synced: lines.some((l) => l.time > 0),
            words: lines.some((l) => l.words),
            via: `window.${key}`
          };
        }
      }
      for (const fn of ["getLyrics", "fetchLyrics", "getCurrent"]) {
        if (typeof val[fn] !== "function") continue;
        try {
          const r = await val[fn](uri);
          const lines = normalizeLines(r?.lines || r?.synced || r);
          if (lines) return { lines, synced: lines.some((l) => l.time > 0), via: `window.${key}.${fn}` };
        } catch {
        }
      }
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !/lyric/i.test(k)) continue;
        const blob = localStorage.getItem(k) || "";
        if (!k.includes(id) && !k.includes(uri) && !blob.includes(id)) continue;
        const parsed = JSON.parse(localStorage.getItem(k));
        const scoped = parsed?.[id] || parsed?.[uri] || parsed;
        const lines = linesFromUnknown(scoped) || normalizeLines(scoped?.lines) || normalizeLines(scoped?.synced) || normalizeLines(scoped);
        if (lines) {
          return {
            lines,
            synced: lines.some((l) => l.time > 0),
            words: lines.some((l) => l.words),
            via: `localStorage:${k.slice(0, 28)}`
          };
        }
      }
    } catch {
    }
    return null;
  }
  async function fromClient(item) {
    const id = item.uri.split(":").pop();
    for (const key of Object.keys(Spicetify.Platform || {})) {
      if (!/lyric/i.test(key)) continue;
      for (const fn of ["getLyrics", "getColorLyrics", "fetchLyrics", "request"]) {
        if (typeof Spicetify.Platform[key]?.[fn] !== "function") continue;
        try {
          const r = await Spicetify.Platform[key][fn](item.uri);
          const lines = r?.lyrics?.lines || r?.lines;
          if (lines?.length) {
            return {
              lines: lines.map((l) => ({
                time: Number(l.startTimeMs ?? l.time ?? 0) / 1e3,
                text: (l.words ?? l.text ?? "").trim()
              })),
              synced: lines.some((l) => Number(l.startTimeMs ?? l.time ?? 0) > 0),
              via: `Platform.${key}.${fn}`
            };
          }
        } catch {
        }
      }
    }
    try {
      const r = await Spicetify.CosmosAsync.get(
        `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`
      );
      const lines = r?.lyrics?.lines;
      if (lines?.length) {
        return {
          lines: lines.map((l) => ({ time: Number(l.startTimeMs || 0) / 1e3, text: (l.words || "").trim() })),
          synced: r.lyrics.syncType !== "UNSYNCED",
          via: "CosmosAsync.color-lyrics"
        };
      }
    } catch {
    }
    return null;
  }
  function titleVariants(raw) {
    const t = (raw || "").trim();
    const out = [t];
    const stripped = t.replace(/\s*[\(\[][^)\]]*(feat|ft|with|remaster|remastered|version|edit|mix|live|bonus|deluxe|explicit)[^)\]]*[\)\]]/gi, "").replace(/\s*-\s*(\d{4}\s*)?(remaster(ed)?|radio edit|single version|album version|live)( \d{4})?$/i, "").trim();
    if (stripped && stripped !== t) out.push(stripped);
    const bare = stripped.replace(/\s*[\(\[].*?[\)\]]/g, "").trim();
    if (bare && !out.includes(bare)) out.push(bare);
    return out;
  }
  async function fromBetterLyrics(item) {
    const title = titleOf(item);
    const artist = (artistOf(item).split(",")[0] || "").trim();
    if (!title || !artist) return null;
    for (const variant of titleVariants(title)) {
      const q = new URLSearchParams({
        s: variant,
        a: artist,
        al: item.album?.name || item.metadata?.album_title || "",
        d: String(Math.round((Spicetify.Player.getDuration() || 0) / 1e3))
      });
      try {
        const r = await fetch(`${PROXY}/lyrics/ttml?${q}`);
        if (!r.ok) continue;
        const d = await r.json();
        const lines = d?.ttml ? parseTTML(d.ttml) : null;
        if (!lines) continue;
        return {
          lines,
          synced: true,
          words: lines.some((l) => l.words),
          via: `BetterLyrics${d.score ? ` (${d.score})` : ""}`
        };
      } catch {
        return null;
      }
    }
    return null;
  }
  async function fromLrclib(item) {
    const title = titleOf(item);
    const artist = (artistOf(item).split(",")[0] || "").trim();
    const album = item.album?.name || item.metadata?.album_title || "";
    const dur = Math.round((Spicetify.Player.getDuration() || 0) / 1e3);
    if (!title || !artist) return null;
    for (const variant of titleVariants(title)) {
      const hit = await lrclibTry(variant, artist, album, dur);
      if (hit) return hit;
    }
    return null;
  }
  async function lrclibTry(title, artist, album, dur) {
    const q = new URLSearchParams({
      track_name: title,
      artist_name: artist,
      album_name: album,
      duration: String(dur)
    });
    let plain = null;
    try {
      const r = await fetch(`${PROXY}/lyrics/lrclib?${q}`);
      if (r.ok) {
        const d = await r.json();
        if (d.syncedLyrics) return { lines: parseLRC(d.syncedLyrics), synced: true, via: "LRCLIB" };
        if (d.plainLyrics) {
          plain = {
            lines: d.plainLyrics.split(/\r?\n/).map((t) => ({ time: 0, text: t })),
            synced: false,
            via: "LRCLIB (unsynced)"
          };
        }
      }
    } catch {
      return null;
    }
    try {
      const s = await fetch(
        `${PROXY}/lyrics/lrclib-search?${new URLSearchParams({ track_name: title, artist_name: artist })}`
      );
      if (s.ok) {
        const list = await s.json();
        const best = list.filter((x) => x.syncedLyrics).sort((a, b) => Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur))[0];
        if (best && Math.abs((best.duration || 0) - dur) <= 5) {
          return { lines: parseLRC(best.syncedLyrics), synced: true, via: "LRCLIB search" };
        }
      }
    } catch {
    }
    return plain;
  }
  function plausible(lines) {
    if (!lines?.length) return false;
    const dur = (Spicetify.Player.getDuration() || 0) / 1e3;
    if (!dur) return true;
    const lastTime = lines[lines.length - 1].time;
    const firstTime = lines[0].time;
    if (lastTime > dur + 5) return false;
    if (firstTime > dur * 0.5 && lines.length > 4) return false;
    return true;
  }
  var PROVIDERS = ["auto", "lrclib", "betterlyrics"];

  // src/lyrics/view.js
  var lyrics = [];
  var lyricsUri = null;
  var lyricIdx = -1;
  var lyricsSource = "none";
  var lyricScale = (() => {
    try {
      const wasDisabled = localStorage.getItem("fsp:lyricsEnabled") === "0";
      localStorage.removeItem("fsp:lyricsEnabled");
      if (wasDisabled) return 0;
      return clamp(Number(localStorage.getItem("fsp:lyricScale")) || 1, 0, 3);
    } catch {
      return 1;
    }
  })();
  var SCALE_MIN = 0;
  var SCALE_MAX = 3;
  var lastLyricScale = lyricScale > 0 ? lyricScale : 1;
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
  function toggleLyricsVisible() {
    el.lszFill?.classList.add("fsp-anim");
    el.lszKnob?.classList.add("fsp-anim");
    setTimeout(() => {
      el.lszFill?.classList.remove("fsp-anim");
      el.lszKnob?.classList.remove("fsp-anim");
    }, 260);
    setLyricScale(lyricScale > 0 ? 0 : lastLyricScale || 1);
  }
  if (el.lszIcon) {
    el.lszIcon.addEventListener("click", toggleLyricsVisible);
    syncLyricsVisibility();
  }
  function paintLyricSlider() {
    const pct = (lyricScale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN) * 100;
    if (el.lszFill) el.lszFill.style.height = `${pct}%`;
    if (el.lszKnob) el.lszKnob.style.bottom = `${pct}%`;
    if (el.lszVal) el.lszVal.textContent = `${Math.round(lyricScale * 100)}%`;
  }
  function getLyricScale() {
    return lyricScale;
  }
  function setLyricScale(value) {
    const next = clamp(Math.round(value * 20) / 20, SCALE_MIN, SCALE_MAX);
    if (lyricScale > 0) lastLyricScale = lyricScale;
    lyricScale = next;
    root.style.setProperty("--fsp-lyric-scale", String(lyricScale));
    paintLyricSlider();
    syncLyricsVisibility();
    try {
      localStorage.setItem("fsp:lyricScale", String(lyricScale));
    } catch {
    }
    lyricIdx = -1;
  }
  function applyLyricScale(delta) {
    if (delta) lyricScale = clamp(Math.round((lyricScale + delta) * 20) / 20, SCALE_MIN, SCALE_MAX);
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
    try {
      localStorage.setItem("fsp:lyricScale", String(lyricScale));
    } catch {
    }
    lyricIdx = -1;
  }
  var providerIdx = 0;
  function cycleProvider() {
    providerIdx = (providerIdx + 1) % PROVIDERS.length;
    return PROVIDERS[providerIdx];
  }
  async function loadLyrics(item) {
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
      let bestSynced = null;
      let bestUnsynced = null;
      for (const fn of [fromOtherExtension, fromBetterLyrics, fromClient, fromLrclib]) {
        const r = await fn(item);
        if (!r?.lines?.length) continue;
        if (r.words) {
          result = r;
          break;
        }
        if (r.synced) bestSynced = bestSynced || r;
        else bestUnsynced = bestUnsynced || r;
      }
      result = result || bestSynced || bestUnsynced;
    }
    if (Spicetify.Player.data?.item?.uri !== uri) return;
    if (result?.lines?.length && !plausible(result.lines)) {
      console.info("[fsp] rejected lyrics \u2014 timings don't fit this track:", result.via);
      lyricsSource = `rejected (${result.via})`;
      return;
    }
    if (result?.lines?.length && result.synced) {
      lyrics = withGapMarkers(result.lines.filter((l) => l.text));
      lyricsSource = `${result.via}${result.words ? " \xB7 per-word" : ""}`;
      renderLyrics(true);
    } else if (result?.lines?.length) {
      lyricsSource = `${result.via} (unsynced, hidden)`;
    }
  }
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
    if (!lyrics.length) {
      box.hidden = true;
      return;
    }
    box.hidden = lyricScale <= 0;
    lyrics.forEach((line, idx) => {
      const el2 = document.createElement("div");
      el2.className = "fsp-line";
      const seek = () => Spicetify.Player.seek(line.time * 1e3);
      const wireHit = (node) => {
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
        const words = (line.text || "\u266A").split(/(\s+)/);
        let weight = 0;
        const weights = [];
        for (const w of words) {
          const ww = w.trim() ? w.trim().length + 1 : 0;
          weights.push(ww);
          weight += ww;
        }
        let acc = 0;
        words.forEach((w, k) => {
          if (!w.trim()) {
            el2.appendChild(document.createTextNode(w));
            return;
          }
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
  function syncLyrics(posSec) {
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
    const nRect = node.getBoundingClientRect();
    const bRect = box.getBoundingClientRect();
    const want = bRect.top + bRect.height * 0.45;
    const have = nRect.top + nRect.height / 2;
    scrollTarget = scrollPos - (have - want);
  }
  var scrollTarget = 0;
  var scrollPos = 0;
  var scrollVel = 0;
  function stepScroll(dt) {
    const inner = root.querySelector(".fsp-lyrics-inner");
    if (!inner) return;
    const steps = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      [scrollPos, scrollVel] = spring(scrollPos, scrollVel, scrollTarget, h, 420, 0.9);
    }
    inner.style.transform = `translate3d(0, ${scrollPos.toFixed(1)}px, 0)`;
  }
  function sweepWords(posSec) {
    if (lyricIdx < 0 || !lyrics.length) return;
    const inner = root.querySelector(".fsp-lyrics-inner");
    const node = inner.children[lyricIdx];
    if (!node) return;
    const line = lyrics[lyricIdx];
    if (line.dots) {
      const span = Math.max(0.5, (line.end || line.time + 5) - line.time);
      const p = clamp((posSec - line.time) / span, 0, 1);
      const dots = node.querySelectorAll(".fsp-dot");
      dots.forEach((d, k) => {
        const local = clamp(p * 3 - k, 0, 1);
        d.style.background = local > 0 ? `rgba(255,255,255,${0.22 + local * 0.7})` : "rgba(255,255,255,.22)";
        const breathe = 1 + 0.12 * Math.sin(posSec * 2.4 - k * 0.6) * (local > 0 ? 1 : 0.35);
        d.style.transform = `scale(${breathe})`;
      });
      return;
    }
    if (line.words) {
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
        const since = posSec - st;
        const env = since < dur ? Math.sin(Math.PI * clamp(since / dur, 0, 1) * 0.5) : Math.max(0, 1 - (since - dur) / 0.55);
        if (env <= 0.01) {
          w.style.textShadow = "none";
          w.style.transform = "none";
          continue;
        }
        const lit = 0.34 + 0.66 * clamp(p, 0, 1);
        w.style.color = posSec >= en ? "" : `rgba(255,255,255,${lit.toFixed(3)})`;
        const held = clamp(dur / 0.6, 0.6, 1.8);
        w.style.textShadow = `0 0 ${10 + env * 20}px rgba(255,255,255,${(0.12 + env * 0.4).toFixed(3)})`;
        w.style.transform = `translateY(${(-2.6 * env * held).toFixed(2)}px)`;
      }
      return;
    }
    for (const w of node.querySelectorAll(".fsp-w")) w.classList.add("fsp-said");
  }
  var OFFSETS = "fsp:offsets";
  var lyricOffset = 0;
  function offsetMap() {
    try {
      return JSON.parse(localStorage.getItem(OFFSETS) || "{}");
    } catch {
      return {};
    }
  }
  function loadOffset(uri) {
    lyricOffset = Number(offsetMap()[uri]) || 0;
  }
  function saveOffset(uri) {
    try {
      const m = offsetMap();
      if (lyricOffset) m[uri] = lyricOffset;
      else delete m[uri];
      localStorage.setItem(OFFSETS, JSON.stringify(m));
    } catch {
    }
  }
  function getLyricOffset() {
    return lyricOffset;
  }
  function nudgeOffset(delta, uri) {
    lyricOffset += delta;
    lyricOffset = Math.round(lyricOffset * 100) / 100;
    saveOffset(uri);
    lyricIdx = -1;
    return lyricOffset;
  }
  function resetOffset(uri) {
    lyricOffset = 0;
    saveOffset(uri);
    lyricIdx = -1;
    return lyricOffset;
  }
  function debugInfo() {
    return {
      source: lyricsSource,
      count: lyrics.length,
      offset: lyricOffset,
      providerName: PROVIDERS[providerIdx],
      lineIdx: lyricIdx,
      lineTime: lyricIdx >= 0 ? lyrics[lyricIdx]?.time : void 0
    };
  }

  // src/track.js
  function paintContext() {
    const c = Spicetify.Player.data?.context || Spicetify.Player.data?.contextMetadata || {};
    const meta = c.metadata || Spicetify.Player.data?.item?.metadata || {};
    const name = meta.context_description || c.name || Spicetify.Player.data?.item?.metadata?.album_title || "";
    const uri = c.uri || Spicetify.Player.data?.item?.metadata?.context_uri || "";
    const kind = uri.includes(":playlist:") ? "Playing from playlist" : uri.includes(":album:") ? "Playing from album" : uri.includes(":artist:") ? "Playing from artist" : uri.includes(":collection") ? "Playing from liked songs" : "Playing from";
    el.ctxKind.textContent = kind;
    el.ctxName.textContent = name;
    el.ctxName.parentElement.parentElement.style.display = name ? "" : "none";
  }
  function paintUpNext() {
    let track = null;
    try {
      track = Spicetify.Queue?.nextTracks?.[0]?.contextTrack || Spicetify.Queue?.nextTracks?.[0] || Spicetify.Platform.PlayerAPI?._queue?._queue?.nextTracks?.[0]?.contextTrack || null;
    } catch {
    }
    const meta = track?.metadata || {};
    const title = meta.title || track?.name || "";
    if (!title) {
      el.nextCard.hidden = true;
      return;
    }
    el.nextCard.hidden = false;
    el.nextTitle.textContent = meta.artist_name ? `${title} \u2022 ${meta.artist_name}` : title;
    const img = toUrl(meta.image_url || meta.image_large_url || "");
    el.nextArt.style.visibility = img ? "visible" : "hidden";
    if (img) el.nextArt.src = img;
  }
  function marqueeSeconds(distance, style2, speed) {
    return style2 === "ticker" ? clamp(distance / 55, 6, 40) / speed : clamp(distance / 22, 6, 26) / speed;
  }
  var TICKER_GAP = 48;
  var BOUNCE_HOLD_SECONDS = 0.5;
  function bounceHoldPercent(totalSeconds) {
    return clamp(BOUNCE_HOLD_SECONDS / totalSeconds * 100, 3, 15);
  }
  var mqStyleEl = null;
  function writeBounceKeyframes(rows) {
    if (!mqStyleEl) {
      mqStyleEl = document.createElement("style");
      document.head.appendChild(mqStyleEl);
    }
    mqStyleEl.textContent = rows.map(({ idx, seconds }) => {
      const p = bounceHoldPercent(seconds);
      const q = 100 - p;
      return `@keyframes fsp-mq-bounce-${idx} {
        0%, ${p}%   { transform: translateX(0); }
        ${q}%, 100% { transform: translateX(var(--fsp-marquee-shift, 0px)); }
      }`;
    }).join("\n");
  }
  function setupMarquee() {
    const viz = getVizSettings();
    const bounceRows = [];
    const boxes = [...root.querySelectorAll(".fsp-scroll")];
    boxes.forEach((box, idx) => {
      const track = box.firstElementChild;
      const original = track.firstElementChild;
      track.querySelector(".fsp-marquee-clone")?.remove();
      box.classList.remove("fsp-marquee-bounce", "fsp-marquee-ticker");
      box.removeAttribute("data-marquee-mode");
      track.style.removeProperty("animation");
      track.style.removeProperty("animation-name");
      track.style.removeProperty("transform");
      if (!viz.marqueeScroll) {
        box.style.overflow = "visible";
        original.style.whiteSpace = "nowrap";
        original.style.overflow = "visible";
        original.style.textOverflow = "clip";
        return;
      }
      box.style.removeProperty("overflow");
      original.style.removeProperty("white-space");
      original.style.removeProperty("overflow");
      original.style.removeProperty("text-overflow");
      const overflow = original.scrollWidth - box.clientWidth;
      if (overflow <= 1) {
        box.dataset.marqueeOverflow = "";
        return;
      }
      if (viz.marqueeStyle === "ticker") {
        const clone = original.cloneNode(true);
        clone.classList.add("fsp-marquee-clone");
        clone.style.marginLeft = `${TICKER_GAP}px`;
        clone.setAttribute("aria-hidden", "true");
        track.appendChild(clone);
        const distance = original.scrollWidth + TICKER_GAP;
        box.dataset.marqueeOverflow = String(distance);
        box.dataset.marqueeMode = "ticker";
        box.style.setProperty("--fsp-marquee-shift", `${-distance}px`);
        box.style.setProperty("--fsp-marquee-time", `${marqueeSeconds(distance, "ticker", viz.marqueeSpeed)}s`);
        box.classList.add("fsp-marquee-ticker");
      } else {
        const seconds = marqueeSeconds(overflow, "bounce", viz.marqueeSpeed);
        box.dataset.marqueeOverflow = String(overflow);
        box.dataset.marqueeMode = "bounce";
        box.style.setProperty("--fsp-marquee-shift", `${-overflow - 6}px`);
        box.style.setProperty("--fsp-marquee-time", `${seconds}s`);
        box.classList.add("fsp-marquee-bounce");
        track.style.setProperty("animation-name", `fsp-mq-bounce-${idx}`);
        bounceRows.push({ idx, seconds });
      }
    });
    writeBounceKeyframes(bounceRows);
    ensureMarqueeResizeObserver();
  }
  var marqueeResizeObserver = null;
  var marqueeResizeRaf = null;
  function ensureMarqueeResizeObserver() {
    if (marqueeResizeObserver || typeof ResizeObserver === "undefined") return;
    marqueeResizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(marqueeResizeRaf);
      marqueeResizeRaf = requestAnimationFrame(setupMarquee);
    });
    for (const box of root.querySelectorAll(".fsp-scroll")) {
      marqueeResizeObserver.observe(box);
      const original = box.firstElementChild?.firstElementChild;
      if (original) marqueeResizeObserver.observe(original);
    }
  }
  function applyMarqueeSpeed() {
    const viz = getVizSettings();
    const bounceRows = [];
    [...root.querySelectorAll(".fsp-scroll")].forEach((box, idx) => {
      if (!box.classList.contains("fsp-marquee-bounce") && !box.classList.contains("fsp-marquee-ticker")) return;
      const distance = Number(box.dataset.marqueeOverflow || 0);
      if (!distance) return;
      const seconds = marqueeSeconds(distance, box.dataset.marqueeMode, viz.marqueeSpeed);
      box.style.setProperty("--fsp-marquee-time", `${seconds}s`);
      if (box.dataset.marqueeMode === "bounce") bounceRows.push({ idx, seconds });
    });
    if (bounceRows.length) writeBounceKeyframes(bounceRows);
  }
  async function loadTrack() {
    const item = Spicetify.Player.data?.item;
    if (!item) return;
    const url = artOf(item);
    el.art.src = url;
    el.wash.style.backgroundImage = url ? `url("${url}")` : "none";
    el.title.textContent = titleOf(item);
    el.artist.textContent = artistOf(item);
    const albumName = item.album?.name || item.metadata?.album_title || "";
    const date = item.album?.release_date || item.metadata?.album_release_date || "";
    const year = /^(\d{4})/.exec(date)?.[1] || "";
    el.album.textContent = [albumName, year].filter(Boolean).join(" \u2022 ");
    el.album.parentElement.style.display = albumName ? "" : "none";
    paintContext();
    paintUpNext();
    requestAnimationFrame(setupMarquee);
    try {
      document.fonts?.ready?.then(setupMarquee);
    } catch {
    }
    setTimeout(setupMarquee, 400);
    loadVisual(item);
    loadLyrics(item);
    S.palette = await paletteFromArt(url);
    try {
      const c = await Spicetify.colorExtractor(item.uri);
      S.accent = c.VIBRANT || c.LIGHT_VIBRANT || c.PROMINENT || "#ffffff";
      root.style.setProperty("--fsp-bg", shade(c.DESATURATED || "#14161c", 0.45));
    } catch {
      S.accent = "#ffffff";
    }
  }

  // src/controls.js
  var lastVolume = 0.7;
  var shownVolume = -1;
  var volDragging = false;
  var readVolume = () => {
    const v = Spicetify.Player.getVolume?.() ?? Spicetify.Platform?.PlaybackAPI?.getVolume?.() ?? 0.7;
    return clamp(typeof v === "number" ? v : 0.7, 0, 1);
  };
  function writeVolume(v) {
    v = clamp(v, 0, 1);
    if (Spicetify.Player.setVolume) Spicetify.Player.setVolume(v);
    else Spicetify.Platform?.PlaybackAPI?.setVolume?.(v);
    paintVolume(v);
  }
  function paintVolume(v) {
    const pct = clamp(v, 0, 1) * 100;
    shownVolume = v;
    el.volFill.style.height = `${pct}%`;
    el.volKnob.style.bottom = `${pct}%`;
    el.volPct.textContent = `${Math.round(pct)}%`;
    el.mute.innerHTML = v <= 1e-3 ? icons.mute : icons.vol;
  }
  function maybeRepaintVolume() {
    if (volDragging) return;
    const v = readVolume();
    if (Math.abs(v - shownVolume) > 5e-3) paintVolume(v);
  }
  var volFromEvent = (e) => {
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
    if (cur > 1e-3) {
      lastVolume = cur;
      writeVolume(0);
    } else writeVolume(lastVolume || 0.7);
  });
  function syncToggles() {
    try {
      const hearted = Spicetify.Player.getHeart?.() ?? false;
      el.heart.innerHTML = hearted ? icons.heartFull : icons.heart;
      el.heart.classList.toggle("fsp-on", !!hearted);
      el.heart.setAttribute("aria-label", hearted ? "Remove from your library" : "Save to your library");
    } catch {
    }
    try {
      const sh = Spicetify.Player.getShuffle?.() ?? false;
      el.shuffle.classList.toggle("fsp-on", !!sh);
      el.shuffle.setAttribute("aria-pressed", String(!!sh));
    } catch {
    }
    try {
      const rp = Spicetify.Player.getRepeat?.() ?? 0;
      el.repeat.innerHTML = rp === 2 ? icons.repeatOne : icons.repeat;
      el.repeat.classList.toggle("fsp-on", rp !== 0);
      el.repeat.setAttribute(
        "aria-label",
        rp === 0 ? "Enable repeat" : rp === 1 ? "Repeat this track" : "Disable repeat"
      );
    } catch {
    }
  }
  el.heart.addEventListener("click", () => {
    try {
      Spicetify.Player.toggleHeart();
    } catch {
    }
    setTimeout(syncToggles, 120);
  });
  el.shuffle.addEventListener("click", () => {
    try {
      Spicetify.Player.toggleShuffle();
    } catch {
    }
    setTimeout(syncToggles, 120);
  });
  el.repeat.addEventListener("click", () => {
    try {
      const rp = Spicetify.Player.getRepeat?.() ?? 0;
      if (Spicetify.Player.setRepeat) Spicetify.Player.setRepeat((rp + 1) % 3);
      else Spicetify.Player.toggleRepeat();
    } catch {
    }
    setTimeout(syncToggles, 120);
  });
  function syncPlayIcon() {
    const playing = Spicetify.Player.isPlaying();
    el.play.innerHTML = playing ? icons.pause : icons.play;
    el.play.setAttribute("aria-label", playing ? "Pause" : "Play");
  }
  var seekTimer = null;
  var seekDir = 0;
  var seekHeld = 0;
  var seekTarget = 0;
  function startSeekHold(dir) {
    if (seekTimer && seekDir === dir) return;
    stopSeekHold();
    seekDir = dir;
    seekHeld = 0;
    seekTarget = Spicetify.Player.getProgress();
    const step = () => {
      const dur = Spicetify.Player.getDuration() || 0;
      const size = (2 + Math.min(13, seekHeld * 5.5)) * 1e3;
      seekHeld += 0.13;
      seekTarget = clamp(seekTarget + seekDir * size, 0, Math.max(0, dur - 500));
      Spicetify.Player.seek(seekTarget);
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
  function stopSeekHold() {
    clearInterval(seekTimer);
    seekTimer = null;
    seekDir = 0;
  }
  function onKeyUp(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") stopSeekHold();
  }
  var scaleFromEvent = (e) => {
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

  // src/index.js
  var open = false;
  var raf = null;
  var resizeObserver = null;
  var isResizing = false;
  var resizeSettleTimer = null;
  function markResizing() {
    isResizing = true;
    clearTimeout(resizeSettleTimer);
    resizeSettleTimer = setTimeout(() => {
      isResizing = false;
    }, 220);
  }
  function onViewportResize() {
    markResizing();
    resize();
    setupMarquee();
  }
  var idleTimer = null;
  function poke() {
    root.classList.remove("fsp-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add("fsp-idle"), 2200);
  }
  function motionReduced() {
    const m = getVizSettings().motionOverride;
    if (m === "on") return true;
    if (m === "off") return false;
    return reduced;
  }
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
    } catch {
    }
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
    if (e.key === " " && e.target === document.body) {
      e.preventDefault();
      Spicetify.Player.togglePlay();
    }
    if (e.key === "ArrowRight" && e.shiftKey) {
      Spicetify.Player.next();
      return;
    }
    if (e.key === "ArrowLeft" && e.shiftKey) {
      Spicetify.Player.back();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      startSeekHold(e.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (e.key === "[" || e.key === "]" || e.key === "\\") {
      const uri = Spicetify.Player.data?.item?.uri || "";
      const offset = e.key === "\\" ? resetOffset(uri) : nudgeOffset(e.key === "]" ? 0.25 : -0.25, uri);
      flash(`lyrics ${offset >= 0 ? "+" : ""}${offset.toFixed(2)}s (this track)`);
      return;
    }
    if (e.key === "+" || e.key === "=") {
      applyLyricScale(0.1);
      return;
    }
    if (e.key === "-" || e.key === "_") {
      applyLyricScale(-0.1);
      return;
    }
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
    if (e.key === "ArrowUp") {
      e.preventDefault();
      writeVolume(readVolume() + 0.05);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      writeVolume(readVolume() - 0.05);
    }
  }
  function paintDebug() {
    const box = root.querySelector(".fsp-debug");
    if (!box || box.hidden) return;
    const info = window.fsp();
    box.textContent = Object.entries(info).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`).join("\n");
  }
  var last = 0;
  var lastDebug = 0;
  var scrubbing = false;
  var nextSoon = false;
  var repPos = 0;
  var repAt = 0;
  var seekOverride = null;
  var SEEK_CATCHUP_MS = 900;
  var SEEK_GRACE_MS = 1500;
  function smoothProgress() {
    const p = Spicetify.Player.getProgress();
    const now = performance.now();
    if (seekOverride) {
      const caughtUp = Math.abs(p - seekOverride.target) < SEEK_CATCHUP_MS;
      const timedOut = now - seekOverride.at > SEEK_GRACE_MS;
      if (caughtUp || timedOut) {
        repPos = caughtUp ? p : seekOverride.target;
        repAt = now;
        seekOverride = null;
      } else {
        const drift2 = now - seekOverride.at;
        return seekOverride.target + (Spicetify.Player.isPlaying() ? drift2 : 0);
      }
    }
    if (p !== repPos) {
      repPos = p;
      repAt = now;
    }
    if (!Spicetify.Player.isPlaying()) return repPos;
    const drift = now - repAt;
    return repPos + Math.min(drift, 1200);
  }
  var lastVW = 0;
  var lastVH = 0;
  function pollViewportSize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw !== lastVW || vh !== lastVH) {
      lastVW = vw;
      lastVH = vh;
      markResizing();
      resize();
      setupMarquee();
    }
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1e3) || 0.016;
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
    const nextMode = getVizSettings().nextVisibility;
    const leadMs = getVizSettings().nextLeadSeconds * 1e3;
    const soon = nextMode === "always" ? true : nextMode === "auto" && dur > leadMs + 5e3 && dur - pos <= leadMs && dur - pos > 0;
    if (soon !== nextSoon) {
      nextSoon = soon;
      if (soon) paintUpNext();
      el.nextCard.classList.toggle("fsp-soon", soon);
    }
    maybeRepaintVolume();
    if (now - lastDebug > 400) {
      lastDebug = now;
      paintDebug();
    }
    const lyricPos = pos / 1e3 + getLyricOffset();
    syncLyrics(lyricPos);
    sweepWords(lyricPos);
    stepScroll(dt);
    if (!isResizing) {
      sample(pos / 1e3, dt);
      if (!motionReduced()) S.rotation += dt * getVizSettings().ringSpeed;
      draw();
      drawSpectrum();
    }
    raf = requestAnimationFrame(frame);
  }
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
      posReported: `${(repPos / 1e3).toFixed(2)}s`,
      posSmoothed: `${(smoothProgress() / 1e3).toFixed(2)}s`,
      posStaleFor: `${Math.round(performance.now() - repAt)}ms`,
      lyricLine: info.lineIdx >= 0 ? `${info.lineIdx} @ ${info.lineTime?.toFixed(2)}s` : "-",
      artSize: S.artSize,
      bands: S.bands.slice(0, 12).map((b) => +b.toFixed(2))
    };
  };
  function register() {
    if (!Spicetify.Player?.data || !Spicetify.Platform || !Spicetify.Playbar || !Spicetify.React) {
      setTimeout(register, 300);
      return;
    }
    Spicetify.Player.addEventListener("songchange", () => {
      nextSoon = false;
      el.nextCard.classList.remove("fsp-soon");
      if (open) {
        loadTrack();
        syncToggles();
        setTimeout(paintDebug, 1200);
      }
    });
    Spicetify.Player.addEventListener("onplaypause", syncPlayIcon);
    const playbarBtn = new Spicetify.Playbar.Button(
      "Fullscreen player",
      icons.expand,
      () => {
        open ? hide() : show();
      },
      false,
      false
    );
    playbarBtn.element.classList.add("fsp-playbar-btn");
    playbarBtn.element.innerHTML = icons.expand;
    playbarBtn.register();
    try {
      Spicetify.Keyboard.registerShortcut(
        { key: "f", ctrl: true, shift: true },
        () => open ? hide() : show()
      );
    } catch {
      document.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") open ? hide() : show();
      });
    }
  }
  register();
})();
