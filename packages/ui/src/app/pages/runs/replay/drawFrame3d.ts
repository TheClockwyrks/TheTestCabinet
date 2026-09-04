// Drawing one frame of a 3D recording.
//
// This is the 3D half of `drawFrame.ts`, and it is the same function under a
// different vocabulary: a pure function of (scene, recording, resources,
// frame) that takes the frame it is asked for, applies the renderer state that
// frame inherited, and re-issues that frame's operations. It NEVER draws the
// frames before it. In 3D that property is exact with no exceptions clause —
// there is no save stack, no clip and no path, so the whole of what crosses a
// frame boundary is the camera, the light list and the render mode — which is
// why seeking to frame 900 costs what drawing frame 900 costs, and why two
// recordings can be scrubbed side by side in step.
//
// A frame refers to two kinds of value it cannot carry inline, and both
// resolve from tables the whole recording shares rather than from the frames
// around it:
//
//   * A value the scene context produced — a geometry, a material — travels as
//     the recipe that rebuilt it. It is REBUILT rather than looked up, because
//     such a value is bound to the scene that created it, so the recipe is
//     issued against the scene being drawn into and the result is memoised for
//     the rest of this frame. A material created on frame 1 and drawn with
//     ever since is therefore drawn on frame 900 under the spec it actually
//     had.
//   * A mesh, a texture or a material document travels as captured bytes.
//     Decoding one is asynchronous and drawing a frame is not, so the whole
//     table is decoded once by `prepareRecording3d` and handed in here already
//     decoded.
//
// What this file does NOT do is put pixels anywhere. Everything it resolves is
// issued at a `SceneDrawer3d` (see `sceneDrawer3d.ts`), which is the seam the
// three.js implementation sits behind — so the ordering rules, the resolution
// rules and the reporting are all testable with no GPU in the room, exactly as
// the 2D drawer's injectable image decoder makes decoding testable.
//
// The one thing the drawer decides that the 2D drawer does not is ORDER. The
// scene context's state setters and its depth clear divide a frame's draws
// into runs, and within a run the translucent draws follow the opaque ones,
// farthest-first from that run's camera, ties holding issue order; the HUD
// composites last across the whole frame. Those rules are the engine's
// (`engines/simple-3d/apis/game.md`, "Draw order"), the picture depends on
// them, and putting them here rather than in the renderer is what lets a test
// assert the order a frame composites in.
//
// What still cannot be reproduced — a value the recorder could not carry, an
// asset that would not decode, a verb this player does not have, a light list
// the format had to cut down — is skipped and counted rather than guessed at,
// so the player can tell the reviewer which part of the picture is missing
// instead of quietly drawing a different one.

import type { ReplayFrameReport } from "./drawFrame";
import { LIGHT_LIMIT, VALUE_DEPTH_LIMIT } from "./format3d";
import type {
  CameraState,
  CapturedAsset,
  Color,
  DrawOp3d,
  DrawValue3d,
  LightState,
  Quat,
  RecordedFrame3d,
  Recording3d,
  RenderMode,
  Resource3d,
  Transform,
  Vec2,
  Vec3,
} from "./format3d";
import {
  HUD_TEXT_DEFAULTS,
  MATERIAL_DEFAULTS,
  colorAlpha,
  type DecodedAsset,
  type DecodedMaterialAsset,
  type DecodedMesh,
  type DecodedTexture,
  type ResolvedHudTextOptions,
  type ResolvedMaterial,
  type ResolvedMeshOptions,
  type SceneDrawer3d,
  type Surface3d,
} from "./sceneDrawer3d";

/* -------------------------------------------------------------------------- */
/* What the player says about what it could not draw                          */
/* -------------------------------------------------------------------------- */

/** What to say about an asset the player has nothing to draw. */
const UNDECODED_ASSET = "an asset that could not be decoded";

/** What to say about a reference to a table entry the recording does not hold. */
const MISSING_ENTRY = "a value this replay does not carry";

/** What to say about a recipe that names itself. */
const CIRCULAR_RESOURCE = "a value whose recipe refers to itself";

/** What to say about a frame whose inherited state is not in the recording. */
const MISSING_STATE = "the state this frame inherited";

/** What to say about a value nested deeper than the format allows. */
const TOO_DEEP = "a value nested deeper than this format carries";

/**
 * What to say about a frame whose recorder ran out of room.
 *
 * Written as the cause, because the reviewer can act on it: the picture is lit
 * by the first sixty-four lights of a longer list, so it is close to the
 * build's and is not it, and what to do about that is to look at a build that
 * sets more lights than the format carries rather than to distrust the player.
 */
const TRUNCATED = "a light list longer than this format carries";

