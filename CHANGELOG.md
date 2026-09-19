# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/), and
this project uses [Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-09-19

### Added
- **Settings panel redesign**: two tabs (General / Visualizer), grouped
  "iOS-style" cards with hairline dividers, a liquid-glass blur/translucency
  effect, green iOS-style toggle switches, and a blue fill on sliders
  showing how far each one is turned.
- **Marquee ticker style**: a new "Continuous ticker" option alongside the
  original "Scroll and snap back" — a seamless, non-stop scroll instead of
  scroll-to-the-end-and-snap-back. Each has its own speed handling.
- **Frequency band selection**: bass/mids/treble are now independent
  checkboxes (was a single exclusive dropdown), so any combination can
  drive the rings/spectrum bar — e.g. bass + treble with mids excluded.
- **Custom-styled dropdowns**: every `<select>` in the panel (Motion, Bar
  shape, Bar position, Mode, Marquee style, and the two new visibility
  dropdowns below) now renders as a themed listbox matching the rest of
  the panel, instead of the browser's native (unstylable) dropdown.
- **"Playing from" / "Up next" visibility control**: each is now a 3-way
  dropdown — **Always shown**, **Fade with cursor** / **Show near track
  end** (their old default behavior), or **Hidden** — replacing the old
  plain on/off toggle.
- **Up-next lead time slider**: when "Up next" is set to show near the
  track's end, a new slider (1–90 seconds) controls exactly how early it
  appears, with a live "Xs" badge next to the label. Replaces the old
  fixed 20-second window.
- **"Playing from" card redesign**: now matches the "Up next" card's look
  — a frosted glass pill with the icon in its own rounded tile, instead of
  a bare icon + text floating on the page.

### Fixed
- Long titles/artists/albums that were only a hair too wide to fit weren't
  scrolling at all (a sub-pixel measurement bug).
- The marquee could measure text before its web font finished loading,
  under-measuring narrow-fallback-font text and leaving some rows stuck
  on plain ellipsis.
- Marquee speed changes and the "bounce" pause only visibly affected the
  title row, not the artist/album rows — each row now gets its own
  independently-tuned timing so a speed change reads the same everywhere.
- A class name (`.fsp-track`) was reused for both the marquee wrapper and
  the playback progress bar, causing visual bleed — a scrolling bar was
  briefly appearing on top of text rows. Renamed to `.fsp-mqtrack`.
- Removed a marquee edge-fade effect that was producing visible ghosting
  lines.
- Unchecking all three frequency bands didn't actually silence the
  rings/spectrum bar (it silently fell back to the full range) — now it
  correctly goes still.
- A subtle math bug in how multiple frequency bands were averaged
  together (double-counting a shared boundary index between adjacent
  bands) — fixed and verified to match the original single-band math
  exactly when only one band is selected.
- The "Up next" card could be visually covered by the spectrum visualizer.
- Dropdowns positioned near the bottom of the panel (e.g. "Motion") were
  clipped by the panel's own scroll area and couldn't be opened/clicked at
  all.
- A dropdown's popup could render *underneath* the fullscreen view itself
  (invisible and unclickable) due to a stacking/z-index mismatch after the
  above fix — every dropdown was affected, not just the clipped one.
- The whole settings panel would sometimes stay open with a horizontal
  scrollbar running along the bottom of the panel body, on both tabs —
  caused by a missing `box-sizing: border-box`, which let a couple of
  elements render a few pixels wider than their container. Fixed the box
  model at the source.

### Changed
- Settings icon reverted to a plain gear (was briefly a different icon).
- `freqFocus` (a single exclusive string setting) was replaced by
  `freqBands` (independent booleans); an existing saved preference is
  carried over automatically to the equivalent new setting.
- `showContext` / `showUpNext` (booleans) were replaced by
  `contextVisibility` / `nextVisibility` (3-way settings, see Added);
  existing `true`/`false` values are migrated automatically (`false` →
  "Hidden", `true` → the old default behavior).

### Removed
- **"Play Canvas video backgrounds" setting**, and all the code behind it.
  It tried to fetch Spotify's Canvas video through a few guessed-at,
  undocumented API shapes that never reliably worked — Spotify doesn't
  expose Canvas through any stable client API. The background now always
  falls back to blurred artist imagery, same as it did whenever Canvas
  wasn't found before.

