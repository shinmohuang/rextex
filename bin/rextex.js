#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { extractFormulas } from '../src/extract.js';
import {
  currentTheme,
  inlineRunning,
  restoreInline,
  runInline,
  schemeOf,
  startInline,
  stopInline,
  themeFile,
} from '../src/inline.js';
import { renderFormula } from '../src/render.js';
import { blockCall, capture, paneColors } from '../src/rex.js';
import { blockSource, fileSource } from '../src/sources.js';
import { kittyImage, queryTerminal } from '../src/term.js';
import { Viewer } from '../src/viewer.js';

const HELP = `rextex: see LaTeX formulas as real math in a Rex pane.

Usage:
  rextex inline --block BLOCK [--on|--off]        draw formulas over their source, in the pane itself
  rextex restore                                  turn in-place rendering back on where it was, as after a reboot
  rextex view --block BLOCK [--session SESSION]   follow the formulas shown in a pane, in this one
  rextex view FILE                                follow the formulas in a .tex or .md file
  rextex show 'LATEX'...                          draw formulas right here, in the scrollback
  rextex list [--block BLOCK | FILE]              print the formulas found, as text
  rextex theme [--bg '#RRGGBB' | --bg theme]      show the colors used in place, or set the background shade

Options:
  -b, --block BLOCK      the Rex pane to read
  -s, --session SESSION  the session that pane is in (default: $REX_SESSION)
  -z, --zoom NUMBER      formula size relative to the text (default 1.3, inline 1)
      --on, --off        with inline: turn it on or off; with neither, switch
      --style STYLE      with inline: "card" sets each formula on a card (default), "plain" on the bare background
      --density N        image pixels per terminal pixel, 1 to 4 (default 2)
      --inline           with show: typeset in inline style, not display style
  -h, --help             show this help

Formulas are found between $…$, $$…$$, \\(…\\), \\[…\\] and \\begin{equation}-style
environments. Drawing needs a terminal with the kitty graphics protocol, such as Rex.
`;

