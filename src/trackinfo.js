// Track metadata readers shared between the main UI (track.js) and the
// lyrics providers (lyrics/sources.js) — split out so neither of those
// two needs to import the other.

import { toUrl } from "./utils.js";

export function artOf(item) {
    if (!item) return "";
    return toUrl(
      item.album?.images?.at(-1)?.url ||
        item.metadata?.image_xlarge_url ||
        item.metadata?.image_large_url ||
        item.metadata?.image_url ||
        ""
    );
  }

export function artistOf(item) {
    if (!item) return "";
    if (Array.isArray(item.artists) && item.artists.length)
      return item.artists.map((a) => a.name).join(", ");
    return item.metadata?.artist_name || "";
  }

export function titleOf(item) {
    return item?.name || item?.metadata?.title || "";
  }
