// fullscreenPlayer.js — a fullscreen now-playing view for Spicetify
//
// Artwork on the left with a live ring visualizer and full-width spectrum
// bars, blurred artwork/Canvas/artist-image backdrop, context label, vertical
// volume, up-next card, and synced (word-level, where available) lyrics
// filling the right half.
//
// Reactivity comes from a companion process, the "audio bridge"
// (see /bridge), which captures Spotify's own audio output via WASAPI
// per-process loopback and streams FFT bands over ws://127.0.0.1:8787. That
// process also proxies lyrics lookups, since the lyrics APIs used here send
// no CORS headers. Without the bridge running, everything still works —
// the rings fall back to a slow ambient motion and lyrics still load, just
// without a synced audio-reactive feel.
//
// Install:
//   1. copy this file to %appdata%\spicetify\Extensions\
//   2. spicetify config extensions fullscreenPlayer.js
//   3. spicetify apply
//
// Open with the topbar button (top-right, the rings icon) or Ctrl+Shift+F.
// Esc closes. Press D for a debug readout, L to cycle the lyrics source for
// the current track, [ and ] to nudge lyric sync per track, + and - (or the
// slider next to the artwork) to resize lyrics, F to toggle real fullscreen.
//
// See ../README.md for full setup, and ../bridge/ for the companion process
// this depends on for audio reactivity and CORS-free lyrics lookups.

