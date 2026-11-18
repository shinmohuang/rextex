// Terminal plumbing: the kitty graphics protocol and the queries for cell size
// and colors.

const ESC = '\x1b';

/**
 * Transmit a PNG and show it at the cursor, scaled to `cols` x `rows` cells.
 * `crop` picks a band of the image's pixel rows to show. The cursor does not
 * move.
 */
export function kittyImage(png, { id, cols, rows, crop } = {}) {
  const data = png.toString('base64');
  const keys = ['a=T', 'f=100', 'q=2', 'C=1'];
  if (id) keys.push(`i=${id}`);
  if (cols) keys.push(`c=${cols}`);
  if (rows) keys.push(`r=${rows}`);
  if (crop) keys.push(`x=0`, `y=${crop.y}`, `w=${crop.w}`, `h=${crop.h}`);
  let out = '';
  for (let offset = 0; offset < data.length; offset += 4096) {
    const chunk = data.slice(offset, offset + 4096);
    const more = offset + 4096 < data.length ? 1 : 0;
    const control = offset === 0 ? `${keys.join(',')},m=${more}` : `m=${more}`;
    out += `${ESC}_G${control};${chunk}${ESC}\\`;
  }
  return out;
}

export const kittyClear = `${ESC}_Ga=d,d=A,q=2${ESC}\\`;

function parseOscColor(body) {
  const match = /rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(body);
  if (!match) return null;
  const channel = (hex) => Math.round((parseInt(hex, 16) / (16 ** hex.length - 1)) * 255);
  return '#' + [match[1], match[2], match[3]].map((hex) => channel(hex).toString(16).padStart(2, '0')).join('');
}

/**
 * Pull replies to our queries out of an input chunk. Returns what was learned
 * and the remaining bytes, which are key presses.
 */
export function parseReplies(input) {
  const info = {};
  let rest = input;
  rest = rest.replace(/\x1b\[6;(\d+);(\d+)t/g, (_all, h, w) => {
    info.cellH = Number(h);
    info.cellW = Number(w);
    return '';
  });
  rest = rest.replace(/\x1b\]1([01]);([^\x07\x1b]*)(?:\x07|\x1b\\)/g, (_all, which, body) => {
    const color = parseOscColor(body);
    if (color) info[which === '0' ? 'fg' : 'bg'] = color;
    return '';
  });
  rest = rest.replace(/\x1b\[\?[\d;]*c/g, () => {
    info.done = true;
    return '';
  });
  rest = rest.replace(/\x1b_G[^\x1b]*\x1b\\/g, '');
  return { info, rest };
}

// Cell size, foreground, background, then device attributes as an end marker
// that every terminal answers.
export const QUERY = `${ESC}[16t${ESC}]10;?\x07${ESC}]11;?\x07${ESC}[c`;

/** Ask the terminal about itself. Resolves with whatever arrived in time. */
export function queryTerminal(input, output, timeoutMs = 400) {
  return new Promise((resolve) => {
    const collected = {};
    let buffer = '';
    const finish = () => {
      clearTimeout(timer);
      input.off('data', onData);
      resolve(collected);
    };
    const onData = (chunk) => {
      buffer += chunk.toString('latin1');
      const { info, rest } = parseReplies(buffer);
      buffer = rest;
      Object.assign(collected, info);
      if (info.done) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    input.on('data', onData);
    output.write(QUERY);
  });
}
