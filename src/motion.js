// Motion: spring-damper, so values have weight and can't jitter.

import { S } from "./state.js";
import { clamp } from "./utils.js";
import { bridgeLive } from "./bridge.js";

const SPR_K = 800, SPR_ZETA = 0.65;     // ~83ms to 90%, slight overshoot
const ENERGY_K = 450, ENERGY_ZETA = 0.75;

export function spring(x, v, target, dt, k, zeta) {
  const d = 2 * zeta * Math.sqrt(k);
  v += (-k * (x - target) - d * v) * dt;
  x += v * dt;
  return [x, v];
}

export function sample(tSec, dt) {
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
