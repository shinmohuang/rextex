// Find formulas on a terminal screen together with the cells they occupy, so
// an image can be laid exactly over the source.

import stringWidth from 'string-width';

import { looksLikeMath } from './extract.js';

// A TUI may put a bullet or a gutter before the text.
const LEAD = String.raw`^([\s│┃▏▕⎿]*(?:[•●⏺∙·]\s+)?)`;
const DISPLAY_OPEN = new RegExp(
  LEAD + String.raw`(\$\$|\\\[|\\begin\{(equation|align|alignat|flalign|gather|multline|eqnarray)(\*?)\})`,
);
const INLINE = /\\\((.{1,400}?)\\\)|(?<![\\$\w])\$(?![\s$])([^$]{1,400}?)(?<![\s\\])\$(?![\w$])/g;

const isBlank = (line) => line === undefined || /^[\s]*$/.test(line);

/**
 * @param {string[]} lines the rows of the screen, top to bottom
 * @returns {{ tex: string, display: boolean, row: number, rows: number, col: number, cols: number }[]}
 *   `row`/`col` are 0-based cells. `cols` is the width of the source; a display formula may be
 *   drawn wider, since the rest of its rows is empty.
 */
export function locateFormulas(lines) {
  const found = [];
  const taken = new Set(); // rows that belong to a display formula

  for (let row = 0; row < lines.length; row++) {
    const open = DISPLAY_OPEN.exec(lines[row]);
    if (!open) continue;
    const opener = open[2];
    const closer = opener === '$$' ? '$$' : opener === '\\[' ? '\\]' : `\\end{${open[3]}${open[4]}}`;
    const col = stringWidth(open[1]);
    const parts = [lines[row].slice(open[0].length)];
    let last = row;
    while (!parts[parts.length - 1].includes(closer) && last + 1 < lines.length && last - row < 30) {
      parts.push(lines[++last]);
    }
    const tail = parts[parts.length - 1];
    const end = tail.indexOf(closer);
    // Still being written, or followed by other text on the row: leave it alone.
    if (end < 0 || tail.slice(end + closer.length).trim() !== '') continue;
    // A continuation row that starts left of the formula holds unrelated text.
    let clean = true;
    for (let r = row + 1; r <= last; r++) {
      if (!isBlank(lines[r]) && stringWidth(/^\s*/.exec(lines[r])[0]) < col) clean = false;
    }
    if (!clean) continue;
    parts[parts.length - 1] = tail.slice(0, end);
    let tex = parts.map((part) => part.trim()).filter(Boolean).join(' ');
    if (!tex) continue;
    if (open[3]) tex = `${opener} ${tex} ${closer}`.replace(/\\label\{[^}]*\}/g, '').replace(/\s+/g, ' ');
    let width = 0;
    for (let r = row; r <= last; r++) width = Math.max(width, stringWidth(lines[r]));
    found.push({ tex, display: true, row, rows: last - row + 1, sourceRows: last - row + 1, col, cols: width - col });
    for (let r = row; r <= last; r++) taken.add(r);
    row = last;
  }

  // A display formula on one source row is cramped. Let it grow into the blank
  // rows around it, which a paragraph break normally provides.
  // Formulas take turns, one row at a time, so neighbours share the gaps
  // between them instead of the first one taking both.
  const free = (row) => row >= 0 && row < lines.length && isBlank(lines[row]) && !taken.has(row);
  for (const side of ['below', 'above']) {
    for (const formula of found) {
      if (formula.rows >= (formula.sourceRows > 1 ? 5 : 3)) continue;
      const row = side === 'below' ? formula.row + formula.rows : formula.row - 1;
      if (!free(row)) continue;
      taken.add(row);
      if (side === 'above') formula.row = row;
      formula.rows++;
    }
  }

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    if (taken.has(row) || line.includes('\t') || !/[$\\]/.test(line)) continue;
    INLINE.lastIndex = 0;
    let match;
    while ((match = INLINE.exec(line)) !== null) {
      const tex = (match[1] ?? match[2]).trim();
      if (!tex) continue;
      if (match[2] !== undefined && !looksLikeMath(tex)) {
        INLINE.lastIndex = match.index + match[0].length - 1; // the closing $ may open the next one
        continue;
      }
      found.push({
        tex,
        display: false,
        row,
        rows: 1,
        col: stringWidth(line.slice(0, match.index)),
        cols: stringWidth(match[0]),
      });
    }
  }
  return found;
}