(function fullscreenPlayer() {
  const VERSION = "1.0.0";
  // The bridge doubles as a lyrics proxy: the lyrics APIs send no CORS
  // headers, so the page can't call them directly, but a local process can.
  const PROXY = "http://127.0.0.1:8787";
  const { Player, Platform, Topbar, React } = Spicetify;
  if (!Player?.data || !Platform || !Topbar || !React) {
    setTimeout(fullscreenPlayer, 300);
    return;
  }

  /* ================================================================== *
   * Style
   * ================================================================== */

  const CSS = `
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
  .fsp-root.fsp-idle  { cursor: none; }
  .fsp-root.fsp-idle .fsp-chrome { opacity: 0; }

  /* Window dragging: the overlay covers Spotify's drag region, so put it back.
     Spotify's own minimise/maximise/close draw above the page in the top-right,
     so that corner is kept clear. */
  .fsp-drag { position: absolute; top: 0; left: 0; right: 180px; height: 52px; -webkit-app-region: drag; }
  .fsp-root button, .fsp-root .fsp-hit { -webkit-app-region: no-drag; }

  /* Track-specific visuals sit behind the blurred cover: Spotify's Canvas
     video when the track has one, otherwise artist imagery. */
  .fsp-canvasvid {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; opacity: 0;
    transition: opacity 1.1s ease;
    pointer-events: none;
  }
  .fsp-canvasvid.fsp-on { opacity: .55; }

  .fsp-backdrop {
    position: absolute; inset: -6%;
    background-size: cover; background-position: center;
    opacity: 0; filter: saturate(115%);
    transition: opacity 1.2s ease;
    animation: fsp-drift 42s ease-in-out infinite alternate;
  }
  .fsp-backdrop.fsp-on { opacity: .42; }
  @keyframes fsp-drift {
    from { transform: scale(1.04) translate3d(0, 0, 0); }
    to   { transform: scale(1.14) translate3d(-2%, -1.5%, 0); }
  }
  @media (prefers-reduced-motion: reduce) { .fsp-backdrop { animation: none; } }

  /* --- backdrop --- */
  .fsp-root.fsp-hasvisual .fsp-wash { opacity: .22; }
  .fsp-wash {
    position: absolute; inset: -15%;
    background-size: cover; background-position: center;
    filter: blur(90px) saturate(180%);
    opacity: .5; transform: scale(1.15);
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

  .fsp-context {
    position: absolute; top: 22px; left: 26px; z-index: 4;
    display: flex; align-items: center; gap: 12px;
    max-width: 44vw;
  }
  .fsp-context svg { width: 17px; height: 17px; fill: rgba(255,255,255,.75); flex: none; }
  .fsp-context-text { min-width: 0; }
  .fsp-context-kind {
    font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
    color: rgba(255,255,255,.55);
  }
  .fsp-context-name {
    font-size: 14px; font-weight: 600; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .fsp-next {
    position: absolute; top: 14px; right: 200px;
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
    position: absolute; left: 26px; top: 50%; transform: translateY(-50%);
    z-index: 4;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    color: rgba(255,255,255,.6);
    transition: opacity .35s ease, color .15s ease;
  }
  .fsp-volume:hover { color: rgba(255,255,255,.95); }
  .fsp-vol-pct { font-size: 11px; font-variant-numeric: tabular-nums; }
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
    box-shadow: 0 26px 60px rgba(0,0,0,.62);
  }

  /* Transport hides unless the mouse is moving. */
  .fsp-transport {
    position: relative; z-index: 2;
    margin-top: calc(-1 * var(--fsp-band, 0px) + 10px);
    text-shadow: 0 2px 10px rgba(0,0,0,.75);
    display: flex; flex-direction: column; gap: 9px;
    width: var(--fsp-art, 300px);
    opacity: 1; transition: opacity .3s ease;
  }
  .fsp-root.fsp-idle .fsp-transport { opacity: 0; pointer-events: none; }

  .fsp-meta {
    position: absolute; left: 30px; bottom: 26px; z-index: 2;
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
  .fsp-scroll { overflow: hidden; min-width: 0; }
  /* The edge fade belongs only to rows that actually scroll. */
  .fsp-scroll.fsp-marquee {
    -webkit-mask-image: linear-gradient(90deg, #000 92%, transparent);
            mask-image: linear-gradient(90deg, #000 92%, transparent);
  }
  .fsp-scroll.fsp-marquee > * { text-overflow: clip; }
  .fsp-scroll.fsp-marquee > * {
    display: inline-block;
    animation: fsp-marquee var(--fsp-marquee-time, 12s) linear infinite;
  }
  @keyframes fsp-marquee {
    0%, 12%   { transform: translateX(0); }
    88%, 100% { transform: translateX(var(--fsp-marquee-shift, 0px)); }
  }
  @media (prefers-reduced-motion: reduce) {
    .fsp-scroll.fsp-marquee > * { animation: none; }
    .fsp-scroll > * { text-overflow: ellipsis; }
  }
  .fsp-row-album span { color: rgba(255,255,255,.5); font-size: clamp(13px, 1.9vh, 17px); }
  .fsp-title {
    margin: 0; font-weight: 800; letter-spacing: -.015em;
    font-size: clamp(24px, 4.6vh, 46px);
    white-space: nowrap;
  }
  .fsp-artist {
    margin: 0; color: rgba(255,255,255,.65);
    font-size: clamp(15px, 2.4vh, 22px);
    white-space: nowrap;
  }

  .fsp-bar {
    width: var(--fsp-art, 300px);
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
    cursor: pointer;
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
    /* Centred on the window exactly like the volume slider, so the two line
       up. Horizontal position is measured from the artwork's right edge. */
    position: absolute; top: 50%; left: var(--fsp-lsz-left, 60%);
    transform: translateY(-50%);
    z-index: 4;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    color: rgba(255,255,255,.55);
    opacity: 0; transition: opacity .3s ease, color .15s ease;
    pointer-events: auto;
  }
  .fsp-root:not(.fsp-idle) .fsp-lyric-size { opacity: 1; }
  .fsp-lyric-size:hover { color: rgba(255,255,255,.95); }
  .fsp-lsz-val { font-size: 11px; font-variant-numeric: tabular-nums; }
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
  .fsp-lyric-size:hover .fsp-lsz-knob { opacity: 1; }
  .fsp-lsz-icon {
    font-size: 15px; line-height: 1; display: block;
    filter: grayscale(.25);
    opacity: .85;
  }
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

  @media (max-width: 820px) {
    .fsp-stage { width: 100vw; max-width: none; }
  }
  @media (prefers-reduced-motion: reduce) { .fsp-root, .fsp-wash, .fsp-btn { transition: none; } }
  `;

  const style = document.createElement("style");
  style.id = "fsp-style";
  style.textContent = CSS;
  document.head.appendChild(style);

  /* ================================================================== *
   * Markup
   * ================================================================== */

  const icons = {
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
    expand: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.06 1H1v5.06h1.5V3.56l3.5 3.5 1.06-1.06-3.5-3.5h2.5V1zM10 15h5.06V9.94h-1.5v2.5l-3.5-3.5L9 10l3.5 3.5H10V15z"/></svg>`,
  };

  const root = document.createElement("div");
  root.className = "fsp-root";
  root.innerHTML = `
    <video class="fsp-canvasvid" muted loop playsinline></video>
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

    <div class="fsp-chrome">
      <div class="fsp-context">
        ${icons.queue}
        <div class="fsp-context-text">
          <div class="fsp-context-kind">Playing from</div>
          <div class="fsp-context-name"></div>
        </div>
      </div>

      <div class="fsp-volume">
        <div class="fsp-vol-pct">70%</div>
        <div class="fsp-vol-track fsp-hit"><div class="fsp-vol-fill"></div><div class="fsp-vol-knob"></div></div>
        <button class="fsp-mute" aria-label="Mute">${icons.vol}</button>
      </div>

      <button class="fsp-close" aria-label="Close fullscreen">${icons.close}</button>
      <pre class="fsp-debug" hidden></pre>
    </div>

      <div class="fsp-meta">
        <div class="fsp-row fsp-row-title">${icons.note}<div class="fsp-scroll"><h1 class="fsp-title"></h1></div></div>
        <div class="fsp-row">${icons.person}<div class="fsp-scroll"><span class="fsp-artist"></span></div></div>
        <div class="fsp-row fsp-row-album">${icons.disc}<div class="fsp-scroll"><span class="fsp-album"></span></div></div>
      </div>

    <div class="fsp-lyric-size">
      <div class="fsp-lsz-val">100%</div>
      <div class="fsp-lsz-track fsp-hit"><div class="fsp-lsz-fill"></div><div class="fsp-lsz-knob"></div></div>
      <span class="fsp-lsz-icon" role="img" aria-label="Lyrics size">🎤</span>
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

  const el = {
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
  };
  const ctx = el.canvas.getContext("2d");

  /* ================================================================== *
   * State
   * ================================================================== */

  let open = false, raf = null;
  // Fullscreen preference, remembered between sessions. F toggles it.
  let wantFullscreen = (() => {
    try { return localStorage.getItem("fsp:fullscreen") !== "0"; } catch { return true; }
  })();
  let N = 12;                       // band count, set by the bridge
  let liveBands = new Array(N).fill(0.3), liveEnergy = 0.3;
  let bands = new Array(N).fill(0.3), bandVel = new Array(N).fill(0);

  function resizeBands(n) {
    if (n === N) return;
    N = n;
    bands = new Array(N).fill(0.3);
    bandVel = new Array(N).fill(0);
  }
  let energy = 0.3, energyVel = 0, pulse = 0;
  let accent = "#ffffff";
  let palette = null;      // colours sampled from the current artwork
  let rotation = 0, artSize = 300;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  /* ================================================================== *
   * Track info
   * ================================================================== */

  function toUrl(raw) {
    if (!raw) return "";
    return raw.startsWith("spotify:image:")
      ? `https://i.scdn.co/image/${raw.slice("spotify:image:".length)}`
      : raw;
  }

  function artOf(item) {
    if (!item) return "";
    return toUrl(
      item.album?.images?.at(-1)?.url ||
        item.metadata?.image_xlarge_url ||
        item.metadata?.image_large_url ||
        item.metadata?.image_url ||
        ""
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

  // "Playing from playlist / Hop Hip"
  function paintContext() {
    const c = Player.data?.context || Player.data?.contextMetadata || {};
    const meta = c.metadata || Player.data?.item?.metadata || {};
    const name =
      meta.context_description ||
      c.name ||
      Player.data?.item?.metadata?.album_title ||
      "";
    const uri = c.uri || Player.data?.item?.metadata?.context_uri || "";
    const kind = uri.includes(":playlist:")
      ? "Playing from playlist"
      : uri.includes(":album:")
      ? "Playing from album"
      : uri.includes(":artist:")
      ? "Playing from artist"
      : uri.includes(":collection")
      ? "Playing from liked songs"
      : "Playing from";
    el.ctxKind.textContent = kind;
    el.ctxName.textContent = name;
    el.ctxName.parentElement.parentElement.style.display = name ? "" : "none";
  }

  function paintUpNext() {
    let track = null;
    try {
      track =
        Spicetify.Queue?.nextTracks?.[0]?.contextTrack ||
        Spicetify.Queue?.nextTracks?.[0] ||
        Platform.PlayerAPI?._queue?._queue?.nextTracks?.[0]?.contextTrack ||
        null;
    } catch {}

    const meta = track?.metadata || {};
    const title = meta.title || track?.name || "";
    if (!title) {
      el.nextCard.hidden = true;
      return;
    }
    el.nextCard.hidden = false;   // visibility is handled by .fsp-soon
    el.nextTitle.textContent = meta.artist_name ? `${title} • ${meta.artist_name}` : title;
    const img = toUrl(meta.image_url || meta.image_large_url || "");
    el.nextArt.style.visibility = img ? "visible" : "hidden";
    if (img) el.nextArt.src = img;
  }

  /* ------------------------------------------------------------------ *
   * Palette: sample the artwork and keep a spread of distinct hues, so the
   * rings carry the cover's colours rather than one flat accent.
   * ------------------------------------------------------------------ */

  const swatchCanvas = document.createElement("canvas");
  swatchCanvas.width = swatchCanvas.height = 40;
  const swatchCtx = swatchCanvas.getContext("2d", { willReadFrequently: true });

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
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

          // Bucket by hue, keeping the most saturated example of each.
          const buckets = new Map();
          for (let i = 0; i < data.length; i += 4) {
            const [h, sat, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (l < 0.12 || l > 0.94) continue;      // skip near-black/white
            const key = Math.round(h * 11);           // 12 hue buckets
            const score = sat * (1 - Math.abs(l - 0.55));
            const prev = buckets.get(key);
            if (!prev || score > prev.score) {
              buckets.set(key, { score, css: `rgb(${data[i]},${data[i+1]},${data[i+2]})`, h, sat });
            }
          }

          let list = [...buckets.values()].filter((c) => c.sat > 0.12);
          if (list.length < 2) return resolve(null);  // monochrome cover
          list.sort((a, b) => a.h - b.h);             // around the colour wheel
          if (list.length > 5) {
            const step = list.length / 5;
            list = [0, 1, 2, 3, 4].map((i) => list[Math.floor(i * step)]);
          }
          resolve(list.map((c) => c.css));
        } catch {
          resolve(null);   // canvas tainted — fall back to colorExtractor
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Scroll a row only if it doesn't fit, at a speed proportional to how far
  // it has to travel, so long titles don't whip past.
  function setupMarquee() {
    for (const box of root.querySelectorAll(".fsp-scroll")) {
      const child = box.firstElementChild;
      box.classList.remove("fsp-marquee");
      child.style.removeProperty("animation");
      const overflow = child.scrollWidth - box.clientWidth;
      if (overflow > 6) {
        box.style.setProperty("--fsp-marquee-shift", `${-overflow - 6}px`);
        box.style.setProperty("--fsp-marquee-time", `${clamp(overflow / 22, 6, 26)}s`);
        box.classList.add("fsp-marquee");
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Track visuals: Canvas video first, then artist imagery. Both are
   * best-effort — the API surface differs between client versions, so every
   * strategy is wrapped and failure just means we keep the blurred cover.
   * ------------------------------------------------------------------ */

  let visualSource = "none";     // reported by the debug panel

  async function fetchCanvas(uri, item) {
    // The client tells us up front on most builds.
    if (item && item.hasAssociatedVideo === false) return null;

    // Strategy 1: a dedicated platform API, where the client exposes one.
    for (const key of Object.keys(Platform || {})) {
      if (!/canvas/i.test(key)) continue;
      const api = Platform[key];
      for (const fn of ["getCanvases", "getCanvas", "getCanvasForTrack", "request"]) {
        if (typeof api?.[fn] !== "function") continue;
        try {
          const r = await api[fn]([uri]) ?? await api[fn](uri);
          const url = findVideoUrl(r);
          if (url) return { url, via: `Platform.${key}.${fn}` };
        } catch {}
      }
    }

    // Strategy 2: the persisted "canvas" query. It takes trackUri (not uri)
    // and answers at data.trackUnion.canvas, which is null when the track
    // simply hasn't got one.
    try {
      const defs = Spicetify.GraphQL?.Definitions || {};
      if (defs.canvas) {
        const r = await Spicetify.GraphQL.Request(defs.canvas, { trackUri: uri });
        const canvas = r?.data?.trackUnion?.canvas;
        if (canvas) {
          const url =
            canvas.url ||
            canvas.videoUrl ||
            canvas.files?.[0]?.url ||
            canvas.sources?.[0]?.url ||
            findVideoUrl(canvas);
          if (url) return { url, via: "GraphQL.canvas" };
        }
      }
    } catch {}

    return null;
  }

  // Walk an unknown response shape looking for something video-ish.
  function findVideoUrl(obj, depth = 0) {
    if (!obj || depth > 6) return null;
    if (typeof obj === "string") return /\.mp4|canvaz|video/i.test(obj) && /^https?:/.test(obj) ? obj : null;
    if (Array.isArray(obj)) {
      for (const v of obj) { const r = findVideoUrl(v, depth + 1); if (r) return r; }
      return null;
    }
    if (typeof obj === "object") {
      for (const v of Object.values(obj)) { const r = findVideoUrl(v, depth + 1); if (r) return r; }
    }
    return null;
  }

  async function fetchArtistImage(item) {
    const artistUri =
      item?.artists?.[0]?.uri || item?.metadata?.artist_uri || "";
    if (!artistUri) return null;
    try {
      const defs = Spicetify.GraphQL?.Definitions || {};
      const name = defs.queryArtistOverview ? "queryArtistOverview"
        : Object.keys(defs).find((k) => /artistOverview/i.test(k));
      if (!name) return null;
      const r = await Spicetify.GraphQL.Request(defs[name], {
        uri: artistUri, locale: "", includePrerelease: false,
      });
      const v = r?.data?.artistUnion?.visuals;
      const url =
        v?.headerImage?.sources?.[0]?.url ||
        v?.imageGroup?.sources?.[0]?.url ||
        v?.avatarImage?.sources?.[0]?.url ||
        null;
      return url ? { url, via: `GraphQL.${name}` } : null;
    } catch {
      return null;
    }
  }

  async function loadVisual(item) {
    const vid = root.querySelector(".fsp-canvasvid");
    const back = root.querySelector(".fsp-backdrop");
    vid.classList.remove("fsp-on");
    back.classList.remove("fsp-on");
    root.classList.remove("fsp-hasvisual");
    visualSource = "none";

    const uri = item.uri;

    const canvas = await fetchCanvas(uri, item);
    if (canvas && Player.data?.item?.uri === uri) {
      vid.src = canvas.url;
      vid.play?.().catch(() => {});
      vid.classList.add("fsp-on");
      root.classList.add("fsp-hasvisual");
      visualSource = `canvas (${canvas.via})`;
      return;
    }
    vid.removeAttribute("src");

    const art = await fetchArtistImage(item);
    if (art && Player.data?.item?.uri === uri) {
      back.style.backgroundImage = `url("${art.url}")`;
      back.classList.add("fsp-on");
      root.classList.add("fsp-hasvisual");
      visualSource = `artist image (${art.via})`;
    }
  }

  /* ------------------------------------------------------------------ *
   * Lyrics. Tries the client's own provider first, then LRCLIB — a free
   * community database of time-synced LRC files.
   * ------------------------------------------------------------------ */

  let lyrics = [];            // [{ time: seconds, text }]
  let lyricsUri = null;
  let lyricIdx = -1;
  let lyricsSource = "none";

  // "[01:23.45] line" -> { time, text }
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

  // Normalise the various shapes lyrics providers use into {time, text}.
  function normalizeLines(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    const lines = raw
      .map((l) => {
        if (typeof l === "string") return null;
        const t = l.startTimeMs ?? l.time ?? l.startTime ?? l.ts ?? null;
        const txt = l.words ?? l.text ?? l.line ?? l.content ?? "";
        if (txt == null) return null;
        const secs = t == null ? 0 : Number(t) > 1000 ? Number(t) / 1000 : Number(t);
        return { time: Number.isFinite(secs) ? secs : 0, text: String(txt).trim() };
      })
      .filter(Boolean);
    return lines.length ? lines : null;
  }

  // Beautiful Lyrics stores syllable-synced data in its own shape: lines with
  // a Lead vocal containing Syllables, each with StartTime/EndTime in seconds.
  // Walk an unknown object looking for that structure (or anything close).
  function linesFromUnknown(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;

    // A container of lines.
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
        const toSec = (v) => (v > 1000 ? v / 1000 : v);

        if (Array.isArray(syl) && syl.length) {
          const words = syl.map((w) => ({
            t: toSec(Number(w.StartTime ?? w.startTime ?? w.time ?? 0)),
            end: toSec(Number(w.EndTime ?? w.endTime ?? 0)),
            text: String(w.Text ?? w.text ?? "") + (w.IsPartOfWord || w.isPartOfWord ? "" : " "),
          }));
          lines.push({
            time: toSec(start) || words[0]?.t || 0,
            end: toSec(finish) || words.at(-1)?.end || 0,
            text: words.map((w) => w.text).join("").trim(),
            words,
          });
        } else {
          const text = String(entry?.Text ?? entry?.text ?? lead?.Text ?? "").trim();
          if (!text && !start) continue;
          lines.push({ time: toSec(start), end: toSec(finish), text, words: null });
        }
      }
      if (lines.length) return lines.sort((a, b) => a.time - b.time);
    }

    // Otherwise keep digging.
    for (const v of Object.values(obj)) {
      const r = linesFromUnknown(v, depth + 1);
      if (r) return r;
    }
    return null;
  }

  // Borrow from another lyrics extension if one has already fetched this
  // track — same data, no second request, and the two views stay in step.
  async function fromOtherExtension(item) {
    const uri = item.uri;
    const id = uri.split(":").pop();

    // 1. Globals an extension may have left behind.
    for (const key of Object.getOwnPropertyNames(window)) {
      if (!/lyric/i.test(key)) continue;
      let val;
      try { val = window[key]; } catch { continue; }
      if (!val) continue;

      const candidates = [
        val.currentLyrics, val.lyrics, val.CACHE?.[uri], val.cache?.[uri],
        val.CACHE?.[id], val.cache?.[id], val.state?.lyrics, val.data?.lyrics,
      ];
      for (const c of candidates) {
        const lines = linesFromUnknown(c) || normalizeLines(c?.lines || c?.synced || c);
        if (lines) {
          return {
            lines,
            synced: lines.some((l) => l.time > 0),
            words: lines.some((l) => l.words),
            via: `window.${key}`,
          };
        }
      }
      // A getter-style API.
      for (const fn of ["getLyrics", "fetchLyrics", "getCurrent"]) {
        if (typeof val[fn] !== "function") continue;
        try {
          const r = await val[fn](uri);
          const lines = normalizeLines(r?.lines || r?.synced || r);
          if (lines) return { lines, synced: lines.some((l) => l.time > 0), via: `window.${key}.${fn}` };
        } catch {}
      }
    }

    // 2. Anything cached in localStorage against this track.
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !/lyric/i.test(k)) continue;
        const blob = localStorage.getItem(k) || "";
        if (!k.includes(id) && !k.includes(uri) && !blob.includes(id)) continue;
        const parsed = JSON.parse(localStorage.getItem(k));
        // Some extensions keep one blob keyed by track id inside.
        const scoped = parsed?.[id] || parsed?.[uri] || parsed;
        const lines =
          linesFromUnknown(scoped) ||
          normalizeLines(scoped?.lines) ||
          normalizeLines(scoped?.synced) ||
          normalizeLines(scoped);
        if (lines) {
          return {
            lines,
            synced: lines.some((l) => l.time > 0),
            words: lines.some((l) => l.words),
            via: `localStorage:${k.slice(0, 28)}`,
          };
        }
      }
    } catch {}

    return null;
  }

  async function fromClient(item) {
    const id = item.uri.split(":").pop();

    // Any platform API this build happens to expose.
    for (const key of Object.keys(Platform || {})) {
      if (!/lyric/i.test(key)) continue;
      for (const fn of ["getLyrics", "getColorLyrics", "fetchLyrics", "request"]) {
        if (typeof Platform[key]?.[fn] !== "function") continue;
        try {
          const r = await Platform[key][fn](item.uri);
          const lines = r?.lyrics?.lines || r?.lines;
          if (lines?.length) {
            return {
              lines: lines.map((l) => ({
                time: Number(l.startTimeMs ?? l.time ?? 0) / 1000,
                text: (l.words ?? l.text ?? "").trim(),
              })),
              synced: lines.some((l) => Number(l.startTimeMs ?? l.time ?? 0) > 0),
              via: `Platform.${key}.${fn}`,
            };
          }
        } catch {}
      }
    }

    // The colour-lyrics endpoint, where Cosmos can reach it.
    try {
      const r = await Spicetify.CosmosAsync.get(
        `https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`
      );
      const lines = r?.lyrics?.lines;
      if (lines?.length) {
        return {
          lines: lines.map((l) => ({ time: Number(l.startTimeMs || 0) / 1000, text: (l.words || "").trim() })),
          synced: r.lyrics.syncType !== "UNSYNCED",
          via: "CosmosAsync.color-lyrics",
        };
      }
    } catch {}

    return null;
  }

  // "00:01:18.234" -> seconds
  function ttmlTime(v) {
    if (!v) return 0;
    const parts = String(v).split(":").map(parseFloat);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  // Better Lyrics returns TTML with per-syllable <span begin end> inside each
  // <p> line — real word timing rather than interpolation.
  function parseTTML(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return null;

    const out = [];
    for (const p of doc.getElementsByTagName("p")) {
      // Walk child nodes, not just the spans: the spaces between syllables are
      // plain text nodes in between, and collecting only spans loses them.
      const words = [];
      for (const node of p.childNodes) {
        if (node.nodeType === 3) {                       // text node
          const ws = node.textContent;
          if (!ws) continue;
          if (words.length) words[words.length - 1].text += ws;
          continue;
        }
        if (node.nodeType !== 1) continue;
        if (node.tagName?.toLowerCase() !== "span") continue;
        if (!node.getAttribute("begin")) {
          // A wrapper without timing — take any timed spans inside it.
          for (const inner of node.getElementsByTagName("span")) {
            if (!inner.getAttribute("begin")) continue;
            words.push({
              t: ttmlTime(inner.getAttribute("begin")),
              end: ttmlTime(inner.getAttribute("end")),
              text: inner.textContent,
            });
          }
          continue;
        }
        words.push({
          t: ttmlTime(node.getAttribute("begin")),
          end: ttmlTime(node.getAttribute("end")),
          text: node.textContent,
        });
      }

      // Last resort: if a syllable still has no spacing, add it at word ends.
      if (words.length > 1 && !words.some((w) => /\s$/.test(w.text))) {
        for (let i = 0; i < words.length - 1; i++) words[i].text += " ";
      }

      const text = words.length ? words.map((w) => w.text).join("") : p.textContent;
      out.push({
        time: ttmlTime(p.getAttribute("begin")),
        end: ttmlTime(p.getAttribute("end")),
        text: (text || "").trim(),
        words: words.length ? words : null,
      });
    }
    return out.length ? out.sort((a, b) => a.time - b.time) : null;
  }

  // Titles carry a lot that lyrics databases don't index: featured artists,
  // remaster tags, version suffixes. Produce progressively plainer variants.
  function titleVariants(raw) {
    const t = (raw || "").trim();
    const out = [t];
    const stripped = t
      .replace(/\s*[\(\[][^)\]]*(feat|ft|with|remaster|remastered|version|edit|mix|live|bonus|deluxe|explicit)[^)\]]*[\)\]]/gi, "")
      .replace(/\s*-\s*(\d{4}\s*)?(remaster(ed)?|radio edit|single version|album version|live)( \d{4})?$/i, "")
      .trim();
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
        d: String(Math.round((Player.getDuration() || 0) / 1000)),
      });
      try {
        const r = await fetch(`${PROXY}/lyrics/ttml?${q}`);
        if (!r.ok) continue;            // 404 no match, 429 limited, 401 needs key
        const d = await r.json();
        const lines = d?.ttml ? parseTTML(d.ttml) : null;
        if (!lines) continue;
        return {
          lines,
          synced: true,
          words: lines.some((l) => l.words),
          via: `BetterLyrics${d.score ? ` (${d.score})` : ""}`,
        };
      } catch {
        return null;   // bridge not running — no point retrying the variants
      }
    }
    return null;
  }

  async function fromLrclib(item) {
    const title = titleOf(item);
    const artist = (artistOf(item).split(",")[0] || "").trim();
    const album = item.album?.name || item.metadata?.album_title || "";
    const dur = Math.round((Player.getDuration() || 0) / 1000);
    if (!title || !artist) return null;

    for (const variant of titleVariants(title)) {
      const hit = await lrclibTry(variant, artist, album, dur);
      if (hit) return hit;
    }
    return null;
  }

  async function lrclibTry(title, artist, album, dur) {
    const q = new URLSearchParams({
      track_name: title, artist_name: artist, album_name: album, duration: String(dur),
    });

    try {
      let r = await fetch(`${PROXY}/lyrics/lrclib?${q}`);
      if (!r.ok) {
        // Exact match failed — fall back to a search and take the closest duration.
        const s = await fetch(
          `${PROXY}/lyrics/lrclib-search?${new URLSearchParams({ track_name: title, artist_name: artist })}`
        );
        if (!s.ok) return null;
        const list = await s.json();
        const best = list
          .filter((x) => x.syncedLyrics)
          .sort((a, b) => Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur))[0];
        // Allow a wider duration window than the exact lookup, but not so wide
        // that a different edit gets synced against this one.
        if (!best || Math.abs((best.duration || 0) - dur) > 12) return null;
        return { lines: parseLRC(best.syncedLyrics), synced: true, via: "LRCLIB search" };
      }
      const d = await r.json();
      if (d.syncedLyrics) return { lines: parseLRC(d.syncedLyrics), synced: true, via: "LRCLIB" };
      if (d.plainLyrics) {
        return {
          lines: d.plainLyrics.split(/\r?\n/).map((t) => ({ time: 0, text: t })),
          synced: false,
          via: "LRCLIB (unsynced)",
        };
      }
    } catch {}
    return null;
  }

  // A match against a different edit produces timings that don't fit this
  // track — usually far too late. Reject those rather than show them.
  function plausible(lines) {
    if (!lines?.length) return false;
    const dur = (Player.getDuration() || 0) / 1000;
    if (!dur) return true;
    const lastTime = lines[lines.length - 1].time;
    const firstTime = lines[0].time;
    // Timings running past the end, or a first line arriving absurdly late,
    // mean the lyrics belong to something else.
    if (lastTime > dur + 5) return false;
    if (firstTime > dur * 0.5 && lines.length > 4) return false;
    return true;
  }

  // Which provider to use. "auto" walks the chain; the others force one, so a
  // bad match on one source can be skipped without touching the others.
  const PROVIDERS = ["auto", "lrclib", "betterlyrics"];

  // Lyric type scale, remembered between sessions. Clamped so the panel can
  // always fit at least a couple of lines without spilling off screen.
  let lyricScale = (() => {
    try { return clamp(Number(localStorage.getItem("fsp:lyricScale")) || 1, 0.7, 2.2); }
    catch { return 1; }
  })();

  const SCALE_MIN = 0.7, SCALE_MAX = 2.2;

  function paintLyricSlider() {
    const pct = ((lyricScale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
    if (el.lszFill) el.lszFill.style.height = `${pct}%`;
    if (el.lszKnob) el.lszKnob.style.bottom = `${pct}%`;
    if (el.lszVal) el.lszVal.textContent = `${Math.round(lyricScale * 100)}%`;
  }

  function setLyricScale(value) {
    lyricScale = clamp(Math.round(value * 20) / 20, SCALE_MIN, SCALE_MAX);
    root.style.setProperty("--fsp-lyric-scale", String(lyricScale));
    paintLyricSlider();
    try { localStorage.setItem("fsp:lyricScale", String(lyricScale)); } catch {}
    lyricIdx = -1;
  }

  function applyLyricScale(delta) {
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

    root.style.setProperty("--fsp-lyric-scale", String(lyricScale));
    paintLyricSlider();
    try { localStorage.setItem("fsp:lyricScale", String(lyricScale)); } catch {}
    lyricIdx = -1;             // re-centre on the next frame
  }
  let providerIdx = 0;

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
      // Prefer a source that has real syllable timing. Only settle for a
      // line-level answer once nothing better has turned up.
      let lineLevel = null;
      for (const fn of [fromOtherExtension, fromBetterLyrics, fromClient, fromLrclib]) {
        const r = await fn(item);
        if (!r?.lines?.length) continue;
        if (r.words) { result = r; break; }
        lineLevel = lineLevel || r;
      }
      result = result || lineLevel;
    }
    if (Player.data?.item?.uri !== uri) return;      // track changed meanwhile

    if (result?.lines?.length && !plausible(result.lines)) {
      console.info("[fsp] rejected lyrics — timings don't fit this track:", result.via);
      lyricsSource = `rejected (${result.via})`;
      return;
    }

    if (result?.lines?.length) {
      lyrics = result.lines.filter((l) => l.text || result.synced);
      if (result.synced) lyrics = withGapMarkers(lyrics);
      lyricsSource = `${result.via}${result.words ? " · per-word" : ""}${result.synced ? "" : " · not synced"}`;
      renderLyrics(result.synced);
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
    box.hidden = false;

    lyrics.forEach((line, idx) => {
      const el2 = document.createElement("div");
      el2.className = "fsp-line";

      if (line.dots) {
        el2.classList.add("fsp-dots");
        for (let k = 0; k < 3; k++) {
          const d = document.createElement("span");
          d.className = "fsp-dot";
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
          el2.appendChild(span);
        });
      }

      if (synced) el2.addEventListener("click", () => Player.seek(line.time * 1000));
      inner.appendChild(el2);
    });
    if (!synced) inner.querySelectorAll(".fsp-line").forEach((n) => n.classList.add("fsp-active"));
  }

  // Keep the current line centred.
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

  // Sweep the white highlight across the current line. Sources give line-level
  // timing only, so word positions are interpolated by word length.
  function sweepWords(posSec) {
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

  function shade(hex, amount) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return "#14161c";
    const [r, g, b] = m.slice(1).map((h) => Math.round(parseInt(h, 16) * amount));
    return `rgb(${r},${g},${b})`;
  }

  async function loadTrack() {
    const item = Player.data?.item;
    if (!item) return;

    const url = artOf(item);
    el.art.src = url;
    el.wash.style.backgroundImage = url ? `url("${url}")` : "none";
    el.title.textContent = titleOf(item);
    el.artist.textContent = artistOf(item);

    const albumName = item.album?.name || item.metadata?.album_title || "";
    const date = item.album?.release_date || item.metadata?.album_release_date || "";
    const year = /^(\d{4})/.exec(date)?.[1] || "";
    el.album.textContent = [albumName, year].filter(Boolean).join(" • ");
    el.album.parentElement.style.display = albumName ? "" : "none";

    paintContext();
    paintUpNext();
    requestAnimationFrame(setupMarquee);
    loadVisual(item);
    loadLyrics(item);

    palette = await paletteFromArt(url);

    try {
      const c = await Spicetify.colorExtractor(item.uri);
      // Prefer the most saturated option so the rings pick up the artwork's
      // character rather than settling on grey.
      accent = c.VIBRANT || c.LIGHT_VIBRANT || c.PROMINENT || "#ffffff";
      root.style.setProperty("--fsp-bg", shade(c.DESATURATED || "#14161c", 0.45));
    } catch {
      accent = "#ffffff";
    }
  }

  /* ================================================================== *
   * Audio bridge
   * ================================================================== */

  const BRIDGE_URL = "ws://127.0.0.1:8787";
  let sock = null, bridgeSeen = 0, retryTimer = null;

  function connectBridge() {
    if (sock && (sock.readyState === 0 || sock.readyState === 1)) return;
    try { sock = new WebSocket(BRIDGE_URL); } catch { return scheduleRetry(); }

    sock.onopen = () => console.info("[fsp] audio bridge connected");
    sock.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (Array.isArray(d.b)) { resizeBands(d.b.length); liveBands = d.b; }
        if (typeof d.e === "number") liveEnergy = d.e;
        if (d.k > 0) pulse = Math.max(pulse, 0.5 + 0.5 * d.k);
        bridgeSeen = performance.now();
      } catch {}
    };
    sock.onclose = () => scheduleRetry();
    sock.onerror = () => { try { sock.close(); } catch {} };
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(connectBridge, 4000);
  }

  const bridgeLive = () => performance.now() - bridgeSeen < 1000;

  /* ================================================================== *
   * Motion: spring-damper, so values have weight and can't jitter
   * ================================================================== */

  const SPR_K = 800, SPR_ZETA = 0.65;     // ~83ms to 90%, slight overshoot
  const ENERGY_K = 450, ENERGY_ZETA = 0.75;

  function spring(x, v, target, dt, k, zeta) {
    const d = 2 * zeta * Math.sqrt(k);
    v += (-k * (x - target) - d * v) * dt;
    x += v * dt;
    return [x, v];
  }

  function sample(tSec, dt) {
    let targetEnergy, targetBands;
    if (bridgeLive()) {
      targetEnergy = Math.pow(liveEnergy, 1.25);
      targetBands = liveBands;
    } else {
      targetEnergy = 0.4 + 0.12 * Math.sin(tSec * 1.1);
      targetBands = bands.map((_, i) => 0.45 + 0.3 * Math.sin(tSec * 0.8 + i * 0.55));
    }

    const steps = Math.max(1, Math.ceil(dt / 0.02));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      [energy, energyVel] = spring(energy, energyVel, targetEnergy, h, ENERGY_K, ENERGY_ZETA);
      for (let i = 0; i < N; i++) {
        [bands[i], bandVel[i]] = spring(bands[i], bandVel[i], targetBands[i] ?? 0, h, SPR_K, SPR_ZETA);
      }
    }
    energy = clamp(energy, 0, 1.4);
    pulse *= Math.pow(0.03, dt);
  }

  /* ================================================================== *
   * Rings
   * ================================================================== */

  const CANVAS_RATIO = 1.62;  // canvas side vs artwork — smaller = bigger art

  function resize() {
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
    artSize = Math.floor(clamp(side / CANVAS_RATIO, 90, 560));
    root.style.setProperty("--fsp-art", `${artSize}px`);

    side = Math.floor(artSize * CANVAS_RATIO);
    // Empty band between the artwork edge and the canvas edge — the transport
    // is pulled up into it.
    root.style.setProperty("--fsp-band", `${Math.round((side - artSize) / 2)}px`);
    const dpr = window.devicePixelRatio || 1;
    el.wrap.style.width = el.wrap.style.height = `${side}px`;
    el.canvas.width = side * dpr;
    el.canvas.height = side * dpr;
    el.canvas.style.width = el.canvas.style.height = `${side}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Place the lyric slider a fixed distance right of the artwork. Measured
    // after layout so it follows the artwork wherever it ends up.
    requestAnimationFrame(() => {
      const art = el.art?.getBoundingClientRect();
      if (!art?.width) return;
      root.style.setProperty("--fsp-lsz-left", `${Math.round(art.right + 30)}px`);
    });
  }

  // Spectrum mirrored across the vertical axis: bass at the top, treble low.
  function bandAt(angle) {
    let a = angle % (Math.PI * 2);
    if (a > Math.PI) a = Math.PI * 2 - a;
    const pos = (a / Math.PI) * (N - 1);
    const i = Math.floor(pos), j = Math.min(N - 1, i + 1);
    const v = lerp(bands[i], bands[j], pos - i);
    let mean = 0;
    for (let k = 0; k < N; k++) mean += bands[k];
    return v - mean / N;
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
    if (!palette || palette.length < 2) return accent;
    const a = rotation * 0.25 * (ring.speed > 0 ? 1 : -1);
    const g = ctx2.createLinearGradient(
      c + Math.cos(a) * radius, c + Math.sin(a) * radius,
      c - Math.cos(a) * radius, c - Math.sin(a) * radius
    );
    palette.forEach((col, i) => g.addColorStop(i / (palette.length - 1), col));
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
    const pos = clamp(t, 0, 1) * (N - 1);
    const i = Math.floor(pos);
    const j = Math.min(N - 1, i + 1);
    return lerp(bands[i] ?? 0, bands[j] ?? 0, pos - i);
  }

  function drawSpectrum() {
    const w = window.innerWidth, h = window.innerHeight;
    sctx.clearRect(0, 0, w, h);

    const bars = Math.max(24, Math.min(120, Math.floor(w / 16)));
    const barW = w / bars - BAR_GAP;
    const maxH = Math.min(h * 0.22, 230);

    // Horizontal gradient from the artwork palette.
    let paint = accent;
    if (palette && palette.length > 1) {
      const g = sctx.createLinearGradient(0, 0, w, 0);
      palette.forEach((c, i) => g.addColorStop(i / (palette.length - 1), c));
      paint = g;
    }
    sctx.fillStyle = paint;

    for (let b = 0; b < bars; b++) {
      const t = b / (bars - 1);
      // Fold the spectrum so bass sits at both edges and treble meets in the
      // middle — a straight left-to-right ramp looks lopsided full-width.
      const fold = t < 0.5 ? t * 2 : (1 - t) * 2;
      const v = Math.pow(bandLerp(fold), 1.1);
      const bh = Math.max(2, v * maxH * (0.25 + energy * 0.95));
      const x = b * (w / bars) + BAR_GAP / 2;

      sctx.globalAlpha = 0.16 + v * 0.42;
      if (hasRoundRect) {
        sctx.beginPath();
        sctx.roundRect(x, 0, barW, bh, [0, 0, 2, 2]);          // top, hanging down
        sctx.fill();
        sctx.beginPath();
        sctx.roundRect(x, h - bh, barW, bh, [2, 2, 0, 0]);     // bottom, rising
        sctx.fill();
      } else {
        sctx.fillRect(x, 0, barW, bh);
        sctx.fillRect(x, h - bh, barW, bh);
      }
    }
    sctx.globalAlpha = 1;
  }

  function draw() {
    const w = el.canvas.width / (window.devicePixelRatio || 1);
    const c = w / 2;
    ctx.clearRect(0, 0, w, w);

    const artR = artSize / 2;
    const beat = 1 + pulse * 0.13;
    const STEPS = 220;

    for (const ring of RINGS) {
      const maxR = w / 2 - ring.width - 2;
      const avail = Math.max(1, maxR - artR);          // room outside the art
      const drive = Math.min(1, energy);
      // Beat scales the artwork-hugging part only; scaling the whole radius
      // pushed the outer ring off the canvas at peaks.
      const base = artR * beat + avail * (ring.gap + drive * 0.05 * ring.lobes);
      const amp = avail * ring.amp * (0.15 + 0.85 * drive);

      ctx.beginPath();
      for (let s = 0; s <= STEPS; s++) {
        const a = (s / STEPS) * Math.PI * 2;
        const mod = bandAt((a * ring.lobes + rotation * ring.speed) % (Math.PI * 2));
        const r = clamp(base + amp * mod, artR * 0.6, maxR);
        const x = c + Math.cos(a - Math.PI / 2) * r;
        const y = c + Math.sin(a - Math.PI / 2) * r;
        s === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = ringPaint(ctx, c, base + amp, ring);
      ctx.globalAlpha = ring.alpha * (0.45 + energy * 0.55);
      ctx.lineWidth = ring.width;
      ctx.lineJoin = "round";
      ctx.shadowBlur = 20 * energy;
      ctx.shadowColor = palette?.[Math.min(palette.length - 1, RINGS.indexOf(ring))] || accent;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    el.art.style.transform = `scale(${1 + pulse * 0.012})`;
  }

  /* ================================================================== *
   * Volume (Spotify's own level)
   * ================================================================== */

  let lastVolume = 0.7, shownVolume = -1, volDragging = false;

  const readVolume = () => {
    const v = Player.getVolume?.() ?? Platform?.PlaybackAPI?.getVolume?.() ?? 0.7;
    return clamp(typeof v === "number" ? v : 0.7, 0, 1);
  };

  function writeVolume(v) {
    v = clamp(v, 0, 1);
    if (Player.setVolume) Player.setVolume(v);
    else Platform?.PlaybackAPI?.setVolume?.(v);
    paintVolume(v);
  }

  function paintVolume(v) {
    const pct = clamp(v, 0, 1) * 100;
    shownVolume = v;
    el.volFill.style.height = `${pct}%`;
    el.volKnob.style.bottom = `${pct}%`;
    el.volPct.textContent = `${Math.round(pct)}%`;
    el.mute.innerHTML = v <= 0.001 ? icons.mute : icons.vol;
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

  /* ================================================================== *
   * Frame loop
   * ================================================================== */

  let last = 0, lastDebug = 0, scrubbing = false, nextSoon = false;

  // Player.getProgress() only refreshes every few hundred ms, so reading it
  // each frame gives a stepped value that visibly lags. Track when it last
  // changed and run the clock forward ourselves between updates.
  let repPos = 0, repAt = 0;
  function smoothProgress() {
    const p = Player.getProgress();
    const now = performance.now();
    if (p !== repPos) { repPos = p; repAt = now; }
    if (!Player.isPlaying()) return repPos;
    const drift = now - repAt;
    // Don't extrapolate forever if updates stop coming.
    return repPos + Math.min(drift, 1200);
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

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000) || 0.016;
    last = now;

    const pos = smoothProgress();
    const dur = Player.getDuration() || 1;
    if (!scrubbing) {
      const pct = clamp(pos / dur, 0, 1);
      el.fill.style.width = `${pct * 100}%`;
      el.knob.style.left = `${pct * 100}%`;
      el.elapsed.textContent = fmt(pos);
      el.remain.textContent = `-${fmt(dur - pos)}`;
    }
    // The up-next card only appears for the last 20 seconds of a track.
    const soon = dur > 25000 && dur - pos <= 20000 && dur - pos > 0;
    if (soon !== nextSoon) {
      nextSoon = soon;
      if (soon) paintUpNext();          // refresh in case the queue changed
      el.nextCard.classList.toggle("fsp-soon", soon);
    }

    if (!volDragging) {
      const v = readVolume();
      if (Math.abs(v - shownVolume) > 0.005) paintVolume(v);
    }

    if (now - lastDebug > 400) { lastDebug = now; paintDebug(); }

    const lyricPos = pos / 1000 + lyricOffset;
    syncLyrics(lyricPos);
    sweepWords(lyricPos);
    stepScroll(dt);

    sample(pos / 1000, dt);
    if (!reduced) rotation += dt;
    draw();
    drawSpectrum();
    raf = requestAnimationFrame(frame);
  }

  /* ================================================================== *
   * Open / close
   * ================================================================== */

  let idleTimer = null;
  function poke() {
    root.classList.remove("fsp-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add("fsp-idle"), 2200);
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
    if (wantFullscreen) enterFullscreen();
    resize();
    requestAnimationFrame(() => requestAnimationFrame(resize));
    loadTrack();
    syncPlayIcon();
    syncToggles();
    paintVolume(readVolume());
    applyLyricScale(0);
    connectBridge();
    requestAnimationFrame(() => root.classList.add("fsp-shown"));
    last = performance.now();
    raf = requestAnimationFrame(frame);
    poke();
    window.addEventListener("resize", resize);
    document.addEventListener("fullscreenchange", resize);
    window.addEventListener("resize", setupMarquee);
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
    clearTimeout(retryTimer);
    try { sock?.close(); } catch {}
    window.removeEventListener("resize", resize);
    document.removeEventListener("fullscreenchange", resize);
    window.removeEventListener("resize", setupMarquee);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("keyup", onKeyUp);
    stopSeekHold();
  }

  function onKey(e) {
    if (e.key === "Escape") return hide();
    if (e.key === "f" || e.key === "F") {
      wantFullscreen = !document.fullscreenElement;
      try { localStorage.setItem("fsp:fullscreen", wantFullscreen ? "1" : "0"); } catch {}
      wantFullscreen ? enterFullscreen() : exitFullscreen();
      return;
    }
    if (e.key === " " && e.target === document.body) { e.preventDefault(); Player.togglePlay(); }
    // Shift skips tracks; plain arrows scrub, accelerating while held.
    if (e.key === "ArrowRight" && e.shiftKey) { Player.next(); return; }
    if (e.key === "ArrowLeft" && e.shiftKey) { Player.back(); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      startSeekHold(e.key === "ArrowRight" ? 1 : -1);
      return;
    }
    // [ and ] nudge lyric sync, \ resets.
    if (e.key === "[" || e.key === "]" || e.key === "\\") {
      if (e.key === "\\") lyricOffset = 0;
      else lyricOffset += e.key === "]" ? 0.25 : -0.25;
      lyricOffset = Math.round(lyricOffset * 100) / 100;
      saveOffset(Player.data?.item?.uri || "");
      flash(`lyrics ${lyricOffset >= 0 ? "+" : ""}${lyricOffset.toFixed(2)}s (this track)`);
      lyricIdx = -1;             // force a re-sync on the next frame
      return;
    }
    // + and - resize the lyrics.
    if (e.key === "+" || e.key === "=") { applyLyricScale(0.1); return; }
    if (e.key === "-" || e.key === "_") { applyLyricScale(-0.1); return; }

    // L cycles the lyrics provider for this track.
    if (e.key === "l" || e.key === "L") {
      providerIdx = (providerIdx + 1) % PROVIDERS.length;
      flash(`lyrics source: ${PROVIDERS[providerIdx]}`);
      if (Player.data?.item) loadLyrics(Player.data.item);
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

  /* ------------------------------------------------------------------ *
   * Heart / shuffle / repeat
   * ------------------------------------------------------------------ */

  function syncToggles() {
    // Saved to library
    try {
      const hearted = Player.getHeart?.() ?? false;
      el.heart.innerHTML = hearted ? icons.heartFull : icons.heart;
      el.heart.classList.toggle("fsp-on", !!hearted);
      el.heart.setAttribute("aria-label", hearted ? "Remove from your library" : "Save to your library");
    } catch {}

    // Shuffle
    try {
      const sh = Player.getShuffle?.() ?? false;
      el.shuffle.classList.toggle("fsp-on", !!sh);
      el.shuffle.setAttribute("aria-pressed", String(!!sh));
    } catch {}

    // Repeat: 0 off, 1 whole context, 2 this track
    try {
      const rp = Player.getRepeat?.() ?? 0;
      el.repeat.innerHTML = rp === 2 ? icons.repeatOne : icons.repeat;
      el.repeat.classList.toggle("fsp-on", rp !== 0);
      el.repeat.setAttribute(
        "aria-label",
        rp === 0 ? "Enable repeat" : rp === 1 ? "Repeat this track" : "Disable repeat"
      );
    } catch {}
  }

  el.heart.addEventListener("click", () => {
    try { Player.toggleHeart(); } catch {}
    setTimeout(syncToggles, 120);   // let the client update its state first
  });

  el.shuffle.addEventListener("click", () => {
    try { Player.toggleShuffle(); } catch {}
    setTimeout(syncToggles, 120);
  });

  el.repeat.addEventListener("click", () => {
    // Cycle off -> context -> track -> off
    try {
      const rp = Player.getRepeat?.() ?? 0;
      if (Player.setRepeat) Player.setRepeat((rp + 1) % 3);
      else Player.toggleRepeat();
    } catch {}
    setTimeout(syncToggles, 120);
  });

  // Brief on-screen readout for sync adjustments.
  let flashTimer = null;
  function flash(text) {
    let n = root.querySelector(".fsp-flash");
    if (!n) {
      n = document.createElement("div");
      n.className = "fsp-flash";
      n.style.cssText =
        "position:absolute;bottom:26px;right:78px;z-index:6;font-size:12px;" +
        "letter-spacing:.04em;color:rgba(255,255,255,.6);" +
        "font-variant-numeric:tabular-nums;transition:opacity .25s ease;";
      root.appendChild(n);
    }
    n.textContent = text;
    n.style.opacity = "1";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (n.style.opacity = "0"), 1300);
  }

  function paintDebug() {
    const box = root.querySelector(".fsp-debug");
    if (!box || box.hidden) return;
    const info = window.fsp();
    box.textContent = Object.entries(info)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
      .join("\n");
  }

  /* ------------------------------------------------------------------ *
   * Hold-to-scrub: a small first step, accelerating the longer you hold
   * ------------------------------------------------------------------ */

  let seekTimer = null, seekDir = 0, seekHeld = 0, seekTarget = 0;

  function startSeekHold(dir) {
    if (seekTimer && seekDir === dir) return;    // key repeat — already running
    stopSeekHold();
    seekDir = dir;
    seekHeld = 0;
    seekTarget = Player.getProgress();

    const step = () => {
      const dur = Player.getDuration() || 0;
      // 2s to start, ramping to 15s after ~2.5s of holding.
      const size = (2 + Math.min(13, seekHeld * 5.5)) * 1000;
      seekHeld += 0.13;
      seekTarget = clamp(seekTarget + seekDir * size, 0, Math.max(0, dur - 500));
      Player.seek(seekTarget);
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

  function stopSeekHold() {
    clearInterval(seekTimer);
    seekTimer = null;
    seekDir = 0;
  }

  function onKeyUp(e) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") stopSeekHold();
  }

  function syncPlayIcon() {
    const playing = Player.isPlaying();
    el.play.innerHTML = playing ? icons.pause : icons.play;
    el.play.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  /* ================================================================== *
   * Wiring
   * ================================================================== */

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
    setLyricScale(lyricScale + (e.deltaY < 0 ? 0.1 : -0.1));
  }, { passive: false });

  root.querySelector(".fsp-close").addEventListener("click", hide);
  root.querySelector(".fsp-prev").addEventListener("click", () => Player.back());
  root.querySelector(".fsp-next-btn").addEventListener("click", () => Player.next());
  el.play.addEventListener("click", () => Player.togglePlay());
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
      Player.seek(seekFromEvent(ev) * (Player.getDuration() || 0));
      scrubbing = false;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  Player.addEventListener("songchange", () => {
    nextSoon = false;
    el.nextCard.classList.remove("fsp-soon");
    if (open) { loadTrack(); syncToggles(); setTimeout(paintDebug, 1200); }
  });
  Player.addEventListener("onplaypause", syncPlayIcon);

  const topbarStyle = document.createElement("style");
  topbarStyle.textContent = `
    .fsp-topbar-btn {
      display: grid; place-items: center;
      width: 32px; height: 32px;
      border-radius: 8px;
      background: rgba(255,255,255,.07);
      color: var(--spice-subtext, rgba(255,255,255,.7));
      transition: background .15s ease, color .15s ease, transform .12s ease;
    }
    .fsp-topbar-btn:hover {
      background: rgba(255,255,255,.14);
      color: #fff;
      transform: scale(1.04);
    }
    .fsp-topbar-btn svg { display: block; }
  `;
  document.head.appendChild(topbarStyle);

  const topbarBtn = new Topbar.Button("Fullscreen player", "search", () => {}, false, false);
  topbarBtn.element.classList.add("fsp-topbar-btn");
  topbarBtn.element.innerHTML = `
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round">
      <circle cx="8" cy="8" r="2.1" fill="currentColor" stroke="none"/>
      <path d="M3.9 4.6a4.6 4.6 0 0 0 0 6.8" stroke-width="1.3"/>
      <path d="M12.1 4.6a4.6 4.6 0 0 1 0 6.8" stroke-width="1.3"/>
      <path d="M1.6 2.2a7.9 7.9 0 0 0 0 11.6" stroke-width="1.1" opacity=".55"/>
      <path d="M14.4 2.2a7.9 7.9 0 0 1 0 11.6" stroke-width="1.1" opacity=".55"/>
    </svg>`;
  topbarBtn.element.addEventListener("click", (e) => {
    e.stopPropagation();
    open ? hide() : show();
  });

  try {
    Spicetify.Keyboard.registerShortcut({ key: "f", ctrl: true, shift: true }, () =>
      open ? hide() : show()
    );
  } catch {
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") open ? hide() : show();
    });
  }

  console.info(`[fsp] loaded ${VERSION}`);

  window.fsp = () => ({
    version: VERSION,
    bridge: bridgeLive() ? "live" : "not connected (ambient fallback)",
    socket: ["connecting", "open", "closing", "closed"][sock?.readyState] ?? "none",
    energy: +energy.toFixed(3),
    visual: visualSource,
    lyrics: `${lyricsSource} (${lyrics.length} lines)`,
    lyricOffset: `${lyricOffset.toFixed(2)}s (${PROVIDERS[providerIdx]})`,
    posReported: `${(repPos / 1000).toFixed(2)}s`,
    posSmoothed: `${(smoothProgress() / 1000).toFixed(2)}s`,
    posStaleFor: `${Math.round(performance.now() - repAt)}ms`,
    lyricLine: lyricIdx >= 0 ? `${lyricIdx} @ ${lyrics[lyricIdx]?.time?.toFixed(2)}s` : "-",
    artSize,
    bands: bands.slice(0, 12).map((b) => +b.toFixed(2)),
  });
})();
