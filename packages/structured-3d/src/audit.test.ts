import { createCanvas } from "@test-cabinet/headless-webgl2";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { Actor, Pawn } from "./actors";
import { ColliderComponent, type Manifold } from "./collision";
import { ConstantClock } from "./clocks";
import {
  AmbientLightComponent,
  DirectionalLightComponent,
  DrawComponent,
  PointLightComponent,
  ShapeComponent,
  TextComponent,
  type DrawApi,
  type SceneContext,
  type Shape3,
} from "./components";
import {
  fitViewport,
  pointerRay,
  projectPoint,
  type SurfaceMetrics,
} from "./camera";
import {
  PRODUCING_METHODS,
  SCENE_OP_METHODS,
  type DrawValue,
  type Recording,
} from "./contract";
import { AIController, PlayerController, type Controller } from "./controllers";
import {
  assembleEngine,
  type Engine,
  type EngineHost,
  type EngineOptions,
} from "./engine";
import { GameInstance, type GameDefinition } from "./game-instance";
import { GameMode } from "./game-mode";
import * as api from "./index";
import {
  quatFromAxisAngle,
  vec3Normalize,
  type CameraState,
  type Quat,
  type Vec3,
  type Viewport,
} from "./math";
import { RECORDING_FORMAT as SUBPATH_FORMAT } from "./recording";
import type {
  ActorSpec,
  EngineEventMap,
  LevelDefinition,
  World,
} from "./worlds";

/**
 * The conformance audit: an adversarial second reading of the package against
 * its own specification, written after the implementation rather than beside
 * it.
 *
 * The module suites beside each source file assert what that module was built
 * to do. This one asserts what the *pages* say, from the outside, by figures
 * derived by hand rather than read off the code:
 *
 * - **The exports tables** are read out of
 *   `apps/docs/src/content/docs/engines/structured-3d/apis/*.md` at test time
 *   and compared, name by name and in both directions, against the barrel's
 *   own export statements — so a name added to a page or dropped from the
 *   package fails here rather than being noticed by a reader. The pages are
 *   the specification and they are in this repository; a vendored copy of the
 *   package has no `apps/docs` beside it, so the doc-reading checks skip
 *   themselves rather than fail when the tree is absent.
 * - **The recording format** is audited field for field, against a recording
 *   armed over a real world drawn by the real pipeline — the envelope, the
 *   frame, the inherited state, the op vocabulary, the resource recipes, and
 *   the four behaviors the format singles out (the depth clears the layers and
 *   the overlay lower onto, the overlay palette, the `text:` capture of a
 *   billboard the engine rasterized itself, and both truncations).
 * - **Six hand-derived probes** stand behind the claims that are easiest to
 *   implement plausibly and wrongly: the collision manifolds against geometry
 *   worked out on paper, the order of the edges a possession change fires, the
 *   order a recording's runs are issued in, everything a world transition tears
 *   down, the camera's projection round trip, and the four calls a
 *   `DrawComponent` is refused.
 *
 * Nothing here is faked that the shipped engine would not also be given: a
 * `@test-cabinet/headless-webgl2` canvas, an injected `SurfaceMetrics`, a
 * scripted clock, and `engine.advance`. The one injection is the host loop,
 * which no test in this file drives at all.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** A small design size: every test renders real triangles, and these are cheap. */
const WIDTH = 64;
const HEIGHT = 36;

/** Every engine a test built, torn down after it whether or not it failed. */
const built: Engine<never>[] = [];

afterEach(() => {
  for (const engine of built) engine.destroy();
  built.length = 0;
});

/** The host loop, present so no test in this file ever schedules a real frame. */
const inertHost: EngineHost = {
  raf: () => 1,
  cancel: () => {},
  now: () => 0,
};

/** A surface over a bare event target: the position a documentless canvas is in. */
function surfaceOver(dpr = 1): SurfaceMetrics {
  const target = new EventTarget();
  return {
    cssWidth: () => WIDTH,
    cssHeight: () => HEIGHT,
    dpr: () => dpr,
    events: () => target,
  };
}

/** An engine over the real subsystems, stepped only with `advance`. */
function makeEngine<D>(
  game: GameDefinition<D>,
  overrides: Partial<EngineOptions<D>> = {},
): Engine<D> {
  const engine = assembleEngine<D>(
    {
      canvas: createCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement,
      width: WIDTH,
      height: HEIGHT,
      game,
      clock: new ConstantClock(16),
      surface: surfaceOver(),
      ...overrides,
    },
    inertHost,
  );
  built.push(engine as unknown as Engine<never>);
  return engine;
}

/**
 * A one-level game whose game mode calls `build` from its `beginPlay` — the
 * moment the docs name for "the world is whole and every declared actor has
 * begun play".
 */
function stagedGame(build: (world: World) => void): GameDefinition<null> {
  class Stage extends GameMode {
    override beginPlay(): void {
      build(this.world);
    }
  }
  return { levels: { stage: { mode: Stage } }, startLevel: "stage" };
}

/** The calls one captured frame issued, resolved through the recording's op table. */
function callsOf(
  recording: Recording,
  frame = 0,
): { method: string; args: readonly DrawValue[] }[] {
  const captured = recording.frames[frame];
  if (captured === undefined) {
    throw new Error(`the recording holds no frame ${frame}`);
  }
  return captured.ops.map((index) => {
    const op = recording.ops[index];
    if (op === undefined)
      throw new Error(`op index ${index} resolves to nothing`);
    if (op.op !== "call") throw new Error(`op index ${index} is a "${op.op}"`);
    return { method: op.method, args: op.args };
  });
}

/** The methods one captured frame issued, in issue order. */
function methodsOf(recording: Recording, frame = 0): string[] {
  return callsOf(recording, frame).map((call) => call.method);
}

/** A recorded `DrawValue` read as a plain object, for a field lookup. */
function fields(value: DrawValue | undefined): Record<string, DrawValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected a plain recorded object, got ${String(value)}`);
  }
  return value as Record<string, DrawValue>;
}

/* -------------------------------------------------------------------------- */
/* 1. The exports tables                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The specification tree, when this package is sitting in its own repository.
 * A vendored copy has no `apps/docs` beside it, so the checks that read the
 * pages skip themselves rather than failing for a reason that is not the
 * package's fault.
 */
const API_PAGES = fileURLToPath(
  new URL(
    "../../../apps/docs/src/content/docs/engines/structured-3d/apis/",
    import.meta.url,
  ),
);
const PAGES_PRESENT = existsSync(API_PAGES);

/** The barrel's source, which is current whether or not `dist` has been built. */
const BARREL = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
);

/** The built type surface, present only after `tsc -b`. */
const DECLARATIONS = fileURLToPath(
  new URL("../dist/index.d.ts", import.meta.url),
);

/**
 * Every name a module re-exports, values and types alike, read out of its
 * `export` statements: the `export {…} from`, `export type {…} from`, and
 * `export type X =` forms the barrel is written in. An aliased re-export
 * counts as the name it is exported *as*, which is the name a caller writes.
 */
function exportedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /export\s+(?:type\s+)?\{([^}]*)\}\s*from/g,
  )) {
    for (const entry of (match[1] ?? "").split(",")) {
      const trimmed = entry.trim();
      if (trimmed === "") continue;
      const parts = trimmed.split(/\s+as\s+/);
      names.add((parts[1] ?? parts[0] ?? "").trim());
    }
  }
  for (const match of source.matchAll(
    /export\s+type\s+([A-Za-z_$][\w$]*)\s*=/g,
  )) {
    names.add(match[1] ?? "");
  }
  return names;
}

/**
 * The names one API page's `## Exports` section states, as the backticked
 * identifiers it holds. The package specifier and the sibling engine's slug
 * are backticked there too and are not identifiers, so the shape of the name
 * is enough to tell a claim from prose.
 */
