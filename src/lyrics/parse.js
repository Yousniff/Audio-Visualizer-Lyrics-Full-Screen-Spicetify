// Pure lyrics-format parsing: LRC text and TTML (with per-syllable
// timing). No Spicetify or DOM dependency.

// "[01:23.45] line" -> { time, text }
export function parseLRC(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, "").trim();
      for (const m of stamps) {
        const time = parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(":", "."));
        out.push({ time, text: body });
      }
    }
    return out.sort((a, b) => a.time - b.time);
  }

// Normalise the various shapes lyrics providers use into {time, text}.
export function normalizeLines(raw) {
    if (!Array.isArray(raw) || !raw.length) return null;
    const lines = raw
      .map((l) => {
        if (typeof l === "string") return null;
        const t = l.startTimeMs ?? l.time ?? l.startTime ?? l.ts ?? null;
        const txt = l.words ?? l.text ?? l.line ?? l.content ?? "";
        if (txt == null) return null;
        const secs = t == null ? 0 : Number(t) > 1000 ? Number(t) / 1000 : Number(t);
        return { time: Number.isFinite(secs) ? secs : 0, text: String(txt).trim() };
      })
      .filter(Boolean);
    return lines.length ? lines : null;
  }

// Beautiful Lyrics stores syllable-synced data in its own shape: lines with
// a Lead vocal containing Syllables, each with StartTime/EndTime in seconds.
// Walk an unknown object looking for that structure (or anything close).
export function linesFromUnknown(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;

    // A container of lines.
    const container = obj.Content || obj.content || obj.lines || obj.Lines;
    if (Array.isArray(container) && container.length) {
      const lines = [];
      for (const entry of container) {
        const lead = entry?.Lead || entry?.lead || entry;
        const syl = lead?.Syllables || lead?.syllables || entry?.Syllables;

        const start = Number(
          entry?.StartTime ?? lead?.StartTime ?? entry?.startTimeMs ?? entry?.time ?? 0
        );
        const finish = Number(entry?.EndTime ?? lead?.EndTime ?? 0);
        const toSec = (v) => (v > 1000 ? v / 1000 : v);

        if (Array.isArray(syl) && syl.length) {
          const words = syl.map((w) => ({
            t: toSec(Number(w.StartTime ?? w.startTime ?? w.time ?? 0)),
            end: toSec(Number(w.EndTime ?? w.endTime ?? 0)),
            text: String(w.Text ?? w.text ?? "") + (w.IsPartOfWord || w.isPartOfWord ? "" : " "),
          }));
          lines.push({
            time: toSec(start) || words[0]?.t || 0,
            end: toSec(finish) || words.at(-1)?.end || 0,
            text: words.map((w) => w.text).join("").trim(),
            words,
          });
        } else {
          const text = String(entry?.Text ?? entry?.text ?? lead?.Text ?? "").trim();
          if (!text && !start) continue;
          lines.push({ time: toSec(start), end: toSec(finish), text, words: null });
        }
      }
      if (lines.length) return lines.sort((a, b) => a.time - b.time);
    }

    // Otherwise keep digging.
    for (const v of Object.values(obj)) {
      const r = linesFromUnknown(v, depth + 1);
      if (r) return r;
    }
    return null;
  }

// "00:01:18.234" -> seconds
export function ttmlTime(v) {
    if (!v) return 0;
    const parts = String(v).split(":").map(parseFloat);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

// Better Lyrics returns TTML with per-syllable <span begin end> inside each
// <p> line — real word timing rather than interpolation.
export function parseTTML(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return null;

    const out = [];
    for (const p of doc.getElementsByTagName("p")) {
      // Walk child nodes, not just the spans: the spaces between syllables are
      // plain text nodes in between, and collecting only spans loses them.
      const words = [];
      for (const node of p.childNodes) {
        if (node.nodeType === 3) {                       // text node
          const ws = node.textContent;
          if (!ws) continue;
          if (words.length) words[words.length - 1].text += ws;
          continue;
        }
        if (node.nodeType !== 1) continue;
        if (node.tagName?.toLowerCase() !== "span") continue;
        if (!node.getAttribute("begin")) {
          // A wrapper without timing — take any timed spans inside it.
          for (const inner of node.getElementsByTagName("span")) {
            if (!inner.getAttribute("begin")) continue;
            words.push({
              t: ttmlTime(inner.getAttribute("begin")),
              end: ttmlTime(inner.getAttribute("end")),
              text: inner.textContent,
            });
          }
          continue;
        }
        words.push({
          t: ttmlTime(node.getAttribute("begin")),
          end: ttmlTime(node.getAttribute("end")),
          text: node.textContent,
        });
      }

      // Last resort: if a syllable still has no spacing, add it at word ends.
      if (words.length > 1 && !words.some((w) => /\s$/.test(w.text))) {
        for (let i = 0; i < words.length - 1; i++) words[i].text += " ";
      }

      const text = words.length ? words.map((w) => w.text).join("") : p.textContent;
      out.push({
        time: ttmlTime(p.getAttribute("begin")),
        end: ttmlTime(p.getAttribute("end")),
        text: (text || "").trim(),
        words: words.length ? words : null,
      });
    }
    return out.length ? out.sort((a, b) => a.time - b.time) : null;
  }
