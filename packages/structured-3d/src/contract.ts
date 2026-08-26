/**
 * The 3D draw-command recording format: the value `stopRecording()` returns,
 * written by the recorder and read by a player that never imports the engine.
 *
 * This module is a deliberate, byte-identical COPY carried by both 3D engine
 * packages — `packages/simple-3d/src/contract.ts` and
 * `packages/structured-3d/src/contract.ts` are the same file, not an import of
 * one another. Each engine package is vendored into run repositories and has
 * to stay self-contained, so neither can depend on the other, and a shared
 * package would tie their release cycles together. The docs instead specify
 * ONE format the two engines both write — "the vocabulary is shared, so one
 * player draws both engines' recordings" — and the two copies (plus the
 * reviewer console's own copy beside its 3D drawer) are held identical by the
 * recording-parity suites. Change one copy and you must change the others
 * byte for byte.
 *
 * Everything here mirrors the `recording` API pages under
 * `docs/engines/simple-3d/apis/` and `docs/engines/structured-3d/apis/` —
 * the two pages specify this one format, and a type that disagrees with them
 * is wrong.
 *
 * There is one recording format and it is version 1. When the recorder
 * changes shape, the types here change with it; a player never learns to read
 * a second shape.
 */

import type { CameraState, Vec3 } from "./math";

/* -------------------------------------------------------------------------- */
/* The format constants                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The format version this engine writes. A recording states the version it
 * was written in, so a player that meets a document stating anything else
 * refuses it by name instead of drawing a confident wrong picture from fields
 * it half-understands.
 */
export const RECORDING_FORMAT = 1;

/**
 * The most lights a `RenderState` carries. A frame that inherited a longer
 * list the recorder cut down carries `truncated: true`, so a reviewer can
 * tell a picture the format could not carry from one it carried.
 *
 * The bound cuts the *state* and not the call: a recorded `setLights` op
 * carries every light the build supplied, however many, because an op records
 * the call as it was made while a state records what a frame inherits. A
 * player re-issuing that op therefore applies the same first-{@link
 * LIGHT_LIMIT}-entries rule the renderers apply, or it lights a replay by
 * lights the engine itself ignored.
 */
export const LIGHT_LIMIT = 64;

/**
 * The depth past which an encoded container records as `{ $opaque: … }`
 * rather than being expanded. The value an operation carries sits at depth
 * zero. Part of the format, not a recorder's choice, so every recorder
 * answers the same input with the same document.
 */
export const VALUE_DEPTH_LIMIT = 32;

/**
 * The most values one encoded value expands into, counted over every value
 * the walk reaches. A container the bound falls inside stops there and
 * carries its remainder as a single `{ $opaque: "truncated" }` — the last
 * element of an array, and the field named `$rest` of an object. Part of the
 * format, like {@link VALUE_DEPTH_LIMIT}.
 */
export const VALUE_EXPANSION_LIMIT = 65_536;

/**
 * The byte budget for captured assets, counted over `data` and `src`. Once a
 * recording holds this much, assets already captured keep resolving and a
 * further new capture records as `{ $opaque: "MeshHandle" }` (or the handle's
 * own type name) — the same degradation a player already reports.
 *
 * The bound is a ceiling and not a threshold: a capture that *would* take the
 * holdings past it is the one refused, so a document never carries more than
 * this many bytes. The looser reading — admit the capture that crosses the
 * line and stop after it — would let one recording exceed a limit a reviewer's
 * console sizes its buffers by, and one engine reading it each way would put
 * two different documents in front of the same reviewer.
 */
export const ASSET_BYTE_LIMIT = 16 * 1024 * 1024;

/**
 * The most mutation steps a resource recipe holds, past which the value
 * records as `{ $opaque: … }`. A produced value is immutable, so a conforming
 * 3D recipe is a `make` with an empty `then`; the bound is the shared
 * format's own rule.
 */
export const RECIPE_STEP_LIMIT = 1024;

/**
 * The most significant digits a number inside a `DrawValue`, a `RenderState`,
 * or a resource recipe is written to. Nine significant digits resolve a
 * coordinate far below a pixel; frame metadata (`count`, `timeMs`, `deltaMs`,
 * `surface`) is exact, because it is the axis a reviewer scrubs on.
 */
export const SIGNIFICANT_DIGITS = 9;

