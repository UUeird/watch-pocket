// Kept apart from catalog.ts so the content schema can use it without importing the collections it defines.
export const refSlug = (ref: string) => ref.toLowerCase().replace(/[^a-z0-9]+/g, '-');
