import assert from 'node:assert/strict';
import test from 'node:test';

import { extractFormulas } from '../src/extract.js';
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
