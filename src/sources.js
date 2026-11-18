// Where the viewer reads text from.

import fs from 'node:fs';
import path from 'node:path';

import { capture } from './rex.js';

/** The screen of a Rex pane, polled. */
export function blockSource({ block, session, intervalMs = 1000 }) {
  let timer = null;
  let last = null;
  let busy = false;
  return {
    title: `pane ${block.slice(-8)}`,
    stripComments: false,
    accumulate: true,
    start(onText, onError) {
      const poll = () => {
        if (busy) return;
        busy = true;
        capture(session, block, { trim: true }).then(
          (text) => {
            busy = false;
            if (text === last) return;
            last = text;
            onText(text);
          },
          (error) => {
            busy = false;
            onError(`rex capture failed: ${error.message}`);
          },
        );
      };
      poll();
      timer = setInterval(poll, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

/** A .tex, .md or other text file, reread when it changes. */
export function fileSource({ file }) {
  const full = path.resolve(file);
  let timer = null;
  let last = null;
  return {
    title: path.basename(full),
    stripComments: /\.(tex|sty|cls|ltx)$/i.test(full),
    accumulate: false,
    start(onText, onError) {
      const read = () => {
        let stamp;
        try {
          const stat = fs.statSync(full);
          stamp = `${stat.mtimeMs}:${stat.size}`;
          if (stamp === last) return;
          onText(fs.readFileSync(full, 'utf8'));
          last = stamp;
        } catch (error) {
          last = null;
          onError(`cannot read ${full}: ${error.code || error.message}`);
        }
      };
      read();
      timer = setInterval(read, 300);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
