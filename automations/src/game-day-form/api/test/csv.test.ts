import { describe, expect, it } from 'vitest';
import { toCsv } from '../src/csv';

describe('toCsv', () => {
  it('adds a BOM, quotes where needed and uses CRLF', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1, null]])).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n1,\r\n');
  });

  it('neutralises spreadsheet formulas in text', () => {
    expect(toCsv(['h'], [['=HYPERLINK("x")'], ['+1'], ['-2'], ['@a'], ['\tz']])).toBe(
      '﻿h\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n\'-2\r\n\'@a\r\n\'\tz\r\n',
    );
  });

  it('leaves negative numbers alone', () => {
    expect(toCsv(['n'], [[-5]])).toBe('﻿n\r\n-5\r\n');
  });
});
