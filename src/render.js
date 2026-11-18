// LaTeX -> SVG (MathJax) -> PNG (resvg). MathJax draws glyphs as paths, so no
// TeX installation and no fonts are needed.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let engine = null;

function getEngine() {
  if (engine) return engine;
  const { mathjax } = require('mathjax-full/js/mathjax.js');
  const { TeX } = require('mathjax-full/js/input/tex.js');
  const { SVG } = require('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
  const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');
  const { Resvg } = require('@resvg/resvg-js');

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({
    // bussproofs needs a layout pass the lite adaptor cannot do.
    packages: AllPackages.filter((name) => name !== 'bussproofs'),
    formatError: (_jax, error) => {
      throw error;
    },
  });
  const svg = new SVG({ fontCache: 'none' });
  const html = mathjax.document('', { InputJax: tex, OutputJax: svg });
  engine = { adaptor, html, Resvg };
  return engine;
}

export const EX_PER_EM = 0.442; // x-height of the MathJax TeX font

const typesetCache = new Map();

/**
 * Typeset a formula to SVG. The size is in ex units; callers pick the scale.
 * @returns {{ svg: string, widthEx: number, heightEx: number } | { error: string }}
 */
export function typeset(tex, display) {
  const cacheKey = (display ? 'D' : 'I') + tex;
  const cached = typesetCache.get(cacheKey);
  if (cached) return cached;
  const { adaptor, html } = getEngine();
  let result;
  try {
    const node = html.convert(tex, { display, em: 16, ex: 16 * EX_PER_EM, containerWidth: 1280 });
    const svg = adaptor.innerHTML(node);
    const widthEx = /\swidth="([\d.]+)ex"/.exec(svg);
    const heightEx = /\sheight="([\d.]+)ex"/.exec(svg);
    if (svg.includes('data-mjx-error')) {
      const message = /data-mjx-error="([^"]*)"/.exec(svg);
      result = { error: message ? message[1] : 'could not parse' };
    } else if (!widthEx || !heightEx || !(Number(widthEx[1]) > 0) || !(Number(heightEx[1]) > 0)) {
      result = { error: 'empty formula' };
    } else {
      result = { svg, widthEx: Number(widthEx[1]), heightEx: Number(heightEx[1]) };
    }
  } catch (error) {
    result = { error: String(error && error.message ? error.message : error) };
  }
  if (typesetCache.size > 5000) typesetCache.clear();
  typesetCache.set(cacheKey, result);
  return result;
}

