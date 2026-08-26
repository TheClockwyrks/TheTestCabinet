// The engine's 3D draw-command recording format, as the console reads it.
//
// A 3D recording is the list of operations a build issued against its scene
// context, frame by frame, in the order it issued them. Replaying it re-issues
// those operations against a scene of the console's own, so what a reviewer
// watches is the build's own drawing rather than a re-shoot of it — and, because
// a frame carries the renderer state it inherited and names everything else it
// needs in tables the whole recording shares, any frame can be drawn without
// drawing the frames before it.
//
// These declarations are a deliberate, structurally identical COPY of
// `packages/simple-3d/src/contract.ts` and `packages/structured-3d/src/contract.ts`
// — which are themselves the same file, carried twice — and not an import of
// either. The reason is the one stated beside the 2D copy in `format.ts`: an
// engine package is vendored into a run repo and has to stay self-contained, so
// the console taking a dependency on one would tie their release cycles
// together, and a console built today has to read a recording produced by an
// engine build it has never seen. The engines make the same argument to each
// other, which is why there are two contract files rather than a package they
// share; this module is the third copy, and the recording-parity suites beside
// it are what hold all three to the same shape.
//
// This module is likewise self-contained *within* the console: it repeats the
// half-dozen one-line predicates `format.ts` carries rather than importing them.
// The two documents are two formats that agree in places, not one format read
// two ways, and keeping the modules independent is what lets `format.ts` own the
// envelope — it imports `parse3dRecording` from here, and nothing travels back.
//
// There is one recording format and it is version 1, in 2D and in 3D alike: a 3D
// document is told apart by its `space`, not by its version. The envelope in
// `format.ts` checks both before anything here runs.

/* -------------------------------------------------------------------------- */
/* The bounds the format fixes                                                */
/* -------------------------------------------------------------------------- */

/**
 * The most lights a `RenderState3d` carries.
 *
 * A fixed part of the format rather than a choice either side makes: past it the
 * recorder cuts the inherited list down and says so on the frame, which is what
 * `truncated` means in a 3D document.
 *
 * The parser enforces it for the reason the 2D parser enforces its save stack —
 * nothing a recorder writes is refused by it, and what it protects against is a
 * document this console did not write. Every entry of a two-hundred-thousand
 * entry light list can be a well-formed light and the frame is still undrawable
 * in practice: a player applies the whole list before it draws anything, on
 * every frame that inherits the state, with the reviewer's tab frozen for all of
 * it.
 *
 * The bound cuts the retained state and not the call. A recorded `setLights`
 * carries every light the build supplied, however many, because an op records
 * the call as it was made; a player re-issuing one keeps the first
 * {@link LIGHT_LIMIT} itself, or it lights the replay by lights the engine
 * ignored.
 */
export const LIGHT_LIMIT = 64;

/**
 * The most mutation steps a resource recipe holds.
 *
 * A produced 3D value is immutable, so a conforming recipe is a `make` with an
 * empty `then` and this bound is never approached — but the mutation machinery
 * remains part of the format the two spaces share, so a player that meets a step
 * replays it, and a player that meets a hundred thousand of them refuses the
 * document instead of paying for them on every frame that draws the value.
 */
export const RECIPE_STEP_LIMIT = 1024;

/**
 * The depth past which the recorder writes `{ $opaque: … }` instead of expanding
 * a container, and so the depth a player resolves to before it gives up.
 *
 * Part of the format rather than a recorder's choice, so every recorder answers
 * the same input with the same document — and so a player can bound its own walk
 * by the same number and know that what it refused to descend into is what the
 * recorder refused to write.
 */
export const VALUE_DEPTH_LIMIT = 32;

// Three further bounds belong to the format and not to this copy: one encoded
// value expands into at most 65,536 values, captured asset bytes stop at 16 MB,
// and every number inside a value, a state, or a recipe is written to nine
// significant digits. All three are the recorder's side of the contract — a
// player meets their consequences (`{ $opaque: "truncated" }`,
// `{ $opaque: "MeshHandle" }`, a coordinate already rounded) as ordinary values
// it already knows how to read, and has nothing to check them against. Carrying
// numbers here that nothing enforces would be three more places to drift.