/**
 * The scene context's whole operation vocabulary: three state setters, a
 * depth clear, and six draw calls. Every `op` of a conforming 3D recording is
 * a `call` whose `method` is one of these ten — producing calls belong to a
 * `Resource` recipe instead, so `ops` never holds one.
 */
export const SCENE_OP_METHODS = [
  "setCamera",
  "setLights",
  "setMode",
  "clearDepth",
  "drawMesh",
  "drawGeometry",
  "drawBillboard",
  "drawLine",
  "drawHudText",
  "drawHudRect",
] as const;

/** A method that may appear as a recorded frame operation. */
export type SceneOpMethod = (typeof SCENE_OP_METHODS)[number];

/**
 * `ops` holds a frame's calls in **issue** order, the dividers among them, so
 * a player re-derives for itself the runs the three state setters and
 * `clearDepth` cut the frame into and sorts each run's translucent draws
 * farthest-first from that run's camera. Sorting is by the distance to the
 * draw's position, and the position of a `drawLine` — the one draw with a
 * point list instead of a position — is its **first point**: a polyline has no
 * center the format carries, and the first point is one the player already
 * reads. Both engines sort a line that way; the API pages state the rule for
 * draws that have a position and stop there, so a player that picks a
 * different key reorders a frame holding several translucent lines.
 */

/**
 * The six scene-context methods that produce a value — the `make.method` of
 * every `Resource`. A producing call belongs to the recipe of the value it
 * made rather than to the frame it happened in.
 */
export const PRODUCING_METHODS = [
  "createBox",
  "createSphere",
  "createCylinder",
  "createCapsule",
  "createPlane",
  "createMaterial",
] as const;

/** A method that may appear as a resource recipe's `make.method`. */
export type ProducingMethod = (typeof PRODUCING_METHODS)[number];

/* -------------------------------------------------------------------------- */
/* Colors, lights, and the renderer state                                     */
/* -------------------------------------------------------------------------- */

/** A CSS color string, matching `background` and every other color the engine takes. */
export type Color = string;

/** How the renderer draws: `"standard"` is the lit default. */
export type RenderMode = "standard" | "wireframe" | "unlit" | "normals";

/** One light of a frame's light list, as plain data. */
export type LightState =
  | { type: "ambient"; color: Color; intensity: number }
  | { type: "directional"; color: Color; intensity: number; direction: Vec3 }
  | {
      type: "point";
      color: Color;
      intensity: number;
      position: Vec3;
      range: number;
    };

/**
 * What survives a frame boundary: the camera, the lights, and the render
 * mode, each set through the scene context and holding until set again. A
 * fresh engine's renderer state is the defaults — the default `CameraState`,
 * an empty light list, and `"standard"`.
 */
export interface RenderState {
  /** The camera in force at the top of the frame. */
  camera: CameraState;
  /** The light list in force, at most {@link LIGHT_LIMIT} entries. */
  lights: readonly LightState[];
  /** The render mode in force. */
  mode: RenderMode;
}

/* -------------------------------------------------------------------------- */
/* Values and operations                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A value carried inside a recorded operation.
 *
 * Plain data travels as itself, and the structured values the scene context
 * takes encode as their plain-data shapes: a `Vec3` as `{ x, y, z }`, a
 * `Quat` as `{ x, y, z, w }`, a `Transform` as
 * `{ position, rotation, scale }`, a `CameraState` and a `LightState` field
 * by field. `$res` names a value the scene context produced — a geometry, a
 * material — as the recipe that rebuilds it, and `$asset` names a captured
 * mesh, texture, or material, so a draw resolves wherever a reviewer lands.
 * `$opaque` names a value the recorder could not carry at all, so a player
 * skips the operation and says so rather than drawing something else.
 */
export type DrawValue =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue[]
  | { readonly $res: number }
  | { readonly $asset: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue };

/**
 * One recorded operation, performed on the scene context itself. The scene
 * context declares no assignable properties, so a conforming recording's
 * `ops` holds `call` entries alone; `set` remains part of the shared format.
 * A `set` records the value the build supplied rather than a normalized form,
 * and a call's arguments are resolved before the call is issued.
 */
export type DrawOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };

/* -------------------------------------------------------------------------- */
/* Captured assets                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A material document's texture slots — the shape the asset loader's
 * `MaterialHandle.maps` and a captured material's `maps` are both keyed by.
 */