function fail(message) {
  process.stderr.write(`rextex: ${message}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      block: { type: 'string', short: 'b' },
      session: { type: 'string', short: 's' },
      zoom: { type: 'string', short: 'z' },
      density: { type: 'string' },
      style: { type: 'string' },
      inline: { type: 'boolean' },
      on: { type: 'boolean' },
      off: { type: 'boolean' },
      foreground: { type: 'boolean' },
      bg: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (error) {
  fail(`${error.message}\nRun "rextex --help" for usage.`);
}

const { values, positionals } = parsed;
const command = positionals[0];
const rest = positionals.slice(1);

if (values.help || !command) {
  process.stdout.write(HELP);
  process.exit(command || values.help ? 0 : 1);
}

let zoom = command === 'inline' ? 1 : 1.3;
if (values.zoom !== undefined) {
  zoom = Number(values.zoom);
  if (!Number.isFinite(zoom) || zoom <= 0) fail(`--zoom takes a positive number, not "${values.zoom}"`);
}
let density = 2;
if (values.density !== undefined) {
  density = Number(values.density);
  if (!Number.isInteger(density) || density < 1 || density > 4) fail(`--density takes a whole number from 1 to 4, not "${values.density}"`);
}
const style = values.style ?? 'card';
if (style !== 'card' && style !== 'plain') fail(`--style takes "card" or "plain", not "${values.style}"`);
const session = values.session ?? process.env.REX_SESSION;

function pickSource() {
  if (values.block && rest.length > 0) fail('give a pane with --block or a file, not both');
  if (values.block) {
    if (values.block === process.env.REX_BLOCK && command === 'view') {
      fail('that is the pane rextex would run in; open it in another pane, for example with "rex split -- rextex view --block ..."');
    }
    return blockSource({ block: values.block, session });
  }
  if (rest.length === 1) {
    if (!fs.existsSync(rest[0])) fail(`no such file: ${rest[0]}`);
    return fileSource({ file: rest[0] });
  }
  fail(`${command} needs a pane (--block BLOCK) or one file`);
}

if (command === 'view') {
  const source = pickSource();
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail('view needs a terminal');
  new Viewer({ source, zoom, density }).start();
} else if (command === 'list') {
  let text;
  let stripComments = false;
  if (values.block) {
    try {
      text = await capture(session, values.block, { trim: true, unwrap: true });
    } catch (error) {
      fail(`rex capture failed: ${error.message}`);
    }
  } else if (rest.length === 1) {
    try {
      text = fs.readFileSync(rest[0], 'utf8');
    } catch (error) {
      fail(`cannot read ${rest[0]}: ${error.code || error.message}`);
    }
    stripComments = /\.(tex|sty|cls|ltx)$/i.test(rest[0]);
  } else {
    fail('list needs a pane (--block BLOCK) or one file');
  }
  for (const formula of extractFormulas(text, { stripComments })) {
    process.stdout.write(`${formula.display ? 'display' : 'inline '}  ${formula.tex}\n`);
  }
} else if (command === 'show') {
  if (rest.length === 0) fail("show needs a formula, for example: rextex show 'e^{i\\pi}+1=0'");
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail('show needs a terminal');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  const term = { cellW: 8, cellH: 17, fg: '#d0d0d0', ...(await queryTerminal(process.stdin, process.stdout)) };
  process.stdin.setRawMode(false);
  process.stdin.pause();
  let failed = false;
  for (const tex of rest) {
    const result = renderFormula(tex, {
      display: !values.inline,
      emPx: term.cellH * 0.8 * zoom,
      color: term.fg,
      cellW: term.cellW,
      cellH: term.cellH,
      maxCols: Math.max(1, (process.stdout.columns || 80) - 3),
      density,
    });
    if (result.error) {
      process.stderr.write(`rextex: ${result.error}: ${tex}\n`);
      failed = true;
      continue;
    }
    process.stdout.write(`  ${kittyImage(result.png, { cols: result.cols, rows: result.rows })}${'\n'.repeat(result.rows)}`);
  }
  process.exit(failed ? 1 : 0);
} else if (command === 'inline') {
  const block = values.block ?? process.env.REX_BLOCK;
  if (!block) fail('inline needs a pane: --block BLOCK');
  if (values.on && values.off) fail('give --on or --off, not both');
  const script = fileURLToPath(import.meta.url);
  if (values.foreground) {
    try {
      await runInline({ session, block, zoom, density, style });
    } catch (error) {
      fail(error.message);
    }
  } else {
    const running = inlineRunning(block);
    if (values.off || (running && !values.on)) {
      stopInline(block);
      process.stdout.write('off\n');
    } else if (running) {
      process.stdout.write('on\n');
    } else {
      // The renderer must run on the machine that owns the pane. Say so with
      // a status of its own, so a caller can start it there.
      try {
        await blockCall(session, block, 'size');
      } catch (error) {
        process.stderr.write(`rextex: that pane is not on this machine (${error.message})\n`);
        process.exit(3);
      }
      startInline(script, { session, block, zoom, density, style });
      process.stdout.write('on\n');
    }
  }
} else if (command === 'restore') {
  // Rex runs this when its server starts (see rex/rextex.lua).
  await restoreInline(fileURLToPath(import.meta.url));
} else if (command === 'theme') {
  // Show the colors rextex draws with in this pane, or record the background
  // shade Rex really paints for this kind of theme (dark or light).
  const pane = values.block ?? process.env.REX_BLOCK;
  if (!pane) fail('theme needs a pane: run it in a Rex pane, or pass --block BLOCK');
  let live;
  try {
    live = await paneColors(session, pane);
  } catch (error) {
    fail(error.message);
  }
  if (!live) fail("could not read that pane's theme: no app has shown the pane yet, or Rex's extended theme palette is off");
  const scheme = schemeOf(live.bg);
  if (values.bg) {
    if (values.bg !== 'theme' && !/^#[0-9a-f]{6}$/i.test(values.bg)) {
      fail(`--bg takes a color such as #1e1e20, or "theme" to go back to the theme's own, not "${values.bg}"`);
    }
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
    } catch {
      // Nothing saved yet.
    }
    const next = {};
    for (const name of ['dark', 'light']) if (typeof saved[name] === 'string') next[name] = saved[name];
    if (values.bg === 'theme') delete next[scheme];
    else next[scheme] = values.bg.toLowerCase();
    fs.mkdirSync(path.dirname(themeFile), { recursive: true });
    fs.writeFileSync(themeFile, JSON.stringify(next) + '\n');
  }
  const theme = await currentTheme(session, pane);
  process.stdout.write(`${scheme} theme: foreground ${live.fg}, background ${live.bg}\n`);
  process.stdout.write(`drawing with: foreground ${theme.fg}, background ${theme.bg}${theme.bg === live.bg ? '' : ` (set for ${scheme} themes)`}\n`);
} else {
  fail(`unknown command "${command}"\nRun "rextex --help" for usage.`);
}
