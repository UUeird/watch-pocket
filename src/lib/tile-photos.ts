import type { ImageMetadata } from 'astro';
import officialPhotos from '../data/official-photos.json';
import { sourceHost, type Model, type Reference } from './catalog';

type Credit = Model['data']['photos'][number]['credit'];

// A photo a tile can show: one of our own copies, credited as its license asks, or the maker's image loaded from
// their site and credited to them. `general` marks a photo of the model standing in for a reference with none of
// its own.
export type TilePhoto = ({ file: ImageMetadata; credit: Credit } | { src: string; page: string }) & { alt: string; general?: boolean };

const official = officialPhotos as Record<string, { src: string; page: string }>;

// Newest first: references still on sale, then by the year they came out. Those with no years go last.
const latest = (reference: Reference) => (reference.periods.at(-1)?.to === undefined && reference.periods.length > 0 ? Infinity : (reference.periods[0]?.from ?? -Infinity));
const newestFirst = (references: Reference[]) => [...references].sort((a, b) => latest(b) - latest(a) || (b.periods[0]?.from ?? 0) - (a.periods[0]?.from ?? 0));

// A model's photos, best first: its references', newest reference first, then its own, then the maker's image of it.
export function modelPhotos(model: Model, brandName: string): TilePhoto[] {
  const name = `${brandName} ${model.data.name}`;
  const ofReferences = newestFirst(model.data.references).flatMap(({ ref, photos }) => photos.map(({ file, credit }) => ({ file, credit, alt: `${name} ${ref}` })));
  const own = model.data.photos.map(({ file, credit }) => ({ file, credit, alt: name }));
  const ours = [...ofReferences, ...own];
  if (ours.length > 0) return ours;
  const shared = official[model.id];
  return shared ? [{ ...shared, alt: name }] : [];
}

// A reference's photos: its own, or the maker's image of it, or failing those its model's.
export function referencePhotos(model: Model, reference: Reference, brandName: string): TilePhoto[] {
  const name = `${brandName} ${model.data.name} ${reference.ref}`;
  if (reference.photos.length > 0) return reference.photos.map(({ file, credit }) => ({ file, credit, alt: name }));
  if (reference.officialPhoto) return [{ ...reference.officialPhoto, alt: name }];
  // Only photos of the model as a whole stand in, never another reference's, which may look quite different.
  const general = model.data.photos.map(({ file, credit }) => ({ file, credit, alt: name, general: true }));
  if (general.length > 0) return general;
  const shared = official[model.id];
  return shared ? [{ ...shared, alt: name, general: true }] : [];
}

// A line's photos: the first of each model's, so cycling through them shows the range.
export const linePhotos = (models: Model[], brandName: string, limit = 5) =>
  models.flatMap((model) => modelPhotos(model, brandName).slice(0, 1)).slice(0, limit);

// How a photo is credited under a grid, e.g. "Photo by Matt C · CC BY 2.0", with links to the license and source.
export const creditOf = (photo: TilePhoto, brandName: string) =>
  'file' in photo
    ? { by: photo.credit.author, license: photo.credit.license, licenseUrl: photo.credit.licenseUrl, source: photo.credit.source }
    : { by: undefined, license: `© ${brandName}`, licenseUrl: undefined, source: photo.page, host: sourceHost(photo.page) };
