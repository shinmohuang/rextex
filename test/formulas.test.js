import assert from 'node:assert/strict';
import test from 'node:test';

import { extractFormulas, looksLikeMath } from '../src/extract.js';
import { Graphics } from '../src/inline.js';
import { locateFormulas } from '../src/locate.js';
import { renderFormula, renderTile, typeset } from '../src/render.js';

test('extract finds every delimiter and skips shell text and prices', () => {
  const text = String.raw`Euler $e^{i\pi} + 1 = 0$, costs $5 and $10, run -s "$A" -b "$B".
Let $x$ and $f(x)$ with \(a^2+b^2=c^2\).
$$\int_0^1 x\,dx
  = \frac12$$
\[ y = 1 \]
\begin{align}
  a &= b \label{eq:1}
\end{align}`;
  const found = extractFormulas(text).map((f) => [f.display, f.tex]);
  assert.deepEqual(found, [
    [false, String.raw`e^{i\pi} + 1 = 0`],
    [false, 'x'],
    [false, 'f(x)'],
    [false, 'a^2+b^2=c^2'],
    [true, String.raw`\int_0^1 x\,dx = \frac12`],
    [true, 'y = 1'],
    [true, String.raw`\begin{align} a &= b \end{align}`],
  ]);
});

test('locate reports cells, counts wide characters as two, and grows into blank rows', () => {
  const lines = ['⏺ 公式 $x^2$ 在这里', '', '$$', String.raw`\sum_{i=1}^n i`, '$$', '', 'next $$a$$'];
  const found = locateFormulas(lines);
  const display = found.find((f) => f.display);
  assert.deepEqual([display.tex, display.row, display.rows, display.col], [String.raw`\sum_{i=1}^n i`, 1, 5, 0]);
  const inline = found.find((f) => !f.display);
  assert.deepEqual([inline.tex, inline.row, inline.col, inline.cols], ['x^2', 0, 7, 5]);
});

test('locate leaves an unfinished display formula alone', () => {
  assert.deepEqual(locateFormulas(['$$', 'a = b']), []);
});

test('neighbouring display formulas share the blank rows between them', () => {
  const found = locateFormulas(['', '$$a$$', '', '$$b$$', '']);
  assert.deepEqual(found.map((f) => [f.row, f.rows]), [[0, 3], [3, 2]]);
});

test('render produces a PNG sized in whole cells, and reports TeX errors', () => {
  const ok = renderFormula(String.raw`\frac{a}{b}`, { display: true, emPx: 18, color: '#ffffff', cellW: 8, cellH: 17 });
  assert.equal(ok.png.subarray(1, 4).toString(), 'PNG');
  assert.equal(ok.width, ok.cols * 8 * 2);
  assert.equal(renderFormula(String.raw`\frac{1}{`, { display: true, emPx: 18, color: '#fff', cellW: 8, cellH: 17 }).error, 'Missing close brace');
});

test('a tile is refused when the formula would shrink too far', () => {
  const math = typeset(String.raw`\sum_{i=1}^{n} \frac{a_i}{b_i}`, true);
  const box = { cols: 40, cellW: 8, cellH: 17, density: 2, exPx: 8.5, minScale: 0.6, inline: false, card: true, color: '#ffffff', background: '#000000' };
  assert.equal(renderTile(math, { ...box, rows: 1 }), null);
  assert.ok(renderTile(math, { ...box, rows: 4 }));
});