/**
 * The scene context's whole operation vocabulary: three state setters, a depth
 * clear, and six draw calls.
 *
 * Every operation of a conforming 3D recording is a `call` naming one of these
 * ten. It is deliberately NOT enforced when the document is read: a method
 * outside the vocabulary is one operation a player skips and reports by name,
 * beside the frame it cost, where refusing the document over it would cost the
 * reviewer the whole replay to report one call.
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
 * The six scene-context calls that produce a value a recipe can rebuild.
 *
 * A recipe is re-issued against the scene a player is drawing into, which is
 * faithful only for a call whose answer does not depend on that scene's state.
 * These six are the whole of that set — each is a pure description of a geometry
 * or a material — and a document naming any other call is refused, for the
 * reason the 2D parser refuses one: a call that read the scene back would have
 * the player draw the rest of the frame under whatever this scene happened to
 * answer, and report the frame as clean.
 *
 * `ops` never holds one of these; a producing call belongs to the recipe of the
 * value it made.
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

/** The producers as bare strings, for the check a recipe's `make` is put to. */
const PRODUCERS: readonly string[] = PRODUCING_METHODS;

/** How the renderer draws. `"standard"` is the lit default. */
export type RenderMode = "standard" | "wireframe" | "unlit" | "normals";

/** The render modes, as the parser checks a state's against them. */
const RENDER_MODES: readonly string[] = [
  "standard",
  "wireframe",
  "unlit",
  "normals",
];

/**
 * A material document's texture slots — the shape a captured material's `maps`
 * is keyed by.
 */
export type MaterialMapSlot =
  | "baseColor"
  | "normal"
  | "roughness"
  | "metallic"
  | "ao"
  | "emissive"
  | "height";

/** The slots, as the parser checks a captured material's keys against them. */
const MATERIAL_MAP_SLOTS: readonly string[] = [
  "baseColor",
  "normal",
  "roughness",
  "metallic",
  "ao",
  "emissive",
  "height",
];

/* -------------------------------------------------------------------------- */
/* The plain-data shapes an operation's values encode as                      */
/* -------------------------------------------------------------------------- */

/** A CSS colour string, as `background` and every colour an operation carries is. */
export type Color = string;

/** A point in the logical design field: a HUD position, a HUD size. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** A point or direction in world units. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** An orientation. Identity is `{ x: 0, y: 0, z: 0, w: 1 }`. */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** A placement: scale, then rotation, then translation. */
export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

/**
 * The frustum camera as a plain value.
 *
 * Aspect is not a field: the frustum's aspect is always the recording's design
 * aspect, so the picture is the same on every canvas it is drawn onto — which is
 * exactly the property that lets a reviewer's pane be a different size from the
 * one the build ran in.
 */
export interface CameraState {
  /** The camera's position in world units. */
  readonly position: Vec3;
  /** The camera's orientation. Identity looks down −Z with +Y up. */
  readonly rotation: Quat;
  /** The vertical field of view, in radians. */
  readonly fovY: number;
  /** The near plane distance, in world units. */
  readonly near: number;
  /** The far plane distance, in world units. */
  readonly far: number;
}

/** One light of a frame's light list, as plain data. */
export type LightState =
  | {
      readonly type: "ambient";
      readonly color: Color;
      readonly intensity: number;
    }
  | {
      readonly type: "directional";
      readonly color: Color;
      readonly intensity: number;
      readonly direction: Vec3;
    }
  | {
      readonly type: "point";
      readonly color: Color;
      readonly intensity: number;
      readonly position: Vec3;
      readonly range: number;
    };

/**
 * The renderer state a frame inherited from the frame before it.
 *
 * This is the whole of what survives a frame boundary in 3D, and it is what
 * makes a frame independently renderable: a build that sets its lights once
 * relies on the renderer still carrying them a thousand frames later, and a
 * player that seeks straight to that frame has no earlier frame to have
 * inherited them from. There is no save stack, no clip and no path, so a 3D
 * state is these three values and nothing else.
 */
