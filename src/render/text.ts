import { measureLine } from './typeset';
import type { TextStyle } from './typeset';

/**
 * Line breaking for captions. SVG draws text but never wraps it, so breaks are
 * decided here and emitted as separate lines. Widths come from Pango, the same
 * shaper that draws the result, so a line that measures as fitting does fit.
 */

async function greedy(words: readonly string[], style: TextStyle, max: number) {
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (current && (await measureLine(candidate, style)) > max) {
      lines.push(current);
      current = word;
      continue;
    }

    current = candidate;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

/**
 * Picks the two-line split with the most even line widths.
 *
 * Greedy wrapping fills the first line and leaves a stub on the second, which
 * looks accidental at display sizes. This is the job CSS `text-wrap: balance`
 * does, and marketing copy is short enough to solve exactly rather than
 * approximate.
 */
async function balance(words: readonly string[], style: TextStyle, max: number) {
  let best: { lines: [string, string]; gap: number } | undefined;

  for (let split = 1; split < words.length; split += 1) {
    const lines: [string, string] = [
      words.slice(0, split).join(' '),
      words.slice(split).join(' '),
    ];
    const [first, second] = await Promise.all([
      measureLine(lines[0], style),
      measureLine(lines[1], style),
    ]);

    if (first > max || second > max) {
      continue;
    }

    const gap = Math.abs(first - second);

    if (!best || gap < best.gap) {
      best = { lines, gap };
    }
  }

  return best?.lines;
}

/**
 * Breaks a caption into lines. An explicit newline is always honoured, so copy
 * that has to break a particular way can say so.
 */
export async function wrap(
  text: string,
  style: TextStyle,
  max: number,
): Promise<string[]> {
  if (text.includes('\n')) {
    return text.split('\n').map((line) => line.trim());
  }

  const words = text.split(/\s+/).filter(Boolean);
  const lines = await greedy(words, style, max);

  if (lines.length !== 2) {
    return lines;
  }

  return (await balance(words, style, max)) ?? lines;
}
