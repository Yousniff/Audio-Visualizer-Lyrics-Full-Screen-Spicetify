// Injected stylesheet for the fullscreen player. Import-time only touches
// document.head, so this can run before Spicetify itself is ready.

const CSS = `
  /* Spotify's own page never sets this, so without it every padded/bordered
     box in here (a select button, say: padding + a 1px border, at
     width:100%) renders a few pixels WIDER than its container instead of
     fitting inside it — content-box adds padding/border on top of the
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
  /* Idle hides the cursor entirely — meant for real OS fullscreen, where
     there's nothing left to click anyway. In windowed mode it was doing
     the same thing and quietly working against dragging the window: with
     no visible cursor, the first grab attempt after being idle for a
     couple seconds is aimed blind, and if it lands a few pixels off the
     drag strip it just silently fails with no feedback — which reads as
     "sometimes it lets me grab it, sometimes it doesn't" even though
     nothing is actually random about it. Scoped to real fullscreen only. */
  .fsp-root.fsp-fs.fsp-idle { cursor: none; }
  .fsp-root.fsp-idle .fsp-chrome { opacity: 0; }

  /* Window dragging: the overlay covers Spotify's drag region, so put it back.
     Spotify's own minimise/maximise/close draw above the page in the top-right,
     so that corner is kept clear. Taller than the "Playing from" card alone
     (which was the whole visible target before) so there's real margin for
     error above/around it — anything actually clickable in this band (the
     gear button, once the panel's open) stays reachable regardless, since
     a no-drag element always wins over a draggable ancestor region behind
     it for its own bounds. */
  .fsp-drag { position: absolute; top: 0; left: 0; right: 180px; height: 90px; -webkit-app-region: drag; }
  .fsp-root button, .fsp-root .fsp-hit { -webkit-app-region: no-drag; }
  /* The "Playing from" label sits on top of .fsp-drag (same top-left
     corner) but, being a plain div with no app-region of its own, it
     was treated as non-draggable and silently ate drag attempts made
     over it — grabbing the window there did nothing. */
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
  /* Fixed width regardless of digit count ("0%" vs "70%" vs "100%") — this
     box is positioned by its left edge but sizes to content by default, so
     without a fixed width here, muting (which shortens the text) shrank
     the box from the right and dragged its centered children — the track,
     the knob — left along with it. Same fix applied to the lyric-scale
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
  /* Stay visible while the panel is open even if the mouse goes idle —
     otherwise adjusting a slider and then pausing to look at the result
     would fade the whole panel out from under the cursor. */
  .fsp-settings.fsp-panel-open { opacity: 1 !important; }
  .fsp-settings:hover { color: rgba(255,255,255,.95); }
  .fsp-gear { background: none; border: 0; padding: 2px; color: inherit; cursor: pointer; display: block; }
  /* Sized a bit larger than the volume/lyric icons (15px) so a plain gear
     glyph doesn't read as noticeably smaller than its neighbors. */
  .fsp-gear > svg { width: 21px; height: 21px; fill: currentColor; display: block; transition: transform .3s ease; }
  .fsp-settings.fsp-panel-open .fsp-gear > svg { transform: rotate(35deg); }

  /* --- panel: "liquid glass" — a frosted, saturated blur behind a very
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
     dragging it — label left, live value pill right, same row. */
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
     has no built-in concept of "how full" to render — the gradient split
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
     shown — its native dropdown popup is an OS-level overlay that CSS can
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
     actual screen coordinates, not against .fsp-select-wrap — it's
     portaled onto <body> so it isn't clipped by the panel's own rounded
     corners or its scrollable body. position: fixed so those JS-set
     left/top/bottom coordinates read as viewport coordinates, matching
     what getBoundingClientRect() gave them.

     Living on <body> also makes it a *sibling* of .fsp-root (the whole
     fullscreen overlay), not a descendant — so it no longer inherits
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
       its visible text happens to sit — the mask-image only fades the
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
       grid below doesn't shrink the icons (they're fixed size) — it just
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
     never detected — which is why only the row that happens to force the
     title container to its max-width (usually the title) ever measured
     as overflowing, and every other row silently never scrolled. */
  .fsp-scroll { overflow: hidden; min-width: 0; flex: 1 1 auto; }
  /* .fsp-mqtrack wraps the actual title/artist/album element and, only in
     ticker mode, a second cloned copy right after it — inline-flex keeps
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
     first one started — a loop with no reset to notice, unlike bounce's
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
       win clicks in this host's renderer regardless — the panel kept
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
     while manually dragging the slider — a transition there would make
     dragging feel laggy, chasing the cursor instead of tracking it. */
  .fsp-lsz-fill.fsp-anim { transition: height .25s ease; }
  .fsp-lsz-knob.fsp-anim { transition: opacity .15s ease, bottom .25s ease; }
  .fsp-lyric-size:hover .fsp-lsz-knob { opacity: 1; }
  /* Now an inline SVG using currentColor, exactly like .fsp-mute — so it
     inherits .fsp-lyric-size's color/hover directly (rgba(255,255,255,.55)
     → .95 on hover) the same way .fsp-mute inherits from .fsp-volume
     (rgba(255,255,255,.6) → .95). Same mechanism, not just matched
     numbers, so it can't drift out of sync again. */
  .fsp-lsz-icon { display: block; cursor: pointer; color: inherit; transition: opacity .2s ease; }
  .fsp-lsz-icon svg { width: 15px; height: 15px; fill: currentColor; display: block; }
  /* Lyrics turned off (scale at 0) via clicking this icon or dragging the
     slider down — see toggleLyricsVisible/setLyricScale in view.js. */
  .fsp-lsz-icon.fsp-off { opacity: .5; }
  @media (max-width: 720px) { .fsp-lyric-size { display: none; } }

  .fsp-lyrics-note {
    text-align: right; width: 100%;
    font-size: 13px; color: rgba(255,255,255,.3);
  }
  /* Narrow windows keep the lyrics — just tighter type and less padding.
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

const style = document.createElement("style");
style.id = "fsp-style";
style.textContent = CSS;
document.head.appendChild(style);
