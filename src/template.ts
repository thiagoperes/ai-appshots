import type {
  CanvasTheme,
  Caption,
  CssFrame,
  Size,
  ThemeName,
} from './types';

export interface CompositionOptions {
  readonly output: Size;
  readonly caption: Caption;
  readonly theme: ThemeName;
  readonly canvas: CanvasTheme;
  readonly captionScale: number;
  readonly captionGapRatio: number;
  readonly allowBleed: boolean;
  readonly allowShadow: boolean;
  /** Data URL of either a pre-framed device or, with `cssFrame`, a raw capture. */
  readonly deviceDataUrl: string;
  readonly cssFrame?: CssFrame;
  /** Pixel width of the raw capture, used to scale the CSS bezel. */
  readonly captureWidth: number;
  /** 1-based position in the set, rendered as the `[ 01 ]` eyebrow index. */
  readonly index: number;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDevice(options: CompositionOptions) {
  const { cssFrame, deviceDataUrl, captureWidth } = options;
  const image = `<img class="device" src="${deviceDataUrl}" alt="" />`;

  if (!cssFrame) {
    return image;
  }

  const bezel = Math.round(captureWidth * cssFrame.bezelRatio);
  const radius = Math.round(captureWidth * cssFrame.radiusRatio);

  return `
    <div class="bezel" style="
      padding: ${bezel}px;
      border-radius: ${radius + bezel}px;
      background: ${cssFrame.color};
    ">
      <img class="device screen" src="${deviceDataUrl}" alt=""
        style="border-radius: ${radius}px;" />
    </div>
  `;
}

export function buildCompositionHtml(options: CompositionOptions) {
  const { output, caption, canvas, captionScale, captionGapRatio } = options;
  const palette = canvas[options.theme];

  const titleSize = Math.round(output.width * captionScale);
  const kickerSize = Math.max(14, Math.round(titleSize * 0.28));
  const sidePadding = Math.round(output.width * 0.07);
  const topPadding = Math.round(output.height * 0.05);
  const captionGap = Math.round(output.height * captionGapRatio);
  // Apple requires product bezels to be shown uncropped, so App Store targets
  // keep a margin below the device. Play targets may bleed, and overshooting
  // the stage is what produces that crop.
  const stagePadding = options.allowBleed
    ? 0
    : Math.round(output.height * 0.042);
  const deviceHeight = options.allowBleed ? 1.16 : 1;
  // A drop shadow counts as modifying an Apple product image. The halo below is
  // a background element behind the device, which is allowed and does the same
  // job of lifting it off the backdrop.
  const shadow = options.allowShadow
    ? `filter: drop-shadow(0 ${Math.round(output.height * 0.012)}px ` +
      `${Math.round(output.height * 0.028)}px rgba(0, 0, 0, 0.55));`
    : '';
  const gridStep = Math.round(output.width / 12);
  const index = canvas.showIndex
    ? `[ ${String(options.index).padStart(2, '0')} ]`
    : '';
  const label = [index, caption.kicker ? escapeHtml(caption.kicker) : '']
    .filter(Boolean)
    .join('&nbsp;&nbsp;');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }

      html, body {
        width: ${output.width}px;
        height: ${output.height}px;
        overflow: hidden;
      }

      body {
        display: flex;
        flex-direction: column;
        background: ${palette.base};
        font-family: ${canvas.sansFont};
        -webkit-font-smoothing: antialiased;
        position: relative;
      }

      .sweep, .grid, .halo, .vignette {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .sweep { background: ${palette.sweep}; }

      /* Fine technical grid, fading out before it reaches the device. */
      .grid {
        background-image:
          linear-gradient(to right, ${palette.grid} 1px, transparent 1px),
          linear-gradient(to bottom, ${palette.grid} 1px, transparent 1px);
        background-size: ${gridStep}px ${gridStep}px;
        mask-image: linear-gradient(to bottom, #000 0%, transparent 62%);
        -webkit-mask-image: linear-gradient(to bottom, #000 0%, transparent 62%);
      }

      /* Accent bloom, anchored to the stage so it sits behind the top of the
         device and separates the bezel from the backdrop without putting a
         shadow on the product. */
      .halo {
        top: ${-Math.round(output.height * 0.03)}px;
        background: radial-gradient(
          ellipse ${Math.round(output.width * 0.6)}px
                  ${Math.round(output.height * 0.2)}px at 50% 14%,
          ${palette.halo} 0%,
          transparent 72%
        );
        opacity: ${options.theme === 'dark' ? 0.42 : 0.2};
      }

      /* Deepens the corners so the bloom reads as deliberate lighting. */
      .vignette {
        background: radial-gradient(
          ellipse ${Math.round(output.width * 0.95)}px
                  ${Math.round(output.height * 0.62)}px at 50% 42%,
          transparent 45%,
          rgba(0, 0, 0, ${options.theme === 'dark' ? 0.55 : 0.06}) 100%
        );
      }

      /* Sized by its content, so the gap to the device stays constant however
         many lines the title wraps to. */
      .caption {
        padding: ${topPadding}px ${sidePadding}px ${captionGap}px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        position: relative;
        flex: none;
      }

      .eyebrow {
        display: flex;
        align-items: center;
        gap: ${Math.round(kickerSize * 0.9)}px;
        margin-bottom: ${Math.round(kickerSize * 1.25)}px;
      }

      .eyebrow .rule {
        width: ${Math.round(kickerSize * 2.4)}px;
        height: 1px;
        background: ${palette.rule};
      }

      .kicker {
        font-family: ${canvas.monoFont};
        font-size: ${kickerSize}px;
        font-weight: 500;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: ${palette.kicker};
        white-space: nowrap;
      }

      /* Always reserves two lines so the device sits at the same height on
         every screen in the set. Without it a one-line caption lets the device
         ride up and the frames jump as the user swipes. A three-line title
         still expands. */
      .title {
        font-size: ${titleSize}px;
        font-weight: 700;
        line-height: 1.04;
        letter-spacing: -0.032em;
        color: ${palette.title};
        text-wrap: balance;
        max-width: ${Math.round(output.width * 0.94)}px;
        min-height: ${Math.round(titleSize * 1.04 * 2)}px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .stage {
        flex: 1;
        min-height: 0;
        padding-bottom: ${stagePadding}px;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        position: relative;
      }

      .device, .bezel {
        max-width: ${Math.round(output.width * 0.88)}px;
        height: ${Math.round(deviceHeight * 100)}%;
        object-fit: contain;
        position: relative;
        ${shadow}
      }

      .bezel { display: flex; }
      .screen { height: 100%; width: auto; filter: none; }
    </style>
  </head>
  <body>
    <div class="sweep"></div>
    <div class="grid"></div>
    <div class="vignette"></div>
    <div class="caption">
      ${
        label
          ? `<div class="eyebrow">
        <span class="rule"></span>
        <span class="kicker">${label}</span>
        <span class="rule"></span>
      </div>`
          : ''
      }
      <h1 class="title">${escapeHtml(caption.title)}</h1>
    </div>
    <div class="stage">
      <div class="halo"></div>
      ${renderDevice(options)}
    </div>
  </body>
</html>`;
}