/**
 * The renderer state a frame is drawn under when the recording does not carry
 * the state it named.
 *
 * Unreachable through `parseRecording` — a frame naming a state outside the
 * table is refused there — so this is for a document assembled by hand. The
 * defaults are a fresh engine's (`apis/viewport.md`, `apis/recording.md`): the
 * frame is reported as having lost the state it inherited, and its own
 * operations still draw, which is more use to a reviewer than a blank pane.
 */
const DEFAULT_STATE = {
  camera: {
    position: { x: 0, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    fovY: Math.PI / 3,
    near: 0.1,
    far: 1000,
  },
  lights: [] as readonly LightState[],
  mode: "standard" as RenderMode,
};

/* -------------------------------------------------------------------------- */
/* Decoding a recording's assets                                              */
/* -------------------------------------------------------------------------- */

/**
 * How a captured mesh or texture is turned into something the scene can draw.
 *
 * The whole decoder is injectable, and unlike the 2D one it has no default:
 * decoding a glTF binary or a PNG into scene objects is the substrate's job,
 * the substrate is three.js, and three has no business in this module (see the
 * note at the top). `threeSceneDrawer.ts` supplies the real one; a test
 * supplies whatever it wants to draw with.
 *
 * A material entry is not passed here. It carries no bytes of its own — it
 * names textures of the same table by index — so it is assembled from the
 * decoded textures below rather than decoded.
 */
export type Asset3dDecoder = (
  asset: Extract<CapturedAsset, { kind: "mesh" | "texture" }>,
) => Promise<DecodedMesh | DecodedTexture>;

/**
 * Everything a 3D recording needs decoded before any of its frames can be
 * drawn.
 *
 * Only the assets are here. A value the scene context produced is rebuilt
 * against the scene it is drawn into, so it cannot be prepared ahead of a
 * particular renderer and is built inside `drawFrame3d` instead.
 */
export interface Replay3dResources {
  /** `recording.assets`, decoded, by index — `null` where decoding failed. */
  readonly assets: readonly (DecodedAsset | null)[];
}

/**
 * Decode everything a recording's frames will need, before playback starts.
 *
 * Every entry is decoded, once, whether or not the frame the reviewer lands on
 * draws it — a scrub bar goes anywhere, and decoding on demand would make the
 * first visit to a frame cost more than the ones after it. An entry that will
 * not decode resolves to `null` rather than failing the recording: a replay
 * missing one mesh is worth watching, and the operations that name it are
 * skipped and reported like any other value the player cannot reproduce.
 *
 * Materials are assembled after the rest, because a material names its
 * textures by index into the same table. `parse3dRecording` has already
 * established that each of those indices is in range and names a texture
 * entry, so the only thing that can go wrong here is a texture that did not
 * decode — and a material missing one of its maps is a material that paints a
 * different surface, so the whole entry fails rather than the slot. The
 * operations naming it then report an asset that could not be decoded, which
 * is what happened.
 */
export async function prepareRecording3d(
  recording: Recording3d,
  decode: Asset3dDecoder,
): Promise<Replay3dResources> {
  const decoded: (DecodedAsset | null)[] = await Promise.all(
    recording.assets.map(async (asset) => {
      if (asset.kind === "material") return null;
      try {
        return await decode(asset);
      } catch {
        return null;
      }
    }),
  );

  recording.assets.forEach((asset, index) => {
    if (asset.kind !== "material") return;
    const maps: Partial<Record<string, DecodedTexture>> = {};
    for (const [slot, at] of Object.entries(asset.maps)) {
      const texture = decoded[at as number];
      if (texture === null || texture === undefined) return;
      if (texture.kind !== "texture") return;
      maps[slot] = texture;
    }
    decoded[index] = {
      kind: "material",
      path: asset.path,
      maps,
    } as DecodedMaterialAsset;
  });

  return { assets: decoded };
}

/* -------------------------------------------------------------------------- */
/* Resolving what a frame refers to                                           */
/* -------------------------------------------------------------------------- */

/** A value resolved into something a draw can be issued with, or why it could not be. */
type Resolution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * A value one of the six producers made: what the scene handed back, and what
 * the drawer has to know about it.
 *
 * The drawer keeps the resolved material beside the handle because whether a
 * draw is translucent — the whole of its place in the frame's order — is
 * decided by the material's opacity, and the handle is opaque by design.
 */
type Produced3d =
  | { readonly kind: "geometry"; readonly handle: unknown }
  | {
      readonly kind: "material";
      readonly material: ResolvedMaterial;
      readonly handle: unknown;
    };

/** Whether a resolved value is one a producer made. */
function isProduced(value: unknown): value is Produced3d {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "handle" in value &&
    ((value as Produced3d).kind === "geometry" ||
      (value as Produced3d).kind === "material")
  );
}

