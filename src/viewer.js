// Full-screen viewer: a scrolling list of rendered formulas that follows its
// source (a Rex pane or a file) as it changes.

import { extractFormulas } from './extract.js';
import { renderFormula } from './render.js';
import { kittyClear, kittyImage, parseReplies, QUERY } from './term.js';

const ESC = '\x1b';
const INDENT = 3; // columns left of each formula

function truncate(text, width) {
  if (width <= 0) return '';
  const chars = [...text];
  return chars.length <= width ? text : chars.slice(0, Math.max(0, width - 1)).join('') + '…';
}

export class Viewer {
  /**
   * @param {{ source: { title: string, stripComments: boolean, accumulate: boolean,
   *   start(onText: (text: string) => void, onError: (message: string) => void): void, stop(): void },
   *   zoom?: number, density?: number, input?: NodeJS.ReadStream, output?: NodeJS.WriteStream }} options
   */
  constructor(options) {
    this.source = options.source;
    this.zoom = options.zoom ?? 1.3;
    this.density = options.density ?? 2;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.items = []; // { tex, display, key }
    this.keys = new Set();
    this.cache = new Map();
    this.term = { cellW: 8, cellH: 17, fg: '#d0d0d0', bg: '#000000' };
    this.scroll = 0;
    this.follow = Boolean(this.source.accumulate); // a pane grows at the end; a file reads from the top
    this.flash = '';
    this.sourceError = '';
    this.pending = '';
    this.drawQueued = false;
  }

