import { ApiError } from './errors';

export function parseWho(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 40) throw new ApiError(400, 'name_required', 'Tell us your name (up to 40 characters) before making changes.');
  return s;
}

export function parseNote(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.trim().length > 200) throw new ApiError(400, 'invalid_note', 'Notes can be up to 200 characters.');
  return v.trim() || null;
}
