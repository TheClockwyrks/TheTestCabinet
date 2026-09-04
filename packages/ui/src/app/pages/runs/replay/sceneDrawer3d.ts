// The seam between reading a 3D recording and putting one on screen, and the
// drawing arithmetic that belongs to neither side.
//
// `drawFrame3d` resolves a frame's references and decides what is drawn, in
// what order; something else turns that into pixels. This module is the line
// between the two: the vocabulary the drawer issues (`SceneDrawer3d`), the
// already-resolved values it issues them with, and the handful of pure
// functions both halves need. Nothing here imports a renderer, which is what
// lets the drawer's whole behaviour be tested with no GPU in the room — the
// role the injectable `ImageDecoder` plays for the 2D drawer.
//
// Two of the pure functions are deliberate copies of engine arithmetic rather
// than inventions of the console's, for the same reason `format3d.ts` copies
// the contract and `hudFont.ts` copies the face:
//
//   * `parseColor3d` is `packages/simple-3d/src/renderer.ts`'s `parseColor`.
//     The engines read a colour from a deliberately narrow vocabulary — the
//     fourteen names below, hex in four lengths, `rgb()`/`rgba()`/`hsl()`/
//     `hsla()` — and answer white to everything else. A player that handed the
//     string to a renderer with a wider vocabulary would draw
//     `"rebeccapurple"` purple where the build drew it white, and report the
//     frame as clean.
//   * `fitSurface` is `viewport.ts`'s `fitViewport`, run backwards from the
//     surface a frame recorded rather than forwards from a measured element.
//     It is what puts the picture inside the same letterbox the build had.
//
// `layoutHudText` is the third: the glyph placement `renderer.ts`'s
// `drawHudText` performs, in logical units, so the lettering is laid out the
// same way whatever draws the cells.

import type {
  CameraState,
  Color,
  LightState,
  MaterialMapSlot,
  RenderMode,
  Transform,
  Vec2,
  Vec3,
} from "./format3d";
import { FONT_CELL_HEIGHT, FONT_CELL_WIDTH, glyphRows } from "./hudFont";

/* -------------------------------------------------------------------------- */
/* Decoded assets                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A captured mesh, decoded.
 *
 * `value` is the substrate's own object — a parsed glTF document — and is
 * opaque to the drawer, which only ever hands it back to the drawer seam. What
 * the drawer does read is `translucent`, because whether a mesh drawn under its
 * file's own materials sorts with the translucent draws is decided by those
 * materials and nothing else can see them, and `clips`, so a `clip` naming an
 * animation the file does not carry is reported rather than posed as the rest
 * pose.
 */
export interface DecodedMesh {
  readonly kind: "mesh";
  /** The asset path the handle was loaded from, for a report that names it. */
  readonly path: string;
  /** Whether any material the file carries blends. */
  readonly translucent: boolean;
  /** The names of the animation clips the file carries. */
  readonly clips: readonly string[];
  /** The substrate's own decoded value. */
  readonly value: unknown;
}

/** A captured texture, decoded. */
export interface DecodedTexture {
  readonly kind: "texture";
  /** The asset path, or `text:` and the string the engine rasterized. */
  readonly path: string;
  readonly width: number;
  readonly height: number;
  /** The substrate's own decoded value. */
  readonly value: unknown;
}

/** A captured material document, with its slots decoded. */
export interface DecodedMaterialAsset {
  readonly kind: "material";
  readonly path: string;
  /** The slots this document names, each already a decoded texture. */
  readonly maps: Readonly<Partial<Record<MaterialMapSlot, DecodedTexture>>>;
}

/** One entry of a recording's asset table, decoded. */
export type DecodedAsset = DecodedMesh | DecodedTexture | DecodedMaterialAsset;

/* -------------------------------------------------------------------------- */
/* Resolved draw arguments                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A material a draw resolved to: the engine's own `ResolvedMaterial`, with the
 * defaults filled in and the texture slots decoded.
 *
 * Every form the scene context takes lands here — a colour string, a material
 * built by `createMaterial`, a loaded material document — because that is what
 * the engine does with them (`scene.ts`'s `resolveMaterial`), and drawing them
 * as three different things would draw three different pictures.
 *
 * A loaded document resolves to its `baseColor` and `normal` slots and the
 * defaults for everything else. The other five slots the format carries —
 * roughness, metallic, ao, emissive, height — are captured but not read, by the
 * engine's renderer and so by this player: drawing a map the build did not
 * would be this player painting a picture of its own.
 */
