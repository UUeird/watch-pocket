// Decides, in the browser, how a logo is set on a colored cell so it stays legible. Logos are drawn for a light
// page, so on a shade one of three things happens:
// - nothing, where the logo already stands out from the shade;
// - a thin white halo along its edges, which lifts a dark logo off a dark shade;
// - a white plate behind it, for a mid-toned logo (gold, orange, mid-gray) that a halo cannot rescue,
//   since its strokes are no darker than the halo is light. On a plate it looks as it was drawn to.

type Rgb = [number, number, number];

// Contrast at which a mark is taken to stand out, as for large text.
const enough = 4.5;

const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const fromHex = (hex: string): Rgb => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)) as Rgb;

// The average color of a logo's inked pixels, by luminance. Worked out once per file.
const tones = new Map<string, Promise<number | undefined>>();
function toneOf(src: string) {
  if (!tones.has(src)) {
    tones.set(
      src,
      (async () => {
        const image = new Image();
        image.src = src;
        try {
          await image.decode();
        } catch {
          return undefined;
        }
        const width = 160;
        const height = Math.max(1, Math.round((width * image.naturalHeight) / (image.naturalWidth || width)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return undefined;
        context.drawImage(image, 0, 0, width, height);
        let pixels;
        try {
          pixels = context.getImageData(0, 0, width, height).data;
        } catch {
          return undefined;
        }
        let count = 0;
        const sum: Rgb = [0, 0, 0];
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index + 3] < 128) continue;
          count++;
          sum[0] += pixels[index];
          sum[1] += pixels[index + 1];
          sum[2] += pixels[index + 2];
        }
        return count === 0 ? undefined : luminance(sum.map((total) => total / count) as Rgb);
      })(),
    );
  }
  return tones.get(src)!;
}

// Sets each logo in these cells with a halo, a plate, or neither, for the shade in its cell's `--shade`.
export function setLogos(root: HTMLElement) {
  for (const image of root.querySelectorAll<HTMLImageElement>('.brand.shaded img')) {
    const shade = image.parentElement!.style.getPropertyValue('--shade').trim();
    if (!shade.startsWith('#')) continue;
    toneOf(image.getAttribute('src')!).then((tone) => {
      if (tone === undefined || !image.isConnected) return;
      const ground = luminance(fromHex(shade));
      const treatment = contrast(tone, ground) >= enough ? 'plain' : contrast(tone, 1) >= enough ? 'halo' : 'plate';
      image.dataset.set = treatment;
    });
  }
}
