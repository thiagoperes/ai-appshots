import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fillLayersToSvg, linearGradientToSvg, radialGradientToSvg, stopsFor, toPaint } from '../color.ts';

test('splits alpha out of colours into a separate opacity', () => {
  assert.deepEqual(toPaint('#1A2BC3'), { color: '#1A2BC3', opacity: 1 });
  assert.deepEqual(toPaint('#abc'), { color: '#aabbcc', opacity: 1 });
  assert.deepEqual(toPaint('#00000080'), {
    color: '#000000',
    opacity: 128 / 255,
  });
  assert.deepEqual(toPaint('rgba(166, 216, 253, 0.07)'), {
    color: 'rgb(166, 216, 253)',
    opacity: 0.07,
  });
  assert.deepEqual(toPaint('rgb(1,2,3)'), {
    color: 'rgb(1, 2, 3)',
    opacity: 1,
  });
  assert.deepEqual(toPaint('transparent'), { color: '#000000', opacity: 0 });
  assert.deepEqual(toPaint('rebeccapurple'), {
    color: 'rebeccapurple',
    opacity: 1,
  });
});

test('distributes stops that were left unpositioned', () => {
  const stops = stopsFor(['#000', '#111', '#222']);

  assert.deepEqual(
    stops.map((stop) => stop.offset),
    [0, 0.5, 1],
  );
});

test('fades to a neighbour colour rather than to black', () => {
  // CSS interpolates in premultiplied alpha, so `transparent` only drops the
  // alpha. Taking it literally would run the ramp through black.
  const [, out] = stopsFor(['#1A2BC3 0%', 'transparent 72%']);

  assert.deepEqual(out, {
    paint: { color: '#1A2BC3', opacity: 0 },
    offset: 0.72,
  });
});

test('places gradient endpoints where CSS puts them', () => {
  // 180deg is straight down, and the line spans the full height.
  const down = linearGradientToSvg(
    'linear-gradient(180deg, #fff 0%, #000 100%)',
    'g',
    { width: 100, height: 200 },
  );

  assert.match(down, /x1="50.00" y1="0.00" x2="50.00" y2="200.00"/);

  // `to right` is 90deg, so the line runs across instead.
  const across = linearGradientToSvg('linear-gradient(to right, #fff, #000)', 'g', {
    width: 100,
    height: 200,
  });

  assert.match(across, /x1="0.00" y1="100.00" x2="100.00" y2="100.00"/);
});

test('carries stop opacity into the SVG', () => {
  const svg = linearGradientToSvg(
    'linear-gradient(176deg, #0F1053 0%, rgba(7, 8, 38, 0.5) 44%, #000000 100%)',
    'sweep',
    { width: 1320, height: 2868 },
  );

  assert.match(
    svg,
    /offset="44.000%" stop-color="rgb\(7, 8, 38\)" stop-opacity="0.5"/,
  );
});

test('sizes radial gradients the way CSS does', () => {
  const box = { width: 200, height: 100 };
  // Ellipse radii are fractions of each axis.
  assert.match(radialGradientToSvg('radial-gradient(ellipse 50% 25% at 50% 80%, #fff, #000)', 'g', box),
    /cx="100.00" cy="80.00" r="100.00" gradientTransform="translate\(0 60.00\) scale\(1 0.25000\)"/);
  // Without a size, CSS reaches the farthest corner: √2 × the farthest sides.
  assert.match(radialGradientToSvg('radial-gradient(#fff, #000)', 'g', { width: 100, height: 100 }),
    /cx="50.00" cy="50.00" r="70.71"/);
  assert.match(radialGradientToSvg('radial-gradient(circle closest-side at 25% 50%, #fff, #000)', 'g', box),
    /cx="50.00" cy="50.00" r="50.00"/);
  // One keyword places one axis and centres the other.
  assert.match(radialGradientToSvg('radial-gradient(circle 40px at top, #fff, #000)', 'g', box),
    /cx="100.00" cy="0.00" r="40.00"/);
  assert.throws(() => radialGradientToSvg('radial-gradient(ellipse 0% 10%, #fff, #000)', 'g', box), /no area/);
});

test('draws a background list bottom layer first', () => {
  const { defs, paints } = fillLayersToSvg(
    'radial-gradient(ellipse 60% 50% at 50% 70%, #f7f2e8, #f1eadc00 72%), #f1eadc',
    'bg',
    { width: 300, height: 200 },
  );

  assert.deepEqual(paints, ['fill="#f1eadc" fill-opacity="1"', 'fill="url(#bg-1)"']);
  assert.match(defs, /<radialGradient id="bg-1"/);
  assert.match(defs, /stop-color="#f1eadc" stop-opacity="0"/);
});

test('refuses a gradient it cannot read', () => {
  assert.throws(
    () => linearGradientToSvg('conic-gradient(#fff, #000)', 'g', {
      width: 10,
      height: 10,
    }),
    /Themes support/,
  );
});
