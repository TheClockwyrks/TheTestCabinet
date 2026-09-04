// @vitest-environment node
/**
 * `@test-cabinet/simple-3d`'s recorder against this console's copy of the 3D
 * format.
 *
 * The whole suite — the scenarios, the invariants, the coverage the sweep has to
 * reach, and the long account of what it checks and what it deliberately does
 * not — lives in {@link ./recordingParity3dSuite}. This file binds it to the
 * engine whose drift against `format3d.ts` it was first written to catch, by
 * assembling a build the way a case's own checks assemble one: a game over a
 * canvas `@test-cabinet/headless-webgl2` makes in process, stepped by a scripted
 * clock, with the recorder armed around the frames.
 *
 * In Simple 3D the game owns the renderer state, so this binding issues the
 * scenario's camera, lights, mode and depth clear itself, from inside `render`,
 * exactly where a build would.
 *
 * Beside the run, the type-level half: this console's copied declarations held
 * against the types the engine exports. A test can only see the drift that
 * changes a document; a verb added to the engine's vocabulary or a field renamed
 * on both sides of the recorder is a compile error here instead.
 */

import { createCanvas } from "@test-cabinet/headless-webgl2";
import {
  ConstantClock,
  createEngine,
  RECORDING_FORMAT,
  type CameraState as EngineCameraState,
  type CapturedAsset as EngineCapturedAsset,
  type DrawOp as EngineDrawOp,
  type Game,
  type LightState as EngineLightState,
  type MaterialMapSlot as EngineMaterialMapSlot,
  type ProducingMethod as EngineProducingMethod,
  type RecordedFrame as EngineRecordedFrame,
  type Recording as EngineRecording,
  type RenderMode as EngineRenderMode,
  type RenderState as EngineRenderState,
  type Resource as EngineResource,
  type SceneOpMethod as EngineSceneOpMethod,
  type SurfaceMetrics,
} from "@test-cabinet/simple-3d";
import { expect, it } from "vitest";
import type {
  CameraState,
  CapturedAsset,
  DrawOp3d,
  LightState,
  MaterialMapSlot,
  ProducingMethod,
  RecordedFrame3d,
  Recording3d,
  RenderMode,
  RenderState3d,
  Resource3d,
  SceneOpMethod,
} from "./format3d";
import {
  ASSET_PATHS,
  describeRecording3dParity,
  type DrawVerbs,
  type LightKind,
  type LoadedAssets,
  type Mutual,
  type Scenario,
} from "./recordingParity3dSuite";

/** The design field every run is projected into, and the element it lands on. */
const WIDTH = 640;
const HEIGHT = 360;
const CSS_WIDTH = 160;
const CSS_HEIGHT = 90;

/** The camera every run is driven under: the engine's own defaults, restated. */
const CAMERA: EngineCameraState = {
  position: { x: 0, y: 0, z: 10 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  fovY: Math.PI / 3,
  near: 0.1,
  far: 1000,
};

/** One light of the kind a scenario asked for, with values of this build's own. */
function lightOf(kind: LightKind): EngineLightState {
  if (kind === "ambient") {
    return { type: "ambient", color: "#ffffff", intensity: 0.4 };
  }
  if (kind === "directional") {
    return {
      type: "directional",
      color: "#ffffff",
      intensity: 0.85,
      direction: { x: -0.3, y: -1, z: -0.2 },
    };
  }
  return {
    type: "point",
    color: "#ff2d55",
    intensity: 2,
    position: { x: 0, y: 3, z: 0 },
    range: 12,
  };
}

/** Nothing lays an element out here, so the surface answers a fixed size. */
function pageSurface(): SurfaceMetrics {
  const target = new EventTarget();
  return {
    cssWidth: () => CSS_WIDTH,
    cssHeight: () => CSS_HEIGHT,
    dpr: () => 1,
    events: () => target,
  };
}

/**
 * Run one scenario: build the game, load its assets, record its frames.
 *
 * The game's `render` is where the scenario lands, because that is where a build
 * draws — the scenario's renderer state first, in the order the format applies
 * it, then the frame's own script. The frame counter is the binding's own rather
 * than the engine's: `render` runs once per frame, and the scripts are a list.
 */
async function record(scenario: Scenario): Promise<unknown> {
  let assets: LoadedAssets = { mesh: null, texture: null, material: null };
  let at = 0;

  const game: Game<number, null> = {
    initialize: async (api) => {
      const [mesh, texture, material] = await Promise.all([
        api.assets.loadMesh(ASSET_PATHS.mesh),
        api.assets.loadTexture(ASSET_PATHS.texture),
        api.assets.loadMaterial(ASSET_PATHS.material),
      ]);
      assets = { mesh, texture, material };
      return [0, null];
    },
    update: (state) => state + 1,
    render: (_state, api) => {
      const scene = api.scene;
      scene.setCamera(CAMERA);
      if (scenario.lights !== undefined) {
        scene.setLights(scenario.lights.map(lightOf));
      }
      if (scenario.mode !== undefined) scene.setMode(scenario.mode);
      if (scenario.depthClear === true) scene.clearDepth();
      const script = scenario.frames[at];
      at += 1;
      script?.(scene as DrawVerbs, assets);
    },
  };

  const engine = createEngine<number, null>({
    canvas: createCanvas(CSS_WIDTH, CSS_HEIGHT) as unknown as HTMLCanvasElement,
    width: WIDTH,
    height: HEIGHT,
    game,
    background: "#05060a",
    clock: new ConstantClock(1000 / 60),
    surface: pageSurface(),
  });
  await engine.initialize();
  engine.startRecording();
  await engine.advance(scenario.frames.length);
  const written = engine.stopRecording();
  engine.destroy();
  return written;
}

describeRecording3dParity({
  name: "@test-cabinet/simple-3d",
  format: RECORDING_FORMAT,
  record,
});

it("declares the types the engine declares, name for name", () => {
  // Each of these is `true` only while the engine's exported type and this
  // console's copy are assignable to each other. A drift on either side makes the
  // annotation a type error, which is the whole assertion; the runtime `expect`
  // is what keeps the constants from being unused locals.
  const same: readonly boolean[] = [
    true satisfies Mutual<EngineRecording, Recording3d>,
    true satisfies Mutual<EngineRecordedFrame, RecordedFrame3d>,
    true satisfies Mutual<EngineRenderState, RenderState3d>,
    true satisfies Mutual<EngineCameraState, CameraState>,
    true satisfies Mutual<EngineLightState, LightState>,
    true satisfies Mutual<EngineRenderMode, RenderMode>,
    true satisfies Mutual<EngineDrawOp, DrawOp3d>,
    true satisfies Mutual<EngineResource, Resource3d>,
    true satisfies Mutual<EngineCapturedAsset, CapturedAsset>,
    true satisfies Mutual<EngineMaterialMapSlot, MaterialMapSlot>,
    true satisfies Mutual<EngineSceneOpMethod, SceneOpMethod>,
    true satisfies Mutual<EngineProducingMethod, ProducingMethod>,
  ];
  expect(same.every((held) => held)).toBe(true);
});
