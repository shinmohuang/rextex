#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { extractFormulas } from '../src/extract.js';
import { inlineRunning, runInline, startInline, stopInline, themeFile } from '../src/inline.js';
import { renderFormula } from '../src/render.js';
import { capture } from '../src/rex.js';
import { blockSource, fileSource } from '../src/sources.js';
import { kittyImage, queryTerminal } from '../src/term.js';
import { Viewer } from '../src/viewer.js';

const HELP = `rextex: see LaTeX formulas as real math in a Rex pane.

Usage:
  rextex inline --block BLOCK [--on|--off]        draw formulas over their source, in the pane itself
  rextex view --block BLOCK [--session SESSION]   follow the formulas shown in a pane, in this one
  rextex view FILE                                follow the formulas in a .tex or .md file
  rextex show 'LATEX'...                          draw formulas right here, in the scrollback
  rextex list [--block BLOCK | FILE]              print the formulas found, as text
  rextex theme                                    measure this terminal's colors for inline mode
  rextex theme --bg '#RRGGBB' [--fg '#RRGGBB']    set those colors by hand

Options:
  -b, --block BLOCK      the Rex pane to read
  -s, --session SESSION  the session that pane is in (default: $REX_SESSION)
  -z, --zoom NUMBER      formula size relative to the text (default 1.3, inline 1)
      --on, --off        with inline: turn it on or off; with neither, switch
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
      inline: { type: 'boolean' },
      on: { type: 'boolean' },
      off: { type: 'boolean' },
      foreground: { type: 'boolean' },
      fg: { type: 'string' },
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
      await runInline({ session, block, zoom, density, script });
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
      const args = ['--block', block, '--zoom', String(zoom), '--density', String(density)];
      if (session) args.push('--session', session);
      startInline(script, args);
      process.stdout.write('on\n');
    }
  }
} else if (command === 'theme' && (values.fg || values.bg)) {
  // Set by hand, for a terminal that draws its background in a different
  // shade from the one it reports.
  const hex = /^#[0-9a-f]{6}$/i;
  for (const name of ['fg', 'bg']) {
    if (values[name] && !hex.test(values[name])) fail(`--${name} takes a color such as #1d1d21, not "${values[name]}"`);
  }
  let theme = {};
  try {
    theme = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
  } catch {
    // Nothing measured yet.
  }
  theme = { fg: values.fg || theme.fg || '#d0d0d0', bg: values.bg || theme.bg || '#101010' };
  fs.mkdirSync(path.dirname(themeFile), { recursive: true });
  fs.writeFileSync(themeFile, JSON.stringify(theme) + '\n');
  process.stdout.write(`foreground ${theme.fg}, background ${theme.bg}\n`);
} else if (command === 'theme') {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail('theme needs a terminal; run it in a Rex pane');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  // Rex answers color queries only once an app is showing the pane, so allow
  // it a moment.
  let term = {};
  for (let attempt = 0; attempt < 8 && !(term.fg && term.bg); attempt++) {
    term = { ...term, ...(await queryTerminal(process.stdin, process.stdout, 400)) };
    if (!(term.fg && term.bg)) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.stdin.setRawMode(false);
  process.stdin.pause();
  if (!term.fg || !term.bg) fail('this terminal did not report its colors');
  fs.mkdirSync(path.dirname(themeFile), { recursive: true });
  fs.writeFileSync(themeFile, JSON.stringify({ fg: term.fg, bg: term.bg }) + '\n');
  process.stdout.write(`foreground ${term.fg}, background ${term.bg}\n`);
} else {
  fail(`unknown command "${command}"\nRun "rextex --help" for usage.`);
}
