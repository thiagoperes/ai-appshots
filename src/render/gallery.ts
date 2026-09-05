import sharp from 'sharp';

/** A review-only gallery with realistic separation between exported panels. */
export async function renderGallery(panels: readonly Buffer[], options: { readonly width?: number; readonly gap?: number } = {}) {
  const width = options.width ?? 300;
  const gap = options.gap ?? 12;
  if (!panels.length) throw new Error('A gallery needs at least one panel.');
  if (!Number.isInteger(width) || width < 64 || width > 1200 || !Number.isInteger(gap) || gap < 0 || gap > 200) {
    throw new Error('Gallery width must be 64–1200px and gap 0–200px.');
  }
  const thumbs = await Promise.all(panels.map((panel) => sharp(panel).resize({ width }).png().toBuffer({ resolveWithObject: true })));
  const height = Math.max(...thumbs.map((thumb) => thumb.info.height));
  return sharp({ create: {
    width: thumbs.length * width + (thumbs.length + 1) * gap,
    height: height + gap * 2, channels: 3, background: '#e8e8ec',
  } }).composite(thumbs.map((thumb, i) => ({ input: thumb.data, left: gap + i * (width + gap), top: gap }))).png().toBuffer();
}
