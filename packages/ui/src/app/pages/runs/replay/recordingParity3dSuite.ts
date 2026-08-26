/**
 * The 3D contract-parity suite: an engine's recorder against this console's copy
 * of the format it writes.
 *
 * Two engines write the 3D half of recording format 1 — `@test-cabinet/simple-3d`
 * and `@test-cabinet/structured-3d` — and both are read by the one player here,
 * so both carry the same drift risk against the hand-maintained copy in
 * `format3d.ts`. The whole suite lives here, parameterized over the one thing
 * that differs between them: how a build is assembled and driven. Each engine
 * gets a thin `*.test.ts` beside this module that binds
 * {@link describeRecording3dParity} to its own engine; everything else — the
 * scenarios, the invariants and the coverage the sweep has to reach — is
 * engine-agnostic, because the format is. The engines say so themselves: the two
 * `contract.ts` files are one file carried twice, and the vocabulary is shared
 * precisely so one player draws both engines' recordings.
 *
 * **What is being caught.** `format3d.ts` is a copy of a contract this console
 * deliberately does not import, and a copy has one failure mode: the two drift
 * and nothing says so. There is no way to see that from either side alone. This
 * suite is the thing that sees it, so it needs both halves in one process — the
 * engine as a test-only dependency, exactly as the 2D suite next door holds
 * `@test-cabinet/simple-2d`. Each engine appears in `devDependencies` and in no
 * file the bundle reaches, so the console still ships without them.
 *
 * **Why this suite is not the 2D suite.** `recordingParitySuite.ts` compares
 * PIXELS: it draws each scenario four ways over `@napi-rs/canvas` and demands
 * byte-for-byte agreement, and its header explains at length why that only means
 * something on that host. The comparison does not transplant. A 3D build renders
 * through the engine's own WebGL2 pipeline and the console's replay renders
 * through the drawer beside this file, which is a different rasterizer over a
 * different substrate; two rasterizers can only ever agree within a tolerance,
 * and a tolerance is exactly what such a file must not have. So the property is
 * split, and this file takes the layer where exactness is honest:
 *
 * 1. every document a real recorder writes is accepted by this console's copy,
 *    read as the 3D document it is, after the round trip through JSON that is the
 *    only form a reviewer ever sees;
 * 2. the vocabulary invariants the copy rests on hold in what the recorder wrote
 *    — the ten verbs, the six producers, the light bound, the immutable recipes,
 *    the absent save stack — checked against the engine's own output rather than
 *    against a document written by hand;
 * 3. every document is then RE-ISSUED through the console's own 3D drawer,
 *    frame by frame, against a scene that records what reached it: the drawer
 *    has to reproduce a real recorder's frame with nothing skipped, and a frame
 *    landed on cold has to reach the scene with exactly the calls it reached it
 *    with in order. That is the part of "does the picture come back" which is
 *    exact without a rasterizer — the drawer's own suite establishes what each
 *    verb does with a document written by hand, and this establishes that the
 *    documents a recorder really writes go through it whole;
 * 4. and the sweep is made to reach all of it, so the acceptance above is
 *    evidence rather than a document that happened to be small. The coverage
 *    assertions at the end of every sweep are what stop a scenario set from
 *    quietly ceasing to exercise a corner of the format.
 *
 * The remaining layer belongs elsewhere: the type-level agreement between each
 * engine's exported types and this copy is asserted in the per-engine binding
 * files, where the engine's own types are in scope. Pixels are out of scope
 * throughout, for the reason above.
 *
 * **Why Node.** A 3D build needs a WebGL2 context, and jsdom has none — no more
 * than it has a 2D canvas backend. `@test-cabinet/headless-webgl2` is a real one,
 * in process, with no browser and no GPU: it is what the engines' own validators
 * render through, so driving a build over it here is driving it the way a case's
 * checks drive it. Each binding declares `// @vitest-environment node`.
 *
 * The engines are consumed from their builds, like every other workspace package
 * this repository's front ends import, so `npm run build:packages` has to have
 * run — which is what `scripts/ci/web-test.sh` does before it runs the suites.
 */

