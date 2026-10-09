import raw from './gear-data.json';
import type { TeamSummary } from './types';

export interface Item {
  id: string;
  category: string;
  name: string;
}

interface TeamDef extends TeamSummary {
  /** Kit Spec column; null for the pool, whose spec is every item at 0. */
  spec: string | null;
}

interface GearData {
  source: string;
  categories: string[];
  items: Item[];
  specs: Record<string, Record<string, number>>;
  teams: TeamDef[];
}

const data = raw as GearData;

export const POOL_SLUG = 'pool';
const POOL: TeamDef = { slug: POOL_SLUG, name: 'Club pool', mascot: '', grade: null, dot: null, spec: null };

export const categories = data.categories;
export const items = data.items;
const itemIndex = new Map(items.map((it, i) => [it.id, i]));
const teams = [...data.teams, POOL];

export const findItem = (id: string) => (itemIndex.has(id) ? { item: items[itemIndex.get(id)!], sort: itemIndex.get(id)! } : null);

export function findTeam(slug: string): TeamDef | null {
  return teams.find((t) => t.slug === slug.toLowerCase()) ?? null;
}

export const summary = ({ slug, name, mascot, grade, dot }: TeamDef): TeamSummary => ({ slug, name, mascot, grade, dot });
export const teamSummaries = (): TeamSummary[] => teams.map(summary);

/** The lines a new stocktake starts with, in catalogue order. */
export function specLines(team: TeamDef): { item: Item; sort: number; expected: number }[] {
  if (team.spec === null) return items.map((item, sort) => ({ item, sort, expected: 0 }));
  const spec = data.specs[team.spec] ?? {};
  return items.flatMap((item, sort) => (spec[item.id] ? [{ item, sort, expected: spec[item.id] }] : []));
}

export const DOT_COLOURS: Record<string, string> = {
  yellow: '#e8c21b',
  'light blue': '#6cb6e6',
  'dark blue': '#24408f',
  green: '#2e9b4d',
  orange: '#e8812a',
  red: '#d23b2f',
};