export interface RenderState3d {
  /** The camera in force at the top of the frame. */
  readonly camera: CameraState;
  /** The light list in force, at most {@link LIGHT_LIMIT} entries. */
  readonly lights: readonly LightState[];
  /** The render mode in force. */
  readonly mode: RenderMode;
}

/* -------------------------------------------------------------------------- */
/* Values, operations, resources and assets                                   */
/* -------------------------------------------------------------------------- */

/**
 * A value carried inside a recorded operation.
 *
 * Plain data travels as itself, and the structured values the scene context
 * takes encode as their plain-data shapes: a {@link Vec3} as `{ x, y, z }`, a
 * {@link Quat} as `{ x, y, z, w }`, a {@link Transform} as
 * `{ position, rotation, scale }`, a {@link CameraState} and a
 * {@link LightState} field by field. `$res` names a value the scene context
 * produced — a geometry, a material — as the recipe that rebuilds it, and
 * `$asset` names a mesh, texture or material the recorder captured, so a draw
 * resolves wherever a reviewer lands. `$opaque` names a value the recorder could
 * not carry at all — including `{ $opaque: "truncated" }`, the remainder of a
 * container the expansion bound fell inside — so a player skips the operation
 * and says so rather than drawing something else.
 *
 * `$asset` is where this format differs from the 2D one, which names captured
 * pictures with `$img`. The two are not spellings of one thing: a 2D `$img`
 * rebuilds as something a context draws, and a 3D `$asset` may be a mesh, a
 * texture or a material.
 */
export type DrawValue3d =
  | null
  | boolean
  | number
  | string
  | readonly DrawValue3d[]
  | { readonly $res: number }
  | { readonly $asset: number }
  | { readonly $opaque: string }
  | { readonly [key: string]: DrawValue3d };

/**
 * One recorded operation.
 *
 * The scene context declares no assignable properties, so a conforming
 * recording's `ops` holds `call` entries alone — but `set` remains part of the
 * format the two spaces share, and a player that meets one applies it rather
 * than refusing the document over a shape the format allows.
 */
export type DrawOp3d =
  | {
      readonly op: "call";
      readonly method: string;
      readonly args: readonly DrawValue3d[];
    }
  | {
      readonly op: "set";
      readonly property: string;
      readonly value: DrawValue3d;
    };

/** One step in a resource's recipe, applied to the value the scene returned. */
export type ResourceOp3d = DrawOp3d;

/**
 * A value the scene context produced, carried as the recipe that rebuilds it.
 *
 * A geometry is bound to the scene that created it, so it cannot be carried as a
 * value at all: what travels is the creating call. A produced 3D value is
 * immutable, so its recipe is its `make` with an empty `then` and its identity
 * is the call that made it — two producing calls with the same arguments share
 * one entry, and a value created every frame and drawn with costs the recording
 * nothing.
 */
export interface Resource3d {
  /** The scene-context call that created the value. */
  readonly make: {
    readonly method: string;
    readonly args: readonly DrawValue3d[];
  };
  /** The calls and assignments made on the value before this use, in order. */
  readonly then: readonly ResourceOp3d[];
}

/**
 * An asset the operations draw with, carried inside the recording so a replay
 * needs nothing from the run's tree.
 *
 * A handle is immutable and loaded once, so it is captured once however many
 * frames draw it. A texture the engine rasterized itself — the lettering of a
 * text billboard — is captured the same way, as a `texture` entry whose `path`
 * is `text:` followed by the string, so a player draws the letters from the
 * captured pixels without owning the face.
 *
 * A `material` entry names its textures by index into the same table, which is
 * why the parser checks those indices against it: a material naming an entry
 * that is not a texture is one a player could only resolve to something else.
 */