import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  drawFrame3d,
  prepareRecording3d,
  type Asset3dDecoder,
  type Replay3dResources,
} from "./drawFrame3d";
import { parseRecording, RECORDING_FORMAT } from "./format";
import type { SceneDrawer3d } from "./sceneDrawer3d";
import {
  LIGHT_LIMIT,
  PRODUCING_METHODS,
  SCENE_OP_METHODS,
  type CapturedAsset,
  type DrawOp3d,
  type LightState,
  type Recording3d,
  type RenderMode,
} from "./format3d";

/* -------------------------------------------------------------------------- */
/* What a scenario is                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The part of the scene context a scenario drives: the six draw calls and the
 * six producers.
 *
 * Not the whole vocabulary, and the omission is the one real difference between
 * the two engines. The three state setters and `clearDepth` are the renderer's
 * own business in Structured 3D — a component that calls one is refused by name
 * — while in Simple 3D the game issues them itself. So a scenario says what
 * renderer state it wants ({@link Scenario.lights}, {@link Scenario.mode}) and
 * each binding reaches it the way its engine reaches it; what a scenario ISSUES
 * is drawing, which both engines let a build issue in the same words.
 *
 * The produced and loaded values are `unknown` here because their types belong
 * to the engines: a geometry is whatever `createBox` answered, and a script only
 * ever hands it back.
 */
export interface DrawVerbs {
  drawMesh(mesh: unknown, transform: unknown, options?: unknown): void;
  drawGeometry(geometry: unknown, material: unknown, transform: unknown): void;
  drawBillboard(texture: unknown, position: unknown, size: unknown): void;
  drawLine(points: unknown, color: string): void;
  drawHudText(text: string, position: unknown, options?: unknown): void;
  drawHudRect(position: unknown, size: unknown, color: string): void;
  createBox(size: unknown): unknown;
  createSphere(radius: number): unknown;
  createCylinder(radius: number, height: number): unknown;
  createCapsule(radius: number, height: number): unknown;
  createPlane(width: number, depth: number): unknown;
  createMaterial(spec: unknown): unknown;
}

/** The assets a binding loads through its engine before the run, by role. */
export interface LoadedAssets {
  /** The glTF binary at {@link ASSET_PATHS.mesh}, as this engine's mesh handle. */
  readonly mesh: unknown;
  /** The PNG at {@link ASSET_PATHS.texture}, as this engine's texture handle. */
  readonly texture: unknown;
  /** The material document at {@link ASSET_PATHS.material}, as its handle. */
  readonly material: unknown;
}

/** Which lights a scenario wants in force; the binding supplies the values. */
export type LightKind = LightState["type"];

/** One frame's drawing, as the build issues it. */
export type FrameScript = (scene: DrawVerbs, assets: LoadedAssets) => void;

/** One scenario: what the build draws, under what renderer state. */
export interface Scenario {
  /** What the run draws, one closure per frame, in order. */
  readonly frames: readonly FrameScript[];
  /**
   * The lights in force for the whole run, by kind. The binding builds a light
   * of each kind its own way — a light's colour and placement are a fact about
   * the engine's own scene rather than about the format.
   */
  readonly lights?: readonly LightKind[];
  /** The render mode in force for the whole run. */
  readonly mode?: RenderMode;
  /**
   * Whether the build asks for a depth clear of its own each frame.
   *
   * Honoured where a build may ask — Simple 3D's game issues one — and ignored
   * where the clear belongs to the engine, which issues its own regardless. Both
   * put a `clearDepth` in the recording, which is the point.
   */
  readonly depthClear?: boolean;
}

/**
 * One engine, as this suite drives it: its own `RECORDING_FORMAT`, and a way to
 * run a scenario and answer what the recorder wrote.
 *
 * `record` is handed the scenario and returns the engine's own `Recording`
 * value, which the suite never trusts as a type: it is serialized and re-read
 * through this console's `parseRecording`, the only form a reviewer ever sees.
 */
