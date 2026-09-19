// Shared mutable state, written from one module and read from another.
// ES module exports are live-but-read-only for importers, so these twelve
// values live on a single exported object and are referenced as `S.x`
// everywhere instead of as free variables.

export const S = {
  N: 12,                       // band count, set by the bridge
  liveBands: new Array(12).fill(0.3),
  liveEnergy: 0.3,
  bands: new Array(12).fill(0.3),
  bandVel: new Array(12).fill(0),
  energy: 0.3,
  energyVel: 0,
  pulse: 0,
  accent: "#ffffff",
  palette: null,      // colours sampled from the current artwork
  rotation: 0,
  artSize: 300,
};

export function resizeBands(n) {
  if (n === S.N) return;
  S.N = n;
  S.bands = new Array(S.N).fill(0.3);
  S.bandVel = new Array(S.N).fill(0);
}
