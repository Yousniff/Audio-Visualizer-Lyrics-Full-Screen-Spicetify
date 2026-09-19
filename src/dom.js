// Root markup, cached element references, and small generic DOM helpers.
// Import-time only touches document/DOM, so this can run before Spicetify
// itself is ready.

import "./styles.js";
import { icons } from "./icons.js";

export const root = document.createElement("div");
root.className = "fsp-root";
  root.innerHTML = `
    <div class="fsp-backdrop"></div>
    <div class="fsp-wash"></div>
    <canvas class="fsp-spectrum"></canvas>
    <div class="fsp-tint"></div>
    <div class="fsp-drag"></div>

    <div class="fsp-next" hidden>
      <img class="fsp-next-art" alt="" />
      <div style="min-width:0">
        <div class="fsp-next-kind">Up next</div>
        <div class="fsp-next-title"></div>
      </div>
    </div>

    <!-- Deliberately a sibling of .fsp-chrome, not a child of it: the
         "always shown" visibility option needs to keep fading independent
         of .fsp-chrome's own idle fade, and a parent's opacity caps
         everything under it — a child stuck at opacity:1 inside a
         parent that's faded to 0 still renders invisible. Living outside
         .fsp-chrome, .fsp-context can carry its own opacity untouched by
         the rest of the chrome hiding on idle. -->
    <div class="fsp-context">
      <div class="fsp-context-icon">${icons.queue}</div>
      <div class="fsp-context-text">
        <div class="fsp-context-kind">Playing from</div>
        <div class="fsp-context-name"></div>
      </div>
    </div>

    <div class="fsp-chrome">
      <div class="fsp-volume">
        <div class="fsp-vol-pct">70%</div>
        <div class="fsp-vol-track fsp-hit"><div class="fsp-vol-fill"></div><div class="fsp-vol-knob"></div></div>
        <button class="fsp-mute" aria-label="Mute">${icons.vol}</button>
      </div>

      <button class="fsp-close" aria-label="Close fullscreen">${icons.close}</button>
      <pre class="fsp-debug" hidden></pre>
    </div>

    <div class="fsp-settings">
      <button class="fsp-gear" aria-label="Visualizer settings">${icons.gear}</button>
      <div class="fsp-settings-panel">
        <div class="fsp-set-tabs" role="tablist">
          <button class="fsp-set-tab fsp-set-tab-active" data-tab="general" role="tab" aria-selected="true">General</button>
          <button class="fsp-set-tab" data-tab="visualizer" role="tab" aria-selected="false">Visualizer</button>
        </div>

        <div class="fsp-set-body">
        <div class="fsp-set-pane fsp-set-pane-active" data-pane="general">

          <div class="fsp-settings-title">Display</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row"><label>Auto-enter fullscreen</label><input type="checkbox" class="fsp-set-autofs fsp-toggle" /></div>
            <div class="fsp-set-row">
              <label>"Playing from" label</label>
              <select class="fsp-set-ctxvis">
                <option value="always">Always shown</option>
                <option value="auto">Fade with cursor</option>
                <option value="off">Hidden</option>
              </select>
            </div>
            <div class="fsp-set-row">
              <label>"Up next" card</label>
              <select class="fsp-set-nextvis">
                <option value="always">Always shown</option>
                <option value="auto">Show near track end</option>
                <option value="off">Hidden</option>
              </select>
            </div>
            <div class="fsp-set-row fsp-set-leadsecs-row">
              <div class="fsp-set-row-head">
                <label>Lead time</label>
                <span class="fsp-set-badge fsp-set-leadsecs-badge">20s</span>
              </div>
              <input type="range" class="fsp-set-leadsecs" min="1" max="90" step="1" />
            </div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Show debug overlay on open</label><input type="checkbox" class="fsp-set-showdebug fsp-toggle" /></div>
            <div class="fsp-set-row">
              <label>Background intensity</label>
              <input type="range" class="fsp-set-bgintensity" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Artwork shadow</label>
              <input type="range" class="fsp-set-artshadow" min="0" max="2" step="0.05" />
            </div>
          </div>

          <div class="fsp-settings-title">Track info</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row"><label>Scroll long titles</label><input type="checkbox" class="fsp-set-marqueescroll fsp-toggle" /></div>
            <div class="fsp-set-row fsp-set-marqueespeed-row">
              <label>Marquee speed</label>
              <input type="range" class="fsp-set-marqueespeed" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-marqueestyle-row">
              <label>Marquee style</label>
              <select class="fsp-set-marqueestyle">
                <option value="bounce">Scroll and snap back</option>
                <option value="ticker">Continuous ticker</option>
              </select>
            </div>
            <div class="fsp-set-row">
              <label>Text size</label>
              <input type="range" class="fsp-set-textsize" min="0.7" max="1.5" step="0.05" />
            </div>
          </div>

          <div class="fsp-settings-title">Accessibility</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row">
              <label>Motion</label>
              <select class="fsp-set-motion">
                <option value="auto">Match system setting</option>
                <option value="off">Always animate</option>
                <option value="on">Always reduced</option>
              </select>
            </div>
          </div>

        </div>

        <div class="fsp-set-pane" data-pane="visualizer" hidden>

          <div class="fsp-settings-title">Color</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row">
              <label>Mode</label>
              <select class="fsp-set-colormode">
                <option value="art">From artwork</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div class="fsp-set-row fsp-set-vbrightness-row">
              <label>Artwork brightness</label>
              <input type="range" class="fsp-set-vbrightness" min="0.4" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-tint-row">
              <label>Artwork tint (lighten toward white)</label>
              <input type="range" class="fsp-set-tint" min="0.4" max="1.8" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-spread-row">
              <label>Artwork color spread</label>
              <input type="range" class="fsp-set-spread" min="0.4" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Opacity</label>
              <input type="range" class="fsp-set-opacity" min="0.1" max="1" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-custom-row">
              <label>Custom color 1</label>
              <input type="color" class="fsp-set-customcolor" value="#8b5cf6" />
            </div>
            <div class="fsp-set-row fsp-set-custom-row fsp-set-toggle-row">
              <label><input type="checkbox" class="fsp-set-usecolor2 fsp-toggle" /> Custom color 2</label>
              <input type="color" class="fsp-set-customcolor2" value="#22d3ee" />
            </div>
            <div class="fsp-set-row fsp-set-custom-row fsp-set-toggle-row">
              <label><input type="checkbox" class="fsp-set-usecolor3 fsp-toggle" /> Custom color 3</label>
              <input type="color" class="fsp-set-customcolor3" value="#f472b6" />
            </div>
          </div>

          <div class="fsp-settings-title">Rings</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row fsp-set-rings">
              <label>Rings on</label>
              <div class="fsp-set-rings-toggles">
                <label class="fsp-ring-toggle">1<input type="checkbox" class="fsp-set-ring0 fsp-toggle" /></label>
                <label class="fsp-ring-toggle">2<input type="checkbox" class="fsp-set-ring1 fsp-toggle" /></label>
                <label class="fsp-ring-toggle">3<input type="checkbox" class="fsp-set-ring2 fsp-toggle" /></label>
              </div>
            </div>
            <div class="fsp-set-row">
              <label>Ring speed</label>
              <input type="range" class="fsp-set-ringspeed" min="0.25" max="2.5" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Ring reactivity</label>
              <input type="range" class="fsp-set-ringreact" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Ring thickness</label>
              <input type="range" class="fsp-set-thickness" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Glow intensity</label>
              <input type="range" class="fsp-set-glow" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Beat pulse strength</label>
              <input type="range" class="fsp-set-pulse" min="0" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Rings spin the same way</label><input type="checkbox" class="fsp-set-lockdir fsp-toggle" /></div>
          </div>

          <div class="fsp-settings-title">Spectrum bar</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row">
              <label>Position</label>
              <select class="fsp-set-barpos">
                <option value="both">Top and bottom</option>
                <option value="top">Top only</option>
                <option value="bottom">Bottom only</option>
              </select>
            </div>
            <div class="fsp-set-row">
              <label>Bar shape</label>
              <select class="fsp-set-barshape">
                <option value="rounded">Rounded</option>
                <option value="sharp">Sharp</option>
              </select>
            </div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Mirror fold (bass at edges)</label><input type="checkbox" class="fsp-set-fold fsp-toggle" /></div>
            <div class="fsp-set-row">
              <label>Bar density</label>
              <input type="range" class="fsp-set-density" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Bar height</label>
              <input type="range" class="fsp-set-height" min="0.5" max="2" step="0.05" />
            </div>
            <div class="fsp-set-row">
              <label>Bar sensitivity</label>
              <input type="range" class="fsp-set-sens" min="0" max="2" step="0.05" />
            </div>
          </div>

          <div class="fsp-settings-title">Frequencies</div>
          <div class="fsp-set-group">
            <div class="fsp-set-row fsp-set-toggle-row"><label>Bass</label><input type="checkbox" class="fsp-set-freqbass fsp-toggle" /></div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Mids</label><input type="checkbox" class="fsp-set-freqmids fsp-toggle" /></div>
            <div class="fsp-set-row fsp-set-toggle-row"><label>Treble</label><input type="checkbox" class="fsp-set-freqtreble fsp-toggle" /></div>
          </div>

        </div>
        </div>

        <button class="fsp-set-reset">Reset to defaults</button>
      </div>
    </div>

      <div class="fsp-meta">
        <div class="fsp-row fsp-row-title">${icons.note}<div class="fsp-scroll"><div class="fsp-mqtrack"><h1 class="fsp-title"></h1></div></div></div>
        <div class="fsp-row">${icons.person}<div class="fsp-scroll"><div class="fsp-mqtrack"><span class="fsp-artist"></span></div></div></div>
        <div class="fsp-row fsp-row-album">${icons.disc}<div class="fsp-scroll"><div class="fsp-mqtrack"><span class="fsp-album"></span></div></div></div>
      </div>

    <div class="fsp-lyric-size">
      <div class="fsp-lsz-val">100%</div>
      <div class="fsp-lsz-track fsp-hit"><div class="fsp-lsz-fill"></div><div class="fsp-lsz-knob"></div></div>
      <span class="fsp-lsz-icon" role="button" aria-label="Lyrics size">${icons.lyricsNote}</span>
    </div>

    <div class="fsp-lyrics"><div class="fsp-lyrics-inner"></div></div>


    <div class="fsp-stage">
      <div class="fsp-column">
      <div class="fsp-canvas-wrap">
        <canvas class="fsp-canvas"></canvas>
        <img class="fsp-art" alt="" />
      </div>
      <div class="fsp-transport">
      <div class="fsp-controls">
        <div class="fsp-ctl-side">
          <button class="fsp-btn fsp-small fsp-heart" aria-label="Save to your library">${icons.heart}</button>
          <button class="fsp-btn fsp-small fsp-shuffle" aria-label="Shuffle">${icons.shuffle}</button>
        </div>
        <div class="fsp-ctl-main">
          <button class="fsp-btn fsp-prev" aria-label="Previous track">${icons.prev}</button>
          <button class="fsp-btn fsp-play" aria-label="Play or pause">${icons.play}</button>
          <button class="fsp-btn fsp-next-btn" aria-label="Next track">${icons.next}</button>
        </div>
        <div class="fsp-ctl-side fsp-ctl-right">
          <button class="fsp-btn fsp-small fsp-repeat" aria-label="Repeat">${icons.repeat}</button>
        </div>
      </div>
      <div class="fsp-bar">
        <span class="fsp-elapsed">0:00</span>
        <div class="fsp-track fsp-hit"><div class="fsp-fill"></div><div class="fsp-knob"></div></div>
        <span class="fsp-remain">-0:00</span>
      </div>
      </div>
      </div>
    </div>
  `;
