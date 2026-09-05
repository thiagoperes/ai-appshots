import type { CanvasTheme, Size } from '../types';

export interface CaptionMetrics {
  readonly titleHeight: number;
  readonly kickerHeight: number;
  readonly titleSize: number;
}

/** Reserve space for fitting, then lay out the actual shaped paragraphs. */
export function captionLayout(options: {
  readonly output: Size;
  readonly canvas: CanvasTheme;
  readonly captionScale: number;
  readonly captionGapRatio?: number;
}, metrics?: CaptionMetrics) {
  const { output, canvas } = options;
  const bounded = (value: number, name: string, min: number, max: number) => {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name} must be between ${min} and ${max}.`);
    }
    return value;
  };
  const lines = bounded(canvas.titleLines ?? 2, 'titleLines', 1, 4);
  if (!Number.isInteger(lines)) throw new Error('titleLines must be an integer between 1 and 4.');
  const titleSize = Math.max(1, Math.round(Math.min(output.width * options.captionScale, output.height * 0.09)));
  const kickerSize = Math.max(1, Math.round(titleSize * 0.5));
  const edge = Math.min(output.width, output.height);
  const topPadding = Math.round(edge * bounded(canvas.captionTopRatio ?? 0.1, 'captionTopRatio', 0, 0.3));
  const gapEm = bounded(canvas.kickerGapEm ?? 0.35, 'kickerGapEm', 0, 3);
  const kickerHeight = metrics?.kickerHeight ?? Math.round(kickerSize * 2.4);
  const titleBlockHeight = metrics?.titleHeight ?? Math.round(titleSize * 1.2 * lines);
  const kickerGap = kickerHeight && titleBlockHeight ? Math.round((metrics?.titleSize ?? titleSize) * gapEm) : 0;
  const kickerBottom = topPadding + kickerHeight;
  const titleTop = kickerBottom + kickerGap;
  const deviceGap = Math.round(output.height * bounded(
    options.captionGapRatio ?? edge * 0.08 / output.height, 'captionGapRatio', 0, 0.3,
  ));
  const bottomPadding = Math.round(output.height * bounded(
    canvas.bottomMarginRatio ?? edge * 0.1 / output.height, 'bottomMarginRatio', 0, 0.25,
  ));
  return {
    titleSize, kickerSize, topPadding, kickerHeight, kickerBottom, kickerGap,
    titleTop, titleBlockHeight, bottomPadding,
    stageTop: titleTop + titleBlockHeight + (kickerHeight || titleBlockHeight ? deviceGap : 0),
  };
}
