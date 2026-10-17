import { describe, expect, it } from 'vitest';

import { parseCsv } from '@/server/importer/csv';

describe('parseCsv (C-15, D-2 Q-1)', () => {
  it('splits plain records on commas and LF', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('reads CRLF and a final record with no line end', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('removes a leading BOM so the first header name matches', () => {
    expect(parseCsv('﻿id,title\n1,x')[0]).toEqual(['id', 'title']);
  });

  it('keeps a comma inside quotes', () => {
    expect(parseCsv('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
  });

  it('turns a doubled quote inside quotes into one quote', () => {
    expect(parseCsv('"say ""hi""",x')).toEqual([['say "hi"', 'x']]);
  });

  it('keeps a newline (LF and CRLF) inside quotes in the field', () => {
    expect(parseCsv('"line1\nline2",x\n"a\r\nb",y')).toEqual([
      ['line1\nline2', 'x'],
      ['a\r\nb', 'y'],
    ]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps empty cells', () => {
    expect(parseCsv('a,,c\n,,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('returns a ragged record as it is, short or long', () => {
    expect(parseCsv('a,b,c\n1\n1,2,3,4')).toEqual([['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']]);
  });

  it('returns nothing for empty text', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });

  it('lets an unterminated quote run to the end without throwing', () => {
    const records = parseCsv('a,b\n1,"never closed\n2,3');
    expect(records[0]).toEqual(['a', 'b']);
    expect(records).toHaveLength(2);
  });
});