/** What is needed to resolve this frame's references, and what has been resolved. */
interface Scope {
  /** The scene being drawn into — what a recipe's producing call is issued against. */
  readonly scene: SceneDrawer3d;
  readonly recording: Recording3d;
  readonly resources: Replay3dResources;
  /**
   * Resources built for THIS frame, by index, successes and failures alike.
   *
   * Memoising the failures matters as much as memoising the successes: a
   * recipe this scene refuses is refused identically every time it is named,
   * and a frame that draws a hundred crates with one box should build one.
   */
  readonly built: Map<number, Resolution>;
}

/**
 * Resolve one recorded value into something a draw can be issued with.
 *
 * Plain data resolves to itself, an `$asset` to the decoded mesh, texture or
 * material it names, a `$res` to the value its recipe rebuilds, and an
 * `$opaque` to a refusal carrying the type the recorder could not carry.
 * Arrays and objects resolve element by element and fail whole: an options bag
 * with one unreproducible field in it would make the call mean something
 * different, so the call is skipped rather than issued with a hole in it.
 *
 * `depth` bounds the walk at the format's own nesting limit, and the check
 * guards the EXPANSION of a container rather than the lookup of a marker — so
 * the `{ $opaque: … }` a recorder writes at the bottom of a structure it
 * refused to expand still resolves to a refusal naming the type, which is the
 * more useful of the two sentences.
 */
function resolve(value: DrawValue3d, scope: Scope, depth: number): Resolution {
  if (value === null || typeof value !== "object") return { ok: true, value };

  if (Array.isArray(value)) {
    if (depth >= VALUE_DEPTH_LIMIT) return { ok: false, reason: TOO_DEEP };
    const resolved = resolveAll(
      value as readonly DrawValue3d[],
      scope,
      depth + 1,
    );
    if (!resolved.ok) return resolved;
    return { ok: true, value: resolved.values };
  }

  const record = value as { readonly [key: string]: DrawValue3d };
  if ("$opaque" in record) {
    const name = record.$opaque;
    return {
      ok: false,
      reason: typeof name === "string" ? name : "an unrecordable value",
    };
  }
  if ("$asset" in record) {
    const index = record.$asset;
    if (typeof index !== "number") return { ok: false, reason: MISSING_ENTRY };
    if (index < 0 || index >= scope.resources.assets.length) {
      return { ok: false, reason: MISSING_ENTRY };
    }
    const asset = scope.resources.assets[index];
    if (asset === null || asset === undefined) {
      return { ok: false, reason: UNDECODED_ASSET };
    }
    return { ok: true, value: asset };
  }
  // Everything from here expands: a recipe is issued and its own arguments are
  // resolved, a plain object is walked field by field. `$opaque` and `$asset`
  // above are lookups, which is why the bound sits between them.
  if (depth >= VALUE_DEPTH_LIMIT) return { ok: false, reason: TOO_DEEP };

  if ("$res" in record) {
    const index = record.$res;
    if (typeof index !== "number") return { ok: false, reason: MISSING_ENTRY };
    // A recipe's own arguments may name further resources, so a chain counts
    // against the same bound as a nest of arrays: without that, a document
    // whose recipes name each other twenty thousand deep is the `RangeError`
    // this bound exists to prevent, arriving by another route.
    return build(index, scope, depth + 1);
  }

  // Built without a prototype, because a recorded object may carry a
  // "__proto__" key: assigned onto an ordinary object that key reaches the
  // prototype setter instead of becoming a field, and the call would be issued
  // with the field missing rather than with the value the build passed.
  const resolved = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    const field = resolve(entry, scope, depth + 1);
    if (!field.ok) return field;
    resolved[key] = field.value;
  }
  return { ok: true, value: resolved };
}

/** Resolve a list of values, failing whole on the first one that cannot be. */
function resolveAll(
  values: readonly DrawValue3d[],
  scope: Scope,
  depth: number,
):
  | { readonly ok: true; readonly values: unknown[] }
  | { readonly ok: false; readonly reason: string } {
  const resolved: unknown[] = [];
  for (const value of values) {
    const entry = resolve(value, scope, depth);
    if (!entry.ok) return entry;
    resolved.push(entry.value);
  }
  return { ok: true, values: resolved };
}

/**
 * Build the resource at `index` against the scene this frame is being drawn
 * into, or say why it could not be.
 *
 * The index is marked as in progress before the recipe's own arguments are
 * resolved, so a recipe that names itself is refused instead of recurring.
 */
function build(index: number, scope: Scope, depth: number): Resolution {
  const memo = scope.built.get(index);
  if (memo !== undefined) return memo;
  const recipe = scope.recording.resources[index];
  if (recipe === undefined) return { ok: false, reason: MISSING_ENTRY };
  scope.built.set(index, { ok: false, reason: CIRCULAR_RESOURCE });
  const outcome = make(recipe, scope, depth);
  scope.built.set(index, outcome);
  return outcome;
}

