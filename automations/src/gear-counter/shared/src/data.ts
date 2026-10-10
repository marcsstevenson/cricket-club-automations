import raw from './gear-data.json';

export interface Item {
  id: string;
  category: string;
  name: string;
}

interface GearData {
  source: string;
  categories: string[];
  items: Item[];
  specs: Record<string, Record<string, number>>;
}

const data = raw as GearData;

export const categories = data.categories;
export const items = data.items;
const itemIndex = new Map(items.map((it, i) => [it.id, i]));

export const findItem = (id: string) => (itemIndex.has(id) ? { item: items[itemIndex.get(id)!], sort: itemIndex.get(id)! } : null);

/** Kit Spec columns (one per grade), in workbook order. */
export const specColumns = Object.keys(data.specs);

/**
 * The lines a new stocktake starts with, in catalogue order: the Kit Spec column's items, or every item at 0
 * for a pool (spec null).
 */
export function specLines(spec: string | null): { item: Item; sort: number; expected: number }[] {
  if (spec === null) return items.map((item, sort) => ({ item, sort, expected: 0 }));
  const column = data.specs[spec] ?? {};
  return items.flatMap((item, sort) => (column[item.id] ? [{ item, sort, expected: column[item.id] }] : []));
}

/** Kit Spec quantity for an item (0 when not in the column, or for a pool). */
export function kitSpecQty(spec: string | null, itemId: string): number {
  return spec === null ? 0 : (data.specs[spec]?.[itemId] ?? 0);
}

export const DOT_COLOURS: Record<string, string> = {
  yellow: '#e8c21b',
  'light blue': '#6cb6e6',
  'dark blue': '#24408f',
  green: '#2e9b4d',
  orange: '#e8812a',
  red: '#d23b2f',
};

/** Images in web/static/mascots (each has a -sm variant). */
export const MASCOTS = [
  'bears', 'cheetahs', 'dolphins', 'dragons', 'foxes', 'gorillas', 'jackals', 'lemurs', 'leopards', 'lions', 'meerkats',
  'monkeys', 'narwhals', 'orcas', 'pandas', 'panthers', 'pelicans', 'penguins', 'pumas', 'pythons', 'rhinos', 'seals',
  'sharks', 'swans', 'tigers', 'unicorns', 'wolves', 'wombats',
];
