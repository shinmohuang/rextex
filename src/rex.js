// Calls to the rex command.

import { execFile, execFileSync } from 'node:child_process';

// The installer records the full path, because a process Rex starts in the
// background may not have rex on its PATH.
export const REX = process.env.REXTEX_REX || 'rex';

const LIMITS = { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 15000 };

function target(session, block) {
  const args = [];
  if (session) args.push('-s', session);
  args.push('-b', block);
  return args;
}

export function rex(args) {
  return new Promise((resolve, reject) => {
    execFile(REX, args, LIMITS, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim().split('\n')[0]));
      else resolve(stdout);
    });
  });
}

export function rexSync(args) {
  return execFileSync(REX, args, { ...LIMITS, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * The pane's screen and scrollback as text. `trim` drops trailing blank rows;
 * `unwrap` rejoins lines the terminal wrapped, so a formula reads the same at
 * any pane width.
 */
export function capture(session, block, { trim = false, unwrap = false } = {}) {
  return rex(['capture', ...(trim ? ['--trim'] : []), ...(unwrap ? ['--unwrap'] : []), ...target(session, block)]);
}

export async function blockCall(session, block, method, args) {
  const argv = ['block', 'call', ...target(session, block), method];
  if (args) argv.push(JSON.stringify(args));
  return JSON.parse(await rex(argv));
}

/**
 * The pane's current theme colors, read from the server, so they follow a
 * theme change with no query to the terminal. Rex derives palette entries 16
 * and 231 from the theme's background and foreground when its extended
 * palette is on (the default). With it off they are plain black and white,
 * which says nothing about the theme, and the result is null.
 */
export async function paneColors(session, block) {
  const reply = await blockCall(session, block, 'format', { format: 'vt', extra_palette: true, max_bytes: 12000 });
  const entry = (index) => {
    const match = new RegExp(`\\]4;${index};rgb:([0-9a-f]{2})/([0-9a-f]{2})/([0-9a-f]{2})`, 'i').exec(reply.content || '');
    return match ? `#${match[1]}${match[2]}${match[3]}`.toLowerCase() : null;
  };
  const bg = entry(16);
  const fg = entry(231);
  if (!bg || !fg || (bg === '#000000' && fg === '#ffffff')) return null;
  return { fg, bg };
}
