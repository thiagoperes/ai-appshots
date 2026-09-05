import type { CanvasThemeOverrides, Caption, FrameSpec, ThemeName } from './types';

export type LayoutPreset =
  | 'classic'
  | 'tilted-panorama'
  | 'feature-closeup'
  | 'side-aligned'
  | 'blank';

export interface LayerShadow {
  readonly color?: string;
  /** Blur and horizontal offset in panel-width units. */
  readonly blur?: number;
  readonly x?: number;
  /** Vertical offset in panel-height units. */
  readonly y?: number;
  readonly opacity?: number;
}

/**
 * Dimensions are fractions of ONE export panel, including in panoramas.
 * x=1 is the first seam; x=2 the second. Negative positions allow bleed.
 * The anchor defaults to the layer's centre and stays fixed during rotation.
 */
export interface LayerPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height?: number;
  readonly anchor?: { readonly x: number; readonly y: number };
  /** Clockwise degrees, rotated around the anchor. */
  readonly rotation?: number;
  readonly scale?: number;
  readonly opacity?: number;
  readonly zIndex?: number;
  readonly hidden?: boolean;
  readonly shadow?: LayerShadow;
}

export interface SourceCrop {
  /** Fractions of the original image, before resizing or rotation. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DeviceLayer extends LayerPlacement {
  readonly kind: 'device';
  readonly screen: string;
  /** Uses the target frame when omitted. Crop requires an unframed screen. */
  readonly frame?: FrameSpec;
  readonly crop?: SourceCrop;
  /** Rounded corners for an unframed screen, in panel-width units. */
  readonly radius?: number;
}

export interface ImageLayer extends LayerPlacement {
  readonly kind: 'image';
  /** Local asset path relative to rootDir. */
  readonly path: string;
  readonly fit?: 'contain' | 'cover';
  readonly crop?: SourceCrop;
  readonly radius?: number;
}

export type LayerText = string
  | { readonly screen: string; readonly caption: keyof Caption }
  | { readonly locales: Readonly<Record<string, string>> };

export interface TextLayer extends LayerPlacement {
  readonly kind: 'text';
  readonly text: LayerText;
  /** Required bounding box; overflow is fitted or reported, never cut off. */
  readonly height: number;
  readonly font?: string;
  readonly fontFile?: string;
  /** Font size is a fraction of one panel's width. */
  readonly fontSize?: number;
  readonly minFontSize?: number;
  readonly weight?: number;
  /** Extra tracking in ems. */
  readonly letterSpacing?: number;
  /** Additional space between baselines, in ems. */
  readonly lineSpacing?: number;
  readonly maxLines?: number;
  readonly color?: string;
  readonly align?: 'left' | 'center' | 'right';
  readonly verticalAlign?: 'top' | 'center' | 'bottom';
  readonly uppercase?: boolean;
}

export interface ShapeLayer extends LayerPlacement {
  readonly kind: 'shape';
  readonly shape?: 'rect' | 'ellipse';
  readonly height: number;
  readonly fill: string;
  readonly radius?: number;
  readonly stroke?: string;
  readonly strokeWidth?: number;
}

export type CompositionLayer = DeviceLayer | ImageLayer | TextLayer | ShapeLayer;
type EditableLayer<T> = T extends CompositionLayer ? Partial<Omit<T, 'id' | 'kind'>> : never;
export type LayerOverride = EditableLayer<CompositionLayer>;

export interface CompositionBackground {
  /** CSS solid colour or linear-gradient, shared across all panels. */
  readonly fill?: string;
  readonly image?: string;
  readonly fit?: 'cover' | 'contain';
  readonly opacity?: number;
}

export interface CompositionSpec {
  readonly preset?: LayoutPreset;
  readonly background?: CompositionBackground;
  /** Appended to preset layers; zIndex controls ordering. IDs must be unique. */
  readonly layers?: readonly CompositionLayer[];
  /** Preset IDs are title-1, kicker-1, device-1, detail-1, etc. */
  readonly overrides?: Readonly<Record<string, LayerOverride>>;
}

export interface PanoramaSpec {
  readonly id: string;
  /** Consecutive screen IDs, in the same order as config.screens. */
  readonly screens: readonly string[];
  readonly composition: CompositionSpec;
  readonly theme?: ThemeName;
  readonly canvas?: CanvasThemeOverrides;
  /** Omit to apply to every target. */
  readonly targets?: readonly string[];
}

export interface CompositionNotice {
  readonly layer: string;
  readonly message: string;
}

export interface CompositionResult {
  /** Entire continuous canvas, before slicing. */
  readonly image: Buffer;
  readonly panels: readonly Buffer[];
  /** Design/artwork guidance, separate from store file-format validation. */
  readonly notices: readonly CompositionNotice[];
}
