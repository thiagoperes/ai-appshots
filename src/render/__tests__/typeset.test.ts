import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import opentype from 'opentype.js';
import sharp from 'sharp';

import { typesetCaption, typesetLine } from '../typeset.ts';

test('renders an explicit font file without a host font installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-appshots-font-'));

  try {
    const glyphPath = new opentype.Path();
    glyphPath.moveTo(50, 0);
    glyphPath.lineTo(300, 700);
    glyphPath.lineTo(550, 0);
    glyphPath.lineTo(430, 0);
    glyphPath.lineTo(365, 210);
    glyphPath.lineTo(235, 210);
    glyphPath.lineTo(170, 0);
    glyphPath.close();
    const descenderPath = new opentype.Path();
    descenderPath.moveTo(80, 320);
    descenderPath.lineTo(500, 320);
    descenderPath.lineTo(500, -200);
    descenderPath.lineTo(380, -200);
    descenderPath.lineTo(380, 0);
    descenderPath.lineTo(80, 0);
    descenderPath.close();

    const font = new opentype.Font({
      familyName: 'Fixture Serif',
      styleName: 'Regular',
      unitsPerEm: 1_000,
      ascender: 800,
      descender: -200,
      glyphs: [
        new opentype.Glyph({ name: '.notdef', advanceWidth: 600 }),
        new opentype.Glyph({
          name: 'A',
          unicode: 65,
          advanceWidth: 600,
          path: glyphPath,
        }),
        new opentype.Glyph({
          name: 'g',
          unicode: 103,
          advanceWidth: 600,
          path: descenderPath,
        }),
      ],
    });
    const path = join(directory, 'fixture.otf');
    await writeFile(path, Buffer.from(font.toArrayBuffer()));

    const line = await typesetLine('AAA', {
      family: 'This Font Is Not Installed',
      fontFile: path,
      size: 80,
      weight: 400,
      letterSpacing: -1,
      colour: '#7a5b34',
    });
    const metadata = await sharp(line.buffer).metadata();

    assert.equal(metadata.width, line.width);
    assert.equal(metadata.height, line.height);
    assert.ok(line.width > 100);
    assert.ok(line.height > 40);

    const descenders = await typesetLine('ggg', {
      family: 'This Font Is Not Installed',
      fontFile: path,
      size: 80,
      weight: 400,
      letterSpacing: -1,
      colour: '#7a5b34',
    });

    assert.equal(descenders.height, line.height);

    const style = { family: 'Not installed', fontFile: path, size: 80, weight: 400, letterSpacing: -1 };
    const paragraph = await typesetLine('AAA\nA', { ...style, align: 'right', lineSpacing: 12 });
    assert.equal(paragraph.width, line.width);
    assert.ok(paragraph.height > line.height * 1.8, 'Font-file paragraphs must honor line breaks');
    const { data, info } = await sharp(paragraph.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const leftEdges = [info.width, info.width];
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * 4 + 3]! > 127) {
          const row = y < line.height ? 0 : 1;
          leftEdges[row] = Math.min(leftEdges[row]!, x);
        }
      }
    }
    assert.ok(leftEdges[1]! > leftEdges[0]! + 60, 'Short lines must respect paragraph alignment');
    const caption = await typesetCaption('AAA\nA', { ...style, align: 'right', lineSpacing: 12 });
    assert.ok(caption.height < paragraph.height, 'Caption flow excludes unused font metric padding');
    assert.ok(caption.height > line.height, 'Trimming must retain both lines');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
