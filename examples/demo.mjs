#!/usr/bin/env node
// A scripted demo for screen recordings. Run it in a Rex pane:
//
//   node examples/demo.mjs
//
// It waits for Enter, types an answer that contains formulas, turns in-place
// rendering on, keeps typing with it on, switches it off and on, and shows the
// formula pane. Set DEMO_AUTO=1 to start without waiting.

import { execFileSync } from 'node:child_process';
import readline from 'node:readline';

const block = process.env.REX_BLOCK;
const session = process.env.REX_SESSION;
if (!block || !session) {
  console.error('Run this in a Rex pane.');
  process.exit(1);
}
const rex = process.env.REXTEX_REX || 'rex';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (text) => process.stdout.write(text);
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const run = (command, args) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
  } catch {
    // Keep the demo going; the recording shows what happened.
  }
};
const inline = (state) => run('rextex', ['inline', '--session', session, '--block', block, `--${state}`]);
const waitForEnter = () =>
  new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin });
    input.once('line', () => {
      input.close();
      resolve();
    });
  });

async function type(text, delay = 14) {
  for (const char of text) {
    out(char);
    if (char !== ' ') await sleep(char === '\n' ? delay * 6 : delay);
  }
}
const note = async (text) => {
  out(`\n${dim(`# ${text}`)}\n`);
  await sleep(900);
};

const FIRST = String.raw`
The likelihood of a sample is $L(\theta) = p(x_1, \dots, x_n \mid \theta)$,
and the estimator maximizes its logarithm:

$$
\hat{\theta} = \arg\max_{\theta} \sum_{i=1}^{n} \log p(x_i \mid \theta)
$$
`;
const SECOND = String.raw`
For a Gaussian with known variance $\sigma^2$ this gives the sample mean:

$$
\hat{\mu} = \frac{1}{n} \sum_{i=1}^{n} x_i
$$

and the Gaussian integral that normalizes it is

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$
`;

inline('off');
out('\x1b[2J\x1b[H');
if (!process.env.DEMO_AUTO) {
  out(dim('rextex demo. Start recording, then press Enter.') + '\n');
  await waitForEnter();
  out('\x1b[2J\x1b[H');
}

out('\x1b[1m❯\x1b[0m ');
await type('Explain maximum likelihood estimation.\n', 28);
await sleep(500);
await type(FIRST);
await sleep(1400);

await note('cmd+shift+m: render the formulas in place');
inline('on');
await sleep(3200);

await type(SECOND);
await sleep(3000);

await note('press it again to see the source');
inline('off');
await sleep(2200);
inline('on');
await sleep(2500);

await note('or list the formulas in a second pane');
run(rex, ['do', '-s', session, '-b', block, 'latex_preview']);
await sleep(9000);
run(rex, ['do', '-s', session, '-b', block, 'latex_preview']);
await sleep(1500);

if (!process.env.DEMO_AUTO) {
  out('\n' + dim('Done. Stop recording, then press Enter to close.') + '\n');
  await waitForEnter();
}
inline('off');
