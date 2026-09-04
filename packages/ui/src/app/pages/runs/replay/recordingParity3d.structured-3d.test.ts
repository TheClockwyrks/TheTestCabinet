// @vitest-environment node
/**
 * `@test-cabinet/structured-3d`'s recorder against this console's copy of the 3D
 * format.
 *
 * Structured 3D writes the same 3D document as Simple 3D — its `contract.ts` is
 * that one carried twice, and its docs say so: the vocabulary is shared, so one
 * player draws both engines' recordings. So it carries exactly the drift risk
 * `recordingParity3d.simple-3d.test.ts` exists to catch, and gets exactly the
 * same sweep. The whole suite lives in {@link ./recordingParity3dSuite}; this
 * file binds it to this engine.
 *
 * What differs is how a build is assembled, and it is the reason the suite is
 * parameterized at all. Here the renderer state belongs to the engine: a
 * component that calls `setCamera`, `setLights`, `setMode` or `clearDepth` is
 * refused by name, because the pipeline issues them. So this binding reaches the
 * scenario's state the way a game reaches it — lights are light components on an
 * actor, the mode is set through the engine's renderer — and the scenario's
 * drawing rides on a `DrawComponent`, the direct-drawing path a case that
 * measures the drawing itself uses. Every one of the ten verbs still lands in
 * the recording; some of them are the pipeline's rather than the build's.
 *
 * Beside the run, the type-level half, for the reason the sibling file states.
 * Its contract types are imported from the `./recording` subpath, which serves
 * the recording format alone.
 */

import { createCanvas } from "@test-cabinet/headless-webgl2";
import {
  Actor,
  AmbientLightComponent,
  ConstantClock,
  createEngine,
  DirectionalLightComponent,
  DrawComponent,
  GameInstance,
  GameMode,
  PointLightComponent,
  RECORDING_FORMAT,
  type CameraState as EngineCameraState,
  type Component,
  type DrawApi,
  type GameDefinition,
  type InitApi,
  type SurfaceMetrics,
} from "@test-cabinet/structured-3d";
import type {
  CapturedAsset as EngineCapturedAsset,
  DrawOp as EngineDrawOp,
  LightState as EngineLightState,
  MaterialMapSlot as EngineMaterialMapSlot,
  ProducingMethod as EngineProducingMethod,
  RecordedFrame as EngineRecordedFrame,
  Recording as EngineRecording,
  RenderMode as EngineRenderMode,
  RenderState as EngineRenderState,
  Resource as EngineResource,
  SceneOpMethod as EngineSceneOpMethod,
} from "@test-cabinet/structured-3d/recording";
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

/** A light component of the kind a scenario asked for. */
function lightOf(kind: LightKind): Component {
  if (kind === "ambient") {
    return new AmbientLightComponent({ color: "#ffffff", intensity: 0.4 });
  }
  if (kind === "directional") {
    return new DirectionalLightComponent({
      color: "#ffffff",
      intensity: 0.85,
    });
  }
  return new PointLightComponent({
    color: "#ff2d55",
    intensity: 2,
    range: 12,
  });
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
 * The scenario lands on a `DrawComponent`, whose `draw` the pipeline calls once
 * per frame in its place in the layer order. The frame counter is the binding's
 * own, for the reason the sibling file gives: `draw` runs once a frame, and the
 * scripts are a list.
 */
async function record(scenario: Scenario): Promise<unknown> {
  let assets: LoadedAssets = { mesh: null, texture: null, material: null };
  let at = 0;

  class Painter extends DrawComponent {
    override draw(api: DrawApi): void {
      const script = scenario.frames[at];
      at += 1;
      script?.(api.scene as DrawVerbs, assets);
    }
  }

  /** One actor carrying the build's drawing and every light the scenario asked for. */
  class Easel extends Actor {
    constructor() {
      super();
      this.attach(new Painter());
      for (const kind of scenario.lights ?? []) this.attach(lightOf(kind));
    }
  }

  class Mode extends GameMode {}

  class Instance extends GameInstance<null> {
    override async initialize(api: InitApi): Promise<null> {
      const [mesh, texture, material] = await Promise.all([
        api.assets.loadMesh(ASSET_PATHS.mesh),
        api.assets.loadTexture(ASSET_PATHS.texture),
        api.assets.loadMaterial(ASSET_PATHS.material),
      ]);
      assets = { mesh, texture, material };
      return null;
    }
  }

  const game: GameDefinition<null> = {
    instance: Instance,
    levels: { only: { mode: Mode, actors: [{ type: Easel }] } },
    startLevel: "only",
  };

  const engine = createEngine<null>({
    canvas: createCanvas(CSS_WIDTH, CSS_HEIGHT) as unknown as HTMLCanvasElement,
    width: WIDTH,
    height: HEIGHT,
    game,
    background: "#05060a",
    clock: new ConstantClock(1000 / 60),
    surface: pageSurface(),
  });
  await engine.initialize();
  // The mode belongs to the renderer here rather than to the build's drawing, so
  // it is set before the recorder is armed and holds for the whole run.
  if (scenario.mode !== undefined) engine.renderer.setMode(scenario.mode);
  engine.startRecording();
  await engine.advance(scenario.frames.length);
  const written = engine.stopRecording();
  engine.destroy();
  return written;
}

describeRecording3dParity({
  name: "@test-cabinet/structured-3d",
  format: RECORDING_FORMAT,
  record,
});

it("declares the types the engine declares, name for name", () => {
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