/**
 * Issue a recipe's producing call against the scene, then apply the steps it
 * carries, in order.
 *
 * The call is one of the six producers, because `parse3dRecording` has already
 * refused every document naming anything else. That check belongs there rather
 * than here, for the reason the 2D parser gives: a recipe re-issued against the
 * scene being drawn into is faithful only for a call whose answer is
 * independent of that scene, and each of the six is a pure description of a
 * geometry or a material.
 *
 * A produced 3D value is immutable, so a conforming recipe's `then` is empty —
 * but the mutation machinery remains part of the format the two spaces share,
 * so a step that is there is replayed against the handle the scene answered,
 * exactly as the 2D drawer replays a gradient's colour stops. A step that does
 * not land fails the whole resource: a value built half way is a value that
 * paints a different picture.
 */
function make(recipe: Resource3d, scope: Scope, depth: number): Resolution {
  const args = resolveAll(recipe.make.args, scope, depth);
  if (!args.ok) return args;
  const method = recipe.make.method;
  const refused = { ok: false as const, reason: `${method}()` };

  let produced: Produced3d;
  try {
    const values = args.values;
    if (method === "createMaterial") {
      const material = resolvedMaterialFrom(values[0]);
      if (material === null) return refused;
      const handle = scope.scene.createMaterial(material);
      if (handle === null || handle === undefined) return refused;
      produced = { kind: "material", material, handle };
    } else {
      const handle = makeGeometry(method, values, scope.scene);
      // A producing call that answers nothing could not make the value —
      // drawing with the nothing it answered is worse than skipping the draw,
      // because a scene handed nothing draws whatever it was already drawing
      // with and the frame reports itself clean.
      if (handle === null || handle === undefined) return refused;
      produced = { kind: "geometry", handle };
    }
  } catch {
    return refused;
  }

  for (const step of recipe.then) {
    const reason = perform(produced.handle, step, scope, depth);
    if (reason !== null) return { ok: false, reason };
  }
  return { ok: true, value: produced };
}

/** Issue one of the five geometry producers, or answer `null` for arguments it cannot take. */
function makeGeometry(
  method: string,
  args: readonly unknown[],
  scene: SceneDrawer3d,
): unknown {
  if (method === "createBox") {
    const size = asVec3(args[0]);
    return size === null ? null : scene.createBox(size);
  }
  if (method === "createSphere") {
    const radius = asNumber(args[0]);
    return radius === null ? null : scene.createSphere(radius);
  }
  if (method === "createCylinder") {
    const radius = asNumber(args[0]);
    const height = asNumber(args[1]);
    return radius === null || height === null
      ? null
      : scene.createCylinder(radius, height);
  }
  if (method === "createCapsule") {
    const radius = asNumber(args[0]);
    const height = asNumber(args[1]);
    return radius === null || height === null
      ? null
      : scene.createCapsule(radius, height);
  }
  if (method === "createPlane") {
    const width = asNumber(args[0]);
    const depth = asNumber(args[1]);
    return width === null || depth === null
      ? null
      : scene.createPlane(width, depth);
  }
  return null;
}

/**
 * Whether `property` may be assigned on `subject` at all.
 *
 * The short form of `drawFrame.ts`'s `assignable`, and for the same reason: a
 * recorded assignment names whatever the build assigned, and performing
 * `__proto__ = null` on the value being drawn with costs more than the
 * operation. The walk stops before `Object.prototype`, which is the line
 * between a property the subject really carries and one reached by falling
 * through to the root object.
 *
 * Nothing a conforming 3D recorder writes reaches here — produced 3D values are
 * immutable and the scene context declares no assignable properties — so this
 * is what a document from somewhere else meets.
 */
function assignable(subject: object, property: string): boolean {
  let host: object | null = subject;
  while (host !== null && host !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(host, property);
    if (descriptor !== undefined) {
      if (descriptor.get !== undefined || descriptor.set !== undefined) {
        return typeof descriptor.set === "function";
      }
      return descriptor.writable === true;
    }
    host = Object.getPrototypeOf(host) as object | null;
  }
  return false;
}

/**
 * Perform one step of a recipe against the value the scene produced, returning
 * `null` or the reason it was not performed.
 */