export interface ResolvedMaterial {
  readonly baseColor: Color;
  readonly roughness: number;
  readonly metallic: number;
  readonly emissive: Color;
  readonly opacity: number;
  readonly unlit: boolean;
  readonly baseColorMap: DecodedTexture | null;
  readonly normalMap: DecodedTexture | null;
}

/** The `MaterialSpec` defaults, as the engine's `fillSpec` fills them. */
export const MATERIAL_DEFAULTS: ResolvedMaterial = {
  baseColor: "#ffffff",
  roughness: 0.8,
  metallic: 0,
  emissive: "#000000",
  opacity: 1,
  unlit: false,
  baseColorMap: null,
  normalMap: null,
};

/** A `drawMesh`'s options, with its defaults filled in and its material resolved. */
export interface ResolvedMeshOptions {
  /** The material overriding every material the file carries, or `null` for none. */
  readonly material: ResolvedMaterial | null;
  /** The clip to pose from, or `null` for the file's rest pose. */
  readonly clip: string | null;
  /** The clip time to sample, in seconds, looping over the clip's duration. */
  readonly clipTime: number;
}

/** A `drawHudText`'s options, with its defaults filled in. */
export interface ResolvedHudTextOptions {
  /** The height of the glyph cell, in logical units. */
  readonly size: number;
  readonly color: Color;
  readonly align: "left" | "center" | "right";
}

/** The `HudTextOptions` defaults. */
export const HUD_TEXT_DEFAULTS: ResolvedHudTextOptions = {
  size: 24,
  color: "#ffffff",
  align: "left",
};

/** A canvas backing store, in device pixels. */
export interface Surface3d {
  readonly width: number;
  readonly height: number;
}

/** A recording's logical design field. */
export interface Design3d {
  readonly width: number;
  readonly height: number;
}

/* -------------------------------------------------------------------------- */
/* The seam                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whatever draws the picture, in the scene context's own vocabulary.
 *
 * The ten verbs and six producers are the recording's, one for one, so the
 * drawer's dispatch is a closed switch over the vocabulary and an operation
 * naming anything else is one operation skipped and reported.
 *
 * What reaches a method here is already resolved and already ordered: the
 * `$res` recipes are built, the `$asset` references are decoded, the defaults
 * are filled, and the draws arrive in the order the picture composites in
 * (each run's opaque draws in issue order, then that run's translucent draws
 * farthest-first, and the whole frame's HUD draws last). An implementation is
 * therefore free of the format entirely: it turns values into pixels, in the
 * order it is given them.
 *
 * A method that cannot draw what it is given throws, and the drawer reports the
 * verb by name — the 3D reading of the 2D drawer's "one operation a context
 * rejects must not cost the reviewer the rest of the frame". Drawing *nothing*
 * is not a failure: a call carrying a non-finite number draws nothing in the
 * build too ("the call is still recorded"), so an implementation skips it
 * silently rather than throwing, and the frame reports no loss it did not have.
 */
