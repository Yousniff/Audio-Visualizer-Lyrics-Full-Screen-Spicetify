// Track-specific visual: artist imagery, layered behind the blurred cover.
// Best-effort — the API surface differs between client versions, so the
// lookup is wrapped and failure just means we keep the blurred cover.
//
// This used to try Spotify's Canvas (the short looping video some tracks
// have) first, via a few undocumented, guessed-at API shapes. It never
// reliably found one — Spotify doesn't expose Canvas through any stable
// client API, so that whole path was dead weight pretending to be a
// feature. Removed rather than fixed, since there's no supported API left
// to fix it onto.
//
// Player/Platform are referenced lazily via `Spicetify.*` rather than a
// module-top-level destructure, since this module is evaluated before the
// client may be up.

import { root } from "./dom.js";

let visualSource = "none";     // reported by the debug panel
export const getVisualSource = () => visualSource;

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

export async function loadVisual(item) {
  const back = root.querySelector(".fsp-backdrop");
  back.classList.remove("fsp-on");
  root.classList.remove("fsp-hasvisual");
  visualSource = "none";

  const uri = item.uri;

  const art = await fetchArtistImage(item);
  if (art && Spicetify.Player.data?.item?.uri === uri) {
    back.style.backgroundImage = `url("${art.url}")`;
    back.classList.add("fsp-on");
    root.classList.add("fsp-hasvisual");
    visualSource = `artist image (${art.via})`;
  }
}
