// Track metadata rendering: context label, up-next card, marquee scroll,
// and the top-level loadTrack() that kicks off visuals/lyrics/palette for
// a new track.
//
// Player/Platform are referenced lazily via `Spicetify.*` rather than a
// module-top-level destructure, since this module is evaluated before the
// client may be up.

import { root, el } from "./dom.js";
import { S } from "./state.js";
import { clamp, shade } from "./utils.js";
import { artOf, artistOf, titleOf } from "./trackinfo.js";
import { toUrl } from "./utils.js";
import { paletteFromArt } from "./palette.js";
import { loadVisual } from "./visuals.js";
import { getVizSettings } from "./settings.js";
import { loadLyrics } from "./lyrics/view.js";

// "Playing from playlist / Hop Hip"
export function paintContext() {
  const c = Spicetify.Player.data?.context || Spicetify.Player.data?.contextMetadata || {};
  const meta = c.metadata || Spicetify.Player.data?.item?.metadata || {};
  const name =
    meta.context_description ||
    c.name ||
    Spicetify.Player.data?.item?.metadata?.album_title ||
    "";
  const uri = c.uri || Spicetify.Player.data?.item?.metadata?.context_uri || "";
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

export function paintUpNext() {
  let track = null;
  try {
    track =
      Spicetify.Queue?.nextTracks?.[0]?.contextTrack ||
      Spicetify.Queue?.nextTracks?.[0] ||
      Spicetify.Platform.PlayerAPI?._queue?._queue?.nextTracks?.[0]?.contextTrack ||
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

// How long one lap takes for a given travel distance and style, in seconds.
// Shared by setupMarquee() (building it) and applyMarqueeSpeed() (re-timing
// it on the fly) so they can't drift out of sync with each other.
function marqueeSeconds(distance, style, speed) {
  return style === "ticker"
    ? clamp(distance / 55, 6, 40) / speed
    : clamp(distance / 22, 6, 26) / speed;
}

// Gap (px) between the two copies in ticker mode, so the repeat doesn't
// read as the same word running into itself.
const TICKER_GAP = 48;

// Bounce's hold-at-each-end is written as a PERCENT of the cycle (0-12% and
// 88-100%), which is fine for a title that takes 20+ seconds to cross —
// but a line that's only just wide enough to scroll gets clamped near the
// 6s floor, where that same 12% is well under a second. Catch the speed
// slider while a short row happens to be sitting in that sliver and it
// looks like the row ignored the change completely, while the title (long
// enough that you're rarely mid-pause) reacts right away — which is
// exactly the "only the top row responds" pattern. Building each row's own
// keyframes so the hold is a roughly constant AMOUNT of time, not a
// constant fraction, keeps every row equally responsive regardless of how
// short its own cycle is.
const BOUNCE_HOLD_SECONDS = 0.5;
function bounceHoldPercent(totalSeconds) {
  return clamp((BOUNCE_HOLD_SECONDS / totalSeconds) * 100, 3, 15);
}

let mqStyleEl = null;
function writeBounceKeyframes(rows) {
  if (!mqStyleEl) {
    mqStyleEl = document.createElement("style");
    document.head.appendChild(mqStyleEl);
  }
  mqStyleEl.textContent = rows
    .map(({ idx, seconds }) => {
      const p = bounceHoldPercent(seconds);
      const q = 100 - p;
      return `@keyframes fsp-mq-bounce-${idx} {
        0%, ${p}%   { transform: translateX(0); }
        ${q}%, 100% { transform: translateX(var(--fsp-marquee-shift, 0px)); }
      }`;
    })
    .join("\n");
}

// Scroll a row only if it doesn't fit. "bounce" scrolls to the end, pauses,
// and snaps back to the start (a hard cut between animation loops — browsers
// don't tween across an iteration boundary, so this is already instant).
// "ticker" instead plays a second copy of the text right after the first
// and scrolls both leftward by exactly one copy's width, so the moment the
// first copy scrolls out of view the second is sitting exactly where the
// first started — a seamless, never-resetting loop.
export function setupMarquee() {
  const viz = getVizSettings();
  const bounceRows = [];
  const boxes = [...root.querySelectorAll(".fsp-scroll")];
  boxes.forEach((box, idx) => {
    const track = box.firstElementChild;      // .fsp-mqtrack — never recreated
    const original = track.firstElementChild; // the actual title/artist/album element
    track.querySelector(".fsp-marquee-clone")?.remove();
    box.classList.remove("fsp-marquee-bounce", "fsp-marquee-ticker");
    box.removeAttribute("data-marquee-mode");
    track.style.removeProperty("animation");
    track.style.removeProperty("animation-name");
    track.style.removeProperty("transform");

    if (!viz.marqueeScroll) {
      // Let the name run exactly as long as it wants on one line — no
      // scrolling, no wrapping to a second line, no ellipsis. It can spill
      // past the row's usual width; nothing here clips or breaks it.
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

    // >1px, not >6: a row that's only a hair over its box (which is common
    // for artist/album — they're rarely as wide as the title) still needs
    // to scroll to show its last letters, and the old 6px floor was hiding
    // exactly that "less than it looks like" sliver of overflow.
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

// setupMarquee() gets one honest shot right after a track loads, but the
// row it measures can still change size afterward for reasons that have
// nothing to do with a track change — a web font finishing its swap-in
// after the "fonts ready" check already fired, a layout shift from
// something else on the page, the settings panel's text-size slider
// landing on a value that nudges wrapping. Rather than guess every case
// that can invalidate a measurement, just watch the boxes themselves and
// remeasure whenever one actually changes size. Watching the original text
// element (not the .fsp-mqtrack wrapper) is what keeps this from looping on
// itself in ticker mode: appending the clone grows the wrapper, but the
// wrapper isn't observed, and the box's own width is pinned by `flex: 1 1
// auto` regardless of how much the track inside it grows.
let marqueeResizeObserver = null;
let marqueeResizeRaf = null;
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

// Re-time the rows that are already scrolling, without remeasuring overflow
// or toggling the class — a speed-only update. Doing the full remove/re-add
// dance from setupMarquee() on every "input" tick of the speed slider was
// forcing each row's animation to restart from 0% (which pauses for the
// keyframes' opening hold), so whichever row happened to be mid-restart when
// the user let go of the slider looked like it wasn't affected by the
// change — this instead just nudges the running animation's duration.
// Bounce also needs its keyframes rewritten here, not just the duration
// variable: bounceHoldPercent() depends on the new duration too, and
// skipping that would leave a stale hold percentage sized for the old
// speed until the next full setupMarquee() call.
export function applyMarqueeSpeed() {
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

export async function loadTrack() {
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
  el.album.textContent = [albumName, year].filter(Boolean).join(" • ");
  el.album.parentElement.style.display = albumName ? "" : "none";

  paintContext();
  paintUpNext();
  // One measurement right after layout isn't always enough: the web font
  // can still be swapping in (the fallback font it measures against is
  // narrower), which can under-measure scrollWidth and leave a long title
  // stuck on plain ellipsis instead of turning marquee scrolling on. Re-check
  // once fonts finish loading, and again after a short delay as a fallback
  // for browsers/embeds where document.fonts isn't reliable.
  requestAnimationFrame(setupMarquee);
  try { document.fonts?.ready?.then(setupMarquee); } catch {}
  setTimeout(setupMarquee, 400);
  loadVisual(item);
  loadLyrics(item);

  S.palette = await paletteFromArt(url);

  try {
    const c = await Spicetify.colorExtractor(item.uri);
    // Prefer the most saturated option so the rings pick up the artwork's
    // character rather than settling on grey.
    S.accent = c.VIBRANT || c.LIGHT_VIBRANT || c.PROMINENT || "#ffffff";
    root.style.setProperty("--fsp-bg", shade(c.DESATURATED || "#14161c", 0.45));
  } catch {
    S.accent = "#ffffff";
  }
}
