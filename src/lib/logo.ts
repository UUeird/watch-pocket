// How a brand's or group's logo is shown at any size, the same way everywhere: the chart, the Ownership Groups
// cards, the Brands list, a brand's own page. Plain data only, so the chart can run it again in the browser.

// One version of a logo: its file and drawn size. `background` is the solid color the file brings along, if any;
// `onWhite` is false for a logo drawn mostly in white, which would vanish on a white fill.
export type LogoFile = { src: string; width: number; height: number; background?: string; onWhite?: boolean };

// A logo and the parts cropped from it at its own scale, of those it has, and the color the brand sets it on, if any.
export type LogoSet = { whole?: LogoFile; wordmark?: LogoFile; logomark?: LogoFile; background?: string };

// The height in pixels a logo's name must be drawn at to read, about that of small caption text.
export const readable = 10;
// The size in pixels a symbol must be drawn at, across its longer side, to read.
export const readableMark = 14;

const scaleIn = (logo: LogoFile, width: number, height: number) => Math.min(width / logo.width, height / logo.height);

// How much of the whole logo's height its name takes up. A wordmark cropped at the logo's scale says exactly. Without
// one, a logo with no symbol is its name, and one with a symbol is taken to give its name about a quarter of its height.
const nameShare = ({ whole, wordmark, logomark }: LogoSet) =>
  whole && wordmark ? wordmark.height / whole.height : logomark ? 0.25 : 1;

// The version of a logo to show in a `width` by `height` pixel space: the whole logo where its name is drawn
// large enough to read, and otherwise its logomark, unless its wordmark would be drawn at twice the area there, as a
// wide space suits the name and a symbol reads smaller than a name. An image is shrunk or grown to fill the space.
export function pickLogo(set: LogoSet, width: number, height: number) {
  const { whole, wordmark, logomark } = set;
  if (!whole) return undefined;
  if ((!wordmark && !logomark) || whole.height * scaleIn(whole, width, height) * nameShare(set) >= readable) return whole;
  const area = (logo: LogoFile) => logo.width * logo.height * scaleIn(logo, width, height) ** 2;
  if (!wordmark || !logomark) return wordmark ?? logomark;
  return area(wordmark) >= 2 * area(logomark) ? wordmark : logomark;
}

// Whether the version `pickLogo` chose for a space reads there, or is better replaced by the brand's name: a symbol
// big enough to make out, or a name tall enough, alone or within the whole logo.
export function logoReads(set: LogoSet, logo: LogoFile, width: number, height: number) {
  const drawn = logo.height * scaleIn(logo, width, height);
  if (logo === set.logomark) return Math.max(logo.width, logo.height) * scaleIn(logo, width, height) >= readableMark;
  if (logo === set.wordmark) return drawn >= readable;
  return drawn * nameShare(set) >= readable;
}

// What a logo is drawn on: the color the brand sets it on where it records one, or the solid background the file
// brings along, so the two meet without an edge; and otherwise white, as logos are drawn for a white page. Black
// only for a logo drawn mostly in white.
export const logoFill = (set: LogoSet, shown?: LogoFile) =>
  set.background ?? shown?.background ?? (shown?.onWhite === false ? '#000000' : '#ffffff');

// Whether a `#rrggbb` color is dark enough to want light text on it, by its relative luminance.
export const isDark = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.18;
};