export type MaterialMapSlot =
  | "baseColor"
  | "normal"
  | "roughness"
  | "metallic"
  | "ao"
  | "emissive"
  | "height";

/**
 * An asset the operations draw with, carried inside the recording so a replay
 * needs nothing from the run's tree. A handle is immutable and loaded once,
 * so it is keyed on identity and captured once, however many frames draw it.
 * A texture the engine rasterized itself — a text billboard — is captured the
 * same way, as a `texture` entry whose `path` is `text:` followed by the
 * string, so a player draws the lettering from the captured pixels without
 * owning the face.
 */
export type CapturedAsset =
  | { kind: "mesh"; path: string; data: string }
  | {
      kind: "texture";
      path: string;
      width: number;
      height: number;
      src: string;
    }
  | {
      kind: "material";
      path: string;
      maps: Readonly<Partial<Record<MaterialMapSlot, number>>>;
    };

/* -------------------------------------------------------------------------- */
/* Resources                                                                  */
/* -------------------------------------------------------------------------- */

/** One recipe step: a call or an assignment made on a produced value. */
export type ResourceOp =
  | { op: "call"; method: string; args: readonly DrawValue[] }
  | { op: "set"; property: string; value: DrawValue };

/**
 * A value the scene context produced: procedural geometry and materials
 * created in code, through the six {@link PRODUCING_METHODS}. A produced
 * value is immutable, so its recipe is its `make` with an empty `then` and
 * its identity is the call that made it: two producing calls with the same
 * arguments share one entry, and a value created but never used is left out.
 * The mutation machinery (`then`, `set`) remains part of the shared format.
 */
export interface Resource {
  /** The scene-context call that created the value, arguments encoded as `DrawValue`. */
  make: { method: string; args: readonly DrawValue[] };
  /** The calls and assignments made on the value before this use, in order. */
  then: readonly ResourceOp[];
}

/* -------------------------------------------------------------------------- */
/* Frames and the envelope                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One captured frame. There is no `stack` field: the scene context has no
 * `save`/`restore`, no clip, and no path machinery, so nothing beyond the
 * renderer state survives a frame boundary and nothing else needs carrying.
 */
export interface RecordedFrame {
  /** The engine's frame counter at this frame. */
  count: number;
  /** Accumulated simulated time through this frame, in milliseconds. Exact. */
  timeMs: number;
  /** What this frame was worth, in milliseconds. Exact. */
  deltaMs: number;
  /** The canvas backing store this frame was drawn into, in device pixels. */
  surface: { width: number; height: number };
  /** Index into `states` of the renderer state this frame inherited, before its own operations. */
  state: number;
  /** Indices into `ops` of the operations this frame issued, in the order it issued them. */
  ops: readonly number[];
  /** Present and `true` when the light list this frame inherited was cut down to {@link LIGHT_LIMIT}. */
  truncated?: boolean;
}

/**
 * The whole recording. `assets`, `resources`, `ops`, and `states` belong to
 * the recording rather than to any one frame: each holds every distinct entry
 * once, a frame names what it needs by index, the tables are settled when the
 * recording is closed, and every entry is one some frame names — which is
 * what makes every frame drawable from itself alone.
 *
 * `space: "3d"` routes the document to the player's 3D drawer; a 2D recording
 * carries no `space` field, so absent means 2D and one player serves every
 * engine's recordings. A player refuses a document whose `format` or `space`
 * it does not know, which is a document no recorder wrote.
 */
export interface Recording {
  /** The format version, equal to {@link RECORDING_FORMAT}. */
  format: number;
  /** `"3d"`: the document is drawn with the 3D drawer. */
  space: "3d";
  /** The logical design width the operations were issued in. */
  width: number;
  /** The logical design height the operations were issued in. */
  height: number;
  /** The CSS color each frame was cleared to, or `null` for transparency. */
  background: string | null;
  /** The meshes, textures, and materials the operations draw, by index. */
  assets: readonly CapturedAsset[];
  /** The values the scene context produced and the operations draw with, by index. */
  resources: readonly Resource[];
  /** Every distinct operation the recording holds, by index. */
  ops: readonly DrawOp[];
  /** Every distinct inherited renderer state, by index. */
  states: readonly RenderState[];
  /** The frames captured, in order. */
  frames: readonly RecordedFrame[];
}
