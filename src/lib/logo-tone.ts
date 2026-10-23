import sharp from 'sharp';

// How a logo file sits on a fill: the solid background it brings along, if any, as `#rrggbb`; and otherwise whether
// nearly all of its drawn pixels stand out from black by at least 3:1, the contrast for large text and marks.
// Worked out once per file, at build time.
export type Tone = { background?: string; onBlack: boolean };
const tones = new Map<string, Promise<Tone>>();
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('');

const luminance = (r: number, g: number, b: number) => {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

async function measure(path: string): Promise<Tone> {
  const { data, info } = await sharp(path, { density: 72 })
    .resize(96, 96, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pixel = (x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  // A logo with its own background brings it along: opaque corners, taken as the average of the four.
  const corners = [pixel(0, 0), pixel(width - 1, 0), pixel(0, height - 1), pixel(width - 1, height - 1)];
  if (corners.every((corner) => corner[3] > 200)) {
    const [r, g, b] = [0, 1, 2].map((channel) => Math.round(corners.reduce((sum, corner) => sum + corner[channel], 0) / 4));
    return { background: hex(r, g, b), onBlack: true };
  }
  let drawn = 0;
  let clear = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] < 128) continue;
    drawn++;
    // Contrast with black is (L + 0.05) / 0.05, so 3:1 needs a luminance of at least 0.1.
    if (luminance(data[at], data[at + 1], data[at + 2]) >= 0.1) clear++;
  }
  return { onBlack: drawn > 0 && clear / drawn >= 0.85 };
}

// Astro keeps where it found an image as a hidden `fsPath`; without one, the logo is taken to need white.
export function logoTone(image: object): Promise<Tone> {
  const path = (image as { fsPath?: string }).fsPath;
  if (!path) return Promise.resolve({ onBlack: false });
  let known = tones.get(path);
  if (!known) {
    known = measure(path).catch(() => ({ onBlack: false }));
    tones.set(path, known);
  }
  return known;
}
