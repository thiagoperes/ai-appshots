import sharp from 'sharp';

import type { CompositionLayer } from '../composition-types';
import type { Size } from '../types';

/** A layer as drawn: its final (rotated, scaled) image and where it lands on the canvas. */
export interface Placement {
  readonly layer: CompositionLayer;
  readonly image: Buffer;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface Box { left: number; top: number; right: number; bottom: number }

/** Glyph ink, and a device's solid body: soft shadows and antialiasing do not count. */
const INK = 64;
const SOLID = 200;

async function mask(placement: Placement, box: Box, threshold: number) {
  const width = box.right - box.left, height = box.bottom - box.top;
  const alpha = await sharp(placement.image).ensureAlpha().extractChannel(3)
    .extract({ left: box.left - placement.left, top: box.top - placement.top, width, height })
    .raw().toBuffer();
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) solid[i] = alpha[i]! > threshold ? 1 : 0;
  return solid;
}

function intersect(a: Box | undefined, b: Box | undefined): Box | undefined {
  if (!a || !b) return undefined;
  const box = {
    left: Math.max(a.left, b.left), top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
  };
  return box.right > box.left && box.bottom > box.top ? box : undefined;
}

const bounds = (p: Placement): Box => ({ left: p.left, top: p.top, right: p.left + p.width, bottom: p.top + p.height });
const grow = (box: Box, by: number): Box => ({
  left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by,
});

/** Whether any glyph pixel has a device pixel within `clearance` of it (a square neighbourhood). */
async function crowds(text: Placement, device: Placement, clearance: number, canvas: Box) {
  // Device pixels that could be near a glyph, and glyph pixels that could be near the device.
  const near = intersect(intersect(grow(bounds(text), clearance), bounds(device)), canvas);
  if (!near) return false;
  const glyphs = intersect(intersect(grow(near, clearance), bounds(text)), canvas);
  if (!glyphs) return false;
  const solid = await mask(device, near, SOLID);
  const width = near.right - near.left, height = near.bottom - near.top;
  // Summed-area table, so each glyph pixel asks "any device pixel nearby?" in constant time.
  const table = new Uint32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += solid[y * width + x]!;
      table[(y + 1) * (width + 1) + x + 1] = table[y * (width + 1) + x + 1]! + row;
    }
  }
  const count = (x0: number, y0: number, x1: number, y1: number) =>
    table[y1 * (width + 1) + x1]! - table[y0 * (width + 1) + x1]! - table[y1 * (width + 1) + x0]! + table[y0 * (width + 1) + x0]!;
  const ink = await mask(text, glyphs, INK);
  const inkWidth = glyphs.right - glyphs.left;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    const x = glyphs.left + (i % inkWidth) - near.left, y = glyphs.top + Math.floor(i / inkWidth) - near.top;
    const x0 = Math.max(0, x - clearance), y0 = Math.max(0, y - clearance);
    const x1 = Math.min(width, x + clearance + 1), y1 = Math.min(height, y + clearance + 1);
    if (x1 > x0 && y1 > y0 && count(x0, y0, x1, y1) > 0) return true;
  }
  return false;
}

/**
 * Text never touches a device: every glyph keeps `clearance` pixels from the
 * solid body of every device layer, measured on what is visible in the canvas.
 */
export async function assertTextClear(placements: readonly Placement[], clearance: number, canvas: Size) {
  const visible = { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
  const texts = placements.filter((p) => p.layer.kind === 'text' && !p.layer.allowDeviceOverlap);
  const devices = placements.filter((p) => p.layer.kind === 'device');
  for (const text of texts) {
    for (const device of devices) {
      if (await crowds(text, device, Math.round(clearance), visible)) {
        throw new Error(`Text layer "${text.layer.id}" comes within ${Math.round(clearance)}px of device layer ` +
          `"${device.layer.id}". Move one of them, or set allowDeviceOverlap on the text when it belongs on the screen.`);
      }
    }
  }
}
