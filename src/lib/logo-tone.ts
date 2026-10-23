import sharp from 'sharp';

// Whether a logo file reads on black: it has its own solid background, or nearly all of its drawn pixels stand out
// from black by at least 3:1, the contrast for large text and marks. Worked out once per file, at build time.
const readsOnBlack = new Map<string, Promise<boolean>>();

const luminance = (r: number, g: number, b: number) => {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

async function measure(path: string) {
  const { data, info } = await sharp(path, { density: 72 })
    .resize(96, 96, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  const { width, height } = info;
  // A logo with its own background brings it along, so it reads on anything.
  const corners = [alpha(0, 0), alpha(width - 1, 0), alpha(0, height - 1), alpha(width - 1, height - 1)];
  if (corners.every((value) => value > 200)) return true;
  let drawn = 0;
  let clear = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (data[at + 3] < 128) continue;
    drawn++;
    // Contrast with black is (L + 0.05) / 0.05, so 3:1 needs a luminance of at least 0.1.
    if (luminance(data[at], data[at + 1], data[at + 2]) >= 0.1) clear++;
  }
  return drawn > 0 && clear / drawn >= 0.85;
}

// Astro keeps where it found an image as a hidden `fsPath`; without one, the logo is taken to need white.
export function logoReadsOnBlack(image: object) {
  const path = (image as { fsPath?: string }).fsPath;
  if (!path) return Promise.resolve(false);
  let known = readsOnBlack.get(path);
  if (!known) {
    known = measure(path).catch(() => false);
    readsOnBlack.set(path, known);
  }
  return known;
}
