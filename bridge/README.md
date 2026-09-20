# Audio bridge

Optional companion process for the Fullscreen Player Spicetify extension.
See the [main README](../README.md) for full setup and context — this file
is a quick reference for people already in this folder.

## What it does

- Captures **only Spotify's own audio** (Windows WASAPI per-process
  loopback) — nothing else on your system is heard.
- Runs an FFT and streams spectrum data to the extension over
  `ws://127.0.0.1:8787`.
- Proxies three lyrics APIs on the same port so the extension can reach them
  without hitting CORS: LRCLIB, a BetterLyrics/TTML wrapper, and NetEase
  Cloud Music's own search+lyric API (a free, no-login third source that
  often has synced lyrics the other two don't, even for Western tracks).
- Only exists while Spotify is open (see the two launch options below).

## Setup

```
npm install
npm run debug        # test with Spotify playing; Ctrl+C to stop
```

`npm run debug` should print a capturing line and a level meter that moves
with the music but ignores any other audio on your system.

## Running it long-term

- **`launch-spotify.vbs`** — starts Spotify and the bridge together; the
  bridge exits when Spotify does. Nothing runs otherwise. Recommended if
  you don't want a background process at login.
- **`bridge-silent.vbs`** — put a shortcut to this in your Startup folder.
  Idles (near-zero cost) until Spotify opens, attaches, detaches when
  Spotify closes, and waits again.

## CLI flags

```
node bridge.js [--exit-with-spotify] [--debug] [--port=8787]
```

## Troubleshooting

**Meter stays flat.** Spotify renders audio from a child process; the
bridge captures the whole tree, but it can occasionally pick the wrong
root. Run with `--debug` and check the reported pid against:
```
Get-CimInstance Win32_Process -Filter "Name='Spotify.exe'" | Select ProcessId,ParentProcessId
```

**Port already in use.** Another instance is already running — check
`Get-Process node`. Or run on a different port with `--port=8788` and
change `BRIDGE_URL` near the top of the lyrics/bridge section in
`fullscreenPlayer.js` to match.

**Lyrics still failing after the bridge starts.** Visit
`http://127.0.0.1:8787/health` in a browser — it should return
`{"ok":true, ...}`. If it doesn't, the bridge isn't running or isn't
reachable on that port.
