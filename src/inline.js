// Inline mode: draw each formula over its own source text, in the pane where
// it appears.
//
// A pane's terminal is a tty device. Anything written to that device reaches
// the terminal exactly as if the program in the pane had printed it, so kitty
// graphics written there show up in the pane. (The technique is from
// liambern/herdr-math.) Nothing is ever read from the tty and every command
// carries q=2, so the terminal sends no reply into the program's input.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { locateFormulas } from './locate.js';
import { renderTile, typeset } from './render.js';
import { blockCall, paneColors, REX } from './rex.js';

const ESC = '\x1b';
const REPLACE_EVERY_MS = 2000;

const stateDir = path.join(os.tmpdir(), `rextex-${os.userInfo().uid}`);
const pidFile = (block) => path.join(stateDir, `${block.replace(/[^\w.-]/g, '_')}.pid`);
export const themeFile = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'rextex', 'theme.json');

function runningPid(block) {
  try {
    const pid = Number(fs.readFileSync(pidFile(block), 'utf8'));
    if (!Number.isInteger(pid) || pid <= 1) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Stop the renderer for a pane. Returns whether one was running. */
export function stopInline(block) {
  const pid = runningPid(block);
  if (!pid) return false;
  process.kill(pid, 'SIGTERM');
  return true;
}

export function inlineRunning(block) {
  return runningPid(block) !== null;
}

/** Start the renderer for a pane as a background process. */
export function startInline(script, args) {
  fs.mkdirSync(stateDir, { recursive: true });
  const log = fs.openSync(path.join(stateDir, 'inline.log'), 'a');
  const child = spawn(process.execPath, [script, 'inline', '--foreground', ...args], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
}

// The tty of the pane, found through the processes that run in it.
async function findTty(session, block) {
  const info = await blockCall(session, block, 'process');
  const pids = [info.foreground, ...(info.ancestors || []), info.child].filter(Boolean).map((p) => p.pid);
  for (const pid of pids) {
    try {
      const name = execFileSync('ps', ['-o', 'tty=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      if (name && !name.startsWith('?') && name !== '-') return name.startsWith('/') ? name : `/dev/${name}`;
    } catch {
      // That process has exited; try the next one.
    }
  }
  throw new Error('could not find the terminal device of that pane');
}

// Formulas are drawn opaque, in the pane's own colors, so they hide the source
// beneath them. The colors come from the server and are read again as the
// renderer runs, so a theme change is followed.
//
// Rex may not paint a pane's background in the theme's background color: with
// its default settings it uses a surface color of its own, one for dark themes
// and one for light ones, whatever the theme. `rextex theme --bg` records that
// color for the kind of theme the pane has, and it is used for the background
// in place of the theme's.
function savedShades() {
  try {
    const saved = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
    const shades = {};
    for (const scheme of ['dark', 'light']) {
      if (/^#[0-9a-f]{6}$/i.test(saved[scheme] || '')) shades[scheme] = saved[scheme].toLowerCase();
    }
    return shades;
  } catch {
    return {};
  }
}

/** 'dark' or 'light', from how bright a background color is. */
export function schemeOf(color) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? 'dark' : 'light';
}

export async function currentTheme(session, block) {
  const shades = savedShades();
  let live = null;
  try {
    live = await paneColors(session, block);
  } catch {
    // Use the defaults below.
  }
  // A pane no app has shown yet has no theme; assume a dark one.
  if (!live) live = { fg: '#d0d0d0', bg: '#101010' };
  return { fg: live.fg, bg: shades[schemeOf(live.bg)] || live.bg, themeBg: live.bg };
}

// What is on the pane's terminal: images uploaded once, placed where the
// formulas are, moved when the text moves, and removed when it goes away.
class Graphics {
  constructor() {
    this.ids = new Map(); // tile key -> image id
    this.placed = new Map(); // "id:n" -> "row,col,cols,rows"
    // A base unlikely to collide with images the program itself shows.
    this.nextId = 0x52580000 + Math.floor(Math.random() * 0x8000) * 2;
  }

  update(placements, force) {
    let out = '';
    const desired = new Map();
    const copies = new Map();
    for (const p of placements) {
      let id = this.ids.get(p.key);
      if (id === undefined) {
        id = this.nextId++;
        this.ids.set(p.key, id);
        const data = p.png.toString('base64');
        for (let offset = 0; offset < data.length; offset += 4096) {
          const more = offset + 4096 < data.length ? 1 : 0;
          const keys = offset === 0 ? `a=t,f=100,i=${id},q=2,m=${more}` : `q=2,m=${more}`;
          out += `${ESC}_G${keys};${data.slice(offset, offset + 4096)}${ESC}\\`;
        }
      }
      const n = (copies.get(id) || 0) + 1;
      copies.set(id, n);
      const where = `${p.row},${p.col},${p.cols},${p.rows}`;
      desired.set(`${id}:${n}`, where);
      if (force || this.placed.get(`${id}:${n}`) !== where) {
        out += `${ESC}[${p.row + 1};${p.col + 1}H${ESC}_Ga=p,i=${id},p=${n},c=${p.cols},r=${p.rows},C=1,q=2${ESC}\\`;
      }
    }
    for (const key of this.placed.keys()) {
      if (desired.has(key)) continue;
      const [id, n] = key.split(':');
      out += `${ESC}_Ga=d,d=i,i=${id},p=${n},q=2${ESC}\\`;
    }
    for (const [key, id] of this.ids) {
      if (copies.has(id)) continue;
      out += `${ESC}_Ga=d,d=I,i=${id},q=2${ESC}\\`;
      this.ids.delete(key);
    }
    this.placed = desired;
    // Save and restore the cursor so the program never sees it move.
    return out && `${ESC}7${out}${ESC}8`;
  }

  clear() {
    let out = '';
    for (const id of this.ids.values()) out += `${ESC}_Ga=d,d=I,i=${id},q=2${ESC}\\`;
    this.ids.clear();
    this.placed = new Map();
    return out;
  }
}

/** Run the renderer for one pane until the pane closes or we are told to stop. */
export async function runInline({ session, block, zoom = 1, density = 2, style = 'card' }) {
  fs.mkdirSync(stateDir, { recursive: true });
  if (runningPid(block)) throw new Error('inline rendering is already on for that pane');
  fs.writeFileSync(pidFile(block), String(process.pid));

  let fd;
  try {
    const tty = await findTty(session, block);
    fd = fs.openSync(tty, fs.constants.O_WRONLY | fs.constants.O_NOCTTY);
  } catch (error) {
    fs.rmSync(pidFile(block), { force: true });
    throw error;
  }
  const graphics = new Graphics();
  const tiles = new Map();
  let stopped = false;

  let watcher = null;
  const finish = (code) => {
    if (stopped) return;
    stopped = true;
    if (watcher) watcher.kill();
    try {
      const out = graphics.clear();
      if (out) fs.writeSync(fd, out);
    } catch {
      // The pane closed first.
    }
    try {
      if (Number(fs.readFileSync(pidFile(block), 'utf8')) === process.pid) fs.unlinkSync(pidFile(block));
    } catch {
      // Already gone.
    }
    process.exit(code);
  };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => finish(0));

  // Lay the formulas of one screen over their source.
  const draw = ({ text, size, theme }, force) => {
    const { columns, rows, cell_width_px: cellW, cell_height_px: cellH } = size;
    let lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    if (lines.length > rows) lines = lines.slice(lines.length - rows); // the screen is the end of the scrollback
    const placements = [];
    for (const formula of locateFormulas(lines)) {
      const exPx = cellH * 0.5 * zoom;
      const card = style === 'card';
      let col = formula.col;
      let cols = formula.cols;
      if (formula.display) {
        // Wide enough to hide the source and to hold the formula, which
        // may be the wider of the two.
        const math = typeset(formula.tex, true);
        const needed = math.error ? 0 : Math.ceil((math.widthEx * exPx) / cellW) + 4;
        cols = Math.max(formula.cols, needed);
        if (card) {
          // A cell of margin each side, so the rounded corners fall on
          // empty cells and not on the source's first and last characters.
          if (col > 0) {
            col -= 1;
            cols += 1;
          }
          cols += 1;
        }
        cols = Math.min(columns - col, cols);
      }
      if (cols < 1 || col + cols > columns) continue;
      // A card is tinted from the theme's own background. The plain style
      // has to match what the terminal paints, which may be set by hand.
      const background = card ? theme.themeBg || theme.bg : theme.bg;
      const key = JSON.stringify([formula.tex, formula.display, cols, formula.rows, cellW, cellH, zoom, density, style, theme.fg, background]);
      let png = tiles.get(key);
      if (png === undefined) {
        const box = {
          cols,
          rows: formula.rows,
          cellW,
          cellH,
          density,
          exPx,
          minScale: 0.6,
          inline: !formula.display,
          card,
          color: theme.fg,
          background,
        };
        // Unfinished or invalid formulas stay readable as source.
        const math = typeset(formula.tex, formula.display);
        png = math.error ? null : renderTile(math, box);
        if (!png && !math.error && formula.display && !/\\begin\{(equation|align|alignat|flalign|gather|multline|eqnarray)/.test(formula.tex)) {
          // Too tall for the rows it has: set it the compact way TeX sets
          // math inside a paragraph, with limits beside the operator.
          const compact = typeset(formula.tex, false);
          if (!compact.error) png = renderTile(compact, box);
        }
        if (tiles.size > 500) tiles.clear();
        tiles.set(key, png);
      }
      if (png) placements.push({ key, png, row: formula.row, col, cols, rows: formula.rows });
    }
    const out = graphics.update(placements, force);
    // One write, so the terminal gets it whole, between the program's own writes.
    if (out) fs.writeSync(fd, out);
  };

  // The newest screen the watcher has reported. Reports can arrive faster
  // than they are drawn; only the latest one matters.
  let latest = null;
  let pending = false;
  const schedule = () => {
    if (pending || stopped) return;
    pending = true;
    setImmediate(() => {
      pending = false;
      if (!latest || stopped) return;
      try {
        draw(latest, false);
      } catch (error) {
        // The pane's terminal is gone.
        process.stderr.write(`rextex inline ${block}: ${error.message}\n`);
        finish(1);
      }
    });
  };

  // A program that clears its screen also removes the images, and nothing
  // reports that, so put everything back in place now and then.
  setInterval(() => {
    if (!latest || stopped) return;
    try {
      draw(latest, true);
    } catch {
      finish(1);
    }
  }, REPLACE_EVERY_MS);

  const shades = () => savedShades();
  let restarts = 0;
  const watch = () => {
    const args = ['do', '-b', block];
    if (session) args.push('-s', session);
    args.push(fileURLToPath(new URL('./watch.lua', import.meta.url)));
    const child = spawn(REX, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    watcher = child;
    let errors = '';
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-400);
    });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let report;
      try {
        report = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof report.text !== 'string' || !report.size) return;
      restarts = 0;
      // A pane no app has shown yet has no theme; assume a dark one.
      const live = report.fg && report.bg && !(report.bg === '#000000' && report.fg === '#ffffff')
        ? { fg: report.fg, bg: report.bg }
        : { fg: '#d0d0d0', bg: '#101010' };
      const theme = { fg: live.fg, bg: shades()[schemeOf(live.bg)] || live.bg, themeBg: live.bg };
      latest = { text: report.text, size: report.size, theme };
      schedule();
    });
    child.on('exit', () => {
      if (stopped) return;
      // The pane has closed, or the server is restarting. Give it a few tries.
      if (++restarts > 5) {
        process.stderr.write(`rextex inline ${block}: the pane is gone${errors ? `: ${errors.trim().split('\n').pop()}` : ''}\n`);
        finish(1);
        return;
      }
      setTimeout(watch, 1000);
    });
  };
  watch();
  await new Promise(() => {}); // runs until a signal or the pane closing ends it
}

export { REX };
