const nzParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date in New Zealand as YYYY-MM-DD. */
export const nzDate = (now: Date) => nzParts.format(now);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-09" → "9 Oct 2026". */
export function dateLabel(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const nzClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const parts = (iso: string) => Object.fromEntries(nzClock.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));

/** ISO time → "2026-10-11 14:14" in New Zealand. */
export function nzDateTime(iso: string) {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** ISO time → "11 Oct, 2:14 pm" in New Zealand. */
export function whenLabel(iso: string) {
  const p = parts(iso);
  const h = Number(p.hour);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}, ${h % 12 || 12}:${p.minute} ${h < 12 ? 'am' : 'pm'}`;
}