  start() {
    const { input, output } = this;
    input.setRawMode(true);
    input.resume();
    // Alternate screen, no cursor, mouse wheel reports.
    output.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?1000h${ESC}[?1006h`);
    input.on('data', (chunk) => this.onInput(chunk.toString('latin1')));
    output.on('resize', () => {
      output.write(QUERY); // the cell size changes with the font size
      this.queueDraw();
    });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => this.quit());
    output.write(QUERY);
    this.source.start(
      (text) => this.onText(text),
      (message) => {
        this.sourceError = message;
        this.queueDraw();
      },
    );
    this.queueDraw();
  }

  quit() {
    this.source.stop();
    this.output.write(`${kittyClear}${ESC}[?1006l${ESC}[?1000l${ESC}[?25h${ESC}[?1049l`);
    this.input.setRawMode(false);
    process.exit(0);
  }

  onText(text) {
    this.sourceError = '';
    const formulas = extractFormulas(text, { stripComments: this.source.stripComments });
    if (this.source.accumulate) {
      // A pane scrolls: keep what was seen, add what is new.
      for (const formula of formulas) {
        const key = (formula.display ? 'D' : 'I') + formula.tex;
        if (this.keys.has(key)) continue;
        this.keys.add(key);
        this.items.push({ ...formula, key });
      }
    } else {
      this.items = formulas.map((formula) => ({ ...formula, key: (formula.display ? 'D' : 'I') + formula.tex }));
    }
    this.queueDraw();
  }

  onInput(chunk) {
    const { info, rest } = parseReplies(this.pending + chunk);
    this.pending = '';
    let changed = false;
    for (const name of ['cellW', 'cellH', 'fg', 'bg']) {
      if (info[name] && info[name] !== this.term[name]) {
        this.term[name] = info[name];
        changed = true;
      }
    }
    if (changed) this.queueDraw();

    const page = Math.max(1, this.bodyRows() - 2);
    let input = rest;
    while (input.length > 0) {
      let match;
      if ((match = /^\x1b\[<(\d+);\d+;\d+[Mm]/.exec(input))) {
        if (match[1] === '64') this.scrollBy(-3);
        else if (match[1] === '65') this.scrollBy(3);
      } else if ((match = /^\x1b\[([\d;]*)([A-Za-z~])/.exec(input))) {
        const code = match[1] + match[2];
        if (code === 'A') this.scrollBy(-1);
        else if (code === 'B') this.scrollBy(1);
        else if (code === '5~') this.scrollBy(-page);
        else if (code === '6~') this.scrollBy(page);
        else if (code === 'H' || code === '1~') this.scrollTo(0);
        else if (code === 'F' || code === '4~') this.scrollToEnd();
      } else if (input === ESC) {
        return this.quit();
      } else if (input[0] === ESC) {
        // An unfinished or unknown sequence: wait for the rest, or drop it.
        if (input.length < 3) this.pending = input;
        return;
      } else {
        const key = input[0];
        if (key === 'q' || key === '\x03') return this.quit();
        else if (key === 'j') this.scrollBy(1);
        else if (key === 'k') this.scrollBy(-1);
        else if (key === ' ' || key === 'f') this.scrollBy(page);
        else if (key === 'b') this.scrollBy(-page);
        else if (key === 'd') this.scrollBy(Math.ceil(page / 2));
        else if (key === 'u') this.scrollBy(-Math.ceil(page / 2));
        else if (key === 'g') this.scrollTo(0);
        else if (key === 'G') this.scrollToEnd();
        else if (key === '+' || key === '=') this.setZoom(this.zoom * 1.15);
        else if (key === '-') this.setZoom(this.zoom / 1.15);
        else if (key === '0') this.setZoom(1.3);
        else if (key === 'y') this.copyTop();
        else if (key === 'c') this.clear();
        match = [key];
      }
      input = input.slice(match[0].length);
    }
  }

  bodyRows() {
    return Math.max(1, (this.output.rows || 24) - 2);
  }

  scrollBy(delta) {
    this.scrollTo(this.scroll + delta);
  }

  scrollTo(row) {
    this.scroll = row;
    this.follow = false; // draw() turns it back on at the end
    this.queueDraw();
  }

  scrollToEnd() {
    this.follow = true;
    this.queueDraw();
  }

  setZoom(zoom) {
    this.zoom = Math.min(4, Math.max(0.5, zoom));
    this.flash = `zoom ${Math.round((this.zoom / 1.3) * 100)}%`;
    this.queueDraw();
  }

  clear() {
    this.items = [];
    this.keys.clear();
    this.flash = 'cleared';
    this.queueDraw();
  }

  copyTop() {
    const top = this.layout().find((entry) => entry.top + entry.rows > this.scroll);
    if (!top) return;
    const payload = Buffer.from(top.item.tex, 'utf8').toString('base64');
    this.output.write(`${ESC}]52;c;${payload}\x07`);
    this.flash = `copied #${top.number}`;
    this.queueDraw();
  }

  rendered(item) {
    const { cellW, cellH, fg } = this.term;
    const emPx = cellH * 0.8 * this.zoom;
    const maxCols = Math.max(1, (this.output.columns || 80) - INDENT - 1);
    const cacheKey = [item.key, emPx, fg, cellW, cellH, maxCols, this.density].join('\0');
    let result = this.cache.get(cacheKey);
    if (!result) {
      result = renderFormula(item.tex, { display: item.display, emPx, color: fg, cellW, cellH, maxCols, density: this.density });
      if (this.cache.size > 2000) this.cache.clear();
      this.cache.set(cacheKey, result);
    }
    return result;
  }

  // Each formula takes a caption row, its image rows (or one error row), and a
  // blank row.
  layout() {
    const entries = [];
    let top = 0;
    this.items.forEach((item, index) => {
      const result = this.rendered(item);
      const imageRows = result.error ? 1 : result.rows;
      const rows = 1 + imageRows + 1;
      entries.push({ item, number: index + 1, result, top, imageRows, rows });
      top += rows;
    });
    return entries;
  }

  queueDraw() {
    if (this.drawQueued) return;
    this.drawQueued = true;
    setTimeout(() => {
      this.drawQueued = false;
      this.draw();
    }, 16);
  }

  draw() {
    const columns = this.output.columns || 80;
    const rows = this.output.rows || 24;
    const bodyRows = this.bodyRows();
    const entries = this.layout();
    const total = entries.length ? entries[entries.length - 1].top + entries[entries.length - 1].rows - 1 : 0;
    const maxScroll = Math.max(0, total - bodyRows);
    if (this.follow || this.scroll >= maxScroll) {
      this.scroll = maxScroll;
      this.follow = true;
    }
    if (this.scroll < 0) this.scroll = 0;

    const at = (row, column) => `${ESC}[${row};${column}H`;
    let out = `${ESC}[?2026h${kittyClear}${ESC}[0m${ESC}[2J`;

    const count = `${this.items.length} formula${this.items.length === 1 ? '' : 's'}`;
    out += at(1, 1) + `${ESC}[1m rextex${ESC}[0m${ESC}[2m · ${truncate(`${count} · ${this.source.title}`, columns - 10)}${ESC}[0m`;

    if (entries.length === 0) {
      const message = this.sourceError || 'No formulas yet. Watching for $…$, $$…$$, \\(…\\), \\[…\\] and \\begin{…}.';
      out += at(3, INDENT) + `${ESC}[2m${truncate(message, columns - INDENT)}${ESC}[0m`;
    }

    let imageId = 1;
    for (const entry of entries) {
      const first = entry.top - this.scroll; // body row of the caption, 0-based
      if (first >= bodyRows || first + entry.rows <= 0) continue;
      if (first >= 0) {
        const caption = `${entry.number}  ${entry.item.tex}`;
        out += at(first + 2, 1) + `${ESC}[2m ${truncate(caption, columns - 2)}${ESC}[0m`;
      }
      const imageTop = first + 1;
      if (entry.result.error) {
        if (imageTop >= 0 && imageTop < bodyRows) {
          out += at(imageTop + 2, INDENT) + `${ESC}[31m${truncate(`✗ ${entry.result.error}`, columns - INDENT)}${ESC}[0m`;
        }
        continue;
      }
      const visibleTop = Math.max(0, imageTop);
      const visibleEnd = Math.min(bodyRows, imageTop + entry.imageRows);
      if (visibleEnd <= visibleTop) continue;
      const shown = visibleEnd - visibleTop;
      const crop = { y: (visibleTop - imageTop) * entry.result.rowPx, w: entry.result.width, h: shown * entry.result.rowPx };
      out += at(visibleTop + 2, INDENT) + kittyImage(entry.result.png, { id: imageId++, cols: entry.result.cols, rows: shown, crop });
    }

    const position = total <= bodyRows ? 'all' : this.follow ? 'end' : `${Math.round((this.scroll / maxScroll) * 100)}%`;
    const help = 'j/k scroll · g/G top/end · +/- zoom · y copy · c clear · q quit';
    const status = this.flash ? `${this.flash} · ${position}` : position;
    this.flash = '';
    out += at(rows, 1) + `${ESC}[2m ${truncate(`${status} · ${help}`, columns - 2)}${ESC}[0m`;
    out += `${ESC}[?2026l`;
    this.output.write(out);
  }
}
