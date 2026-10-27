import sharp from 'sharp';

// How a logo file sits on a fill: the solid background it brings along, if any, as `#rrggbb`; and otherwise whether
// it reads on white, which is false only for a logo drawn mostly in white or near-white.
// Worked out once per file, at build time.
export type Tone = { background?: string; onWhite: boolean };
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
    return { background: hex(r, g, b), onWhite: true };
  }
  let drawn = 0;
  let light = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] < 128) continue;
    drawn++;
    // Near-white: under 1.5:1 contrast with white, too faint to make out on it.
    if (luminance(data[at], data[at + 1], data[at + 2]) > 0.65) light++;
  }
  // Mostly light, as a logo made for dark backgrounds is. A white detail inside a dark mark doesn't count against it.
  return { onWhite: drawn === 0 || light / drawn < 0.75 };
}

// A logo file's tone, from its path on disk. One that cannot be read is taken to read on white.
export function logoTone(path: string): Promise<Tone> {
  let known = tones.get(path);
  if (!known) {
    known = measure(path).catch(() => ({ onWhite: true }));
    tones.set(path, known);
  }
  return known;
}
