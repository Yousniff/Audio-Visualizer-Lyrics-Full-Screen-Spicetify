// Palette extraction: sample the artwork and keep a spread of distinct
// hues, so the rings carry the cover's colours rather than one flat accent.

  const swatchCanvas = document.createElement("canvas");
  swatchCanvas.width = swatchCanvas.height = 40;
  const swatchCtx = swatchCanvas.getContext("2d", { willReadFrequently: true });

export function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, sat, l];
  }

export function paletteFromArt(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          swatchCtx.drawImage(img, 0, 0, 40, 40);
          const { data } = swatchCtx.getImageData(0, 0, 40, 40);

          // Bucket by hue, keeping the most saturated example of each.
          const buckets = new Map();
          for (let i = 0; i < data.length; i += 4) {
            const [h, sat, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            if (l < 0.12 || l > 0.94) continue;      // skip near-black/white
            const key = Math.round(h * 11);           // 12 hue buckets
            const score = sat * (1 - Math.abs(l - 0.55));
            const prev = buckets.get(key);
            if (!prev || score > prev.score) {
              buckets.set(key, { score, css: `rgb(${data[i]},${data[i+1]},${data[i+2]})`, h, sat });
            }
          }

          let list = [...buckets.values()].filter((c) => c.sat > 0.12);
          if (list.length < 2) return resolve(null);  // monochrome cover
          list.sort((a, b) => a.h - b.h);             // around the colour wheel
          if (list.length > 5) {
            const step = list.length / 5;
            list = [0, 1, 2, 3, 4].map((i) => list[Math.floor(i * step)]);
          }
          resolve(list.map((c) => c.css));
        } catch {
          resolve(null);   // canvas tainted — fall back to colorExtractor
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
