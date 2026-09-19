// Lyrics providers. Tries the client's own provider first, then LRCLIB — a
// free community database of time-synced LRC files.
//
// Player/Platform are referenced lazily via `Spicetify.*` rather than a
// module-top-level destructure, since this module is evaluated before the
// client may be up.

import { PROXY } from "../config.js";
import { titleOf, artistOf } from "../trackinfo.js";
import { linesFromUnknown, normalizeLines, parseLRC, parseTTML } from "./parse.js";

// Borrow from another lyrics extension if one has already fetched this
// track — same data, no second request, and the two views stay in step.
export async function fromOtherExtension(item) {
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

export async function fromClient(item) {
  const id = item.uri.split(":").pop();

  // Any platform API this build happens to expose.
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

export async function fromBetterLyrics(item) {
  const title = titleOf(item);
  const artist = (artistOf(item).split(",")[0] || "").trim();
  if (!title || !artist) return null;

  for (const variant of titleVariants(title)) {
    const q = new URLSearchParams({
      s: variant,
      a: artist,
      al: item.album?.name || item.metadata?.album_title || "",
      d: String(Math.round((Spicetify.Player.getDuration() || 0) / 1000)),
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

export async function fromLrclib(item) {
  const title = titleOf(item);
  const artist = (artistOf(item).split(",")[0] || "").trim();
  const album = item.album?.name || item.metadata?.album_title || "";
  const dur = Math.round((Spicetify.Player.getDuration() || 0) / 1000);
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
export function plausible(lines) {
  if (!lines?.length) return false;
  const dur = (Spicetify.Player.getDuration() || 0) / 1000;
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
export const PROVIDERS = ["auto", "lrclib", "betterlyrics"];