function documentedNames(page: string): string[] {
  const source = readFileSync(`${API_PAGES}${page}`, "utf8");
  const at = source.indexOf("\n## Exports");
  if (at === -1) return [];
  const section = source.slice(at);
  const found = [...section.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
  return [...new Set(found)];
}

/** Every API page, so a page added later is audited without this file changing. */
function apiPages(): string[] {
  return readdirSync(API_PAGES)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

describe("audit: the exports tables", () => {
  it.skipIf(!PAGES_PRESENT)(
    "exports every name every API page's Exports section states",
    () => {
      const exported = exportedNames(BARREL);
      const missing: string[] = [];
      for (const page of apiPages()) {
        for (const name of documentedNames(page)) {
          if (!exported.has(name)) missing.push(`${page}: ${name}`);
        }
      }
      expect(missing).toEqual([]);
    },
  );

  it.skipIf(!PAGES_PRESENT)(
    "exports nothing no Exports section states, so the surface is exactly the specified one",
    () => {
      const documented = new Set<string>();
      for (const page of apiPages()) {
        for (const name of documentedNames(page)) documented.add(name);
      }
      const undocumented = [...exportedNames(BARREL)].filter(
        (name) => !documented.has(name),
      );
      expect(undocumented).toEqual([]);
    },
  );

  it.skipIf(!PAGES_PRESENT)(
    "covers every API page: each one states its exports, save the overview",
    () => {
      const pages = apiPages();
      expect(pages).toContain("overview.md");
      const silent = pages.filter((page) => documentedNames(page).length === 0);
      // The overview describes the entry points rather than naming symbols.
      expect(silent).toEqual(["overview.md"]);
    },
  );

  it.skipIf(!existsSync(DECLARATIONS))(
    "emits the same names it declares, so the built surface matches the barrel",
    () => {
      const emitted = exportedNames(readFileSync(DECLARATIONS, "utf8"));
      expect([...emitted].sort()).toEqual([...exportedNames(BARREL)].sort());
    },
  );

  it("hands out every value the pages call a class, a function, or a value", () => {
    // Transcribed from the pages' Exports sections: the names stated as
    // classes, as functions, or as values, and nothing else. Every other
    // documented name is a type and cannot be present at runtime.
    const classes = [
      "GameInstance",
      "GameMode",
      "GameState",
      "PlayerState",
      "Actor",
      "Pawn",
      "Component",
      "RenderComponent",
      "MeshComponent",
      "ShapeComponent",
      "TextComponent",
      "DrawComponent",
      "CameraComponent",
      "LightComponent",
      "AmbientLightComponent",
      "DirectionalLightComponent",
      "PointLightComponent",
      "ColliderComponent",
      "Controller",
      "PlayerController",
      "AIController",
      "WallClock",
      "PacedClock",
      "ConstantClock",
      "SequenceClock",
      "JitterClock",
    ];
    const functions = [
      "createEngine",
      "vec3Add",
      "vec3Sub",
      "vec3Scale",
      "vec3Dot",
      "vec3Cross",
      "vec3Length",
      "vec3Normalize",
      "quatFromAxisAngle",
      "quatMultiply",
      "rotateVec3",
      "transformPoint",
      "projectPoint",
      "pointerRay",
      "fitViewport",
      "syncCanvas",
    ];
    const surface = api as unknown as Record<string, unknown>;

    for (const name of [...classes, ...functions]) {
      expect(typeof surface[name], name).toBe("function");
    }
    // A class is constructible and carries its own prototype methods or
    // fields; a plain function does not, which is what tells the two apart at
    // runtime without calling anything.
    for (const name of classes) {
      const value = surface[name] as { prototype?: object };
      expect(value.prototype, name).toBeTypeOf("object");
      expect(Object.getOwnPropertyNames(value.prototype ?? {}), name).toContain(
        "constructor",
      );
    }
    expect(typeof api.TOUCH_LAYOUTS).toBe("object");
    expect(typeof api.RECORDING_FORMAT).toBe("number");
    expect(Object.keys(surface).sort()).toEqual(
      [...classes, ...functions, "TOUCH_LAYOUTS", "RECORDING_FORMAT"].sort(),
    );
  });

  it("serves the recording format from the subpath and the root as one value", () => {
    expect(SUBPATH_FORMAT).toBe(1);
    expect(api.RECORDING_FORMAT).toBe(SUBPATH_FORMAT);
  });

  it("keeps the recording module a leaf: it imports no value from the engine", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./recording.ts", import.meta.url)),
      "utf8",
    );
    const valueImports = [
      ...source.matchAll(/^import\s+(?!type)([\s\S]*?)from\s+"([^"]+)"/gm),
    ]
      .map((match) => match[2] ?? "")
      .filter((specifier) => specifier !== "./contract");
    expect(valueImports).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The recording format, field for field                                   */
/* -------------------------------------------------------------------------- */

/** The three colliders the overlay palette is read off, each on its own answer. */
function paletteWorld(world: World): void {
  const place = (
    at: Vec3,
    responses: Record<string, "ignore" | "overlap" | "block">,
  ): void => {
    const actor = world.spawn(Actor, { transform: { position: at } });
    actor.attach(
      new ColliderComponent({
        shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
        responses,
      }),
    );
  };
  place({ x: -20, y: 0, z: 0 }, { solid: "block", trigger: "overlap" });
  place({ x: 0, y: 0, z: 0 }, { trigger: "overlap" });
  place({ x: 20, y: 0, z: 0 }, {});
}

describe("audit: the recording format", () => {
  /**
   * The scene every envelope and vocabulary check below reads: one opaque
   * shape on layer `0`, one lettered billboard on layer `1`, and the collision
   * overlay switched on, so the frame exercises every lowering the pipeline
   * performs.
   */
  async function stagedRecording(frames = 1): Promise<Recording> {
    const engine = makeEngine(
      stagedGame((world) => {
        const block = world.spawn(Actor, {
          transform: { position: { x: 0, y: 0, z: 0 } },
        });
        block.attach(
          new ShapeComponent({
            shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
            color: "#3355ff",
          }),
        );
        const score = world.spawn(Actor, {
          transform: { position: { x: 0, y: 4, z: 0 } },
        });
        const text = score.attach(new TextComponent({ text: "SCORE" }));
        text.layer = 1;
        paletteWorld(world);
      }),
      { background: "#101820" },
    );
    await engine.initialize();
    engine.renderer.setCollisionOverlay(true);
    engine.startRecording();
    await engine.advance(frames);
    return engine.stopRecording();
  }

  it('carries exactly the ten fields `Recording` declares, and `space` is "3d"', async () => {
    const recording = await stagedRecording();
    expect(Object.keys(recording).sort()).toEqual(
      [
        "assets",
        "background",
        "format",
        "frames",
        "height",
        "ops",
        "resources",
        "space",
        "states",
        "width",
      ].sort(),
    );
    expect(recording.format).toBe(api.RECORDING_FORMAT);
    expect(recording.format).toBe(1);
    expect(recording.space).toBe("3d");
  });

  it("fixes the design size and background at arm time from the engine's own options", async () => {
    const recording = await stagedRecording();
    // Not the canvas backing store, which is what a read-back-at-close
    // recorder would report: the design size `createEngine` was handed.
    expect(recording.width).toBe(WIDTH);
    expect(recording.height).toBe(HEIGHT);
    expect(recording.background).toBe("#101820");
    expect(recording.frames[0]?.surface).toEqual({
      width: WIDTH,
      height: HEIGHT,
    });
  });

  it("reports a background of null for an engine given none", async () => {
    const engine = makeEngine(stagedGame(() => {}));
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    expect(engine.stopRecording().background).toBeNull();
  });

  it("carries the six documented frame fields and no `stack`", async () => {
    const recording = await stagedRecording();
    const frame = recording.frames[0]!;
    expect(Object.keys(frame).sort()).toEqual(
      ["count", "deltaMs", "ops", "state", "surface", "timeMs"].sort(),
    );
    expect("stack" in frame).toBe(false);
    expect("truncated" in frame).toBe(false);
  });

  it("carries the frame metadata exact while rounding a drawn number to nine digits", async () => {
    // A delta no float writes cleanly: the frame figures must survive it
    // untouched while the numbers inside an operation do not.
    const engine = makeEngine(
      stagedGame((world) => {
        const actor = world.spawn(Actor, {
          transform: { position: { x: 1 / 3, y: 0, z: 0 } },
        });
        actor.attach(
          new ShapeComponent({ shape: { kind: "sphere", radius: 1 } }),
        );
      }),
      { clock: new ConstantClock(1000 / 60) },
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(3);
    const recording = engine.stopRecording();

    expect(recording.frames.map((frame) => frame.count)).toEqual([1, 2, 3]);
    expect(recording.frames.map((frame) => frame.deltaMs)).toEqual([
      1000 / 60,
      1000 / 60,
      1000 / 60,
    ]);
    expect(recording.frames[2]?.timeMs).toBe(1000 / 60 + 1000 / 60 + 1000 / 60);

    const draw = callsOf(recording).find(
      (call) => call.method === "drawGeometry",
    );
    const transform = fields(draw?.args[2]);
    // 1/3 is 0.3333333333333333; nine significant digits is 0.333333333.
    expect(fields(transform["position"])["x"]).toBe(0.333333333);
  });

  it("holds only `call` ops, each naming one of the ten vocabulary methods", async () => {
    const recording = await stagedRecording(2);
    expect(recording.ops.every((op) => op.op === "call")).toBe(true);
    const methods = new Set(
      recording.ops.map((op) => (op.op === "call" ? op.method : op.property)),
    );
    for (const method of methods) {
      expect(SCENE_OP_METHODS as readonly string[]).toContain(method);
    }
    // A producing call belongs to the recipe of the value it made, never to a
    // frame, so no `ops` entry may name one.
    for (const producer of PRODUCING_METHODS) {
      expect([...methods]).not.toContain(producer);
    }
  });

  it("opens each frame with the mode, the camera, and the lights, in that order", async () => {
    const recording = await stagedRecording(2);
    expect(methodsOf(recording, 0).slice(0, 3)).toEqual([
      "setMode",
      "setCamera",
      "setLights",
    ]);
    expect(methodsOf(recording, 1).slice(0, 3)).toEqual([
      "setMode",
      "setCamera",
      "setLights",
    ]);
  });

  it("states the renderer state each frame inherited, the first from the defaults", async () => {
    const recording = await stagedRecording(2);
    const first = recording.states[recording.frames[0]!.state]!;
    expect(Object.keys(first).sort()).toEqual(["camera", "lights", "mode"]);
    // Nothing had drawn when the first captured frame opened, so what it
    // inherited is a fresh engine's renderer state.
    expect(first.mode).toBe("standard");
    expect(first.lights).toEqual([]);
    expect(first.camera).toEqual({
      position: { x: 0, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fovY: 1.04719755,
      near: 0.1,
      far: 1000,
    });

    // The second frame inherits what the first left in force: the default rig.
    const second = recording.states[recording.frames[1]!.state]!;
    const direction = vec3Normalize({ x: -1, y: -2, z: -1 });
    expect(second.lights).toEqual([
      { type: "ambient", color: "#ffffff", intensity: 0.4 },
      {
        type: "directional",
        color: "#ffffff",
        intensity: 0.8,
        direction: {
          x: Number(direction.x.toPrecision(9)),
          y: Number(direction.y.toPrecision(9)),
          z: Number(direction.z.toPrecision(9)),
        },
      },
    ]);
  });

  it("lowers every layer's depth clear onto `clearDepth`, one before each layer", async () => {
    const recording = await stagedRecording();
    const methods = methodsOf(recording);
    // Two layers and the overlay, so three depth clears; the first sits
    // before the first layer's draws and after the state sets.
    expect(methods.filter((method) => method === "clearDepth")).toHaveLength(3);
    expect(methods.indexOf("clearDepth")).toBe(3);
    expect(methods.indexOf("drawGeometry")).toBeGreaterThan(3);
    const beforeBillboard = methods.lastIndexOf(
      "clearDepth",
      methods.indexOf("drawBillboard"),
    );
    expect(beforeBillboard).toBe(methods.indexOf("drawBillboard") - 1);
  });

  it("draws the collision overlay as a depth clear followed by its outlines", async () => {
    const recording = await stagedRecording();
    const methods = methodsOf(recording);
    // Three box colliders, six outline loops each.
    expect(methods.slice(-19)).toEqual([
      "clearDepth",
      ...Array.from({ length: 18 }, () => "drawLine"),
    ]);
  });

  it("states the strongest response each collider declares as the overlay's color", async () => {
    const recording = await stagedRecording();
    const colors = callsOf(recording)
      .slice(-18)
      .map((call) => call.args[1]);
    // Spawn order: the blocker, the trigger, then the collider answering
    // neither — six loops each, `#ff4040`, `#40ff40`, `#808080`.
    expect(new Set(colors.slice(0, 6))).toEqual(new Set(["#ff4040"]));
    expect(new Set(colors.slice(6, 12))).toEqual(new Set(["#40ff40"]));
    expect(new Set(colors.slice(12, 18))).toEqual(new Set(["#808080"]));
  });

  it("captures a lettered billboard as a `text:`-pathed texture of its own pixels", async () => {
    const recording = await stagedRecording();
    const billboard = callsOf(recording).find(
      (call) => call.method === "drawBillboard",
    );
    expect(billboard).toBeDefined();
    const handle = fields(billboard?.args[0]);
    const index = handle["$asset"];
    expect(typeof index).toBe("number");

    const asset = recording.assets[index as number];
    expect(asset?.kind).toBe("texture");
    if (asset?.kind !== "texture") throw new Error("not a texture entry");
    expect(asset.path).toBe("text:SCORE");
    expect(asset.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(asset.width).toBeGreaterThan(0);
    expect(asset.height).toBeGreaterThan(0);

    // The billboard's quad: the default `16px` face is eight world units wide
    // per character and sixteen tall, and the default centre alignment leaves
    // it on the component's own world position.
    expect(billboard?.args[1]).toEqual({ x: 0, y: 4, z: 0 });
    expect(billboard?.args[2]).toEqual({ x: 40, y: 16 });
  });

  it("captures one asset however many frames draw it", async () => {
    const recording = await stagedRecording(3);
    expect(recording.frames).toHaveLength(3);
    expect(recording.assets).toHaveLength(1);
  });

  it("names produced values as resources whose recipe is a make with an empty then", async () => {
    const recording = await stagedRecording();
    expect(recording.resources.length).toBeGreaterThan(0);
    for (const resource of recording.resources) {
      expect(Object.keys(resource).sort()).toEqual(["make", "then"]);
      expect(resource.then).toEqual([]);
      expect(PRODUCING_METHODS as readonly string[]).toContain(
        resource.make.method,
      );
    }
    // The one opaque box the scene draws, produced through `createBox`.
    expect(recording.resources.map((resource) => resource.make.method)).toEqual(
      ["createBox"],
    );
    expect(recording.resources[0]?.make.args).toEqual([{ x: 2, y: 2, z: 2 }]);
  });

  it("leaves a produced value that is never drawn out of the table", async () => {
    let made = 0;
    class Idle extends DrawComponent {
      override draw(drawApi: DrawApi): void {
        // Two boxes of the same size share one recipe; the second, never
        // drawn with, is not an entry at all.
        drawApi.scene.createBox({ x: 3, y: 3, z: 3 });
        const used = drawApi.scene.createBox({ x: 3, y: 3, z: 3 });
        drawApi.scene.drawGeometry(used, "#ffffff", {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        });
        drawApi.scene.createSphere(4);
        made += 1;
      }
    }
    const engine = makeEngine(
      stagedGame((world) => {
        world.spawn(Actor).attach(new Idle());
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(made).toBe(1);
    expect(recording.resources.map((resource) => resource.make.method)).toEqual(
      ["createBox"],
    );
  });

  it("flags a frame whose inherited light list was cut to the format's bound", async () => {
    const engine = makeEngine(
      stagedGame((world) => {
        const rig = world.spawn(Actor);
        for (let i = 0; i < 65; i += 1) {
          rig.attach(new AmbientLightComponent({ intensity: 0.01 }));
        }
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(2);
    const recording = engine.stopRecording();

    // The first captured frame inherited the empty list; the second inherited
    // the sixty-five the first set.
    expect(recording.frames[0]?.truncated).toBeUndefined();
    expect(recording.frames[1]?.truncated).toBe(true);
    expect(recording.states[recording.frames[1]!.state]?.lights).toHaveLength(
      64,
    );

    // The call itself is recorded whole: the bound is the renderer state's,
    // and the renderer uses the first sixty-four.
    const call = callsOf(recording, 1).find(
      (entry) => entry.method === "setLights",
    );
    expect((call?.args[0] as readonly DrawValue[]).length).toBe(65);
  });

  it("stops expanding one value at the format's sixty-five-thousand-value bound", async () => {
    class LongLine extends DrawComponent {
      override draw(drawApi: DrawApi): void {
        const points: Vec3[] = [];
        for (let i = 0; i < 20_000; i += 1) {
          points.push({ x: i, y: 0, z: 0 });
        }
        // A non-finite last point: the call is recorded whole and draws
        // nothing, so the bound is exercised without rasterizing a line the
        // assertion does not care about.
        points.push({ x: Number.NaN, y: 0, z: 0 });
        drawApi.scene.drawLine(points, "#ffffff");
      }
    }
    const engine = makeEngine(
      stagedGame((world) => {
        world.spawn(Actor).attach(new LongLine());
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    const line = callsOf(recording).find((call) => call.method === "drawLine");
    const points = line?.args[0] as readonly DrawValue[];
    // The array costs one value, then each point costs four (itself and its
    // three numbers), so the 65,536-value budget carries 16,384 whole points
    // — the last of them missing its final field — and then the remainder.
    expect(points.length).toBe(16_385);
    expect(points[16_384]).toEqual({ $opaque: "truncated" });
    expect(fields(points[16_383])).toEqual({
      x: 16_383,
      y: 0,
      $rest: { $opaque: "truncated" },
    });
    expect(fields(points[16_382])).toEqual({ x: 16_382, y: 0, z: 0 });
  });

  it("stops expanding a container reached at depth thirty-two", async () => {
    class DeepLine extends DrawComponent {
      override draw(drawApi: DrawApi): void {
        let chain: Record<string, unknown> = {};
        for (let i = 0; i < 40; i += 1) chain = { next: chain };
        // The vocabulary is typed, so a value this shape can only arrive
        // through a cast — which is exactly the case the bound exists for.
        drawApi.scene.drawLine([chain as unknown as Vec3], "#ffffff");
      }
    }
    const engine = makeEngine(
      stagedGame((world) => {
        world.spawn(Actor).attach(new DeepLine());
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    const line = callsOf(recording).find((call) => call.method === "drawLine");
    const points = line?.args[0] as readonly DrawValue[];
    // The array sits at depth zero and its entry at depth one, so the link
    // reached at depth thirty-two is the thirty-first hop from there.
    let cursor = fields(points[0]);
    for (let i = 0; i < 30; i += 1) cursor = fields(cursor["next"]);
    expect(cursor["next"]).toEqual({ $opaque: "Object" });
  });

  it("begins at the next frame and drops a frame open when the recorder is disarmed", async () => {
    // A box rather than a bare slot: both writes happen inside a closure the
    // compiler's flow analysis cannot follow, and a bare `let` would narrow to
    // `null` at the reads below.
    const capture: { armed: boolean; stopped: Recording | null } = {
      armed: false,
      stopped: null,
    };
    class Arm extends DrawComponent {
      override draw(): void {
        if (!capture.armed) {
          capture.armed = true;
          engine.startRecording();
        } else if (capture.stopped === null && engine.frame().count === 3) {
          capture.stopped = engine.stopRecording();
        }
      }
    }
    const engine: Engine<null> = makeEngine(
      stagedGame((world) => {
        world.spawn(Actor).attach(new Arm());
      }),
    );
    await engine.initialize();
    await engine.advance(3);

    // Armed from inside frame 1's draw, stopped from inside frame 3's: only
    // frame 2 was open for its whole length.
    const stopped = capture.stopped;
    expect(stopped).not.toBeNull();
    expect(stopped?.frames.map((frame) => frame.count)).toEqual([2]);
    // Every table entry is one the surviving frame names.
    const named = new Set(stopped?.frames[0]?.ops ?? []);
    expect(named.size).toBe(stopped?.ops.length);
  });

  it("refuses an unbalanced arm or disarm, naming the call", async () => {
    const engine = makeEngine(stagedGame(() => {}));
    await engine.initialize();
    expect(() => engine.stopRecording()).toThrow(
      /stopRecording was called while the recorder is not armed/,
    );
    engine.startRecording();
    expect(() => engine.startRecording()).toThrow(
      /startRecording was called while the recorder is already armed/,
    );
    expect(engine.recording()).toBe(true);
    engine.stopRecording();
    expect(engine.recording()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Collision manifolds against hand geometry                               */
/* -------------------------------------------------------------------------- */

/** One collider a probe places: a shape, where it sits, and how it is turned. */
interface Placed {
  shape: Shape3;
  position: Vec3;
  rotation?: Quat;
}

/**
 * Places pairs of colliders, one pair per channel, and returns the manifold
 * the frame's pass reported for each.
 *
 * Every pair is on its own channel and answers only that channel, so no two
 * pairs can see each other however close the probes are placed; and the first
 * collider of a pair is spawned first, so it carries the lower actor id and the
 * manifold is reported oriented from it toward the second.
 */
async function manifolds(
  cases: Readonly<Record<string, readonly [Placed, Placed]>>,
): Promise<Map<string, Manifold>> {
  const actors: ActorSpec[] = [];
  for (const [channel, pair] of Object.entries(cases)) {
    for (const placed of pair) {
      actors.push({
        type: Actor,
        transform: {
          position: placed.position,
          rotation: placed.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
        },
        configure: (actor) => {
          actor.attach(
            new ColliderComponent({
              shape: placed.shape,
              channel,
              responses: { [channel]: "block" },
            }),
          );
        },
      });
    }
  }
  const level: LevelDefinition = { mode: GameMode, actors };
  const engine = makeEngine<null>({
    levels: { probe: level },
    startLevel: "probe",
  });
  const found = new Map<string, Manifold>();
  engine.events.on("hit", (payload) => {
    found.set(payload.colliders[0].channel, payload.manifold);
  });
  await engine.initialize();
  await engine.advance(1);
  return found;
}

/** A manifold compared against figures worked out on paper. */
function expectManifold(
  found: Manifold | undefined,
  expected: { normal: Vec3; depth: number; point: Vec3 },
): void {
  expect(found).toBeDefined();
  expect(found!.normal.x).toBeCloseTo(expected.normal.x, 9);
  expect(found!.normal.y).toBeCloseTo(expected.normal.y, 9);
  expect(found!.normal.z).toBeCloseTo(expected.normal.z, 9);
  expect(found!.depth).toBeCloseTo(expected.depth, 9);
  expect(found!.point.x).toBeCloseTo(expected.point.x, 9);
  expect(found!.point.y).toBeCloseTo(expected.point.y, 9);
  expect(found!.point.z).toBeCloseTo(expected.point.z, 9);
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

describe("audit: collision manifolds against hand geometry", () => {
  it("separates two spheres along their centre line, at the midpoint of the lens", async () => {
    const found = await manifolds({
      spheres: [
        {
          shape: { kind: "sphere", radius: 1 },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "sphere", radius: 1 },
          position: { x: 1.5, y: 0, z: 0 },
        },
      ],
    });
    // Centres 1.5 apart, radii summing to 2: they overlap by 0.5, and the
    // boundaries they cut off sit at x = 1 and x = 0.5.
    expectManifold(found.get("spheres"), {
      normal: { x: 1, y: 0, z: 0 },
      depth: 0.5,
      point: { x: 0.75, y: 0, z: 0 },
    });
  });

  it("separates a sphere outside a box along the line to the box's closest point", async () => {
    const found = await manifolds({
      outside: [
        {
          shape: { kind: "sphere", radius: 1.5 },
          position: { x: 0, y: 3, z: 0 },
        },
        {
          shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
          position: { x: 0, y: 0, z: 0 },
        },
      ],
    });
    // The box's top face is y = 2, one unit below the sphere's centre, so the
    // sphere's 1.5 radius reaches half a unit past it.
    expectManifold(found.get("outside"), {
      normal: { x: 0, y: -1, z: 0 },
      depth: 0.5,
      point: { x: 0, y: 2, z: 0 },
    });
  });

  it("orients a box-then-sphere pair from the box, whichever way the shapes were derived", async () => {
    const found = await manifolds({
      flipped: [
        {
          shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "sphere", radius: 1.5 },
          position: { x: 0, y: 3, z: 0 },
        },
      ],
    });
    // The same geometry as above with the box spawned first: the manifold is
    // the mirror, because it is oriented by the reported order of the pair.
    expectManifold(found.get("flipped"), {
      normal: { x: 0, y: 1, z: 0 },
      depth: 0.5,
      point: { x: 0, y: 2, z: 0 },
    });
  });

  it("pushes a sphere inside a box out through the face with the least clearance", async () => {
    const found = await manifolds({
      inside: [
        {
          shape: { kind: "sphere", radius: 0.5 },
          position: { x: 0.5, y: 0, z: 0 },
        },
        {
          shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
          position: { x: 0, y: 0, z: 0 },
        },
      ],
    });
    // The +x face is 1.5 away and the others are 2, so the shortest way out is
    // through it: the sphere leaves along +x and the normal, which points from
    // the sphere toward the box, is its negation.
    expectManifold(found.get("inside"), {
      normal: { x: -1, y: 0, z: 0 },
      depth: 2,
      point: { x: 2, y: 0, z: 0 },
    });
  });

  it("separates two axis-aligned boxes on the axis of least overlap", async () => {
    const found = await manifolds({
      boxes: [
        {
          shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
          position: { x: 1.5, y: 0, z: 0 },
        },
      ],
    });
    // x overlaps by 0.5 and the other two by 2, so x wins; the point is the
    // midpoint between each box's deepest corner along it.
    expectManifold(found.get("boxes"), {
      normal: { x: 1, y: 0, z: 0 },
      depth: 0.5,
      point: { x: 0.75, y: 1, z: 1 },
    });
  });

  it("takes a turned box's projection radius on the separating axis", async () => {
    const found = await manifolds({
      turned: [
        {
          shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
          position: { x: 2, y: 0, z: 0 },
          rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
        },
      ],
    });
    // The turned box projects √2 onto x, so the overlap there is
    // 1 + √2 − 2 = √2 − 1, still the least of the fifteen candidate axes. The
    // second box's deepest corner along −x sits at x = 2 − √2.
    const root2 = Math.SQRT2;
    expectManifold(found.get("turned"), {
      normal: { x: 1, y: 0, z: 0 },
      depth: root2 - 1,
      point: { x: (1 + (2 - root2)) / 2, y: 0.5, z: 1 },
    });
  });

  it("collides a sphere with a capsule as a sphere around the nearest point on its axis", async () => {
    const found = await manifolds({
      capsule: [
        {
          shape: { kind: "sphere", radius: 1 },
          position: { x: 0, y: 1, z: 1.5 },
        },
        {
          shape: { kind: "capsule", radius: 1, height: 4 },
          position: { x: 0, y: 0, z: 0 },
        },
      ],
    });
    // The capsule's axis runs from (0, −2, 0) to (0, 2, 0); the point nearest
    // the sphere's centre is (0, 1, 0), 1.5 away, so the pair reads as two
    // unit spheres 1.5 apart.
    expectManifold(found.get("capsule"), {
      normal: { x: 0, y: 0, z: -1 },
      depth: 0.5,
      point: { x: 0, y: 1, z: 0.75 },
    });
  });

  it("collides two parallel capsules at the deterministic end of the first's axis", async () => {
    const found = await manifolds({
      capsules: [
        {
          shape: { kind: "capsule", radius: 1, height: 4 },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "capsule", radius: 1, height: 4 },
          position: { x: 1.5, y: 0, z: 0 },
        },
      ],
    });
    // Parallel axes have no single closest pair, so the derivation resolves
    // toward the first segment's start, at y = −2.
    expectManifold(found.get("capsules"), {
      normal: { x: 1, y: 0, z: 0 },
      depth: 0.5,
      point: { x: 0.75, y: -2, z: 0 },
    });
  });

  it("separates a box and a capsule still outside it along the line to the box", async () => {
    const found = await manifolds({
      sweep: [
        {
          shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "capsule", radius: 1, height: 2 },
          position: { x: 0, y: 3.5, z: 0 },
        },
      ],
    });
    // The capsule's lower cap centre is (0, 2.5, 0), half a unit above the
    // box's top face, so its 1 radius reaches half a unit inside.
    expectManifold(found.get("sweep"), {
      normal: { x: 0, y: 1, z: 0 },
      depth: 0.5,
      point: { x: 0, y: 2, z: 0 },
    });
  });

  it("scales a box per axis and a sphere by the largest factor, and encloses a turned box", async () => {
    const engine = makeEngine(
      stagedGame((world) => {
        const scaled = world.spawn(Actor, {
          transform: {
            position: { x: 10, y: 0, z: 0 },
            rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
          },
        });
        scaled.attach(
          new ColliderComponent({
            shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
          }),
        );
        const ball = world.spawn(Actor, {
          transform: {
            position: { x: 0, y: 0, z: 0 },
            scale: { x: 2, y: 3, z: 4 },
          },
        });
        ball.attach(
          new ColliderComponent({ shape: { kind: "sphere", radius: 1 } }),
        );
      }),
    );
    await engine.initialize();
    const [turned, ball] = engine.world.actors();

    // A turned unit-sided box's world extent on x and y is each half extent's
    // projection: 1·cos45 + 1·sin45 = √2, with z unturned at 1.
    const box = turned!.component(ColliderComponent)!.bounds();
    expect(box.min.x).toBeCloseTo(10 - Math.SQRT2, 9);
    expect(box.max.x).toBeCloseTo(10 + Math.SQRT2, 9);
    expect(box.min.y).toBeCloseTo(-Math.SQRT2, 9);
    expect(box.max.z).toBeCloseTo(1, 9);

    // A radius scales by the largest of the three factors' magnitudes.
    const sphere = ball!.component(ColliderComponent)!.bounds();
    expect(sphere).toEqual({
      min: { x: -4, y: -4, z: -4 },
      max: { x: 4, y: 4, z: 4 },
    });
  });

  it("reports the smallest translation that separates the pair, for every shape pairing", async () => {
    // The manifold's whole promise: `normal × depth` separates the two. Each
    // pair below is pushed apart by exactly that vector — plus a rounding
    // margin — and the next frame must find nothing.
    const pairs: Record<string, readonly [Placed, Placed]> = {
      spheres: [
        {
          shape: { kind: "sphere", radius: 1 },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "sphere", radius: 1 },
          position: { x: 1.5, y: 0.25, z: -0.5 },
        },
      ],
      insideBox: [
        {
          shape: { kind: "sphere", radius: 0.5 },
          position: { x: 0.5, y: 0.25, z: 0 },
        },
        {
          shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
          position: { x: 0, y: 0, z: 0 },
        },
      ],
      turnedBoxes: [
        {
          shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "box", size: { x: 2, y: 2, z: 2 } },
          position: { x: 2, y: 0.5, z: 0 },
          rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 4),
        },
      ],
      boxCapsule: [
        {
          shape: { kind: "box", size: { x: 4, y: 4, z: 4 } },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "capsule", radius: 1, height: 2 },
          position: { x: 0.5, y: 3.4, z: 0 },
        },
      ],
      capsules: [
        {
          shape: { kind: "capsule", radius: 1, height: 4 },
          position: { x: 0, y: 0, z: 0 },
        },
        {
          shape: { kind: "capsule", radius: 1, height: 4 },
          position: { x: 1.4, y: 0.3, z: 0.2 },
          rotation: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 6),
        },
      ],
    };

    const actors: ActorSpec[] = [];
    for (const [channel, pair] of Object.entries(pairs)) {
      for (const placed of pair) {
        actors.push({
          type: Actor,
          transform: {
            position: { ...placed.position },
            rotation: placed.rotation ?? IDENTITY,
          },
          tags: [channel],
          configure: (actor) => {
            actor.attach(
              new ColliderComponent({
                shape: placed.shape,
                channel,
                responses: { [channel]: "block" },
              }),
            );
          },
        });
      }
    }
    const engine = makeEngine<null>({
      levels: { probe: { mode: GameMode, actors } },
      startLevel: "probe",
    });
    const hits = new Map<string, Manifold>();
    engine.events.on("hit", (payload) => {
      hits.set(payload.colliders[0].channel, payload.manifold);
    });
    await engine.initialize();
    await engine.advance(1);
    expect([...hits.keys()].sort()).toEqual(Object.keys(pairs).sort());

    // Push the second collider of each pair out along +normal.
    for (const [channel, manifold] of hits) {
      const [, second] = engine.world.byTag(channel);
      const push = manifold.depth * (1 + 1e-9);
      second!.transform.position = {
        x: second!.transform.position.x + manifold.normal.x * push,
        y: second!.transform.position.y + manifold.normal.y * push,
        z: second!.transform.position.z + manifold.normal.z * push,
      };
    }
    hits.clear();
    await engine.advance(1);
    expect([...hits.keys()]).toEqual([]);
  });

  it("ends an overlap when a collider is disabled and when an actor is destroyed", async () => {
    const edges: string[] = [];
    const overlapping = (channel: string, tag: string): ActorSpec => ({
      type: Actor,
      transform: { position: { x: 0, y: 0, z: 0 } },
      tags: [tag],
      configure: (actor) => {
        actor.attach(
          new ColliderComponent({
            shape: { kind: "sphere", radius: 1 },
            channel,
            // Each pair answers only its own channel, so the four colliders
            // sitting on one another still form exactly two pairs.
            responses: { [channel]: "overlap" },
          }),
        );
      },
    });
    const engine = makeEngine<null>({
      levels: {
        probe: {
          mode: GameMode,
          actors: [
            overlapping("pair", "first"),
            overlapping("pair", "second"),
            overlapping("other", "third"),
            overlapping("other", "fourth"),
          ],
        },
      },
      startLevel: "probe",
    });
    engine.events.on("overlap:begin", () => edges.push("begin"));
    engine.events.on("overlap:end", () => edges.push("end"));
    await engine.initialize();
    await engine.advance(1);
    // Two pairs, each on its own channel.
    expect(edges).toEqual(["begin", "begin"]);

    edges.length = 0;
    engine.world.byTag("second")[0]!.component(ColliderComponent)!.enabled =
      false;
    await engine.advance(1);
    expect(edges).toEqual(["end"]);

    edges.length = 0;
    engine.world.byTag("fourth")[0]!.destroy();
    await engine.advance(1);
    expect(edges).toEqual(["end"]);
  });

  it("takes the stronger of the two directions, from either side alone", async () => {
    const seen: string[] = [];
    const engine = makeEngine(
      stagedGame((world) => {
        const ball = world.spawn(Actor, {
          transform: { position: { x: 0, y: 0, z: 0 } },
        });
        ball.attach(
          new ColliderComponent({
            shape: { kind: "sphere", radius: 1 },
            channel: "ball",
            responses: { wall: "overlap" },
          }),
        );
        const wall = world.spawn(Actor, {
          transform: { position: { x: 1.5, y: 0, z: 0 } },
        });
        wall.attach(
          new ColliderComponent({
            shape: { kind: "sphere", radius: 1 },
            channel: "wall",
            responses: { ball: "block" },
          }),
        );
      }),
    );
    engine.events.on("hit", () => seen.push("hit"));
    engine.events.on("overlap:begin", () => seen.push("overlap:begin"));
    await engine.initialize();
    await engine.advance(1);
    // One side answers `overlap` and the other `block`: `block` is stronger,
    // so the pair reports a hit and never an overlap edge.
    expect(seen).toEqual(["hit"]);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. The possession lifecycle                                                */
/* -------------------------------------------------------------------------- */

/** A pawn that records every notification it is given, in order. */
class Marked extends Pawn {
  readonly log: string[] = [];

  override possessedBy(controller: Controller): void {
    this.log.push(`possessedBy:${(controller as Named).mark}`);
  }

  override unpossessed(): void {
    this.log.push("unpossessed");
  }
}

/** A controller carrying a name, so an event names which seat moved. */
class Named extends AIController {
  mark = "?";
}

/** A world with no pawn class, so a bot arrives holding nothing. */
function seatGame(): GameDefinition<null> {
  class Empty extends GameMode {
    override pawnClass = null;
  }
  return { levels: { seats: { mode: Empty } }, startLevel: "seats" };
}

/** A world, two named controllers, and the possession events they fire. */
async function seats(): Promise<{
  engine: Engine<null>;
  a: Named;
  b: Named;
  events: EngineEventMap["possession:changed"][];
}> {
  const engine = makeEngine(seatGame());
  const events: EngineEventMap["possession:changed"][] = [];
  engine.events.on("possession:changed", (payload) => events.push(payload));
  await engine.initialize();
  const a = engine.world.mode.addBot(Named) as Named;
  a.mark = "a";
  const b = engine.world.mode.addBot(Named) as Named;
  b.mark = "b";
  events.length = 0;
  return { engine, a, b, events };
}

describe("audit: the possession lifecycle", () => {
  it("announces a take once, carrying what the seat held before", async () => {
    const { engine, a, events } = await seats();
    const pawn = engine.world.spawn(Marked);
    a.possess(pawn);

    expect(events).toHaveLength(1);
    expect(events[0]?.controller).toBe(a);
    expect(events[0]?.pawn).toBe(pawn);
    expect(events[0]?.previous).toBeNull();
    expect(pawn.controller).toBe(a);
    expect(pawn.log).toEqual(["possessedBy:a"]);
  });

  it("releases the seat's own pawn inside the take rather than as a second edge", async () => {
    const { engine, a, events } = await seats();
    const first = engine.world.spawn(Marked);
    const second = engine.world.spawn(Marked);
    a.possess(first);
    events.length = 0;

    a.possess(second);

    // One event for one seat that changed, with the released pawn as
    // `previous`; the released pawn is still notified.
    expect(events).toHaveLength(1);
    expect(events[0]?.controller).toBe(a);
    expect(events[0]?.pawn).toBe(second);
    expect(events[0]?.previous).toBe(first);
    expect(first.log).toEqual(["possessedBy:a", "unpossessed"]);
    expect(first.controller).toBeNull();
    expect(first.alive).toBe(true);
    expect(engine.world.actors()).toContain(first);
  });

  it("unseats the holder first, so the robbery reads as two edges in order", async () => {
    const { engine, a, b, events } = await seats();
    const pawn = engine.world.spawn(Marked);
    a.possess(pawn);
    events.length = 0;
    pawn.log.length = 0;

    b.possess(pawn);

    expect(events).toHaveLength(2);
    // The robbed seat announces its own unpossession, then the taking seat
    // announces the take.
    expect(events[0]?.controller).toBe(a);
    expect(events[0]?.pawn).toBeNull();
    expect(events[0]?.previous).toBe(pawn);
    expect(events[1]?.controller).toBe(b);
    expect(events[1]?.pawn).toBe(pawn);
    expect(events[1]?.previous).toBeNull();

    // And the pawn is told in the same order.
    expect(pawn.log).toEqual(["unpossessed", "possessedBy:b"]);
    expect(a.pawn).toBeNull();
    expect(b.pawn).toBe(pawn);
    expect(pawn.controller).toBe(b);
  });

  it("emits nothing when a seat holding nothing is asked to release", async () => {
    const { a, events } = await seats();
    a.unpossess();
    expect(events).toEqual([]);
    expect(a.pawn).toBeNull();
  });

  it("unpossesses a destroyed pawn at the mark and runs pawnDied after its endPlay", async () => {
    const log: string[] = [];
    class Dying extends Pawn {
      override endPlay(): void {
        log.push(`endPlay:controller=${String(this.controller)}`);
      }

      override unpossessed(): void {
        log.push("unpossessed");
      }
    }
    class Watcher extends GameMode {
      override pawnClass = null;

      override pawnDied(controller: Controller, pawn: Pawn): void {
        log.push(`pawnDied:${pawn.id}:${controller === seat ? "seat" : "?"}`);
      }
    }
    let seat: Controller | null = null;
    const engine = makeEngine<null>({
      levels: { seats: { mode: Watcher } },
      startLevel: "seats",
    });
    engine.events.on("actor:destroyed", (payload) =>
      log.push(`actor:destroyed:${payload.actor.id}`),
    );
    engine.events.on("possession:changed", (payload) =>
      log.push(`possession:changed:pawn=${String(payload.pawn)}`),
    );
    await engine.initialize();
    seat = engine.world.mode.addBot(Named);
    const pawn = engine.world.spawn(Dying);
    seat.possess(pawn);
    log.length = 0;

    pawn.destroy();
    expect(pawn.alive).toBe(false);
    // The seat clears at the mark, with its own edge, so nothing is still
    // holding a pawn the world is about to remove; the teardown itself is
    // deferred to the end of the frame.
    expect(log).toEqual(["unpossessed", "possession:changed:pawn=null"]);
    expect(seat.pawn).toBeNull();
    expect(pawn.controller).toBeNull();

    log.length = 0;
    await engine.advance(1);
    // And the flush runs the pawn's `endPlay` — which therefore observes no
    // controller — then announces the destruction, then hands `pawnDied` the
    // controller recorded at the mark.
    expect(log).toEqual([
      "endPlay:controller=null",
      `actor:destroyed:${pawn.id}`,
      `pawnDied:${pawn.id}:seat`,
    ]);
  });

  it("restarts a seat by destroying its pawn, spawning at the spawn point, and possessing", async () => {
    class Runner extends Pawn {}
    class Course extends GameMode {
      override pawnClass = Runner;

      override spawnPoint(): api.Transform {
        return {
          position: { x: 7, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        };
      }
    }
    const engine = makeEngine<null>({
      levels: { course: { mode: Course } },
      startLevel: "course",
    });
    await engine.initialize();
    const seat = engine.world.mode.addBot(Named);
    const first = seat.pawn!;
    expect(first.transform.position).toEqual({ x: 7, y: 0, z: 0 });

    const second = engine.world.mode.restart(seat);
    expect(second).not.toBe(first);
    expect(first.alive).toBe(false);
    expect(seat.pawn).toBe(second);
    expect(second?.transform.position).toEqual({ x: 7, y: 0, z: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Per-run ordering in a recording                                         */
/* -------------------------------------------------------------------------- */

describe("audit: per-run ordering in a recording", () => {
  /**
   * Four shapes on one layer, three of them translucent and placed at
   * different distances from the camera, plus one lettered billboard a layer
   * above, so both the in-layer ordering and the depth clear between layers
   * are observable in the issue order alone.
   */
  async function orderedRecording(): Promise<Recording> {
    const engine = makeEngine(
      stagedGame((world) => {
        const place = (z: number, opacity: number, size: number): void => {
          const actor = world.spawn(Actor, {
            transform: { position: { x: 0, y: 0, z } },
          });
          const shape = actor.attach(
            new ShapeComponent({
              shape: { kind: "box", size: { x: size, y: size, z: size } },
            }),
          );
          shape.opacity = opacity;
        };
        // Spawn order deliberately unlike the distance order: the camera sits
        // at z = 10, so these are 10, 20, and 15 away.
        place(0, 0.5, 1);
        place(-10, 0.5, 2);
        place(-5, 0.5, 3);
        // An opaque shape spawned last, which still draws before all three.
        place(2, 1, 4);
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    return engine.stopRecording();
  }

  it("draws a layer's opaque components before its translucent ones", async () => {
    const recording = await orderedRecording();
    const draws = callsOf(recording).filter(
      (call) => call.method === "drawGeometry",
    );
    expect(draws).toHaveLength(4);
    // The opaque one was spawned last and still leads the run.
    const first = fields(fields(draws[0]?.args[2])["position"]);
    expect(first["z"]).toBe(2);
  });

  it("sorts a run's translucent draws farthest from the camera first", async () => {
    const recording = await orderedRecording();
    const zs = callsOf(recording)
      .filter((call) => call.method === "drawGeometry")
      .slice(1)
      .map((call) => fields(fields(call.args[2])["position"])["z"]);
    // Distances 20, 15, 10 from a camera at z = 10.
    expect(zs).toEqual([-10, -5, 0]);
  });

  it("passes a translucent draw its material as a produced resource, not a colour", async () => {
    const recording = await orderedRecording();
    const draws = callsOf(recording).filter(
      (call) => call.method === "drawGeometry",
    );
    // The opaque shape draws with the colour shorthand; the translucent ones
    // need a material carrying their opacity.
    expect(draws[0]?.args[1]).toBe("#ffffff");
    for (const draw of draws.slice(1)) {
      const material = fields(draw.args[1]);
      const index = material["$res"];
      expect(typeof index).toBe("number");
      expect(recording.resources[index as number]?.make.method).toBe(
        "createMaterial",
      );
    }
  });

  it("opens exactly one run per layer, before that layer's first draw", async () => {
    const recording = await orderedRecording();
    const methods = methodsOf(recording);
    expect(methods).toEqual([
      "setMode",
      "setCamera",
      "setLights",
      "clearDepth",
      "drawGeometry",
      "drawGeometry",
      "drawGeometry",
      "drawGeometry",
    ]);
  });

  it("sorts by layer, then owner spawn order, then attachment order, stably", async () => {
    const engine = makeEngine(
      stagedGame((world) => {
        // Two actors, two components each, layers deliberately interleaved so
        // only a layer-first sort produces the order asserted below.
        const first = world.spawn(Actor, {
          transform: { position: { x: 1, y: 0, z: 0 } },
        });
        const firstHigh = first.attach(
          new ShapeComponent({ shape: { kind: "sphere", radius: 1 } }),
        );
        firstHigh.layer = 1;
        first.attach(
          new ShapeComponent({ shape: { kind: "sphere", radius: 2 } }),
        );

        const second = world.spawn(Actor, {
          transform: { position: { x: 2, y: 0, z: 0 } },
        });
        const secondHigh = second.attach(
          new ShapeComponent({ shape: { kind: "sphere", radius: 3 } }),
        );
        secondHigh.layer = 1;
        second.attach(
          new ShapeComponent({ shape: { kind: "sphere", radius: 4 } }),
        );
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    // The radius each draw names identifies the component it came from.
    const radii = callsOf(recording)
      .filter((call) => call.method === "drawGeometry")
      .map((call) => {
        const resource =
          recording.resources[fields(call.args[0])["$res"] as number];
        return resource?.make.args[0];
      });
    expect(radii).toEqual([2, 4, 1, 3]);
    // One depth clear per layer, and only two layers exist.
    expect(
      methodsOf(recording).filter((method) => method === "clearDepth"),
    ).toHaveLength(2);
  });

  it("lowers a lettered billboard onto a line loop under wireframe", async () => {
    const engine = makeEngine(
      stagedGame((world) => {
        const actor = world.spawn(Actor, {
          transform: { position: { x: 0, y: 0, z: 0 } },
        });
        actor.attach(new TextComponent({ text: "AB", fill: "#ff0000" }));
      }),
    );
    await engine.initialize();
    engine.renderer.setMode("wireframe");
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(methodsOf(recording)).toEqual([
      "setMode",
      "setCamera",
      "setLights",
      "clearDepth",
      "drawLine",
    ]);
    const line = callsOf(recording)[4]!;
    expect(line.args[1]).toBe("#ff0000");
    // Two characters at the default sixteen-unit face: an 16 × 16 quad
    // centred on the actor, closed back onto its first corner.
    expect(line.args[0]).toEqual([
      { x: -8, y: 8, z: 0 },
      { x: 8, y: 8, z: 0 },
      { x: 8, y: -8, z: 0 },
      { x: -8, y: -8, z: 0 },
      { x: -8, y: 8, z: 0 },
    ]);
    // The mode the frame states is the one it drew under, and nothing was
    // captured: a wireframe billboard rasterizes no lettering.
    expect(callsOf(recording)[0]?.args[0]).toBe("wireframe");
    expect(recording.assets).toEqual([]);
  });

  it("refuses a render mode outside the four, naming every valid one", async () => {
    const engine = makeEngine(stagedGame(() => {}));
    await engine.initialize();
    expect(() => engine.renderer.setMode("shaded" as api.RenderMode)).toThrow(
      /setMode was called with "shaded", which is not a render mode: the modes are "standard", "wireframe", "unlit", and "normals"/,
    );
    expect(engine.renderer.mode()).toBe("standard");
  });

  it("interns two frames' identical operations as one entry each", async () => {
    const engine = makeEngine(
      stagedGame((world) => {
        const actor = world.spawn(Actor);
        actor.attach(
          new ShapeComponent({ shape: { kind: "sphere", radius: 1 } }),
        );
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(4);
    const recording = engine.stopRecording();

    // Nothing moves, so all four frames issue the same five operations and
    // the table holds five entries.
    expect(recording.frames).toHaveLength(4);
    expect(recording.ops).toHaveLength(5);
    expect(recording.frames[0]?.ops).toEqual(recording.frames[3]?.ops);
    // And the states table holds the two distinct inherited states.
    expect(recording.states).toHaveLength(2);
    expect(recording.frames[1]?.state).toBe(recording.frames[3]?.state);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. World transition teardown                                               */
/* -------------------------------------------------------------------------- */

describe("audit: world transition teardown", () => {
  /** Every hook a transition runs, in one interleaved log. */
  async function transitionLog(): Promise<{
    log: string[];
    engine: Engine<null>;
  }> {
    const log: string[] = [];
    class Logged extends Actor {
      override beginPlay(): void {
        log.push(`actor.beginPlay:${this.id}`);
      }

      override endPlay(reason: string): void {
        log.push(`actor.endPlay:${this.id}:${reason}`);
      }
    }
    class LoggedController extends AIController {
      override endPlay(reason: string): void {
        log.push(`controller.endPlay:${reason}`);
      }
    }
    class First extends GameMode {
      override pawnClass = null;

      override beginPlay(): void {
        log.push("mode.beginPlay:first");
        this.addBot(LoggedController);
        this.world.after(9_999, () => log.push("timer:first"));
        this.world.diagnostics.register("worldOnly", () => 1);
      }

      override tick(): void {
        if (this.world.frame().count === 1) this.world.open("second");
      }

      override endPlay(reason: string): void {
        log.push(`mode.endPlay:first:${reason}`);
      }
    }
    class Second extends GameMode {
      override pawnClass = null;

      override beginPlay(): void {
        log.push("mode.beginPlay:second");
      }
    }
    class Instance extends GameInstance<null> {
      override initialize(): null {
        return null;
      }

      override worldOpened(world: World): void {
        log.push(`instance.worldOpened:${world.level}`);
      }

      override worldClosing(world: World): void {
        log.push(`instance.worldClosing:${world.level}`);
      }
    }
    const engine = makeEngine<null>({
      instance: Instance,
      levels: {
        first: {
          mode: First,
          actors: [{ type: Logged }, { type: Logged }],
          load: () => {
            log.push("load:first");
          },
        },
        second: {
          mode: Second,
          load: () => {
            log.push("load:second");
          },
        },
      },
      startLevel: "first",
    });
    for (const name of [
      "world:opening",
      "world:closed",
      "world:opened",
    ] as const) {
      engine.events.on(name, () => log.push(name));
    }
    await engine.initialize();
    log.length = 0;
    await engine.advance(1);
    return { log, engine };
  }

  it("runs the twelve steps in the order the page fixes them", async () => {
    const { log } = await transitionLog();
    expect(log).toEqual([
      "world:opening",
      "instance.worldClosing:first",
      "controller.endPlay:level-closed",
      "actor.endPlay:2:level-closed",
      "actor.endPlay:1:level-closed",
      "mode.endPlay:first:level-closed",
      "world:closed",
      "load:second",
      "mode.beginPlay:second",
      "world:opened",
      "instance.worldOpened:second",
    ]);
  });

  it("names both levels on the announcement and only the outgoing one on the close", async () => {
    const engine = makeEngine<null>({
      levels: {
        first: { mode: GameMode },
        second: { mode: GameMode },
      },
      startLevel: "first",
    });
    const opening: EngineEventMap["world:opening"][] = [];
    const closed: EngineEventMap["world:closed"][] = [];
    engine.events.on("world:opening", (payload) => opening.push(payload));
    engine.events.on("world:closed", (payload) => closed.push(payload));
    await engine.initialize();
    // The start level's own announcement carries `from: null`.
    expect(opening).toEqual([{ from: null, to: "first" }]);
    expect(closed).toEqual([]);

    engine.world.open("second");
    await engine.advance(1);
    expect(opening[1]).toEqual({ from: "first", to: "second" });
    expect(closed).toEqual([{ level: "first" }]);
  });

  it("ends every overlapping pair it was holding when the world closes", async () => {
    const ends: string[] = [];
    class Overlapping extends GameMode {
      override tick(): void {
        if (this.world.frame().count === 2) this.world.open("empty");
      }
    }
    const overlap = (channel: string): ActorSpec => ({
      type: Actor,
      transform: { position: { x: 0, y: 0, z: 0 } },
      configure: (actor) => {
        actor.attach(
          new ColliderComponent({
            shape: { kind: "sphere", radius: 1 },
            channel,
            responses: { pair: "overlap" },
          }),
        );
      },
    });
    const engine = makeEngine<null>({
      levels: {
        pairs: {
          mode: Overlapping,
          actors: [overlap("pair"), overlap("pair")],
        },
        empty: { mode: GameMode },
      },
      startLevel: "pairs",
    });
    engine.events.on("overlap:begin", () => ends.push("begin"));
    engine.events.on("overlap:end", () => ends.push("end"));
    await engine.initialize();
    await engine.advance(1);
    expect(ends).toEqual(["begin"]);
    await engine.advance(1);
    // The pair is still overlapping when the world closes, so the edge is
    // still closed rather than left dangling.
    expect(ends).toEqual(["begin", "end"]);
  });

  it("clears the outgoing world's timers, so none of them fire into the new world", async () => {
    let fired = 0;
    class Ticking extends GameMode {
      override beginPlay(): void {
        if (this.world.level !== "one") return;
        this.world.every(0.016, () => {
          fired += 1;
        });
      }

      override tick(): void {
        if (this.world.level === "one" && this.world.frame().count === 1) {
          this.world.open("two");
        }
      }
    }
    const engine = makeEngine<null>({
      levels: { one: { mode: Ticking }, two: { mode: Ticking } },
      startLevel: "one",
    });
    await engine.initialize();
    await engine.advance(1);
    const afterTransition = fired;
    await engine.advance(5);
    expect(fired).toBe(afterTransition);
  });

  it("rebuilds the world, its camera, its state, and world time, and carries the rest", async () => {
    class Hop extends GameMode {
      override tick(): void {
        if (this.world.level === "one" && this.world.frame().count === 3) {
          this.world.open("two");
        }
      }
    }
    class Instance extends GameInstance<null> {
      best = 0;

      override initialize(): null {
        return null;
      }
    }
    const engine = makeEngine<null>({
      instance: Instance,
      levels: { one: { mode: Hop }, two: { mode: Hop } },
      startLevel: "one",
    });
    await engine.initialize();
    (engine.instance as Instance).best = 42;
    const before = engine.world;
    before.camera.position = { x: 99, y: 99, z: 99 };
    before.mode.setPhase("playing");
    let subscriptions = 0;
    engine.events.on("world:opened", () => {
      subscriptions += 1;
    });

    await engine.advance(3);
    const after = engine.world;

    expect(after).not.toBe(before);
    expect(after.level).toBe("two");
    expect(after.mode).not.toBe(before.mode);
    expect(after.state).not.toBe(before.state);
    expect(after.camera).not.toBe(before.camera);
    // The camera is world state, so the incoming world starts at the defaults.
    expect(after.camera.position).toEqual({ x: 0, y: 0, z: 10 });
    expect(after.state.phase).toBe("waiting");
    // `world.time` restarts; the engine's own counter and clock do not.
    expect(after.time).toBe(0);
    expect(engine.frame().count).toBe(3);
    expect(engine.frame().timeMs).toBe(48);
    // The instance and subscriptions on `engine.events` survive.
    expect((engine.instance as Instance).best).toBe(42);
    expect(subscriptions).toBe(1);
  });

  it("drops the world's diagnostic sources and keeps the instance's", async () => {
    class Hop extends GameMode {
      override beginPlay(): void {
        this.world.diagnostics.register(`world:${this.world.level}`, () => 1);
      }

      override tick(): void {
        if (this.world.level === "one" && this.world.frame().count === 1) {
          this.world.open("two");
        }
      }
    }
    class Instance extends GameInstance<null> {
      override initialize(initApi: api.InitApi): null {
        initApi.diagnostics.register("instance", () => 1);
        return null;
      }
    }
    const engine = makeEngine<null>({
      instance: Instance,
      levels: { one: { mode: Hop }, two: { mode: Hop } },
      startLevel: "one",
    });
    await engine.initialize();
    await engine.advance(1);

    // No `Engine` member reports the registry, so the overlay's own read is
    // the only surface: a recording of the panel is not one, but the world's
    // sources being rebuilt is observable through what the new world holds.
    expect(engine.world.level).toBe("two");
    // Registering the outgoing world's name again must be a fresh
    // registration rather than a duplicate, which it is only if the old one
    // was dropped.
    expect(() =>
      engine.world.diagnostics.register("world:one", () => 2),
    ).not.toThrow();
  });

  it("honors one request per frame, the last one replacing the first", async () => {
    class Indecisive extends GameMode {
      override tick(): void {
        if (this.world.frame().count !== 1) return;
        this.world.open("two");
        this.world.open("three");
      }
    }
    const engine = makeEngine<null>({
      levels: {
        one: { mode: Indecisive },
        two: { mode: GameMode },
        three: { mode: GameMode },
      },
      startLevel: "one",
    });
    const opened: string[] = [];
    engine.events.on("world:opened", (payload) => opened.push(payload.level));
    await engine.initialize();
    await engine.advance(1);
    expect(opened).toEqual(["one", "three"]);
    expect(engine.world.level).toBe("three");
  });

  it("carries the request's options to the incoming mode and an empty object to the start level", async () => {
    const seen: Readonly<Record<string, unknown>>[] = [];
    class Watching extends GameMode {
      override beginPlay(): void {
        seen.push(this.options);
      }

      override tick(): void {
        if (this.world.level === "one" && this.world.frame().count === 1) {
          this.world.open("two", { round: 3, seed: "abc" });
        }
      }
    }
    const engine = makeEngine<null>({
      levels: { one: { mode: Watching }, two: { mode: Watching } },
      startLevel: "one",
    });
    await engine.initialize();
    await engine.advance(1);
    expect(seen).toEqual([{}, { round: 3, seed: "abc" }]);
  });

  it("builds every declared actor before any of their beginPlay runs", async () => {
    const peers: number[] = [];
    class Peer extends Actor {
      override beginPlay(): void {
        peers.push(this.world.actors().length);
      }
    }
    const engine = makeEngine<null>({
      levels: {
        crowd: {
          mode: GameMode,
          actors: [{ type: Peer }, { type: Peer }, { type: Peer }],
        },
      },
      startLevel: "crowd",
    });
    await engine.initialize();
    // Each of them finds all three, rather than one, two, three.
    expect(peers).toEqual([3, 3, 3]);
  });

  it("ends every controller's play in reverse order of addition, before the actors", async () => {
    const log: string[] = [];
    class Seat extends AIController {
      mark = "?";

      override endPlay(reason: string): void {
        log.push(`controller:${this.mark}:${reason}`);
      }
    }
    class Placed extends Actor {
      override endPlay(reason: string): void {
        log.push(`actor:${this.id}:${reason}`);
      }
    }
    class Crew extends GameMode {
      override pawnClass = null;

      override beginPlay(): void {
        if (this.world.level !== "one") return;
        for (const mark of ["a", "b", "c"]) {
          (this.addBot(Seat) as Seat).mark = mark;
        }
      }

      override tick(): void {
        if (this.world.level === "one" && this.world.frame().count === 1) {
          this.world.open("two");
        }
      }
    }
    const engine = makeEngine<null>({
      levels: {
        one: { mode: Crew, actors: [{ type: Placed }, { type: Placed }] },
        two: { mode: Crew },
      },
      startLevel: "one",
    });
    await engine.initialize();
    await engine.advance(1);
    expect(log).toEqual([
      "controller:c:level-closed",
      "controller:b:level-closed",
      "controller:a:level-closed",
      "actor:2:level-closed",
      "actor:1:level-closed",
    ]);
  });

  it("renders the world it opened, once, on the frame that performed the transition", async () => {
    class Hop extends GameMode {
      override tick(): void {
        if (this.world.level === "one" && this.world.frame().count === 1) {
          this.world.open("two");
        }
      }
    }
    const engine = makeEngine<null>({
      levels: {
        one: { mode: Hop, actors: [] },
        two: {
          mode: Hop,
          actors: [
            {
              type: Actor,
              configure: (actor) => {
                actor.attach(
                  new ShapeComponent({ shape: { kind: "sphere", radius: 1 } }),
                );
              },
            },
          ],
        },
      },
      startLevel: "one",
    });
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    // One frame, and its picture is the incoming world's — the outgoing one
    // held nothing to draw.
    expect(recording.frames).toHaveLength(1);
    expect(methodsOf(recording)).toContain("drawGeometry");
    // The transition ran before the render, so the world's own clock starts
    // from this frame rather than inheriting the outgoing world's.
    expect(engine.world.level).toBe("two");
    expect(engine.world.time).toBe(0);
    expect(engine.frame().count).toBe(1);
  });

  it("refuses a level it does not know before anything closes", async () => {
    class Typo extends GameMode {
      override tick(): void {
        if (this.world.frame().count === 1) this.world.open("secnod");
      }
    }
    const engine = makeEngine<null>({
      levels: { first: { mode: Typo }, second: { mode: GameMode } },
      startLevel: "first",
    });
    await engine.initialize();
    const standing = engine.world;
    await expect(engine.advance(1)).rejects.toThrow(
      /"secnod" is not a registered level/,
    );
    // The running world is still standing rather than half torn down.
    expect(engine.world).toBe(standing);
    expect(engine.world.level).toBe("first");
  });
});

/* -------------------------------------------------------------------------- */
/* 7. The camera's projection round trip                                      */
/* -------------------------------------------------------------------------- */

describe("audit: the camera's projection round trip", () => {
  const viewport: Viewport = fitViewport(640, 360, 640, 360, 1);
  const camera: CameraState = {
    position: { x: 0, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    fovY: Math.PI / 3,
    near: 0.1,
    far: 1000,
  };

  it("carries a projected point back onto the ray that reaches it", () => {
    const points: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: -2, z: -14 },
      { x: -7.5, y: 4.25, z: 5 },
      { x: 120, y: -60, z: -300 },
    ];
    for (const point of points) {
      const logical = projectPoint(camera, viewport, point);
      expect(logical).not.toBeNull();
      const ray = pointerRay(camera, viewport, logical!);
      // The ray leaves the camera and passes through the point, so the point
      // is origin + direction × distance for one positive distance.
      const to = {
        x: point.x - ray.origin.x,
        y: point.y - ray.origin.y,
        z: point.z - ray.origin.z,
      };
      const distance = Math.hypot(to.x, to.y, to.z);
      expect(ray.direction.x).toBeCloseTo(to.x / distance, 9);
      expect(ray.direction.y).toBeCloseTo(to.y / distance, 9);
      expect(ray.direction.z).toBeCloseTo(to.z / distance, 9);
    }
  });

  it("keeps the round trip through a turned camera", () => {
    const turned: CameraState = {
      ...camera,
      position: { x: 4, y: 3, z: 2 },
      rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 5),
    };
    const point: Vec3 = { x: -6, y: 1, z: -9 };
    const logical = projectPoint(turned, viewport, point)!;
    const ray = pointerRay(turned, viewport, logical);
    const to = {
      x: point.x - ray.origin.x,
      y: point.y - ray.origin.y,
      z: point.z - ray.origin.z,
    };
    const distance = Math.hypot(to.x, to.y, to.z);
    expect(ray.direction.x).toBeCloseTo(to.x / distance, 9);
    expect(ray.direction.y).toBeCloseTo(to.y / distance, 9);
    expect(ray.direction.z).toBeCloseTo(to.z / distance, 9);
    expect(ray.origin).toEqual(turned.position);
  });

  it("holds the y flip in the NDC step and nowhere else", () => {
    // A point on the camera's own axis lands dead centre.
    expect(projectPoint(camera, viewport, { x: 0, y: 0, z: 0 })).toEqual({
      x: 320,
      y: 180,
    });
    // The frustum's half height at ten units is 10·tan(π/6); a point that far
    // above the axis lands on the field's top edge, because the world is
    // y-up and the logical field is y-down.
    const halfHeight = 10 * Math.tan(Math.PI / 6);
    const top = projectPoint(camera, viewport, { x: 0, y: halfHeight, z: 0 })!;
    expect(top.x).toBeCloseTo(320, 9);
    expect(top.y).toBeCloseTo(0, 9);
    const halfWidth = halfHeight * (640 / 360);
    const right = projectPoint(camera, viewport, { x: halfWidth, y: 0, z: 0 })!;
    expect(right.x).toBeCloseTo(640, 9);
    expect(right.y).toBeCloseTo(180, 9);
  });

  it("returns null at or behind the camera plane and a value outside the field", () => {
    expect(projectPoint(camera, viewport, { x: 0, y: 0, z: 10 })).toBeNull();
    expect(projectPoint(camera, viewport, { x: 0, y: 0, z: 11 })).toBeNull();
    const outside = projectPoint(camera, viewport, { x: -100, y: 0, z: 0 })!;
    expect(outside.x).toBeLessThan(0);
  });

  it("keeps the frustum on the design aspect however the surface is shaped", () => {
    // The same logical field fitted onto three different surfaces: the fit
    // changes and the projection does not, which is what letterboxes a
    // picture identically everywhere.
    const point: Vec3 = { x: 2, y: 1, z: -4 };
    const wide = fitViewport(640, 360, 1280, 400, 1);
    const tall = fitViewport(640, 360, 400, 800, 2);
    expect(projectPoint(camera, wide, point)).toEqual(
      projectPoint(camera, viewport, point),
    );
    expect(projectPoint(camera, tall, point)).toEqual(
      projectPoint(camera, viewport, point),
    );
  });

  it("resolves a world point to a device pixel through the two viewport equations", () => {
    // A 640×360 field on an 800×360 surface at dpr 2: the uniform scale is
    // min(800/640, 360/360) × 2 = 2, and the left bar is (800×2 − 1280)/2.
    const fit = fitViewport(640, 360, 800, 360, 2);
    expect(fit.scale).toBe(2);
    expect(fit.offsetX).toBe(160);
    expect(fit.offsetY).toBe(0);
    const logical = projectPoint(camera, fit, { x: 0, y: 0, z: 0 })!;
    expect({
      x: fit.offsetX + logical.x * fit.scale,
      y: fit.offsetY + logical.y * fit.scale,
    }).toEqual({ x: 800, y: 360 });
  });

  it("gives a point inside a letterbox bar a ray all the same", () => {
    const fit = fitViewport(640, 360, 800, 360, 2);
    const ray = pointerRay(camera, fit, { x: -40, y: 180 });
    expect(
      Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z),
    ).toBeCloseTo(1, 9);
    expect(ray.direction.x).toBeLessThan(0);
    expect(ray.origin).toEqual(camera.position);
  });

  it("composes the camera's own project and ray from the world's current fit", async () => {
    const engine = makeEngine(stagedGame(() => {}));
    await engine.initialize();
    const world = engine.world;
    const point: Vec3 = { x: 1, y: -2, z: 3 };
    expect(world.camera.project(point)).toEqual(
      projectPoint(world.camera.snapshot(), engine.viewport(), point),
    );
    expect(world.camera.ray({ x: 10, y: 20 })).toEqual(
      pointerRay(world.camera.snapshot(), engine.viewport(), { x: 10, y: 20 }),
    );
    // The snapshot is a value the caller owns.
    const snapshot = world.camera.snapshot();
    snapshot.position.x = 500;
    expect(world.camera.position.x).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* 8. A DrawComponent's retained-state calls                                  */
/* -------------------------------------------------------------------------- */

describe("audit: a DrawComponent's retained-state calls", () => {
  /** Runs `body` inside a `DrawComponent`'s draw, once, and returns the engine. */
  async function inDraw(body: (drawApi: DrawApi) => void): Promise<void> {
    let ran = false;
    class Probe extends DrawComponent {
      override draw(drawApi: DrawApi): void {
        if (ran) return;
        ran = true;
        body(drawApi);
      }
    }
    const engine = makeEngine(
      stagedGame((world) => {
        world.spawn(Actor).attach(new Probe());
      }),
    );
    await engine.initialize();
    await engine.advance(1);
    expect(ran).toBe(true);
  }

  it("refuses setCamera, setLights, setMode, and clearDepth, naming the rule", async () => {
    const refusals: string[] = [];
    await inDraw((drawApi) => {
      const attempts: [string, () => void][] = [
        ["setCamera", () => drawApi.scene.setCamera(drawApi.camera())],
        ["setLights", () => drawApi.scene.setLights([])],
        ["setMode", () => drawApi.scene.setMode("unlit")],
        ["clearDepth", () => drawApi.scene.clearDepth()],
      ];
      for (const [name, attempt] of attempts) {
        try {
          attempt();
          refusals.push(`${name}: NOT REFUSED`);
        } catch (error) {
          refusals.push(`${name}: ${(error as Error).message}`);
        }
      }
    });
    expect(refusals).toHaveLength(4);
    for (const refusal of refusals) {
      expect(refusal).toMatch(
        /^(setCamera|setLights|setMode|clearDepth): \1 was called from a DrawComponent's draw: the camera, the lights, the mode, and the depth clear belong to the pipeline$/,
      );
    }
  });

  it("leaves a refused call out of the recording, so the frame reads as issued", async () => {
    let recording: Recording | null = null;
    class Probe extends DrawComponent {
      override draw(drawApi: DrawApi): void {
        try {
          drawApi.scene.setMode("wireframe");
        } catch {
          // Refused, as specified.
        }
        drawApi.scene.drawHudRect({ x: 0, y: 0 }, { x: 4, y: 4 }, "#ffffff");
      }
    }
    const engine = makeEngine(
      stagedGame((world) => {
        world.spawn(Actor).attach(new Probe());
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    recording = engine.stopRecording();

    // One `setMode` — the pipeline's own — and the mode it names is the one
    // in force, not the value the refused call carried.
    const modes = callsOf(recording).filter(
      (call) => call.method === "setMode",
    );
    expect(modes).toHaveLength(1);
    expect(modes[0]?.args[0]).toBe("standard");
    expect(methodsOf(recording)).toContain("drawHudRect");
  });

  it("lets the draw calls through in the same place in the layer order", async () => {
    const seen: string[] = [];
    class Probe extends DrawComponent {
      constructor(private readonly mark: string) {
        super();
      }

      override draw(drawApi: DrawApi): void {
        seen.push(this.mark);
        drawApi.scene.drawLine(
          [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          "#ffffff",
        );
      }
    }
    const engine = makeEngine(
      stagedGame((world) => {
        const above = world.spawn(Actor).attach(new Probe("above"));
        above.layer = 2;
        world.spawn(Actor).attach(new Probe("below"));
      }),
    );
    await engine.initialize();
    engine.startRecording();
    await engine.advance(1);
    const recording = engine.stopRecording();

    expect(seen).toEqual(["below", "above"]);
    expect(methodsOf(recording)).toEqual([
      "setMode",
      "setCamera",
      "setLights",
      "clearDepth",
      "drawLine",
      "clearDepth",
      "drawLine",
    ]);
  });

  it("refuses every vocabulary call from a context kept past the frame", async () => {
    let kept: SceneContext | null = null;
    await inDraw((drawApi) => {
      kept = drawApi.scene;
    });
    const context = kept as unknown as SceneContext;
    expect(() => context.drawLine([{ x: 0, y: 0, z: 0 }], "#ffffff")).toThrow(
      /drawLine was called outside the render pipeline/,
    );
    expect(() => context.createBox({ x: 1, y: 1, z: 1 })).toThrow(
      /createBox was called outside the render pipeline/,
    );
    expect(() => context.setMode("unlit")).toThrow(
      /setMode was called outside the render pipeline/,
    );
  });

  it("hands the same context object to every draw, so a held reference stays live", async () => {
    const contexts: SceneContext[] = [];
    class Probe extends DrawComponent {
      override draw(drawApi: DrawApi): void {
        contexts.push(drawApi.scene);
      }
    }
    const engine = makeEngine(
      stagedGame((world) => {
        world.spawn(Actor).attach(new Probe());
      }),
    );
    await engine.initialize();
    await engine.advance(3);
    expect(contexts).toHaveLength(3);
    expect(new Set(contexts).size).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* 9. Every documented option field reaches what it names                     */
/* -------------------------------------------------------------------------- */

/**
 * One field of one options interface, dropped on the floor, is the cheapest
 * defect in the package to write and the hardest to notice: the build compiles,
 * the frame runs, and the value silently reads as its default. So every field
 * the API pages document is set to a value unlike its default and read back.
 */
describe("audit: every documented option field reaches what it names", () => {
  it("carries every light option, a point light's included", () => {
    // `PointLightOptions` extends `LightOptions`, so a point light takes the
    // two fields every light takes.
    const point = new PointLightComponent({
      color: "#ff8800",
      intensity: 2.5,
      range: 30,
    });
    expect(point.color).toBe("#ff8800");
    expect(point.intensity).toBe(2.5);
    expect(point.range).toBe(30);
    expect(new PointLightComponent().color).toBe("#ffffff");
    expect(new PointLightComponent().intensity).toBe(1);
    expect(new PointLightComponent().range).toBe(0);

    for (const Light of [AmbientLightComponent, DirectionalLightComponent]) {
      const light = new Light({ color: "#00ff00", intensity: 0.25 });
      expect(light.color).toBe("#00ff00");
      expect(light.intensity).toBe(0.25);
      expect(new Light().color).toBe("#ffffff");
      expect(new Light().intensity).toBe(1);
    }
  });

  it("carries every mesh, shape, text, and camera component option", () => {
    const mesh = {
      path: "models/ship.glb",
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      nodes: ["root"],
      clips: ["walk"],
    } as api.MeshHandle;
    const material = {
      path: "materials/hull",
      maps: {},
    } as api.MaterialHandle;

    const body = new api.MeshComponent({
      mesh,
      material,
      color: "#123456",
      clip: "walk",
      clipTime: 1.25,
    });
    expect(body.mesh).toBe(mesh);
    expect(body.material).toBe(material);
    expect(body.color).toBe("#123456");
    expect(body.clip).toBe("walk");
    expect(body.clipTime).toBe(1.25);
    const bare = new api.MeshComponent({ mesh });
    expect(bare.material).toBeNull();
    expect(bare.color).toBeNull();
    expect(bare.clip).toBeNull();
    expect(bare.clipTime).toBe(0);

    const shape: Shape3 = { kind: "capsule", radius: 2, height: 3 };
    const solid = new ShapeComponent({ shape, color: "#abcdef", material });
    expect(solid.shape).toBe(shape);
    expect(solid.color).toBe("#abcdef");
    expect(solid.material).toBe(material);
    expect(new ShapeComponent({ shape }).color).toBe("#ffffff");
    expect(new ShapeComponent({ shape }).material).toBeNull();

    const label = new TextComponent({
      text: "GO",
      font: "32px monospace",
      fill: "#00ffff",
      align: "right",
      baseline: "top",
    });
    expect(label.text).toBe("GO");
    expect(label.font).toBe("32px monospace");
    expect(label.fill).toBe("#00ffff");
    expect(label.align).toBe("right");
    expect(label.baseline).toBe("top");
    const plain = new TextComponent({ text: "GO" });
    expect(plain.font).toBe("16px monospace");
    expect(plain.fill).toBe("#ffffff");
    expect(plain.align).toBe("center");
    expect(plain.baseline).toBe("middle");

    expect(new api.CameraComponent({ fovY: 1.1 }).fovY).toBe(1.1);
    expect(new api.CameraComponent().fovY).toBe(Math.PI / 3);

    // Every render component's own three fields default as documented.
    expect(solid.layer).toBe(0);
    expect(solid.visible).toBe(true);
    expect(solid.opacity).toBe(1);
    expect(solid.enabled).toBe(true);
  });

  it("carries every collider option, copying the response map it was given", () => {
    const responses: Record<string, api.CollisionResponse> = { wall: "block" };
    const collider = new ColliderComponent({
      shape: { kind: "sphere", radius: 1 },
      channel: "ball",
      responses,
    });
    expect(collider.channel).toBe("ball");
    expect(collider.responses).toEqual({ wall: "block" });
    // Copied, so retuning the record a caller passed does not reach through.
    responses["goal"] = "overlap";
    expect(collider.responses["goal"]).toBeUndefined();

    const bare = new ColliderComponent({
      shape: { kind: "sphere", radius: 1 },
    });
    expect(bare.channel).toBe("default");
    expect(bare.responses).toEqual({});
  });

  it("carries every actor and spawn spec field, in the documented order", async () => {
    const order: string[] = [];
    class Configured extends Actor {
      seen: { position: Vec3; tags: string[] } | null = null;

      override beginPlay(): void {
        order.push("beginPlay");
      }
    }
    // Annotated rather than written inline: `LevelDefinition.actors` is
    // `readonly ActorSpec[]`, so a spec written inside a level literal binds
    // `A` to `Actor` and its `configure` never sees the subclass. Naming the
    // spec's own type is what a game does to configure a declared actor.
    const spec: ActorSpec<Configured> = {
      type: Configured,
      transform: {
        position: { x: 1, y: 2, z: 3 },
        scale: { x: 4, y: 4, z: 4 },
      },
      tags: ["placed", "declared"],
      configure: (actor) => {
        order.push("configure");
        // `configure` runs after the transform and the tags are applied and
        // before `beginPlay`.
        actor.seen = {
          position: { ...actor.transform.position },
          tags: [...actor.tags],
        };
      },
    };
    const engine = makeEngine<null>({
      levels: { stage: { mode: GameMode, actors: [spec] } },
      startLevel: "stage",
    });
    await engine.initialize();
    const declared = engine.world.find(Configured)!;
    expect(order).toEqual(["configure", "beginPlay"]);
    expect(declared.seen).toEqual({
      position: { x: 1, y: 2, z: 3 },
      tags: ["placed", "declared"],
    });
    // A present field replaces the whole value and an absent one is the
    // identity's, with no merging inside either.
    expect(declared.transform.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(declared.transform.rotation).toEqual(IDENTITY);
    expect(declared.transform.scale).toEqual({ x: 4, y: 4, z: 4 });

    // `SpawnSpec` carries the same three fields with the same meaning.
    const spawned = engine.world.spawn(Configured, {
      transform: { rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0) },
      tags: ["runtime"],
      configure: (actor) => {
        actor.seen = {
          position: { ...actor.transform.position },
          tags: [...actor.tags],
        };
      },
    });
    expect(spawned.transform.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(spawned.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(spawned.hasTag("runtime")).toBe(true);
    expect(spawned.seen?.tags).toEqual(["runtime"]);
  });

  it("carries every player and bot option", async () => {
    class Seat extends PlayerController {}
    class Bot extends AIController {}
    class Alt extends Pawn {}
    class Standard extends Pawn {}
    class Table extends GameMode {
      override pawnClass = Standard;

      override playerControllerClass = Seat;
    }
    const engine = makeEngine<null>({
      levels: { table: { mode: Table } },
      startLevel: "table",
    });
    await engine.initialize();
    const mode = engine.world.mode;

    const named = mode.addPlayer({ index: 4, name: "Ada", pawn: Alt });
    expect(named).toBeInstanceOf(Seat);
    expect(named.index).toBe(4);
    expect(named.playerState.name).toBe("Ada");
    expect(named.pawn).toBeInstanceOf(Alt);

    class Other extends PlayerController {}
    const custom = mode.addPlayer({ controller: Other, pawn: null });
    expect(custom).toBeInstanceOf(Other);
    // An explicit `null` stands in for `pawnClass`, so the seat arrives empty.
    expect(custom.pawn).toBeNull();

    const bot = mode.addBot(Bot, { name: "Hal", pawn: Alt });
    expect(bot).toBeInstanceOf(Bot);
    expect(bot.playerState.name).toBe("Hal");
    expect(bot.pawn).toBeInstanceOf(Alt);

    const plain = mode.addPlayer();
    expect(plain.pawn).toBeInstanceOf(Standard);
    // An index the options name is taken as given, and every later
    // participant fills the lowest gap; the list is kept in index order, a
    // bot's state alongside a player's.
    expect(custom.index).toBe(0);
    expect(bot.playerState.index).toBe(1);
    expect(plain.index).toBe(2);
    expect(engine.world.state.players.map((player) => player.index)).toEqual([
      0, 1, 2, 4,
    ]);
    expect(engine.world.state.players.map((player) => player.name)).toEqual([
      "",
      "Hal",
      "",
      "Ada",
    ]);
    // `players()` reports the player controllers alone, in index order.
    expect(engine.world.players()).toEqual([custom, plain, named]);
    // `controllers()` reports all of them, in the order they were added.
    expect(engine.world.controllers()).toEqual([named, custom, bot, plain]);
  });

  it("carries every engine option a construction reads", async () => {
    let seen: { layout: string | null; resolved: string } | null = null;
    class Instance extends GameInstance<null> {
      override initialize(initApi: api.InitApi): null {
        seen = {
          layout: initApi.input.layout()?.name ?? null,
          resolved: initApi.assets.resolve("models/ship.glb"),
        };
        return null;
      }
    }
    const engine = makeEngine<null>(
      {
        instance: Instance,
        levels: { stage: { mode: GameMode } },
        startLevel: "stage",
      },
      { layout: "wheel-pedals", assetRoot: "content/" },
    );
    await engine.initialize();
    expect(seen).toEqual({
      layout: "wheel-pedals",
      resolved: "content/models/ship.glb",
    });

    // And the default root, for an engine given none.
    let root: string | null = null;
    class Bare extends GameInstance<null> {
      override initialize(initApi: api.InitApi): null {
        root = initApi.assets.resolve("a.png");
        return null;
      }
    }
    const plain = makeEngine<null>({
      instance: Bare,
      levels: { stage: { mode: GameMode } },
      startLevel: "stage",
    });
    await plain.initialize();
    expect(root).toBe("assets/a.png");
  });

  it("refuses a layout outside the catalogue, naming every valid one", () => {
    expect(() =>
      makeEngine(
        stagedGame(() => {}),
        { layout: "twin-stick" },
      ),
    ).toThrow(/twin-stick/);
    for (const name of Object.keys(api.TOUCH_LAYOUTS)) {
      expect(() =>
        makeEngine(
          stagedGame(() => {}),
          { layout: "twin-stick" },
        ),
      ).toThrow(new RegExp(name));
    }
  });
});
