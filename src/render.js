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
  // MathJax draws its own glyphs as paths. Characters its fonts lack, such as
  // Chinese inside \\text{...}, come out as text and need a font to draw them.
  const font = /<text[\s>]/.test(inner) ? textFont() : { loadSystemFonts: false };
  return new Resvg(framed, { fitTo: { mode: 'original' }, font }).render().asPng();
}

// Fonts that cover CJK and other scripts, broadest first. Loading one file
// takes tens of milliseconds; scanning every system font takes over a second,
// so that is the last resort.
const TEXT_FONTS = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/STHeiti Medium.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
  '/usr/share/fonts/truetype/arphic/uming.ttc',
];

let textFontOptions = null;

function textFont() {
  if (textFontOptions) return textFontOptions;
  const fs = require('node:fs');
  const extra = (process.env.REXTEX_FONT || '').split(':').filter(Boolean);
  const found = [...extra, ...TEXT_FONTS].filter((file) => fs.existsSync(file)).slice(0, extra.length + 1);
  textFontOptions = found.length > 0 ? { loadSystemFonts: false, fontFiles: found } : { loadSystemFonts: true };
  return textFontOptions;
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
 * Draw a formula onto a tile that exactly covers a box of terminal cells,
 * scaled down if it has to be to fit. Returns null when it would have to
 * shrink below `minScale` of its natural size.
 *
 * With `card`, the tile is a rounded card a shade apart from the background,
 * as a code block is in an editor, with the formula centered on it. The card
 * fills the whole box and nothing is painted outside it, so the tile never
 * has to match the color the terminal paints its background with.
 *
 * Without it, the tile is filled with `background` and the formula sits at
 * its left edge.
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

  // Space kept clear between the edge of the box and the formula.
  const padX = card ? (inline ? Math.max(3, cellW * 0.5) : cellW * 1.5) : inline ? 2 : 2 * cellW;
  // One row is all an inline formula gets, so it keeps nearly all of it.
  const padY = card ? (inline ? 0.75 : Math.max(4, cellH * 0.3)) : inline ? 0.75 : 3;

  const scale = Math.min(1, (boxW - 2 * padX) / naturalW, (boxH - 2 * padY) / naturalH);
  if (!(scale >= box.minScale)) return null;
  const width = naturalW * scale;
  const height = naturalH * scale;

  let under = '';
  if (card) {
    const inset = 0.5;
    const radius = Math.min(inline ? 4 : 7, boxH / 2);
    const px = (value) => (value * density).toFixed(2);
    under =
      `<rect x="${px(inset)}" y="${px(inset)}" width="${px(boxW - 2 * inset)}" height="${px(boxH - 2 * inset)}" rx="${px(radius)}"` +
      ` fill="${mix(box.background, box.color, 0.1)}" stroke="${mix(box.background, box.color, 0.2)}" stroke-width="${density}"/>`;
  }
  try {
    return paint(math, {
      canvasW: boxW * density,
      canvasH: boxH * density,
      x: (card ? (boxW - width) / 2 : padX) * density,
      y: ((boxH - height) / 2) * density,
      width: width * density,
      height: height * density,
      color: box.color,
      background: card ? null : box.background,
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