// Place a typeset formula on a canvas of the given pixel size.
function paint(math, { canvasW, canvasH, x, y, width, height, color, background, under = '' }) {
  const { Resvg } = getEngine();
  const inner = math.svg
    .replace(/\swidth="[\d.]+ex"/, ` x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}"`)
    .replace(/\sheight="[\d.]+ex"/, ` height="${height.toFixed(2)}"`)
    .replace(/\sstyle="[^"]*"/, '')
    .replace(/currentColor/g, color);
  const fill = background ? `<rect width="${canvasW}" height="${canvasH}" fill="${background}"/>` : '';
  const framed = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">${fill}${under}${inner}</svg>`;
  return new Resvg(framed, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().asPng();
}

// A color part of the way from one to another.
function mix(from, to, amount) {
  const channel = (color, i) => parseInt(color.slice(1 + 2 * i, 3 + 2 * i), 16);
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * amount).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Draw a formula onto an opaque tile that exactly covers a box of terminal
 * cells, scaled down if it has to be to fit. Returns null when it would have
 * to shrink below `minScale` of its natural size.
 *
 * With `card`, the formula sits on a rounded card a shade apart from the
 * background, as a code block does in an editor. The card is sized to the
 * formula, not to the box: the box is as wide as the LaTeX source it hides,
 * which says nothing about how wide the formula is.
 *
 * @param {{ svg: string, widthEx: number, heightEx: number }} math
 * @param {{ cols: number, rows: number, cellW: number, cellH: number, density: number, exPx: number,
 *   minScale: number, inline: boolean, card: boolean, color: string, background: string }} box
 */
export function renderTile(math, box) {
  const { cols, rows, cellW, cellH, density, inline, card } = box;
  const boxW = cols * cellW;
  const boxH = rows * cellH;
  const naturalW = math.widthEx * box.exPx;
  const naturalH = math.heightEx * box.exPx;

  // Space between the box and the card, and between the card and the formula.
  const outerX = inline ? (card ? 1 : 2) : card ? cellW : 2 * cellW;
  const outerY = inline ? (card ? 0.5 : 1) : card ? 2 : 3;
  const innerX = card ? (inline ? Math.max(3, cellW * 0.5) : cellW * 1.25) : 0;
  const innerY = card ? (inline ? 1 : Math.max(4, cellH * 0.3)) : 0;

  const scale = Math.min(1, (boxW - 2 * outerX - 2 * innerX) / naturalW, (boxH - 2 * outerY - 2 * innerY) / naturalH);
  if (!(scale >= box.minScale)) return null;
  const width = naturalW * scale;
  const height = naturalH * scale;

  let under = '';
  if (card) {
    const cardW = width + 2 * innerX;
    // An inline card fills its row, so cards on one line share a height.
    const cardH = inline ? boxH - 2 * outerY : height + 2 * innerY;
    const cardY = (boxH - cardH) / 2;
    const radius = Math.min(inline ? 4 : 7, cardH / 2);
    const px = (value) => (value * density).toFixed(2);
    under =
      `<rect x="${px(outerX)}" y="${px(cardY)}" width="${px(cardW)}" height="${px(cardH)}" rx="${px(radius)}"` +
      ` fill="${mix(box.background, box.color, 0.07)}" stroke="${mix(box.background, box.color, 0.16)}" stroke-width="${density}"/>`;
  }
  try {
    return paint(math, {
      canvasW: boxW * density,
      canvasH: boxH * density,
      x: (outerX + innerX) * density,
      y: ((boxH - height) / 2) * density,
      width: width * density,
      height: height * density,
      color: box.color,
      background: box.background,
      under,
    });
  } catch {
    return null;
  }
}

/**
 * Render one formula onto a canvas that covers a whole number of terminal
 * cells, so it can be placed by cells without distortion. The canvas holds
 * `density` image pixels per terminal pixel, which keeps it sharp on displays
 * where a terminal pixel is more than one device pixel.
 *
 * @param {string} tex
 * @param {{ display: boolean, emPx: number, color: string, cellW: number, cellH: number,
 *   density?: number, maxCols?: number }} options
 * @returns {{ png: Buffer, cols: number, rows: number, rowPx: number, width: number }
 *   | { error: string }}
 */
export function renderFormula(tex, options) {
  const math = typeset(tex, options.display);
  if (math.error) return math;

  const { cellW, cellH } = options;
  const density = options.density ?? 2;
  const exPx = options.emPx * EX_PER_EM;
  let width = Math.max(1, math.widthEx * exPx);
  let height = Math.max(1, math.heightEx * exPx);
  const maxWidth = options.maxCols ? options.maxCols * cellW : Infinity;
  if (width > maxWidth) {
    height = Math.max(1, (height * maxWidth) / width);
    width = maxWidth;
  }
  const cols = Math.max(1, Math.ceil(width / cellW - 1e-6));
  const rows = Math.max(1, Math.ceil(height / cellH - 1e-6));
  const canvasW = cols * cellW * density;
  const canvasH = rows * cellH * density;
  try {
    const png = paint(math, {
      canvasW,
      canvasH,
      x: 0,
      y: (canvasH - height * density) / 2,
      width: width * density,
      height: height * density,
      color: options.color,
    });
    return { png, cols, rows, rowPx: cellH * density, width: canvasW };
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) };
  }
}