export interface Parity3dEngine {
  /** The engine's package name, for the sweep's describe block. */
  readonly name: string;
  /** `RECORDING_FORMAT` as this engine's package exports it. */
  readonly format: number;
  /** Assemble a build, load the assets, run the frames, answer the recording. */
  record(scenario: Scenario): Promise<unknown>;
}

/* -------------------------------------------------------------------------- */
/* The assets the scenarios draw with                                         */
/* -------------------------------------------------------------------------- */

/** The paths the scenarios load, under each engine's default asset root. */
export const ASSET_PATHS = {
  mesh: "models/ship.glb",
  texture: "textures/wall.png",
  material: "materials/wall.json",
} as const;

/** A PNG chunk: length, type, body, CRC. */
function chunk(type: string, body: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

/** The PNG/zlib CRC-32 of a byte run. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** A minimal 8-bit RGBA PNG of the given size, every pixel the same colour. */
function pngBytes(
  width: number,
  height: number,
  rgba: readonly number[],
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0); // filter: none
    for (let x = 0; x < width; x += 1) rows.push(...rgba);
  }
  const idat = new Uint8Array(deflateSync(Uint8Array.from(rows)));
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const parts = [
    Uint8Array.from(signature),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", []),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A one-mesh glTF document with two clips, so a posed draw has one to name. */
const SHIP_GLTF = {
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "hull", mesh: 0, translation: [0, 0, 0] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min: [-1, -1, -1], max: [1, 1, 1] }],
  animations: [{ name: "spin" }, { name: "bob" }],
};

/** A version-2 glTF binary wrapping a document, as both engines decode one. */
function glbBytes(json: object): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  const jsonLength = text.length + pad;
  const total = 12 + 8 + jsonLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(text, 20);
  // The spec pads a JSON chunk with spaces, which `JSON.parse` tolerates.
  for (let i = 0; i < pad; i += 1) out[20 + text.length + i] = 0x20;
  return out;
}

/**
 * The bodies the stubbed asset server answers with, by resolved URL.
 *
 * Both engines resolve a path under `assets/` and fetch it, so what a scenario
 * needs is a fetch that answers three URLs. The material document names its map
 * relative to its own directory, which is why the base-colour texture appears
 * under `materials/`.
 */
const ASSET_BODIES: Readonly<Record<string, Uint8Array | string>> = {
  "assets/models/ship.glb": glbBytes(SHIP_GLTF),
  "assets/textures/wall.png": pngBytes(4, 4, [0x40, 0x80, 0xc0, 0xff]),
  "assets/materials/wall.json": JSON.stringify({
    maps: [{ name: "base-color", path: "wall-base.png", colorSpace: "srgb" }],
  }),
  "assets/materials/wall-base.png": pngBytes(2, 2, [0xff, 0x20, 0x40, 0xff]),
};

/**
 * Answer every asset fetch from the table above, and nothing else.
 *
 * The engines load assets through `globalThis.fetch`, which is the seam a
 * browser gives them and the one Node gives them too. Pointing it at bytes this
 * process made is what lets a scenario draw a mesh, a texture and a material —
 * the whole `assets` half of the format — with no server and no fixture files.
 * A path outside the table answers 404, so a binding that mistypes one is told.
 */