export type CapturedAsset =
  | {
      /** How the value is rebuilt: as a mesh a scene draws. */
      readonly kind: "mesh";
      /** The asset path the handle was loaded from. */
      readonly path: string;
      /** The glTF binary's bytes, base64 encoded. */
      readonly data: string;
    }
  | {
      /** How the value is rebuilt: as a texture. */
      readonly kind: "texture";
      /** The asset path the handle was loaded from, or `text:` and the string. */
      readonly path: string;
      /** The decoded width in pixels. */
      readonly width: number;
      /** The decoded height in pixels. */
      readonly height: number;
      /** A `data:image/png;base64,…` URL holding the pixels. */
      readonly src: string;
    }
  | {
      /** How the value is rebuilt: as a material over textures of this table. */
      readonly kind: "material";
      /** The asset path the handle was loaded from. */
      readonly path: string;
      /** Indices into `assets` of the material's textures, by slot. */
      readonly maps: Readonly<Partial<Record<MaterialMapSlot, number>>>;
    };

/* -------------------------------------------------------------------------- */
/* Frames and the envelope                                                    */
/* -------------------------------------------------------------------------- */

/** One frame of a 3D recording. */
export interface RecordedFrame3d {
  /** The engine's frame counter at this frame. */
  readonly count: number;
  /** Accumulated simulated time through this frame, in milliseconds. */
  readonly timeMs: number;
  /** What this frame was worth, in milliseconds. */
  readonly deltaMs: number;
  /** The canvas backing store this frame was drawn into, in device pixels. */
  readonly surface: { readonly width: number; readonly height: number };
  /** Index into the recording's `states` of the state this frame inherited. */
  readonly state: number;
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  readonly ops: readonly number[];
  /**
   * Whether the light list this frame inherited was longer than the format
   * carries, and was cut down to {@link LIGHT_LIMIT}.
   *
   * A reviewer has to be able to tell a picture the format could not carry from
   * one it carried, so a frame that was cut down says so and the player reports
   * it beside everything else it could not reproduce. Present only when
   * something was in fact cut down: the flag names an exceptional frame, and
   * writing `false` on every frame of a fifty-thousand-frame recording would
   * cost bytes to say nothing.
   *
   * There is no `stack` beside it. The scene context has no `save`/`restore`, no
   * clip and no path machinery, so the renderer state above is the whole of what
   * crosses a frame boundary — which is what makes frame independence exact here
   * rather than exact-with-exceptions.
   */
  readonly truncated?: boolean;
}

/** A recorded run of 3D frames. */
export interface Recording3d {
  /** The format version a player checks before drawing anything. */
  readonly format: number;
  /** `"3d"`: the document is drawn with the 3D drawer. */
  readonly space: "3d";
  /** The logical design width the operations were issued in. */
  readonly width: number;
  /** The logical design height the operations were issued in. */
  readonly height: number;
  /** The colour each frame was cleared to, or `null` for transparency. */
  readonly background: string | null;
  /** The meshes, textures and materials the operations draw, by index. */
  readonly assets: readonly CapturedAsset[];
  /** The values the scene produced and the operations draw with, by index. */
  readonly resources: readonly Resource3d[];
  /** Every distinct operation the recording holds, by index. */
  readonly ops: readonly DrawOp3d[];
  /** Every distinct inherited renderer state, by index. */
  readonly states: readonly RenderState3d[];
  /** The frames captured, in order. */
  readonly frames: readonly RecordedFrame3d[];
}

/**
 * The outcome of reading a document the envelope has routed to this space.
 *
 * A refusal carries a sentence written for the reviewer looking at the run,
 * exactly as the 2D one does, and the envelope hands it on unchanged.
 */
export type Recording3dParse =
  | { readonly ok: true; readonly recording: Recording3d }
  | { readonly ok: false; readonly message: string };

/* -------------------------------------------------------------------------- */
/* Reading a document                                                         */
/* -------------------------------------------------------------------------- */

/** Whether a value is a plain JSON object (and so may carry named fields). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a value is a real number — JSON's `null`, strings and NaN are not. */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Whether a value is an index into a table of `length` entries. */
function isIndex(value: unknown, length: number): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < length
  );
}

