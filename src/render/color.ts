/**
 * Translates the CSS colour and gradient values a theme is written in into the
 * attributes SVG wants.
 *
 * Themes stay in CSS syntax because that is what the people and agents editing
 * them already know, and because it keeps a theme portable. SVG splits what CSS
 * combines: a colour carries no alpha, so every value becomes a paint plus a
 * separate opacity.
 */

export interface Paint {
  /** A colour SVG accepts in `fill` or `stop-color`, with no alpha. */
  readonly color: string;
  readonly opacity: number;
}

const HEX = /^#([0-9a-f]{3,8})$/i;
const FUNCTIONAL = /^(rgba?|hsla?)\(([^)]*)\)$/i;

function fromHex(digits: string): Paint | undefined {
  const expand = (value: string) =>
    value
      .split('')
      .map((digit) => digit + digit)
      .join('');

  if (digits.length === 3 || digits.length === 4) {
    return fromHex(expand(digits));
  }

  if (digits.length === 6) {
    return { color: `#${digits}`, opacity: 1 };
  }

  if (digits.length === 8) {
    return {
      color: `#${digits.slice(0, 6)}`,
      opacity: Number.parseInt(digits.slice(6), 16) / 255,
    };
  }

  return undefined;
}

/**
 * Splits a CSS colour into an SVG paint and an opacity.
 *
 * `transparent` becomes fully transparent black, matching CSS, and inside a
 * gradient it should be replaced by the neighbouring colour at zero opacity —
 * see `stopsFor` — or the ramp darkens as it fades.
 */
export function toPaint(value: string): Paint {
  const input = value.trim();

  if (input === 'transparent') {
    return { color: '#000000', opacity: 0 };
  }

  const hex = HEX.exec(input);

  if (hex?.[1]) {
    const parsed = fromHex(hex[1]);

    if (parsed) {
      return parsed;
    }
  }

  const functional = FUNCTIONAL.exec(input);

  if (functional?.[1] && functional[2] !== undefined) {
    const kind = functional[1].toLowerCase();
    const parts = functional[2]
      .split(/[,/]|\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const alpha = parts[3];

    return {
      color: `${kind.startsWith('hsl') ? 'hsl' : 'rgb'}(${parts.slice(0, 3).join(', ')})`,
      opacity: alpha === undefined ? 1 : parseAlpha(alpha),
    };
  }

  // Named colours and anything else SVG understands verbatim.
  return { color: input, opacity: 1 };
}

function parseAlpha(value: string) {
  const alpha = value.endsWith('%')
    ? Number.parseFloat(value) / 100
    : Number.parseFloat(value);

  return Number.isFinite(alpha) ? Math.min(Math.max(alpha, 0), 1) : 1;
}

export interface GradientStop {
  readonly paint: Paint;
  /** Position along the gradient line, 0 to 1. */
  readonly offset: number;
}

/** Splits on commas that are not inside brackets, e.g. between `rgba(...)`. */
function splitTopLevel(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const character of value) {
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    }

    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts.map((part) => part.trim());
}

/**
 * Reads `<colour> [<position>]` pairs, distributing any positions that were left
 * out evenly, as CSS does.
 *
 * A `transparent` stop inherits its neighbour's colour at zero opacity. CSS
 * interpolates gradients in premultiplied alpha, so fading to `transparent`
 * fades only the alpha; SVG interpolates each channel separately, and would run
 * the colour towards black on the way out.
 */
export function stopsFor(parts: readonly string[]): GradientStop[] {
  const parsed = parts.map((part) => {
    const match = /\s+(-?[\d.]+(?:%|px)?)$/.exec(part);
    const position = match?.[1];
    const colour = (position ? part.slice(0, match.index) : part).trim();

    return {
      paint: toPaint(colour),
      offset: position?.endsWith('%')
        ? Number.parseFloat(position) / 100
        : undefined,
      transparent: colour === 'transparent',
    };
  });

  const withOffsets = parsed.map((stop, index) => ({
    ...stop,
    offset:
      stop.offset ??
      (index === 0 ? 0 : index === parsed.length - 1 ? 1 : index / (parsed.length - 1)),
  }));

  return withOffsets.map((stop, index) => {
    if (!stop.transparent) {
      return { paint: stop.paint, offset: stop.offset };
    }

    const neighbour = withOffsets[index - 1] ?? withOffsets[index + 1];

    return {
      paint: { color: neighbour?.paint.color ?? '#000000', opacity: 0 },
      offset: stop.offset,
    };
  });
}