test('a closing $$ at the top of the screen does not pair with the next opener', () => {
  const lines = [
    String.raw`  \ell(s) \le P(s) \le u(s)`,
    '  $$',
    '',
    String.raw`  设 $\mathcal{C}(s)$ 是所有允许的分布：`,
    '',
    '  $$',
    String.raw`  U(s) = \max_{P} \sum_{s'} P(s, s') U(s')`,
    '  $$',
    '',
    '  and then, with no blank row before it,',
    '  $$',
    String.raw`  L(s) \le U(s)`,
    '  $$',
  ];
  const found = locateFormulas(lines);
  assert.deepEqual(
    found.map((f) => [f.display, f.tex]),
    [
      [true, String.raw`U(s) = \max_{P} \sum_{s'} P(s, s') U(s')`],
      [true, String.raw`L(s) \le U(s)`],
      [false, String.raw`\mathcal{C}(s)`],
    ],
  );
});

test('images follow the screen: moved when text moves, kept when it scrolls into history', () => {
  const graphics = new Graphics();
  const png = Buffer.from('x');
  const at = (key, row) => ({ key, png, row, col: 2, cols: 10, rows: 3 });
  const count = (out, pattern) => (out.match(pattern) || []).length;

  let out = graphics.update([at('a', 5), at('b', 12)], false);
  assert.equal(count(out, /a=t,/g), 2);
  assert.equal(count(out, /a=p,/g), 2);

  // Nothing changed: nothing is written.
  assert.equal(graphics.update([at('a', 5), at('b', 12)], false), '');

  // The program redrew its screen two rows up (alternate screen): both move.
  out = graphics.update([at('a', 3), at('b', 10)], false);
  assert.equal(count(out, /a=p,/g), 2);
  assert.equal(count(out, /a=d,/g), 0);

  // The terminal scrolled four rows (main screen). 'a' left the top and is
  // kept for the scrollback; 'b' was carried along and needs no command.
  out = graphics.update([at('b', 6)], false, 4);
  assert.equal(out, '');

  // 'b' is erased by the program: its placement and image go, 'a' stays.
  out = graphics.update([], false);
  assert.equal(count(out, /a=d,d=i,/g), 1);
  assert.equal(count(out, /a=d,d=I,/g), 1);

  // The same formula again gets a placement number of its own.
  out = graphics.update([at('a', 8)], false);
  assert.match(out, /a=p,i=\d+,p=3,/);
});

test('an accented capital fits one row as inline math', () => {
  const box = { cols: 12, rows: 1, cellW: 8, density: 2, minScale: 0.52, inline: true, card: true, color: '#ffffff', background: '#000000' };
  for (const cellH of [15, 16, 17, 20]) {
    for (const tex of [String.raw`\hat{P}(s)`, String.raw`\tilde{O}(n^2)`, String.raw`\bar{X}_n`]) {
      assert.ok(renderTile(typeset(tex, false), { ...box, cellH, exPx: cellH * 0.5 }), `${tex} at cell height ${cellH}`);
    }
  }
});

test('what counts as inline math', () => {
  for (const tex of ['x', 'n-1', "f'(x)", '[L, U]', '(a, b]', '(0, 1)', 'x, y', '0.1', '95%', 'n!', 'A', 'a.b', String.raw`\hat{P}(s)`, 'L(s) = 1']) {
    assert.ok(looksLikeMath(tex), tex);
  }
  for (const tex of ['5 and ', 'A" -b "', 'HOME and the', 'PATH', 'the price is', '(see below)']) {
    assert.ok(!looksLikeMath(tex), tex);
  }
  const found = extractFormulas('The bound is $[L, U]$, not $5 and $10, and run "$HOME" -b "$PATH" now.').map((f) => f.tex);
  assert.deepEqual(found, ['[L, U]']);
});

test('text that MathJax has no glyphs for is still drawn', () => {
  const options = { display: true, emPx: 20, color: '#000000', cellW: 8, cellH: 17, density: 1 };
  const ink = (tex) => {
    const { png } = renderFormula(tex, options);
    return png.length;
  };
  // The same formula with and without the Chinese: the text adds ink.
  assert.ok(ink(String.raw`x \ne 0 \quad \text{样本太少}`) > ink(String.raw`x \ne 0 \quad \text{\qquad\qquad\quad}`) + 200);
});