/** Whether a value is a point in world units: three real numbers. */
function isVec3(value: unknown): value is Vec3 {
  return (
    isRecord(value) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.z)
  );
}

/** Whether a value is an orientation: four real numbers. */
function isQuat(value: unknown): value is Quat {
  return (
    isRecord(value) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.z) &&
    isNumber(value.w)
  );
}

/**
 * Check one operation's shape.
 *
 * The operation's *values* are deliberately not walked, for the reason the 2D
 * parser does not walk them: a `DrawValue3d` is any JSON at all, and the three
 * shapes that mean something to a player — `$res`, `$asset` and `$opaque` — are
 * recognised while drawing, where one naming a table entry this recording does
 * not carry can be reported against the operation it appeared in, beside the
 * frame it cost. What is checked here is the part a player dispatches on, so
 * drawing never has to ask whether `method` is really a string.
 *
 * The method itself is not checked against {@link SCENE_OP_METHODS} either: an
 * operation this player has no verb for is one operation skipped and named,
 * where refusing the document would cost the reviewer every frame of it.
 */
function opProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  if (value.op === "call") {
    if (typeof value.method !== "string") {
      return "is a call with no method name";
    }
    if (!Array.isArray(value.args)) {
      return `is a call to ${value.method} with no arguments list`;
    }
    return null;
  }
  if (value.op === "set") {
    if (typeof value.property !== "string") {
      return "is an assignment with no property name";
    }
    if (!("value" in value)) {
      return `is an assignment to ${value.property} with no value`;
    }
    return null;
  }
  return `is of an unknown kind (${JSON.stringify(value.op)})`;
}

/** Check one light of a state's list, returning `null` or what is wrong with it. */
function lightProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  if (
    value.type !== "ambient" &&
    value.type !== "directional" &&
    value.type !== "point"
  ) {
    return `is of an unknown kind (${JSON.stringify(value.type)})`;
  }
  if (typeof value.color !== "string" || !isNumber(value.intensity)) {
    return "does not say what colour it burns at, or how brightly";
  }
  // Each kind carries the placement its light needs and the others do not, and
  // which one is checked is the whole of what `type` decides here: a directional
  // light is a direction, a point light is a position and a reach, and an
  // ambient light is neither.
  if (value.type === "directional" && !isVec3(value.direction)) {
    return "is a directional light that shines in no direction";
  }
  if (value.type === "point") {
    if (!isVec3(value.position)) return "is a point light that sits nowhere";
    if (!isNumber(value.range)) return "is a point light with no reach";
  }
  return null;
}

/** Check one camera, returning `null` or what is wrong with it. */
function cameraProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  if (!isVec3(value.position)) return "sits at no position";
  if (!isQuat(value.rotation)) return "faces in no direction";
  if (!isNumber(value.fovY) || !isNumber(value.near) || !isNumber(value.far)) {
    return "does not say how much of the world it sees";
  }
  return null;
}

/** Check one inherited renderer state, returning `null` or what is wrong with it. */
function stateProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  const camera = cameraProblem(value.camera);
  if (camera !== null) return `carries a camera that ${camera}`;
  if (!Array.isArray(value.lights)) return "carries no light list";
  if (value.lights.length > LIGHT_LIMIT) {
    return `carries ${value.lights.length} lights, more than the ${LIGHT_LIMIT} this format carries, so it was not written by a recorder`;
  }
  for (let i = 0; i < value.lights.length; i += 1) {
    const problem = lightProblem(value.lights[i]);
    if (problem !== null) return `has a light (${i}) that ${problem}`;
  }
  if (typeof value.mode !== "string" || !RENDER_MODES.includes(value.mode)) {
    return `was drawn in a render mode this player does not have (${JSON.stringify(value.mode)})`;
  }
  return null;
}