export interface SceneDrawer3d {
  /**
   * Start a frame: clear `surface` to `background` with the depth state reset,
   * and put the letterbox for `design` in force.
   */
  blank(surface: Surface3d, design: Design3d, background: Color | null): void;
  setCamera(camera: CameraState): void;
  /** Set the light list. At most {@link import("./format3d").LIGHT_LIMIT} entries reach here. */
  setLights(lights: readonly LightState[]): void;
  setMode(mode: RenderMode): void;
  clearDepth(): void;
  drawMesh(
    mesh: DecodedMesh,
    transform: Transform,
    options: ResolvedMeshOptions,
  ): void;
  /** `geometry` is a value one of the five geometry producers below handed back. */
  drawGeometry(
    geometry: unknown,
    material: ResolvedMaterial,
    transform: Transform,
  ): void;
  drawBillboard(texture: DecodedTexture, position: Vec3, size: Vec2): void;
  drawLine(points: readonly Vec3[], color: Color): void;
  drawHudText(
    text: string,
    position: Vec2,
    options: ResolvedHudTextOptions,
  ): void;
  drawHudRect(position: Vec2, size: Vec2, color: Color): void;
  createBox(size: Vec3): unknown;
  createSphere(radius: number): unknown;
  createCylinder(radius: number, height: number): unknown;
  createCapsule(radius: number, height: number): unknown;
  createPlane(width: number, depth: number): unknown;
  createMaterial(material: ResolvedMaterial): unknown;
  /** Finish the frame: everything issued since `blank` is on screen after this. */
  render(): void;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The colour names the engines answer, and what they answer.
 *
 * A copy of `packages/simple-3d/src/renderer.ts`'s `NAMED_COLORS`. The list is
 * short on purpose: the engines parse a colour themselves rather than asking a
 * browser, so that a build letters and fills the same in Node and on screen.
 */
const NAMED_COLORS: Readonly<
  Record<string, readonly [number, number, number, number]>
> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 128 / 255, 0, 1],
  lime: [0, 1, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
  gray: [128 / 255, 128 / 255, 128 / 255, 1],
  grey: [128 / 255, 128 / 255, 128 / 255, 1],
  orange: [1, 165 / 255, 0, 1],
  purple: [128 / 255, 0, 128 / 255, 1],
};

/** One hue-to-channel leg of the HSL conversion. */
function hueChannel(p: number, q: number, t: number): number {
  let h = t;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h < 1 / 6) return p + (q - p) * 6 * h;
  if (h < 1 / 2) return q;
  if (h < 2 / 3) return p + (q - p) * 6 * (2 / 3 - h);
  return p;
}

/**
 * A CSS colour as the engines read one: red, green, blue and alpha in `0..1`.
 *
 * A string outside the vocabulary — a name the table does not carry, a
 * malformed hex, anything at all — is opaque white, which is what the build
 * drew it as.
 */
export function parseColor3d(css: string): [number, number, number, number] {
  if (typeof css !== "string") return [1, 1, 1, 1];
  const text = css.trim().toLowerCase();
  const named = NAMED_COLORS[text];
  if (named !== undefined) return [named[0], named[1], named[2], named[3]];

  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (/^[0-9a-f]+$/.test(hex)) {
      if (hex.length === 3 || hex.length === 4) {
        const parts = hex.split("").map((c) => parseInt(c + c, 16) / 255);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
      }
      if (hex.length === 6 || hex.length === 8) {
        const at = (i: number): number =>
          parseInt(hex.slice(i, i + 2), 16) / 255;
        return [at(0), at(2), at(4), hex.length === 8 ? at(6) : 1];
      }
    }
    return [1, 1, 1, 1];
  }

  const call = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (call !== null) {
    const parts = (call[2] ?? "")
      .split(/[\s,/]+/)
      .filter((part) => part !== "");
    const numberAt = (index: number, scale: number): number => {
      const raw = parts[index];
      if (raw === undefined) return 0;
      const percent = raw.endsWith("%");
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) return 0;
      return percent ? value / 100 : value / scale;
    };
    const alpha =
      parts.length > 3 ? Math.min(1, Math.max(0, numberAt(3, 1))) : 1;
    if ((call[1] ?? "").startsWith("rgb")) {
      const clamp = (v: number): number => Math.min(1, Math.max(0, v));
      return [
        clamp(numberAt(0, 255)),
        clamp(numberAt(1, 255)),
        clamp(numberAt(2, 255)),
        alpha,
      ];
    }
    const h = (((Number.parseFloat(parts[0] ?? "0") % 360) + 360) % 360) / 360;
    const s = Math.min(1, Math.max(0, numberAt(1, 100)));
    const l = Math.min(1, Math.max(0, numberAt(2, 100)));
    if (s === 0) return [l, l, l, alpha];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      hueChannel(p, q, h + 1 / 3),
      hueChannel(p, q, h),
      hueChannel(p, q, h - 1 / 3),
      alpha,
    ];
  }

  return [1, 1, 1, 1];
}

/** How opaque a colour is, in `0..1`. What decides whether a line blends. */
export function colorAlpha(css: string): number {
  return parseColor3d(css)[3] ?? 1;
}