function perform(
  subject: unknown,
  op: DrawOp3d,
  scope: Scope,
  depth: number,
): string | null {
  const named =
    op.op === "set" ? `the ${op.property} property` : `${op.method}()`;
  if (subject === null || subject === undefined) return named;
  if (typeof subject !== "object" && typeof subject !== "function") {
    return named;
  }
  const host = subject as Record<string, unknown>;

  if (op.op === "set") {
    if (!assignable(host, op.property)) return named;
    const value = resolve(op.value, scope, depth);
    if (!value.ok) return value.reason;
    try {
      host[op.property] = value.value;
    } catch {
      return named;
    }
    return null;
  }

  const args = resolveAll(op.args, scope, depth);
  if (!args.ok) return args.reason;
  const method = host[op.method];
  if (typeof method !== "function") return named;
  try {
    (method as (...rest: unknown[]) => unknown).apply(subject, args.values);
  } catch {
    return named;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Reading a resolved argument                                                */
/* -------------------------------------------------------------------------- */

// Shape checks over already-resolved values. Two rules run through all of them.
//
// The first is that a NON-FINITE number is a shape the format carries, not a
// malformed argument: "A draw call carrying a non-finite number in a transform,
// position, size, or point draws nothing for that call … The call is still
// recorded" (`apis/game.md`). The build drew nothing and reported nothing, so
// the player draws nothing and reports nothing — which means these checks ask
// whether a field is a number, not whether it is a finite one, and the scene
// implementation is what declines to draw an infinite box.
//
// The second is that a value that is the WRONG SHAPE is reported under the
// verb that carried it ("drawMesh()"), the same sentence the 2D drawer writes
// for a call its context refused. Nothing a recorder writes is the wrong shape.

/** Whether a resolved value is a record with named fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A number, finite or not, or `null` for a value that is not one. */
function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** A CSS colour string, or `null`. */
function asColor(value: unknown): Color | null {
  return typeof value === "string" ? value : null;
}

/** A point in the logical field, or `null`. */
function asVec2(value: unknown): Vec2 | null {
  if (!isRecord(value)) return null;
  if (typeof value.x !== "number" || typeof value.y !== "number") return null;
  return { x: value.x, y: value.y };
}

/** A point or direction in world units, or `null`. */
function asVec3(value: unknown): Vec3 | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.z !== "number"
  ) {
    return null;
  }
  return { x: value.x, y: value.y, z: value.z };
}

/** An orientation, or `null`. */
function asQuat(value: unknown): Quat | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.x !== "number" ||
    typeof value.y !== "number" ||
    typeof value.z !== "number" ||
    typeof value.w !== "number"
  ) {
    return null;
  }
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

/** A placement, or `null`. */
function asTransform(value: unknown): Transform | null {
  if (!isRecord(value)) return null;
  const position = asVec3(value.position);
  const rotation = asQuat(value.rotation);
  const scale = asVec3(value.scale);
  if (position === null || rotation === null || scale === null) return null;
  return { position, rotation, scale };
}

/** A camera, or `null`. */
function asCamera(value: unknown): CameraState | null {
  if (!isRecord(value)) return null;
  const position = asVec3(value.position);
  const rotation = asQuat(value.rotation);
  const fovY = asNumber(value.fovY);
  const near = asNumber(value.near);
  const far = asNumber(value.far);
  if (position === null || rotation === null) return null;
  if (fovY === null || near === null || far === null) return null;
  return { position, rotation, fovY, near, far };
}

/** One light, or `null`. Each kind carries the placement its light needs. */
function asLight(value: unknown): LightState | null {
  if (!isRecord(value)) return null;
  const color = asColor(value.color);
  const intensity = asNumber(value.intensity);
  if (color === null || intensity === null) return null;
  if (value.type === "ambient") return { type: "ambient", color, intensity };
  if (value.type === "directional") {
    const direction = asVec3(value.direction);
    if (direction === null) return null;
    return { type: "directional", color, intensity, direction };
  }
  if (value.type === "point") {
    const position = asVec3(value.position);
    const range = asNumber(value.range);
    if (position === null || range === null) return null;
    return { type: "point", color, intensity, position, range };
  }
  return null;
}

/** A whole light list, or `null` if any entry is not a light. */
function asLights(value: unknown): readonly LightState[] | null {
  if (!Array.isArray(value)) return null;
  const lights: LightState[] = [];
  for (const entry of value) {
    const light = asLight(entry);
    if (light === null) return null;
    lights.push(light);
  }
  return lights;
}

/** A render mode, or `null` for a value outside the four. */
function asMode(value: unknown): RenderMode | null {
  return value === "standard" ||
    value === "wireframe" ||
    value === "unlit" ||
    value === "normals"
    ? value
    : null;
}

/** A polyline's points, or `null` if any entry is not a point. */
function asPoints(value: unknown): readonly Vec3[] | null {
  if (!Array.isArray(value)) return null;
  const points: Vec3[] = [];
  for (const entry of value) {
    const point = asVec3(entry);
    if (point === null) return null;
    points.push(point);
  }
  return points;
}

/** A decoded asset of one kind, or `null`. */
function asMesh(value: unknown): DecodedMesh | null {
  return isRecord(value) && value.kind === "mesh"
    ? (value as unknown as DecodedMesh)
    : null;
}

/** A decoded texture, or `null`. */
function asTexture(value: unknown): DecodedTexture | null {
  return isRecord(value) && value.kind === "texture"
    ? (value as unknown as DecodedTexture)
    : null;
}

