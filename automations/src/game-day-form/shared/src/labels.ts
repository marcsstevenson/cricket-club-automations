export interface SquadPlayer {
  key: string;
  firstName: string;
  lastName: string;
  playhqId?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function prefixLabel(first: string, last: string, n: number) {
  return `${first} ${cap(last.slice(0, n))}.`;
}

/** "First L." labels for one team, extended until unique within the team. */
export function squadLabels(players: SquadPlayer[]): Map<string, string> {
  const out = new Map<string, string>();
  const groups = new Map<string, SquadPlayer[]>();
  for (const p of players) {
    const id = `${p.firstName.trim().toLowerCase()}|${p.lastName.trim().charAt(0).toLowerCase()}`;
    groups.set(id, [...(groups.get(id) ?? []), p]);
  }
  for (const group of groups.values()) {
    for (const p of group) {
      const first = p.firstName.trim();
      const last = p.lastName.trim();
      const lower = last.toLowerCase();
      const others = group.filter((q) => q !== p).map((q) => q.lastName.trim().toLowerCase());
      let n = 1;
      while (n < last.length && others.some((o) => o.slice(0, n) === lower.slice(0, n))) n++;
      const distinct = n < last.length || !others.some((o) => o.slice(0, n) === lower.slice(0, n));
      out.set(p.key, distinct ? prefixLabel(first, last, n) : `${prefixLabel(first, last, 1)} (${p.key.slice(-2)})`);
    }
  }
  return out;
}

/** Label for a name typed by a coach or taken from PlayHQ. */
export function otherLabel(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words[0] ?? '';
  return `${words[0]} ${words.at(-1)!.charAt(0).toUpperCase()}.`;
}
