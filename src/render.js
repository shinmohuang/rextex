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
function paint(math, { canvasW, canvasH, x, y, width, height, color, background }) {
  const { Resvg } = getEngine();
  const inner = math.svg
    .replace(/\swidth="[\d.]+ex"/, ` x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}"`)
    .replace(/\sheight="[\d.]+ex"/, ` height="${height.toFixed(2)}"`)
    .replace(/\sstyle="[^"]*"/, '')
    .replace(/currentColor/g, color);
  const fill = background ? `<rect width="${canvasW}" height="${canvasH}" fill="${background}"/>` : '';
  const framed = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">${fill}${inner}</svg>`;
  return new Resvg(framed, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().asPng();
}

/**
 * Draw a formula onto an opaque tile that exactly covers a box of terminal
 * cells, scaled down if it has to be to fit. Returns null when it would have
 * to shrink below `minScale` of its natural size.
 *
 * @param {{ svg: string, widthEx: number, heightEx: number }} math
 * @param {{ cols: number, rows: number, cellW: number, cellH: number, density: number, exPx: number,
 *   minScale: number, align: 'left' | 'center', padLeft?: number, color: string, background: string }} box
 */
export function renderTile(math, box) {
  const { cols, rows, cellW, cellH, density } = box;
  const boxW = cols * cellW;
  const boxH = rows * cellH;
  const padX = box.padLeft ?? 2;
  const padY = rows === 1 ? 1 : 3;
  const scale = Math.min(1, (boxW - padX - 2) / (math.widthEx * box.exPx), (boxH - 2 * padY) / (math.heightEx * box.exPx));
  if (!(scale >= box.minScale)) return null;
  const width = math.widthEx * box.exPx * scale;
  const height = math.heightEx * box.exPx * scale;
  const x = box.align === 'center' ? (boxW - width) / 2 : padX;
  try {
    return paint(math, {
      canvasW: boxW * density,
      canvasH: boxH * density,
      x: x * density,
      y: ((boxH - height) / 2) * density,
      width: width * density,
      height: height * density,
      color: box.color,
      background: box.background,
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