document.body.appendChild(root);

export const el = {
    wash: root.querySelector(".fsp-wash"),
    stage: root.querySelector(".fsp-stage"),
    wrap: root.querySelector(".fsp-canvas-wrap"),
    canvas: root.querySelector(".fsp-canvas"),
    art: root.querySelector(".fsp-art"),
    title: root.querySelector(".fsp-title"),
    artist: root.querySelector(".fsp-artist"),
    album: root.querySelector(".fsp-album"),
    meta: root.querySelector(".fsp-meta"),
    bar: root.querySelector(".fsp-bar"),
    controls: root.querySelector(".fsp-controls"),
    track: root.querySelector(".fsp-track"),
    fill: root.querySelector(".fsp-fill"),
    knob: root.querySelector(".fsp-knob"),
    elapsed: root.querySelector(".fsp-elapsed"),
    remain: root.querySelector(".fsp-remain"),
    play: root.querySelector(".fsp-play"),
    heart: root.querySelector(".fsp-heart"),
    shuffle: root.querySelector(".fsp-shuffle"),
    repeat: root.querySelector(".fsp-repeat"),
    ctxName: root.querySelector(".fsp-context-name"),
    ctxKind: root.querySelector(".fsp-context-kind"),
    nextCard: root.querySelector(".fsp-next"),
    nextArt: root.querySelector(".fsp-next-art"),
    nextTitle: root.querySelector(".fsp-next-title"),
    volPct: root.querySelector(".fsp-vol-pct"),
    volTrack: root.querySelector(".fsp-vol-track"),
    volFill: root.querySelector(".fsp-vol-fill"),
    volKnob: root.querySelector(".fsp-vol-knob"),
    volWrap: root.querySelector(".fsp-volume"),
    mute: root.querySelector(".fsp-mute"),
    lszTrack: root.querySelector(".fsp-lsz-track"),
    lszFill: root.querySelector(".fsp-lsz-fill"),
    lszKnob: root.querySelector(".fsp-lsz-knob"),
    lszVal: root.querySelector(".fsp-lsz-val"),
    lszWrap: root.querySelector(".fsp-lyric-size"),
    lszIcon: root.querySelector(".fsp-lsz-icon"),
    settingsWrap: root.querySelector(".fsp-settings"),
    gearBtn: root.querySelector(".fsp-gear"),
    context: root.querySelector(".fsp-context"),
};
export const ctx = el.canvas.getContext("2d");

// Brief on-screen readout for sync adjustments.
let flashTimer = null;
export function flash(text) {
    let n = root.querySelector(".fsp-flash");
    if (!n) {
      n = document.createElement("div");
      n.className = "fsp-flash";
      n.style.cssText =
        "position:absolute;bottom:26px;right:78px;z-index:6;font-size:12px;" +
        "letter-spacing:.04em;color:rgba(255,255,255,.6);" +
        "font-variant-numeric:tabular-nums;transition:opacity .25s ease;";
      root.appendChild(n);
    }
    n.textContent = text;
    n.style.opacity = "1";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (n.style.opacity = "0"), 1300);
  }