/**
 * A `MaterialSpec`'s resolved form, with the engine's defaults filled in.
 *
 * A field of the wrong type refuses the whole spec rather than falling back to
 * its default: the recorder wrote what the build passed, so a `roughness` that
 * is not a number is a document this player did not write, and quietly
 * substituting `0.8` would draw a surface nobody asked for.
 */
function resolvedMaterialFrom(value: unknown): ResolvedMaterial | null {
  if (!isRecord(value)) return null;
  const material: {
    -readonly [K in keyof ResolvedMaterial]: ResolvedMaterial[K];
  } = { ...MATERIAL_DEFAULTS };
  const strings = ["baseColor", "emissive"] as const;
  for (const name of strings) {
    if (value[name] === undefined) continue;
    const color = asColor(value[name]);
    if (color === null) return null;
    material[name] = color;
  }
  const numbers = ["roughness", "metallic", "opacity"] as const;
  for (const name of numbers) {
    if (value[name] === undefined) continue;
    const number = asNumber(value[name]);
    if (number === null) return null;
    material[name] = number;
  }
  if (value.unlit !== undefined) {
    if (typeof value.unlit !== "boolean") return null;
    material.unlit = value.unlit;
  }
  const maps = ["baseColorMap", "normalMap"] as const;
  for (const name of maps) {
    if (value[name] === undefined) continue;
    const texture = asTexture(value[name]);
    if (texture === null) return null;
    material[name] = texture;
  }
  return material;
}

/**
 * Whatever the scene context takes as a material, resolved the way the engine
 * resolves one (`scene.ts`'s `resolveMaterial`).
 *
 * A colour string is shorthand for a lit material of that base colour with the
 * spec's defaults. A produced material is the spec it was created from. A
 * loaded material document is its base-colour and normal slots over the same
 * defaults — the other five slots the format carries are captured but not
 * drawn, by the engine and so by this player.
 */
function asMaterial(value: unknown): ResolvedMaterial | null {
  const color = asColor(value);
  if (color !== null) return { ...MATERIAL_DEFAULTS, baseColor: color };
  if (isProduced(value)) {
    return value.kind === "material" ? value.material : null;
  }
  if (isRecord(value) && value.kind === "material") {
    const asset = value as unknown as DecodedMaterialAsset;
    return {
      ...MATERIAL_DEFAULTS,
      baseColorMap: asset.maps.baseColor ?? null,
      normalMap: asset.maps.normal ?? null,
    };
  }
  return null;
}

/** A `drawMesh`'s options, or `null` for an options bag this format does not carry. */
function asMeshOptions(
  value: unknown,
  mesh: DecodedMesh,
): ResolvedMeshOptions | null {
  if (value === undefined) {
    return { material: null, clip: null, clipTime: 0 };
  }
  if (!isRecord(value)) return null;
  let material: ResolvedMaterial | null = null;
  if (value.material !== undefined) {
    material = asMaterial(value.material);
    if (material === null) return null;
  }
  let clip: string | null = null;
  if (value.clip !== undefined) {
    if (typeof value.clip !== "string") return null;
    // The engine refuses a clip the mesh does not carry, loudly, before the
    // call is recorded — so a recording naming one is a document no build
    // produced, and posing the rest pose instead would be the player inventing
    // a picture. Reported, like every other thing it cannot reproduce.
    if (!mesh.clips.includes(value.clip)) return null;
    clip = value.clip;
  }
  let clipTime = 0;
  if (value.clipTime !== undefined) {
    const time = asNumber(value.clipTime);
    if (time === null) return null;
    clipTime = time;
  }
  return { material, clip, clipTime };
}

/** A `drawHudText`'s options, or `null`. */
function asHudTextOptions(value: unknown): ResolvedHudTextOptions | null {
  if (value === undefined) return HUD_TEXT_DEFAULTS;
  if (!isRecord(value)) return null;
  let size = HUD_TEXT_DEFAULTS.size;
  if (value.size !== undefined) {
    const given = asNumber(value.size);
    if (given === null) return null;
    size = given;
  }
  let color = HUD_TEXT_DEFAULTS.color;
  if (value.color !== undefined) {
    const given = asColor(value.color);
    if (given === null) return null;
    color = given;
  }
  // Only two values move the anchor, and the engine reads anything else — a
  // missing field, a misspelling — as "left" rather than refusing the call.
  const align =
    value.align === "center" || value.align === "right" ? value.align : "left";
  return { size, color, align };
}

/**
 * The string a HUD draw letters.
 *
 * The engine letters `String(text)`, so a build that passed a number lettered
 * its digits and the player letters the same digits. An object is refused
 * rather than lettered as `[object Object]`: the engine's own copy runs behind
 * a guard that draws nothing when stringifying throws, and a report is more
 * use to a reviewer than either outcome.
 */
function asText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Drawing a frame                                                            */
/* -------------------------------------------------------------------------- */