export function stopsToSvg(stops: readonly GradientStop[]) {
  return stops
    .map(
      ({ paint, offset }) =>
        `<stop offset="${(offset * 100).toFixed(3)}%" ` +
        `stop-color="${paint.color}" stop-opacity="${paint.opacity}" />`,
    )
    .join('');
}

const ANGLES: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315,
};

/**
 * Converts a CSS `linear-gradient()` into an SVG `<linearGradient>` for a box of
 * the given size.
 *
 * Endpoints follow the CSS spec: the gradient line runs through the centre at
 * the given angle, sized so the first and last stops land exactly on the corners
 * that project furthest along it. Without that the ramp looks subtly compressed
 * on any angle that is not a multiple of 90 degrees.
 */
export function linearGradientToSvg(
  value: string,
  id: string,
  size: { readonly width: number; readonly height: number },
) {
  const match = /^linear-gradient\((.*)\)$/is.exec(value.trim());

  if (!match?.[1]) {
    throw new Error(
      `Could not read the gradient "${value}". Themes support ` +
        `linear-gradient(<angle>deg | to <side>, <colour> <stop>%, ...).`,
    );
  }

  const parts = splitTopLevel(match[1]);
  const first = parts[0]?.toLowerCase() ?? '';
  const named = ANGLES[first];
  const degrees = /^-?[\d.]+deg$/.test(first)
    ? Number.parseFloat(first)
    : named;
  const stops = stopsFor(degrees === undefined ? parts : parts.slice(1));
  // CSS measures clockwise from "to top", so 0deg points up the negative y axis.
  const radians = ((degrees ?? 180) * Math.PI) / 180;
  const direction = { x: Math.sin(radians), y: -Math.cos(radians) };
  const length =
    Math.abs(size.width * direction.x) + Math.abs(size.height * direction.y);
  const centre = { x: size.width / 2, y: size.height / 2 };
  const half = length / 2;

  // Trig leaves a residue on the axis-aligned angles, which would print as
  // "-0.00" rather than zero.
  const coordinate = (value: number) =>
    (Math.abs(value) < 1e-9 ? 0 : value).toFixed(2);

  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${coordinate(centre.x - direction.x * half)}" ` +
    `y1="${coordinate(centre.y - direction.y * half)}" ` +
    `x2="${coordinate(centre.x + direction.x * half)}" ` +
    `y2="${coordinate(centre.y + direction.y * half)}">` +
    `${stopsToSvg(stops)}</linearGradient>`
  );
}

/**
 * An SVG `<radialGradient>` shaped like a CSS `radial-gradient(ellipse Xpx Ypx
 * at cx cy, ...)`. SVG only draws circles, so the ellipse comes from scaling the
 * y axis about the centre.
 */
export function ellipseGradientToSvg(options: {
  readonly id: string;
  readonly centre: { readonly x: number; readonly y: number };
  readonly radius: { readonly x: number; readonly y: number };
  readonly stops: readonly GradientStop[];
}) {
  const { id, centre, radius, stops } = options;
  const scale = radius.y / radius.x;

  return (
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `cx="${centre.x.toFixed(2)}" cy="${centre.y.toFixed(2)}" ` +
    `r="${radius.x.toFixed(2)}" ` +
    `gradientTransform="translate(0 ${(centre.y * (1 - scale)).toFixed(2)}) ` +
    `scale(1 ${scale.toFixed(5)})">` +
    `${stopsToSvg(stops)}</radialGradient>`
  );
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
