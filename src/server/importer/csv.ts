// A small RFC 4180 reader (D-2 Q-1; no dependency). Pure.

/**
 * Parses CSV text into records of fields. Handles a leading BOM, comma
 * separators, double-quoted fields with doubled quotes, CRLF and LF line ends,
 * and newlines inside quotes. Blank lines are skipped. A ragged record is
 * returned as it is. An unterminated quote runs to the end of the text.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let hasContent = false;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // A line with no characters at all is blank, not a record of one empty field.
    if (hasContent) records.push(record);
    record = [];
    hasContent = false;
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      hasContent = true;
    } else if (char === ',') {
      endField();
      hasContent = true;
    } else if (char === '\n') {
      endRecord();
    } else if (char === '\r') {
      if (source[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      field += char;
      hasContent = true;
    }
  }
  if (hasContent) endRecord();
  return records;
}
