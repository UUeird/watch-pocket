import type { ImageMetadata } from 'astro';
import officialPhotos from '../data/official-photos.json';
import type { Model, Reference } from './catalog';

// A photo a tile can show: one of our own copies, or the maker's image loaded from their site. `general` marks a
// photo of the model standing in for a reference with none of its own.
export type TilePhoto = ({ file: ImageMetadata } | { src: string }) & { alt: string; general?: boolean };

const official = officialPhotos as Record<string, { src: string }>;

// A model's photos, best first: its own, then its references', then the maker's image of it.
export function modelPhotos(model: Model, brandName: string): TilePhoto[] {
  const name = `${brandName} ${model.data.name}`;
  const own = model.data.photos.map(({ file }) => ({ file, alt: name }));
  const ofReferences = model.data.references.flatMap(({ ref, photos }) => photos.map(({ file }) => ({ file, alt: `${name} ${ref}` })));
  const ours = [...own, ...ofReferences];
  if (ours.length > 0) return ours;
  return official[model.id] ? [{ src: official[model.id].src, alt: name }] : [];
}

// A reference's photos: its own, or failing that its model's.
export function referencePhotos(model: Model, reference: Reference, brandName: string): TilePhoto[] {
  const name = `${brandName} ${model.data.name} ${reference.ref}`;
  if (reference.photos.length > 0) return reference.photos.map(({ file }) => ({ file, alt: name }));
  return modelPhotos(model, brandName).map((photo) => ({ ...photo, alt: name, general: true }));
}

// A line's photos: the first of each model's, so cycling through them shows the range.
export const linePhotos = (models: Model[], brandName: string, limit = 5) =>
  models.flatMap((model) => modelPhotos(model, brandName).slice(0, 1)).slice(0, limit);
