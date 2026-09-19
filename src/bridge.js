// Audio bridge: WebSocket client for the local FFT process.

import { S, resizeBands } from "./state.js";

const BRIDGE_URL = "ws://127.0.0.1:8787";
let sock = null, bridgeSeen = 0, retryTimer = null;

export function connectBridge() {
  if (sock && (sock.readyState === 0 || sock.readyState === 1)) return;
  try { sock = new WebSocket(BRIDGE_URL); } catch { return scheduleRetry(); }

  sock.onopen = () => console.info("[fsp] audio bridge connected");
  sock.onmessage = (ev) => {
    try {
      const d = JSON.parse(ev.data);
      if (Array.isArray(d.b)) { resizeBands(d.b.length); S.liveBands = d.b; }
      if (typeof d.e === "number") S.liveEnergy = d.e;
      if (d.k > 0) S.pulse = Math.max(S.pulse, 0.5 + 0.5 * d.k);
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

export function disconnectBridge() {
  clearTimeout(retryTimer);
  try { sock?.close(); } catch {}
}

export const bridgeLive = () => performance.now() - bridgeSeen < 1000;

// ["connecting","open","closing","closed"] — used by window.fsp()'s debug
// readout. This array element "open" is a plain string label, not the
// module-local `open`/`raf` lifecycle flag that lives in index.js.
export function socketStateLabel() {
  return ["connecting", "open", "closing", "closed"][sock?.readyState] ?? "none";
}