/** A draw waiting for its run to be flushed. */
interface Pending {
  /** The verb that queued it, for a report that names what was lost. */
  readonly name: string;
  /** Where the draw stood in its run's translucent order, for a stable tie-break. */
  readonly at: number;
  /** How far the draw's own position is from this run's camera. */
  readonly distance: number;
  /** Issue it at the scene. */
  readonly issue: () => void;
}

/**
 * The surface a frame is drawn into.
 *
 * A recording taken before the canvas was ever laid out carries a zero-sized
 * surface, and the logical design size is the only other size it states — the
 * same fallback `ReplayCanvas` sizes the canvas by, so the letterbox the drawer
 * computes and the canvas it draws into agree.
 */
function surfaceOf(recording: Recording3d, shot: RecordedFrame3d): Surface3d {
  return {
    width: shot.surface.width > 0 ? shot.surface.width : recording.width,
    height: shot.surface.height > 0 ? shot.surface.height : recording.height,
  };
}

/**
 * Draw one frame of a 3D recording at a scene.
 *
 * `frame` is an index into `recording.frames`; an index outside it draws
 * nothing and reports nothing, which is how a pane holds its last frame while
 * the pane beside it plays on.
 *
 * `resources` is what `prepareRecording3d` returned for this recording. Passing
 * one prepared from another recording resolves assets to the wrong meshes, so
 * the two travel together everywhere the player carries them.
 */
