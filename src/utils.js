// Small standalone helpers with no dependency on player state.

export const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function toUrl(raw) {
  if (!raw) return "";
  return raw.startsWith("spotify:image:")
    ? `https://i.scdn.co/image/${raw.slice("spotify:image:".length)}`
    : raw;
}

export function shade(hex, amount) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return "#14161c";
  const [r, g, b] = m.slice(1).map((h) => Math.round(parseInt(h, 16) * amount));
  return `rgb(${r},${g},${b})`;
}
