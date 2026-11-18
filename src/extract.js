// Find LaTeX formulas in plain text: a terminal capture, a .tex file, or Markdown.

const ENVS =
  'equation|align|alignat|flalign|gather|multline|eqnarray|displaymath|math|split|aligned|gathered|cases|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix';

// One pass, left to right, so delimiters never overlap. Order matters: longer
// delimiters come first.
const PATTERN = new RegExp(
  [
    // 1: \begin{env} ... \end{env}
    `(\\\\begin\\{(${ENVS})(\\*?)\\}[\\s\\S]{1,4000}?\\\\end\\{\\2\\3\\})`,
    // 4: $$ ... $$
    `\\$\\$([\\s\\S]{1,4000}?)\\$\\$`,
    // 5: \[ ... \]
    `\\\\\\[([\\s\\S]{1,4000}?)\\\\\\]`,
    // 6: \( ... \)
    `\\\\\\(([\\s\\S]{1,1000}?)\\\\\\)`,
    // 7: $ ... $  (may cross one hard line break, never a blank line)
    `(?<![\\\\$\\w])\\$(?![\\s$])((?:[^$\\n]|\\n(?![ \\t]*\\n)){1,400}?)(?<![\\s\\\\])\\$(?![\\w$])`,
  ].join('|'),
  'g',
);

// Environments MathJax only accepts inside math mode.
const INNER_ENVS = new Set([
  'split', 'aligned', 'gathered', 'cases', 'array', 'matrix', 'pmatrix',
  'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'smallmatrix',
]);

// A hard-wrapped formula picks up the pane's indentation and gutter characters
// at each line break. Drop them and join the lines.
function joinLines(source, stripComments) {
  return source
    .split('\n')
    .map((line) => {
      if (stripComments) line = line.replace(/(?<!\\)%.*$/, '');
      return line.replace(/^[\s│┃▏▕⎿]+/, '').replace(/[\s│┃▏▕]+$/, '');
    })
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
}

// `$...$` also appears in shell text and prices. Keep only what reads as math.
export function looksLikeMath(tex) {
  if (/[\\^_={}<>+*/|]/.test(tex)) return true;
  if (/^[A-Za-z](?:[-,][A-Za-z0-9])?$/.test(tex)) return true; // $x$, $n-1$
  if (/^[A-Za-z0-9]{1,3}$/.test(tex) && /[A-Za-z]/.test(tex)) return true;
  if (/^[A-Za-z]{1,3}'*\([^()]{1,20}\)$/.test(tex)) return true; // $f(x)$
  if (/^[-\d\s.,A-Za-z()!']{1,40}$/.test(tex) && /\d/.test(tex) && /[A-Za-z(]/.test(tex) && !/\s[A-Za-z]{3,}/.test(tex)) return true; // $2n$
  return false;
}

/**
 * @param {string} text
 * @param {{ stripComments?: boolean }} [options] set stripComments for .tex sources
 * @returns {{ tex: string, display: boolean, raw: string, index: number }[]}
 */
export function extractFormulas(text, options = {}) {
  const stripComments = Boolean(options.stripComments);
  const found = [];
  const seen = new Set();
  PATTERN.lastIndex = 0;
  let match;
  while ((match = PATTERN.exec(text)) !== null) {
    let tex;
    let display;
    if (match[1] !== undefined) {
      const env = match[2];
      tex = joinLines(match[1], stripComments);
      if (env === 'math') {
        tex = tex.replace(/^\\begin\{math\}/, '').replace(/\\end\{math\}$/, '').trim();
        display = false;
      } else if (env === 'displaymath') {
        tex = tex.replace(/^\\begin\{displaymath\}/, '').replace(/\\end\{displaymath\}$/, '').trim();
        display = true;
      } else {
        display = true;
        if (!INNER_ENVS.has(env)) tex = tex.replace(/\\label\{[^}]*\}/g, '').replace(/\s+/g, ' ');
      }
    } else if (match[4] !== undefined) {
      tex = joinLines(match[4], stripComments);
      display = true;
    } else if (match[5] !== undefined) {
      tex = joinLines(match[5], stripComments);
      display = true;
    } else if (match[6] !== undefined) {
      tex = joinLines(match[6], stripComments);
      display = false;
    } else {
      tex = joinLines(match[7], stripComments);
      display = false;
      if (!looksLikeMath(tex)) {
        // Let the closing `$` open the next candidate.
        PATTERN.lastIndex = match.index + match[0].length - 1;
        continue;
      }
    }
    if (!tex) continue;
    const key = (display ? 'D' : 'I') + tex.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ tex, display, raw: match[0], index: match.index });
  }
  return found;
}
