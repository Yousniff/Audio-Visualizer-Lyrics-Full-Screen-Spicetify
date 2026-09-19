// Inline SVG icon set used throughout the UI.

// The standard Material Design "settings" gear path (0..24 box), reused
// both at full size and shrunk into the corner of the settings icon below
// — hand-drawn gear teeth don't hold up at small sizes, this one is
// already battle-tested at exactly this scale.
const GEAR_PATH = `<path d="M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z"/>`;

export const icons = {
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
    </svg>`,
};
