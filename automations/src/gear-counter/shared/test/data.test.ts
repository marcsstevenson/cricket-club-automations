import { describe, expect, it } from 'vitest';
import { DOT_COLOURS, MASCOTS } from '../src/data';

describe('shared data', () => {
  it('has dot colours as hex', () => {
    for (const hex of Object.values(DOT_COLOURS)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('lists mascot images', () => {
    expect(MASCOTS).toContain('pumas');
  });
});
