import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { CollectionEntry } from 'astro:content';
import type { LogoFile, LogoSet } from './logo';
import { logoTone } from './logo-tone';

// A brand's or group's logo files as a LogoSet, with how each file sits on a fill measured from it. Build time only,
// as the measuring reads the files. Astro gives no file path for an SVG, so each file is found from the path its
// record gives, e.g. `logo: ../logos/omega.svg`.
type Record = CollectionEntry<'brands'> | CollectionEntry<'groups'>;
const keys = { whole: 'logo', wordmark: 'wordmark', logomark: 'logomark' } as const;
const sets = new Map<string, Promise<LogoSet>>();

async function build({ data, filePath }: Record): Promise<LogoSet> {
  const text = filePath ? await readFile(filePath, 'utf8') : '';
  const file = async (key: (typeof keys)[keyof typeof keys]): Promise<LogoFile | undefined> => {
    const image = data[key];
    if (!image) return undefined;
    const given = text.match(new RegExp(`^${key}:\\s*['"]?([^'"\\s]+)`, 'm'))?.[1];
    const tone = given && filePath ? await logoTone(resolve(dirname(filePath), given)) : { onWhite: true };
    return { src: image.src, width: image.width, height: image.height, ...tone };
  };
  const [whole, wordmark, logomark] = await Promise.all([file(keys.whole), file(keys.wordmark), file(keys.logomark)]);
  return { whole, wordmark, logomark, background: data.logoBackground };
}

export function logoSetOf(record: Record): Promise<LogoSet> {
  const key = `${record.collection}/${record.id}`;
  let set = sets.get(key);
  if (!set) {
    set = build(record);
    sets.set(key, set);
  }
  return set;
}