/**
 * Check one captured asset against the table it belongs to, returning `null` or
 * what is wrong with it.
 *
 * The table is needed because a material names its textures by index into it. An
 * index checked here rather than at the draw is what makes resolving a material
 * total: a player builds one from entries it already knows are textures.
 */
function assetProblem(
  value: unknown,
  assets: readonly unknown[],
): string | null {
  if (!isRecord(value)) return "is not an object";
  if (
    value.kind !== "mesh" &&
    value.kind !== "texture" &&
    value.kind !== "material"
  ) {
    return `does not say how it is rebuilt (${JSON.stringify(value.kind)})`;
  }
  if (typeof value.path !== "string") {
    return "does not say what it was loaded from";
  }
  if (value.kind === "mesh") {
    if (typeof value.data !== "string") return "carries no mesh";
    return null;
  }
  if (value.kind === "texture") {
    if (!isNumber(value.width) || !isNumber(value.height)) {
      return "does not say what size it is";
    }
    if (typeof value.src !== "string") return "carries no pixels";
    return null;
  }
  const maps = value.maps;
  if (!isRecord(maps)) return "names no texture slots";
  for (const [slot, at] of Object.entries(maps)) {
    if (!MATERIAL_MAP_SLOTS.includes(slot)) {
      return `names a texture slot this format does not carry (${JSON.stringify(slot)})`;
    }
    if (!isIndex(at, assets.length)) {
      return `names asset ${JSON.stringify(at)} as its ${slot} map, which this replay does not carry`;
    }
    const named = assets[at];
    if (!isRecord(named) || named.kind !== "texture") {
      return `names asset ${at} as its ${slot} map, which is not a texture`;
    }
  }
  return null;
}

/** Check one resource recipe, returning `null` or what is wrong with it. */
function resourceProblem(value: unknown): string | null {
  if (!isRecord(value)) return "is not an object";
  const make = value.make;
  if (!isRecord(make)) return "does not say what call created it";
  if (typeof make.method !== "string") {
    return "was created by a call with no method name";
  }
  if (!PRODUCERS.includes(make.method)) {
    return `names ${make.method} as the call that created it, which does not produce a value this player may rebuild`;
  }
  if (!Array.isArray(make.args)) {
    return `was created by a call to ${make.method} with no arguments list`;
  }
  if (!Array.isArray(value.then)) return "carries no list of steps";
  if (value.then.length > RECIPE_STEP_LIMIT) {
    return `carries ${value.then.length} steps, more than the ${RECIPE_STEP_LIMIT} this format carries, so it was not written by a recorder`;
  }
  for (const step of value.then) {
    const problem = opProblem(step);
    if (problem !== null) return `has a step that ${problem}`;
  }
  return null;
}

/**
 * Check one frame's shape against the tables it indexes into.
 *
 * An index outside a table is as damaging as a malformed operation and is
 * reported the same way: the frame names something the recording does not carry,
 * so the picture it would draw is not the one that was recorded.
 *
 * A field this format does not know is ignored rather than refused — a frame
 * that carried a 2D document's `stack` would be read as the 3D frame it says it
 * is, and drawn from its own state.
 */
function frameProblem(
  value: unknown,
  states: number,
  ops: number,
): string | null {
  if (!isRecord(value)) return "is not an object";
  if (!isNumber(value.count)) return "has no frame counter";
  if (!isNumber(value.timeMs) || !isNumber(value.deltaMs)) {
    return "has no timing";
  }
  const surface = value.surface;
  if (
    !isRecord(surface) ||
    !isNumber(surface.width) ||
    !isNumber(surface.height)
  ) {
    return "does not say what surface it was drawn into";
  }
  if (!isIndex(value.state, states)) {
    return `names inherited state ${JSON.stringify(value.state)}, which this replay does not carry, so it cannot be drawn on its own`;
  }
  if (!Array.isArray(value.ops)) return "has no operations list";
  for (const index of value.ops) {
    if (!isIndex(index, ops)) {
      return `names operation ${JSON.stringify(index)}, which this replay does not carry`;
    }
  }
  // Absent on every frame the recorder had room for, so it is checked only when
  // it is there. A frame carrying something else under the name is a document
  // that means something by it this player does not, which is the case the shape
  // checks exist to catch.
  if (value.truncated !== undefined && typeof value.truncated !== "boolean") {
    return `says it was truncated as ${JSON.stringify(value.truncated)}, which is neither true nor absent`;
  }
  return null;
}

