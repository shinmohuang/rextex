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

import { locateFormulas } from './locate.js';
import { renderTile, typeset } from './render.js';
import { blockCall, capture, REX, rexSync } from './rex.js';

const ESC = '\x1b';
const POLL_MS = 100;

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

// Formulas are drawn opaque, in the terminal's own colors, so they hide the
// source beneath them. A program outside the pane cannot ask that terminal
// for its colors, so they are measured once in a pane of our own and kept.
function loadTheme(session, block, script) {
  const read = () => {
    try {
      const theme = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
      if (/^#[0-9a-f]{6}$/i.test(theme.fg) && /^#[0-9a-f]{6}$/i.test(theme.bg)) return theme;
    } catch {
      // Not measured yet.
    }
    return null;
  };
  let theme = read();
  if (!theme) {
    try {
      // A split of the pane itself, because Rex only reports colors for a
      // pane an app is showing. It closes as soon as it has the answer.
      const args = ['split', '--split=below', '--ratio', '10', '--focus=false', '--wait', '--shell=none', '-b', block];
      if (session) args.push('-s', session);
      rexSync([...args, '--', process.execPath, script, 'theme']);
    } catch {
      // Fall through to the default.
    }
    theme = read();
  }
  return theme || { fg: '#d0d0d0', bg: '#101010' };
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
export async function runInline({ session, block, zoom = 1, density = 2, script }) {
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
  const theme = loadTheme(session, block, script);
  const graphics = new Graphics();
  const tiles = new Map();
  let stopped = false;

  const finish = (code) => {
    if (stopped) return;
    stopped = true;
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

  let size = null;
  let previous = null;
  let failures = 0;
  for (let tick = 0; !stopped; tick++) {
    try {
      // The size changes rarely; the text is what moves.
      if (!size || tick % 10 === 0) size = await blockCall(session, block, 'size');
      const text = await capture(session, block);
      failures = 0;
      const { columns, rows, cell_width_px: cellW, cell_height_px: cellH } = size;
      const stamp = `${columns}x${rows}@${cellW}x${cellH}\n${text}`;
      // Re-place everything now and then: a program that clears its screen
      // also removes the images, and nothing reports that.
      const force = tick % 20 === 0;
      if (stamp !== previous || force) {
        previous = stamp;
        let lines = text.split('\n');
        if (lines[lines.length - 1] === '') lines.pop();
        if (lines.length > rows) lines = lines.slice(lines.length - rows); // the screen is the end of the scrollback
        const placements = [];
        for (const formula of locateFormulas(lines)) {
          const exPx = cellH * 0.5 * zoom;
          let cols = formula.cols;
          if (formula.display) {
            // Wide enough to hide the source and to hold the formula, which
            // may be the wider of the two.
            const math = typeset(formula.tex, true);
            const needed = math.error ? 0 : Math.ceil((math.widthEx * exPx) / cellW) + 4;
            cols = Math.min(columns - formula.col, Math.max(formula.cols, needed));
          }
          if (cols < 1 || formula.col + cols > columns) continue;
          const key = JSON.stringify([formula.tex, formula.display, cols, formula.rows, cellW, cellH, zoom, density]);
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
              align: 'left',
              padLeft: formula.display ? 2 * cellW : 2,
              color: theme.fg,
              background: theme.bg,
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
          if (png) placements.push({ key, png, row: formula.row, col: formula.col, cols, rows: formula.rows });
        }
        const out = graphics.update(placements, force);
        // One write, so the terminal gets it whole, between the program's own writes.
        if (out) fs.writeSync(fd, out);
      }
    } catch (error) {
      // The pane is gone, or Rex is restarting.
      if (++failures >= 20) {
        process.stderr.write(`rextex inline ${block}: ${error.message}\n`);
        finish(1);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export { REX };