/** `css` as `#rrggbb`, for a renderer that takes a colour as a string. */
export function colorHex(css: string): string {
  const [r, g, b] = parseColor3d(css);
  const byte = (channel: number): string =>
    Math.max(0, Math.min(255, Math.round(channel * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/* -------------------------------------------------------------------------- */
/* The letterbox                                                              */
/* -------------------------------------------------------------------------- */

/** Where the logical design field sits inside a surface, in device pixels. */
export interface Fit3d {
  /** Device pixels per logical unit. Zero when nothing can be drawn. */
  readonly scale: number;
  /** The left letterbox bar, in device pixels. */
  readonly offsetX: number;
  /** The top letterbox bar, in device pixels. */
  readonly offsetY: number;
}

/**
 * The fit a frame was drawn under, recovered from the surface it recorded.
 *
 * This is `fitViewport` run backwards. The engine computed its fit from a
 * measured element and a device pixel ratio, neither of which a recording
 * carries; what it carries is the backing store the frame was drawn into, and
 * the backing store is exactly `round(css * dpr)` on both axes. Taking the
 * scale from it directly therefore recovers the engine's own scale to within
 * the half device pixel that rounding lost, and the offsets are the same two
 * equal bars — which is what puts the picture inside the letterbox the build
 * had rather than stretched across the pane.
 *
 * A degenerate surface or design yields a zero scale, which draws nothing, as
 * it does in the engine.
 */
export function fitSurface(design: Design3d, surface: Surface3d): Fit3d {
  const usable =
    design.width > 0 &&
    design.height > 0 &&
    surface.width > 0 &&
    surface.height > 0 &&
    Number.isFinite(design.width) &&
    Number.isFinite(design.height) &&
    Number.isFinite(surface.width) &&
    Number.isFinite(surface.height);
  const scale = usable
    ? Math.min(surface.width / design.width, surface.height / design.height)
    : 0;
  return {
    scale,
    offsetX: (surface.width - design.width * scale) / 2,
    offsetY: (surface.height - design.height * scale) / 2,
  };
}

/* -------------------------------------------------------------------------- */
/* HUD lettering                                                              */
/* -------------------------------------------------------------------------- */

/** One glyph cell of a laid-out HUD string, in logical units. */
export interface HudGlyph {
  /** The code point the cell letters — what a glyph atlas is indexed by. */
  readonly code: number;
  /** The 16 row bytes of the glyph, top to bottom, most significant bit leftmost. */
  readonly rows: Uint8Array;
  /** The left edge of the cell, in logical units. */
  readonly x: number;
  /** The top edge of the cell, in logical units. */
  readonly y: number;
  /** The cell's width in logical units: half the em size. */
  readonly width: number;
  /** The cell's height in logical units: the em size. */
  readonly height: number;
}

/** How many pixels across a glyph's bitmap is. */
export const GLYPH_WIDTH = FONT_CELL_WIDTH;

/** How many pixels down a glyph's bitmap is. */
export const GLYPH_HEIGHT = FONT_CELL_HEIGHT;

/**
 * Where each glyph of a HUD string sits, in logical units.
 *
 * The arithmetic is `renderer.ts`'s `drawHudText`: the string is split into
 * code points, each advances half the em size, the whole run is shifted left by
 * half its width under `"center"` and by its width under `"right"`, and
 * `position.y` is the TOP of the em box rather than a baseline. The cell is the
 * face's 8×16 bitmap stretched to `size / 2` by `size`, so a glyph is drawn by
 * painting the rows into that rectangle.
 *
 * A non-finite size or position lays out nothing, which is the call the build
 * drew nothing for.
 */
export function layoutHudText(
  text: string,
  position: Vec2,
  options: ResolvedHudTextOptions,
): readonly HudGlyph[] {
  if (
    !Number.isFinite(options.size) ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return [];
  }
  const glyphs = [...text];
  if (glyphs.length === 0) return [];
  const advance = options.size / 2;
  const total = glyphs.length * advance;
  let x = position.x;
  if (options.align === "center") x -= total / 2;
  else if (options.align === "right") x -= total;
  return glyphs.map((glyph, i) => ({
    code: glyph.codePointAt(0) ?? 0,
    rows: glyphRows(glyph.codePointAt(0) ?? 0),
    x: x + i * advance,
    y: position.y,
    width: advance,
    height: options.size,
  }));
}