/**
 * Read a document the envelope has routed to the 3D drawer, or refuse it.
 *
 * The version and the space are already settled: `parseRecording` in `format.ts`
 * establishes that this is a JSON object stating the one recording format and
 * the space `"3d"`, and calls this with it. Everything here is a shape check
 * over the fields a player dispatches on — the shared tables, and each frame's
 * indices into them — so drawing a frame is total: it never has to ask whether
 * the thing it is about to replay is really an operation.
 *
 * The tables are checked before the frames, because a frame is checked against
 * their lengths: an index is only in range once there is a table to be in range
 * of. The asset table comes first among them for the same reason one step down —
 * a captured material names its textures by index into it.
 */
export function parse3dRecording(
  data: Record<string, unknown>,
): Recording3dParse {
  if (!isNumber(data.width) || !isNumber(data.height)) {
    return {
      ok: false,
      message:
        "This replay does not say what size it was drawn at, so it cannot be played.",
    };
  }
  const background = data.background;
  // Transparency is written as an explicit `null`, so an absent field is a
  // document that does not state what its frames were cleared to rather than one
  // saying they were cleared to nothing. Reading the two as the same thing draws
  // every frame of a recording that lost the field over a transparent page,
  // which is a different picture told as a clean one.
  if (background === undefined) {
    return {
      ok: false,
      message:
        "This replay does not say what its frames were cleared to, so it cannot be played.",
    };
  }
  if (background !== null && typeof background !== "string") {
    return {
      ok: false,
      message:
        "This replay's background is not a colour, so it cannot be played.",
    };
  }

  const assets = data.assets;
  if (!Array.isArray(assets)) {
    return {
      ok: false,
      message:
        "This replay is damaged: it carries no asset table, so its frames cannot be drawn.",
    };
  }
  for (let i = 0; i < assets.length; i += 1) {
    const problem = assetProblem(assets[i], assets);
    if (problem !== null) {
      return {
        ok: false,
        message: `This replay is damaged: asset ${i} ${problem}.`,
      };
    }
  }

  const tables: Array<[string, unknown, (entry: unknown) => string | null]> = [
    ["resource", data.resources, resourceProblem],
    ["operation", data.ops, opProblem],
    ["state", data.states, stateProblem],
  ];
  for (const [noun, table, problemOf] of tables) {
    if (!Array.isArray(table)) {
      return {
        ok: false,
        message: `This replay is damaged: it carries no ${noun} table, so its frames cannot be drawn.`,
      };
    }
    for (let i = 0; i < table.length; i += 1) {
      const problem = problemOf(table[i]);
      if (problem !== null) {
        return {
          ok: false,
          message: `This replay is damaged: ${noun} ${i} ${problem}.`,
        };
      }
    }
  }

  if (!Array.isArray(data.frames)) {
    return {
      ok: false,
      message: "This replay carries no frames, so there is nothing to play.",
    };
  }
  const states = data.states as unknown[];
  const ops = data.ops as unknown[];
  for (let i = 0; i < data.frames.length; i += 1) {
    const problem = frameProblem(data.frames[i], states.length, ops.length);
    if (problem !== null) {
      return {
        ok: false,
        message: `This replay is damaged: frame ${i} ${problem}.`,
      };
    }
  }

  return {
    ok: true,
    recording: {
      format: data.format as number,
      space: "3d",
      width: data.width,
      height: data.height,
      background,
      assets: assets as readonly CapturedAsset[],
      resources: data.resources as readonly Resource3d[],
      ops: ops as readonly DrawOp3d[],
      states: states as readonly RenderState3d[],
      frames: data.frames as readonly RecordedFrame3d[],
    },
  };
}
