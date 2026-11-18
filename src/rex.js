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

export async function blockCall(session, block, method) {
  return JSON.parse(await rex(['block', 'call', ...target(session, block), method]));
}
