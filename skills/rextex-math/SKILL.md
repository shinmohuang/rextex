---
name: rextex-math
description: Write math so that rextex can draw it in place in a Rex terminal pane. Use whenever a reply in a Rex terminal contains a formula, an equation, or any LaTeX math.
---

# Writing math for rextex

The user runs you in a Rex pane with rextex. It reads the text on screen, finds
LaTeX math, and draws each formula as an image over its own source. You don't
run anything: write ordinary LaTeX, laid out as described here.

rextex can't move text. A formula gets exactly the screen rows its source
occupies, plus the blank row above and the blank row below a display formula.
A formula that doesn't fit in that space stays as source. So the layout of the
source decides whether the formula is drawn.

## Display math

Put the delimiters on their own lines, with a blank line before and after:

```text
The estimator is

$$
\hat{\theta} = \arg\max_{\theta} \sum_{i=1}^{n} \log p(x_i \mid \theta)
$$

where the sum runs over the sample.
```

That gives the formula five rows, enough for sums, integrals, fractions, and
2-row matrices at full size.

- Use `$$ … $$` for display math. `equation`, `align`, `gather`, and `multline`
  environments (with or without `*`) also work, with `\begin` and `\end` on
  their own lines.
- Start the opening delimiter at the beginning of its line, and put nothing
  after the closing delimiter on its line.
- For a taller formula, such as a 3-row matrix or a long `align`, spread the
  source over more lines: one line per matrix row or per equation. Each source
  line adds a row of space.
- Never write `$$ … $$` on a single line inside a paragraph. It gets one row
  and anything with a fraction or a limit is left as source.

## Inline math

Use `$…$` for short expressions inside a sentence, such as `$e^{i\pi} + 1 = 0$`
or `$x_i$`.

- Inline math gets one row. Keep it to what reads well at one row high:
  symbols, subscripts, superscripts, short relations. Move fractions, sums with
  limits, and matrices to display math.
- Keep each inline formula short. One that wraps onto a second terminal row is
  left as source.
- Don't put a space just inside the dollar signs, and write currency without
  them or as `\$5`.

## Backslashes

Your reply is rendered as Markdown before it reaches the screen, and Markdown
removes a backslash that comes before punctuation. Double those backslashes so
one survives:

| You want on screen | Write |
| --- | --- |
| `\\` (row break in `align` or a matrix) | `\\\\` |
| `\,` `\;` `\!` `\:` (spacing) | `\\,` `\;` `\\!` `\\:` |
| `\{` `\}` (literal braces) | `\\{` `\\}` |
| `\|` (norm bars) | `\\|` |
| `\[` `\]` `\(` `\)` | prefer `$$` and `$`; otherwise `\\[` `\\]` `\\(` `\\)` |

A backslash before a letter, as in `\frac`, `\sum`, or `\theta`, needs no
doubling.

## What not to do

- Don't put math you want drawn inside backticks or a code fence. Use those
  only when the user wants to see or copy the LaTeX source itself.
- Don't leave a line that holds only `=` or `-`; Markdown may read it as a
  heading underline.
- Don't use macros defined elsewhere with `\newcommand`. Each formula is
  typeset on its own.

When the user asks for a different notation or for plain text, follow them.