export function drawFrame3d(
  scene: SceneDrawer3d,
  recording: Recording3d,
  resources: Replay3dResources,
  frame: number,
): ReplayFrameReport {
  const shot = recording.frames[frame];
  if (shot === undefined) return { drawn: 0, skipped: 0, unreproducible: [] };

  let skipped = 0;
  const unreproducible: string[] = [];
  const skip = (reason: string): void => {
    skipped += 1;
    if (!unreproducible.includes(reason)) unreproducible.push(reason);
  };
  let drawn = 0;

  // Built fresh for this frame, because a produced value is bound to the scene
  // it was created against and a memo that outlived the frame would be a
  // picture depending on something other than (recording, resources, frame).
  const scope: Scope = {
    scene,
    recording,
    resources,
    built: new Map(),
  };

  /** Issue something at the scene, reporting it by name if the scene refuses. */
  const at = (name: string, issue: () => void): boolean => {
    try {
      issue();
      return true;
    } catch {
      // One draw a renderer rejects — a mesh it cannot pose, a texture it
      // cannot upload — must not cost the reviewer the rest of the frame.
      skip(name);
      return false;
    }
  };

  at("blank()", () =>
    scene.blank(
      surfaceOf(recording, shot),
      { width: recording.width, height: recording.height },
      recording.background,
    ),
  );

  // Reported before anything is applied, so it heads the list of what this
  // frame could not carry: the state below is the light list the recorder had
  // room for rather than the one the build set, and everything after this
  // draws that state faithfully and would otherwise report nothing.
  if (shot.truncated === true) skip(TRUNCATED);

  const inherited = recording.states[shot.state];
  if (inherited === undefined) skip(MISSING_STATE);
  const state = inherited ?? DEFAULT_STATE;

  // The order is the format's: "the mode, the camera, then the lights".
  at("setMode()", () => scene.setMode(state.mode));
  at("setCamera()", () => scene.setCamera(state.camera));
  // Bounded here as well as at the parse, because the rule is the player's own:
  // a `setLights` op carries every light the build supplied, so the first
  // sixty-four is something this drawer applies rather than something it is
  // handed.
  at("setLights()", () => scene.setLights(state.lights.slice(0, LIGHT_LIMIT)));

  let camera: CameraState = state.camera;
  let opaque: Array<{ name: string; issue: () => void }> = [];
  let translucent: Pending[] = [];
  const hud: Array<{ name: string; issue: () => void }> = [];

  /**
   * Close the run in force: its opaque draws in issue order, then its
   * translucent draws farthest-first from the run's own camera.
   *
   * The sort is by distance descending with the issue index breaking ties,
   * which is the engine's rule stated outright rather than left to whether the
   * host's sort is stable.
   */
  const flush = (): void => {
    for (const draw of opaque) if (at(draw.name, draw.issue)) drawn += 1;
    const sorted = [...translucent].sort(
      (a, b) => b.distance - a.distance || a.at - b.at,
    );
    for (const draw of sorted) if (at(draw.name, draw.issue)) drawn += 1;
    opaque = [];
    translucent = [];
  };

  /** Queue one world draw into the run in force. */
  const world = (
    name: string,
    position: Vec3,
    isTranslucent: boolean,
    issue: () => void,
  ): void => {
    if (!isTranslucent) {
      opaque.push({ name, issue });
      return;
    }
    const dx = position.x - camera.position.x;
    const dy = position.y - camera.position.y;
    const dz = position.z - camera.position.z;
    translucent.push({
      name,
      at: translucent.length,
      distance: Math.hypot(dx, dy, dz),
      issue,
    });
  };

  for (const index of shot.ops) {
    const op = recording.ops[index];
    if (op === undefined) {
      skip(MISSING_ENTRY);
      continue;
    }
    if (op.op === "set") {
      // The scene context declares no assignable properties, so no recorder
      // writes one — and the drawer will not assign a name from a document
      // onto the object it draws through. Reported, like any other operation
      // it cannot perform.
      skip(`the ${op.property} property`);
      continue;
    }

    const named = `${op.method}()`;
    const args = resolveAll(op.args, scope, 0);
    if (!args.ok) {
      skip(args.reason);
      continue;
    }
    const values = args.values;

    switch (op.method) {
      case "setCamera": {
        const next = asCamera(values[0]);
        if (next === null) {
          skip(named);
          break;
        }
        // A state setter divides the frame into runs: everything issued before
        // it belongs to the run it closes, and its translucent draws sort
        // under the camera that was in force for them.
        flush();
        camera = next;
        if (at(named, () => scene.setCamera(next))) drawn += 1;
        break;
      }
      case "setLights": {
        const lights = asLights(values[0]);
        if (lights === null) {
          skip(named);
          break;
        }
        flush();
        const kept = lights.slice(0, LIGHT_LIMIT);
        if (at(named, () => scene.setLights(kept))) drawn += 1;
        break;
      }
      case "setMode": {
        const mode = asMode(values[0]);
        if (mode === null) {
          skip(named);
          break;
        }
        flush();
        if (at(named, () => scene.setMode(mode))) drawn += 1;
        break;
      }
      case "clearDepth": {
        flush();
        if (at(named, () => scene.clearDepth())) drawn += 1;
        break;
      }
      case "drawMesh": {
        const mesh = asMesh(values[0]);
        const transform = asTransform(values[1]);
        if (mesh === null || transform === null) {
          skip(named);
          break;
        }
        const options = asMeshOptions(values[2], mesh);
        if (options === null) {
          skip(named);
          break;
        }
        world(
          named,
          transform.position,
          options.material === null
            ? mesh.translucent
            : options.material.opacity < 1,
          () => scene.drawMesh(mesh, transform, options),
        );
        break;
      }
      case "drawGeometry": {
        const geometry = values[0];
        const material = asMaterial(values[1]);
        const transform = asTransform(values[2]);
        if (
          !isProduced(geometry) ||
          geometry.kind !== "geometry" ||
          material === null ||
          transform === null
        ) {
          skip(named);
          break;
        }
        const handle = geometry.handle;
        world(named, transform.position, material.opacity < 1, () =>
          scene.drawGeometry(handle, material, transform),
        );
        break;
      }
      case "drawBillboard": {
        const texture = asTexture(values[0]);
        const position = asVec3(values[1]);
        const size = asVec2(values[2]);
        if (texture === null || position === null || size === null) {
          skip(named);
          break;
        }
        // Every billboard is translucent, whatever its texture carries.
        world(named, position, true, () =>
          scene.drawBillboard(texture, position, size),
        );
        break;
      }
      case "drawLine": {
        const points = asPoints(values[0]);
        const color = asColor(values[1]);
        if (points === null || color === null) {
          skip(named);
          break;
        }
        // A polyline names no centre of its own, so it sorts by its first
        // point — and draws nothing at all under two points, which is the
        // scene's business rather than a loss to report.
        world(
          named,
          points[0] ?? { x: 0, y: 0, z: 0 },
          colorAlpha(color) < 1,
          () => scene.drawLine(points, color),
        );
        break;
      }
      case "drawHudText": {
        const text = asText(values[0]);
        const position = asVec2(values[1]);
        if (text === null || position === null) {
          skip(named);
          break;
        }
        const options = asHudTextOptions(values[2]);
        if (options === null) {
          skip(named);
          break;
        }
        hud.push({
          name: named,
          issue: () => scene.drawHudText(text, position, options),
        });
        break;
      }
      case "drawHudRect": {
        const position = asVec2(values[0]);
        const size = asVec2(values[1]);
        const color = asColor(values[2]);
        if (position === null || size === null || color === null) {
          skip(named);
          break;
        }
        hud.push({
          name: named,
          issue: () => scene.drawHudRect(position, size, color),
        });
        break;
      }
      default:
        // A verb outside the vocabulary is one operation skipped and named,
        // beside the frame it cost. Refusing the document over it — which the
        // parser deliberately does not do — would cost the reviewer every
        // frame of the replay to report one call.
        skip(named);
    }
  }

  flush();

  // The HUD composites last, above the 3D picture, in issue order across the
  // whole frame — however many runs the frame was divided into.
  for (const draw of hud) if (at(draw.name, draw.issue)) drawn += 1;

  at("render()", () => scene.render());

  return { drawn, skipped, unreproducible };
}