export function installAssetServer(): void {
  vi.stubGlobal("fetch", (url: string): Promise<Response> => {
    const body = ASSET_BODIES[String(url)];
    if (body === undefined) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return Promise.resolve(
      new Response(typeof body === "string" ? body : (body as BlobPart)),
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Reading what the recorder wrote                                            */
/* -------------------------------------------------------------------------- */

/** What one sweep has reached, accumulated across its scenarios. */
interface Covered {
  readonly methods: Set<string>;
  readonly producers: Set<string>;
  readonly lights: Set<string>;
  readonly modes: Set<string>;
  readonly assets: Set<string>;
  readonly truncated: Set<boolean>;
}

/** A fresh, empty coverage tally. */
function tally(): Covered {
  return {
    methods: new Set(),
    producers: new Set(),
    lights: new Set(),
    modes: new Set(),
    assets: new Set(),
    truncated: new Set(),
  };
}

/** The verbs and producers as plain strings, for membership checks. */
const VERBS: readonly string[] = SCENE_OP_METHODS;
const PRODUCERS: readonly string[] = PRODUCING_METHODS;

/* -------------------------------------------------------------------------- */
/* Re-issuing what the recorder wrote                                         */
/* -------------------------------------------------------------------------- */

/**
 * The clip names a captured glTF binary carries, read out of the container.
 *
 * The replay below decodes an asset without a renderer, and a mesh's clips are
 * the one thing about a decoded mesh the drawer reads: a `drawMesh` naming a
 * clip the file does not carry is a call the drawer refuses rather than poses,
 * so a decode that answered no clips would report a loss the build never had.
 */
function clipsOfGlb(base64: string): readonly string[] {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  // 12-byte header, then chunks of (length, type, body); the first is the JSON.
  const length = view.getUint32(12, true);
  const json = new TextDecoder().decode(bytes.subarray(20, 20 + length));
  const document = JSON.parse(json) as {
    animations?: readonly { name?: string }[];
  };
  return (document.animations ?? []).map((clip) => clip.name ?? "");
}

/**
 * A decoder with no renderer behind it.
 *
 * The drawer takes its decoded assets from a seam for exactly this reason: what
 * this layer asserts is which calls a document re-issues as, and that is
 * independent of what a mesh turns into on a GPU. The engines' own validators
 * render through `@test-cabinet/headless-webgl2`; three.js does not, and
 * building the console's real three-backed decoder here would test three rather
 * than the copy.
 */
const decodeWithoutRenderer: Asset3dDecoder = async (asset) =>
  asset.kind === "mesh"
    ? {
        kind: "mesh",
        path: asset.path,
        translucent: false,
        clips: clipsOfGlb(asset.data),
        value: null,
      }
    : {
        kind: "texture",
        path: asset.path,
        width: asset.width,
        height: asset.height,
        value: null,
      };

/** A scene that writes down what reached it, in the order it reached it. */
function transcript(): { scene: SceneDrawer3d; log: unknown[] } {
  const log: unknown[] = [];
  const note = (method: string, ...args: unknown[]): void => {
    log.push([method, args]);
  };
  const produce = (method: string, ...args: unknown[]): unknown => {
    note(method, ...args);
    return { made: method, args };
  };
  const scene: SceneDrawer3d = {
    blank: (surface, design, background) =>
      note("blank", surface, design, background),
    setCamera: (camera) => note("setCamera", camera),
    setLights: (lights) => note("setLights", lights),
    setMode: (mode) => note("setMode", mode),
    clearDepth: () => note("clearDepth"),
    drawMesh: (mesh, transform, options) =>
      note("drawMesh", mesh, transform, options),
    drawGeometry: (geometry, material, transform) =>
      note("drawGeometry", geometry, material, transform),
    drawBillboard: (texture, position, size) =>
      note("drawBillboard", texture, position, size),
    drawLine: (points, color) => note("drawLine", points, color),
    drawHudText: (text, position, options) =>
      note("drawHudText", text, position, options),
    drawHudRect: (position, size, color) =>
      note("drawHudRect", position, size, color),
    createBox: (size) => produce("createBox", size),
    createSphere: (radius) => produce("createSphere", radius),
    createCylinder: (radius, height) =>
      produce("createCylinder", radius, height),
    createCapsule: (radius, height) => produce("createCapsule", radius, height),
    createPlane: (width, depth) => produce("createPlane", width, depth),
    createMaterial: (material) => produce("createMaterial", material),
    render: () => note("render"),
  };
  return { scene, log };
}

/**
 * Re-issue every frame of a real recorder's document through this console's
 * drawer, and hold the two properties a reviewer's scrub bar rests on.
 *
 * The first is that the drawer reproduces the frame WHOLE: a recorder wrote
 * every one of these operations, so anything the drawer skips is a hole in the
 * picture a reviewer is about to write a verdict against. The second is that a
 * frame drawn cold is the frame drawn in order — the same calls, with the same
 * arguments, in the same composite order — which is what makes seeking to frame
 * 900 the same picture as playing to it.
 */
async function redraw(recording: Recording3d): Promise<void> {
  const resources: Replay3dResources = await prepareRecording3d(
    recording,
    decodeWithoutRenderer,
  );

  // In order, on one scene, as playback does.
  const played = transcript();
  const inOrder: string[] = [];
  for (let frame = 0; frame < recording.frames.length; frame += 1) {
    const before = played.log.length;
    const report = drawFrame3d(played.scene, recording, resources, frame);
    // Nothing a recorder wrote is beyond the drawer — with one exception the
    // format itself names: a frame whose inherited light list the recorder had
    // to cut down is a picture the format could not carry, and the drawer
    // reports it rather than lighting the replay by sixty-four lights and
    // calling the frame clean.
    expect(
      report.unreproducible,
      `what frame ${frame} could not be drawn with`,
    ).toEqual(
      recording.frames[frame]?.truncated === true
        ? ["a light list longer than this format carries"]
        : [],
    );
    expect(report.drawn, `operations frame ${frame} re-issued`).toBe(
      recording.frames[frame]?.ops.length,
    );
    inOrder.push(JSON.stringify(played.log.slice(before)));
  }

  // Cold, each on a scene of its own, as a scrub does.
  for (let frame = 0; frame < recording.frames.length; frame += 1) {
    const cold = transcript();
    drawFrame3d(cold.scene, recording, resources, frame);
    expect(JSON.stringify(cold.log), `frame ${frame} landed on cold`).toBe(
      inOrder[frame],
    );
  }
}

/**
 * Read one engine's recording the way a reviewer's console reads it, and hold
 * what it holds against the copy's own invariants.
 *
 * The document goes through `JSON.parse(JSON.stringify(...))` first, because a
 * recording is written to a file by one process and read by another: anything
 * that survives only as a live object reference would pass here and fail there.
 */
async function read(
  written: unknown,
  engine: Parity3dEngine,
  covered: Covered,
): Promise<Recording3d> {
  const parsed = parseRecording(JSON.parse(JSON.stringify(written)) as unknown);
  if (!parsed.ok) {
    throw new Error(`this console refused the recording: ${parsed.message}`);
  }
  const recording = parsed.recording;
  // The whole point of the envelope: what this engine wrote is routed to the 3D
  // contract by its own `space`, not by anything the suite asserted.
  if (recording.space !== "3d") {
    throw new Error("this console read the recording as a 2D document");
  }
  expect(recording.format, "the format the document states").toBe(
    RECORDING_FORMAT,
  );
  expect(engine.format, "the format the engine package exports").toBe(
    RECORDING_FORMAT,
  );

  const named = { ops: new Set<number>(), states: new Set<number>() };
  for (const frame of recording.frames) {
    // There is no save stack in 3D, and a frame that grew one would be a frame
    // this console reads without the thing it means.
    expect(
      Object.hasOwn(frame, "stack"),
      "a 3D frame carrying a 2D document's save stack",
    ).toBe(false);
    named.states.add(frame.state);
    for (const at of frame.ops) named.ops.add(at);
    if (frame.truncated !== undefined) covered.truncated.add(frame.truncated);
  }

  recording.ops.forEach((op, at) => {
    // A conforming recording's operations are calls: the scene context declares
    // no assignable property, so an assignment here would be a shape the format
    // allows and no recorder writes.
    expect(op.op, `operation ${at}`).toBe("call");
    const method = (op as Extract<DrawOp3d, { op: "call" }>).method;
    expect(VERBS, `operation ${at} names ${method}`).toContain(method);
    covered.methods.add(method);
  });

  recording.resources.forEach((resource, at) => {
    expect(
      PRODUCERS,
      `resource ${at} was made by ${resource.make.method}`,
    ).toContain(resource.make.method);
    // A produced 3D value is immutable, so a recipe is its `make` and nothing
    // else. The step machinery stays in the format the two spaces share, and
    // this is the assertion that no 3D recorder uses it.
    expect(resource.then, `resource ${at}'s steps`).toEqual([]);
    covered.producers.add(resource.make.method);
  });

  recording.states.forEach((state, at) => {
    expect(
      state.lights.length,
      `state ${at} carries more lights than the format does`,
    ).toBeLessThanOrEqual(LIGHT_LIMIT);
    covered.modes.add(state.mode);
    for (const light of state.lights) covered.lights.add(light.type);
  });

  for (const asset of recording.assets) covered.assets.add(asset.kind);

  // Every entry of the shared tables is one some frame names: the tables are
  // settled when the recording is closed, from the frames it holds.
  expect(named.ops.size, "operations no frame names").toBe(
    recording.ops.length,
  );
  expect(named.states.size, "states no frame names").toBe(
    recording.states.length,
  );

  await redraw(recording);
  return recording;
}

/** The transform every scenario draws under, as the format encodes one. */
const PLACED = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: { x: 1, y: 1, z: 1 },
};

/** A transform at a named spot, for a frame that draws more than one thing. */
function at(x: number, y: number, z: number): unknown {
  return { ...PLACED, position: { x, y, z } };
}

/* -------------------------------------------------------------------------- */
/* The sweep                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Register the whole suite, bound to one engine.
 *
 * Called once, at the top level of each per-engine test file, so the suites it
 * registers land in that file. The two engines never share state: vitest
 * evaluates this module afresh per test file, so the tally below is that file's
 * own.
 */
export function describeRecording3dParity(engine: Parity3dEngine): void {
  const covered = tally();

  describe(`${engine.name}'s recorder against this console's copy`, () => {
    beforeAll(() => {
      installAssetServer();
    });

    it("writes a document this console reads, drawing the whole vocabulary", async () => {
      const written = await engine.record({
        mode: "standard",
        lights: ["ambient", "directional", "point"],
        depthClear: true,
        frames: [
          (scene, assets) => {
            scene.drawGeometry(
              scene.createBox({ x: 1, y: 1, z: 1 }),
              "#7fd1ff",
              at(-2, 0, 0),
            );
            scene.drawGeometry(scene.createSphere(0.5), "#f45b69", at(0, 0, 0));
            scene.drawGeometry(
              scene.createCylinder(0.4, 1.5),
              "#e8e8e8",
              at(2, 0, 0),
            );
            scene.drawMesh(assets.mesh, at(0, 2, 0));
            scene.drawBillboard(
              assets.texture,
              { x: 0, y: 1, z: 0 },
              {
                x: 1,
                y: 1,
              },
            );
            scene.drawLine(
              [
                { x: -4, y: 0, z: 0 },
                { x: 4, y: 0, z: 0 },
                { x: 4, y: 4, z: 0 },
              ],
              "#ffcc00",
            );
            scene.drawHudRect({ x: 8, y: 8 }, { x: 120, y: 24 }, "#00000080");
            scene.drawHudText("SCORE 10", { x: 12, y: 24 }, { size: 16 });
          },
          (scene, assets) => {
            scene.drawGeometry(
              scene.createCapsule(0.3, 1.2),
              scene.createMaterial({
                baseColor: "#ffcc00",
                baseColorMap: assets.texture,
                roughness: 0.3,
                metallic: 0.1,
              }),
              at(0, 0, -2),
            );
            scene.drawGeometry(scene.createPlane(8, 8), assets.material, {
              ...PLACED,
              position: { x: 0, y: -1, z: 0 },
            });
            scene.drawMesh(assets.mesh, at(0, 2, 0), {
              clip: "spin",
              clipTime: 0.25,
            });
          },
        ],
      });
      const recording = await read(written, engine, covered);
      expect(recording.frames).toHaveLength(2);
      // The assets are captured once each, however many frames draw them, so a
      // mesh drawn on both frames is one entry.
      expect(recording.assets.length).toBeGreaterThanOrEqual(3);
    });

    it("shares one resource entry between two producing calls with the same arguments", async () => {
      // The recorder keys a produced value on the call that made it, so a build
      // that creates its geometry inside `render` — the ordinary way to write
      // one — costs the recording one entry rather than one per frame. The copy
      // rests on that: a `$res` a later frame names has to be an entry an earlier
      // frame's recipe already settled.
      const written = await engine.record({
        frames: [
          (scene) =>
            scene.drawGeometry(
              scene.createBox({ x: 2, y: 2, z: 2 }),
              "#7fd1ff",
              PLACED,
            ),
          (scene) =>
            scene.drawGeometry(
              scene.createBox({ x: 2, y: 2, z: 2 }),
              "#7fd1ff",
              PLACED,
            ),
          (scene) =>
            scene.drawGeometry(
              scene.createBox({ x: 3, y: 3, z: 3 }),
              "#7fd1ff",
              PLACED,
            ),
        ],
      });
      const recording = await read(written, engine, covered);
      const boxes = recording.resources.filter(
        (resource) => resource.make.method === "createBox",
      );
      expect(boxes).toHaveLength(2);
    });

    it("writes a document in each of the four render modes", async () => {
      // Two frames rather than one, and the reason is the format: `states` holds
      // what a frame INHERITED, so a mode set inside the first frame is an
      // operation there and the state the second frame opens under. A one-frame
      // run would record the mode as a call and never as a state.
      const draw = (scene: DrawVerbs): void => {
        scene.drawGeometry(
          scene.createBox({ x: 1, y: 1, z: 1 }),
          "#7fd1ff",
          PLACED,
        );
      };
      for (const mode of [
        "standard",
        "wireframe",
        "unlit",
        "normals",
      ] as const) {
        const written = await engine.record({
          mode,
          lights: ["ambient"],
          frames: [draw, draw],
        });
        const recording = await read(written, engine, covered);
        const modes = new Set(recording.states.map((state) => state.mode));
        expect(modes, `a run driven in ${mode}`).toContain(mode);
      }
    });

    it("cuts an inherited light list down to the bound and says so on the frame", async () => {
      // The one place the copy's own number has to equal the engine's. Nothing
      // exports the bound as a value, so this is what holds `LIGHT_LIMIT` to what
      // a recorder actually writes: a run lit by more lights than the format
      // carries has to answer with a state at the bound and a frame that says it
      // was cut down.
      const written = await engine.record({
        lights: Array.from<LightKind>({ length: LIGHT_LIMIT + 6 }).fill(
          "ambient",
        ),
        frames: [
          (scene) =>
            scene.drawGeometry(scene.createSphere(1), "#f45b69", PLACED),
          (scene) =>
            scene.drawGeometry(scene.createSphere(1), "#f45b69", PLACED),
          (scene) =>
            scene.drawGeometry(scene.createSphere(1), "#f45b69", PLACED),
        ],
      });
      const recording = await read(written, engine, covered);
      const cut = recording.frames.filter((frame) => frame.truncated === true);
      expect(cut.length, "frames that say they were cut down").toBeGreaterThan(
        0,
      );
      for (const frame of cut) {
        expect(recording.states[frame.state]?.lights).toHaveLength(LIGHT_LIMIT);
      }
      // The bound cuts the state and not the call: a recorded `setLights` carries
      // every light the build supplied, which is what a player applies the same
      // first-64 rule to.
      const supplied = recording.ops.flatMap((op) =>
        op.op === "call" && op.method === "setLights" ? [op.args[0]] : [],
      );
      const lengths = supplied.map((args) =>
        Array.isArray(args) ? args.length : 0,
      );
      expect(Math.max(0, ...lengths), "the longest recorded light list").toBe(
        LIGHT_LIMIT + 6,
      );
    });

    it("carries a scrub axis of frames a reviewer can seek along", async () => {
      const written = await engine.record({
        frames: Array.from({ length: 5 }, () => (scene: DrawVerbs) => {
          scene.drawGeometry(
            scene.createBox({ x: 1, y: 1, z: 1 }),
            "#fff",
            PLACED,
          );
        }),
      });
      const recording = await read(written, engine, covered);
      expect(recording.frames).toHaveLength(5);
      let previous = -1;
      let elapsed = -1;
      for (const frame of recording.frames) {
        expect(frame.count).toBeGreaterThan(previous);
        expect(frame.timeMs).toBeGreaterThan(elapsed);
        expect(frame.deltaMs).toBeGreaterThan(0);
        expect(frame.surface.width).toBeGreaterThan(0);
        previous = frame.count;
        elapsed = frame.timeMs;
      }
    });

    it("captures a mesh, a texture and a material, and names the material's maps", async () => {
      const written = await engine.record({
        frames: [
          (scene, assets) => {
            scene.drawMesh(assets.mesh, PLACED);
            scene.drawBillboard(
              assets.texture,
              { x: 0, y: 0, z: 0 },
              {
                x: 2,
                y: 2,
              },
            );
            scene.drawGeometry(
              scene.createPlane(4, 4),
              assets.material,
              PLACED,
            );
          },
        ],
      });
      const recording = await read(written, engine, covered);
      const kinds = (kind: CapturedAsset["kind"]): readonly CapturedAsset[] =>
        recording.assets.filter((asset) => asset.kind === kind);
      expect(kinds("mesh").length, "captured meshes").toBeGreaterThan(0);
      expect(kinds("texture").length, "captured textures").toBeGreaterThan(0);
      const materials = kinds("material");
      expect(materials.length, "captured materials").toBeGreaterThan(0);
      for (const material of materials) {
        if (material.kind !== "material") continue;
        for (const slot of Object.values(material.maps)) {
          // Already established by the parse — asserted again because it is the
          // invariant the drawer's material resolution is total on.
          expect(recording.assets[slot]?.kind).toBe("texture");
        }
      }
    });

    it("reached every corner of the format this suite claims to cover", () => {
      // The assertion that keeps the acceptance above meaning something. Each
      // scenario asks "does this console read what the recorder wrote"; only this
      // one says the scenarios between them wrote the whole format down.
      expect(
        [...covered.methods].sort(),
        "the verbs the sweep recorded",
      ).toEqual([...VERBS].sort());
      expect(
        [...covered.producers].sort(),
        "the producers the sweep recorded",
      ).toEqual([...PRODUCERS].sort());
      expect([...covered.lights].sort(), "the light kinds").toEqual([
        "ambient",
        "directional",
        "point",
      ]);
      expect([...covered.modes].sort(), "the render modes").toEqual([
        "normals",
        "standard",
        "unlit",
        "wireframe",
      ]);
      expect([...covered.assets].sort(), "the captured asset kinds").toEqual([
        "material",
        "mesh",
        "texture",
      ]);
      expect([...covered.truncated], "the truncation flag").toEqual([true]);
    });
  });
}

/* -------------------------------------------------------------------------- */
/* The type-level half, for the bindings                                      */
/* -------------------------------------------------------------------------- */

/**
 * `true` only when the two types are each assignable to the other.
 *
 * The bindings use it to hold this console's copied declarations against the
 * types the engine exports, which is the half of the drift a running test cannot
 * see: a field renamed on both sides of a recorder still round-trips through
 * `parseRecording`, and a verb added to the engine's `SceneOpMethod` is a verb
 * this console will meet and have no drawer for. Both are compile errors here.
 *
 * The tuple wrappers stop the conditional from distributing, so a union is
 * compared as one type rather than member by member — which is what makes the
 * check fail when the engine's vocabulary gains a verb this copy has not.
 */
export type Mutual<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
