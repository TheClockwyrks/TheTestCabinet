import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Actor, attachActorToWorld } from "./actors";
import { WorldCamera } from "./camera";
import { ColliderComponent } from "./collision";
import type { Component } from "./components";
import {
  CameraComponent,
  DrawComponent,
  LightComponent,
  MeshComponent,
  ModelComponent,
  Object3DComponent,
  RenderComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
import type { DrawApi, FrameInfo, Model, Viewport } from "./contract";
import { quatFromEuler, vec3 } from "./math";
import type { RenderPipelineOptions } from "./rendering";
import { RenderPipeline } from "./rendering";
import type { Context2dStub, StubCanvas } from "./testing/canvas";
import type { InstalledContexts } from "./testing/canvas";
import {
  createContextlessCanvas,
  createStage,
  createStubCanvas,
  installCanvasContexts,
} from "./testing/canvas";
import type { GlCall, GlStub } from "./testing/gl";
import type { World } from "./worlds";

/**
 * The pipeline: the two switches, the scene it maintains from the world's
 * render components, the world pass it renders through the camera, the
 * collision overlay over that, the screen pass on the layer, and the composite
 * that joins the two surfaces.
 *
 * The picture itself is out of scope here — the GL context is a stub, the 2D
 * context records rather than rasterizes, and pixels are a case's validators'
 * business in a real browser against a real GPU. What is in scope is everything
 * the pipeline decides *around* the picture, which is exactly what those stubs
 * can answer for: which object it placed for a declaration and where, what it
 * did when the declaration changed, which material a draw actually ran through
 * under each mode, where the letterboxed rectangle went, what the canvas was
 * cleared to and whether the clear preceded the scissor, and the order and the
 * arguments of every operation the screen layer received.
 *
 * Three idioms recur:
 *
 * - **World-pass placement is read off `pipeline.scene`**, because the objects
 *   in it *are* the pipeline's output, and a validator reads them the same way.
 * - **World-pass ordering and state are read off the GL calls the stub
 *   recorded**, because their order is the claim: "the bars carry the
 *   background" is "the clear happened while the scissor test was off", and
 *   "the overlay is over the picture" is "its draw came after the scene's".
 *   Note that three caches GL state — a viewport, a scissor rectangle, or an
 *   enable that does not change is not re-issued — so a test that wants to see
 *   one either forgets the recorded calls and renders a second frame, or
 *   asserts on the frame that first set it.
 * - **Which material a draw ran through is read from `onBeforeRender`**, whose
 *   fifth argument is the material three is about to draw with. A render mode
 *   is a substitution undone before the frame returns, so the material a check
 *   reads off the scene afterwards is always the declared one; the hook is the
 *   only place the substituted one is visible, which is the whole point of it.
 */

/** The design size every pipeline below is built at. */
const WIDTH = 640;
const HEIGHT = 360;

/**
 * The fit the suite renders through: one device pixel per logical unit and no
 * letterbox bars, so a logical coordinate in an assertion is the device
 * coordinate.
 *
 * Written out rather than computed through `fitViewport`, so this suite pins
 * the pipeline against a rectangle it states itself and a change to the fit
 * shows up here as a disagreement rather than as two modules agreeing on
 * something wrong.
 */
const FIT: Viewport = {
  width: WIDTH,
  height: HEIGHT,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

/** A letterboxed fit, for the claims that are about the bars. */
const LETTERBOX: Viewport = {
  width: WIDTH,
  height: HEIGHT,
  scale: 1.25,
  offsetX: 40,
  offsetY: 75,
};

/** The loop position handed to the screen pass, for `DrawApi.frame`. */
const FRAME: FrameInfo = { count: 7, timeMs: 116, lastDeltaMs: 16 };

const disposable: RenderPipeline[] = [];

afterEach(() => {
  for (const pipeline of disposable.splice(0)) pipeline.dispose();
});

/** A world reduced to the three members the pipeline reads. */
interface TestWorld extends World {
  actors(): readonly Actor[];
}

/** Everything one test drives: the pipeline, the surfaces, and a world. */
interface Rig {
  pipeline: RenderPipeline;
  gl: GlStub;
  stage: StubCanvas;
  layer: Context2dStub;
  world: TestWorld;
  camera: WorldCamera;
  /** Spawn an actor carrying the given components, in spawn order. */
  spawn(...components: Component[]): Actor;
}

/** A pipeline over stubbed canvases and an empty world, disposed afterwards. */
function rig(options: Partial<RenderPipelineOptions> = {}): Rig {
  const stage = createStage({
    width: WIDTH,
    height: HEIGHT,
    cssWidth: WIDTH,
    cssHeight: HEIGHT,
    dpr: 1,
  });
  const pipeline = new RenderPipeline({
    canvas: stage.stage.canvas,
    width: WIDTH,
    height: HEIGHT,
    screen: stage.screen.canvas,
    ...options,
  });
  disposable.push(pipeline);

  const actors: Actor[] = [];
  const camera = new WorldCamera(WIDTH, HEIGHT);
  const world = {
    actors: (): readonly Actor[] => actors,
    camera,
    paused: false,
  } as unknown as TestWorld;

  let nextId = 1;
  return {
    pipeline,
    gl: stage.stage.gl,
    stage: stage.stage,
    layer: stage.screen.context2d,
    world,
    camera,
    spawn: (...components: Component[]): Actor => {
      const actor = new Actor();
      attachActorToWorld(actor, world, nextId);
      nextId += 1;
      for (const component of components) actor.attach(component);
      actors.push(actor);
      return actor;
    },
  };
}

/** A mesh component with a stated color, the suite's usual subject. */
function mesh(color = "#4488ff"): MeshComponent {
  return new MeshComponent({
    geometry: { kind: "box", width: 1, height: 1, depth: 1 },
    material: { color },
  });
}

/** A bitmap a sprite can carry without a decoder behind it. */
function bitmap(width = 16, height = 16): ImageBitmap {
  return { width, height } as unknown as ImageBitmap;
}

/** A loaded model with one named joint and one clip that moves it. */
function model(): Model {
  const root = new THREE.Group();
  root.name = "rig";
  const joint = new THREE.Object3D();
  joint.name = "joint";
  root.add(joint);
  const clip = new THREE.AnimationClip("wave", 2, [
    new THREE.VectorKeyframeTrack("joint.position", [0, 2], [0, 0, 0, 0, 1, 0]),
  ]);
  return { scene: root, animations: [clip], nodes: ["rig", "joint"] };
}

/** The one object the pipeline placed, as the type the caller expects. */
function placed<T extends THREE.Object3D>(pipeline: RenderPipeline): T {
  const [object] = pipeline.scene.children;
  expect(object).toBeDefined();
  return object as T;
}

/** The indices of every recorded GL call a predicate accepts, oldest first. */
function indices(gl: GlStub, accept: (call: GlCall) => boolean): number[] {
  const found: number[] = [];
  gl.calls.forEach((call, at) => {
    if (accept(call)) found.push(at);
  });
  return found;
}

/** The index of the first recorded GL call a predicate accepts, or `-1`. */
function firstIndex(gl: GlStub, accept: (call: GlCall) => boolean): number {
  return indices(gl, accept)[0] ?? -1;
}

/** Whether a call is a draw of any of the four kinds three issues. */
function isDraw(call: GlCall): boolean {
  return (
    call.name === "drawElements" ||
    call.name === "drawArrays" ||
    call.name === "drawElementsInstanced" ||
    call.name === "drawArraysInstanced"
  );
}

/** How many draws the stub has recorded. */
function draws(gl: GlStub): number {
  return indices(gl, isDraw).length;
}

/** Whether a call enables or disables the named capability. */
function toggles(gl: GlStub, call: GlCall, capability: string): boolean {
  return (
    (call.name === "enable" || call.name === "disable") &&
    call.args[0] === gl.constant(capability)
  );
}

/**
 * The materials three was about to draw each object with, in draw order.
 *
 * Installed on an object already in the scene, so the substitution a render
 * mode performs is observable at the only moment it exists.
 */
function watchMaterial(object: THREE.Object3D): THREE.Material[] {
  const seen: THREE.Material[] = [];
  object.onBeforeRender = (
    _renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    _geometry: THREE.BufferGeometry,
    material: THREE.Material,
  ): void => {
    seen.push(material);
  };
  return seen;
}

/* -------------------------------------------------------------------------- */

describe("construction", () => {
  it("builds the renderer over the webgl2 context the stage canvas gave", () => {
    const { pipeline, gl } = rig();

    expect(pipeline.renderer.getContext()).toBe(gl.gl);
    expect(pipeline.renderer.capabilities.isWebGL2).toBe(true);
  });

  it("asks that context for antialiasing and an alpha channel", () => {
    const stage = createStage({ width: WIDTH, height: HEIGHT, dpr: 1 });
    const asked: { id: string; attributes: unknown }[] = [];
    const real = stage.stage.canvas.getContext.bind(stage.stage.canvas);
    stage.stage.canvas.getContext = ((
      id: string,
      attributes: unknown,
    ): unknown => {
      asked.push({ id, attributes });
      return real(id as "webgl2");
    }) as unknown as HTMLCanvasElement["getContext"];

    disposable.push(
      new RenderPipeline({
        canvas: stage.stage.canvas,
        width: WIDTH,
        height: HEIGHT,
        screen: stage.screen.canvas,
      }),
    );

    // Both are properties of the drawing buffer rather than renderer settings,
    // so they have to be asked for where the context is created or not at all.
    expect(asked).toEqual([
      { id: "webgl2", attributes: { antialias: true, alpha: true } },
    ]);
  });

  it("writes sRGB, so a color reaches the canvas as the color it was written as", () => {
    const { pipeline } = rig();

    expect(pipeline.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("leaves every clear to the pipeline", () => {
    const { pipeline } = rig();

    // Not a style preference: the clear precedes the scissor, and the overlay
    // and the composite are two further renders onto the same picture.
    expect(pipeline.renderer.autoClear).toBe(false);
  });

  it("has shadow maps off unless the build asked for them", () => {
    const { pipeline } = rig();

    expect(pipeline.renderer.shadowMap.enabled).toBe(false);
  });

  it("enables PCF soft shadow maps when the build asked for them", () => {
    const { pipeline } = rig({ shadows: true });

    expect(pipeline.renderer.shadowMap.enabled).toBe(true);
    expect(pipeline.renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
  });

  it("creates the scene empty", () => {
    const { pipeline } = rig();

    expect(pipeline.scene).toBeInstanceOf(THREE.Scene);
    expect(pipeline.scene.children).toEqual([]);
  });

  it("sizes the screen canvas to the stage's backing store", () => {
    // A canvas element starts at 300x150, so a screen layer that was never
    // sized would composite a fraction of the picture, stretched.
    const { pipeline } = rig();

    expect(pipeline.screenCanvas.width).toBe(WIDTH);
    expect(pipeline.screenCanvas.height).toBe(HEIGHT);
  });

  it("tracks the stage canvas's backing store, so the composite resamples nothing", () => {
    const { pipeline, stage } = rig();

    stage.canvas.width = 800;
    stage.canvas.height = 600;
    pipeline.syncScreen();

    expect(pipeline.screenCanvas.width).toBe(800);
    expect(pipeline.screenCanvas.height).toBe(600);
  });

  it("writes neither dimension when the two already agree", () => {
    const { pipeline } = pipelineWithCountedScreenWrites();

    expect(pipeline.written).toEqual([]);
  });

  it("refuses a width that is not finite and positive, naming the size", () => {
    const stage = createStage({ width: WIDTH, height: HEIGHT, dpr: 1 });

    expect(
      () =>
        new RenderPipeline({
          canvas: stage.stage.canvas,
          width: 0,
          height: HEIGHT,
          screen: stage.screen.canvas,
        }),
    ).toThrow(/width/);
  });

  it("refuses a height that is not finite and positive, naming the size", () => {
    const stage = createStage({ width: WIDTH, height: HEIGHT, dpr: 1 });

    expect(
      () =>
        new RenderPipeline({
          canvas: stage.stage.canvas,
          width: WIDTH,
          height: Number.NaN,
          screen: stage.screen.canvas,
        }),
    ).toThrow(/height/);
  });

  it("refuses a canvas that yields no webgl2 context, naming the canvas", () => {
    expect(
      () =>
        new RenderPipeline({
          canvas: createContextlessCanvas(),
          width: WIDTH,
          height: HEIGHT,
          screen: createStubCanvas().canvas,
        }),
    ).toThrow(/webgl2 context from the canvas/);
  });

  it("names the canvas rather than the screen layer when a build has both mistakes", () => {
    // The errors table's order is the order the refusals are raised in: the
    // surface everything else is drawn on comes first, because a build told
    // about its screen canvas would fix that and be refused all over again.
    expect(
      () =>
        new RenderPipeline({
          canvas: createContextlessCanvas(),
          width: WIDTH,
          height: HEIGHT,
          screen: createContextlessCanvas(),
        }),
    ).toThrow(/webgl2 context from the canvas/);
  });

  it("refuses a stage canvas with no owning document, naming the option", () => {
    const stage = createStubCanvas({ width: WIDTH, height: HEIGHT });
    Object.defineProperty(stage.canvas, "ownerDocument", {
      value: null,
      configurable: true,
    });

    expect(
      () =>
        new RenderPipeline({
          canvas: stage.canvas,
          width: WIDTH,
          height: HEIGHT,
        }),
    ).toThrow(/`screen`/);
  });

  it("refuses a screen canvas that yields no 2D context, naming the option", () => {
    const stage = createStage({ width: WIDTH, height: HEIGHT, dpr: 1 });

    expect(
      () =>
        new RenderPipeline({
          canvas: stage.stage.canvas,
          width: WIDTH,
          height: HEIGHT,
          screen: createContextlessCanvas(),
        }),
    ).toThrow(/2D context from the screen canvas/);
  });

  it("creates a screen canvas from the stage canvas's own document when the build supplied none", () => {
    const stage = createStubCanvas({ width: WIDTH, height: HEIGHT });
    const made: HTMLCanvasElement[] = [];
    // The 2D context the created canvas will answer with, built before the
    // override is installed: `createStubCanvas` creates a canvas of its own.
    const context = createStubCanvas().context2d.ctx;
    const owner = document;
    const real = owner.createElement.bind(owner);
    owner.createElement = ((name: string): Element => {
      const element = real(name as "canvas");
      if (name === "canvas") {
        const canvas = element as HTMLCanvasElement;
        canvas.getContext = ((id: string): unknown =>
          id === "2d" ? context : null) as HTMLCanvasElement["getContext"];
        made.push(canvas);
      }
      return element;
    }) as Document["createElement"];

    try {
      const pipeline = new RenderPipeline({
        canvas: stage.canvas,
        width: WIDTH,
        height: HEIGHT,
      });
      disposable.push(pipeline);

      expect(made).toHaveLength(1);
      expect(pipeline.screenCanvas).toBe(made[0]);
    } finally {
      owner.createElement = real as Document["createElement"];
    }
  });

  it("passes through whatever the screen canvas returned for a context", () => {
    // The whole of the substitution seam a validator uses: a suite that wants
    // the operations rather than the pixels replaces `getContext` on the canvas
    // it supplies, and whatever that returns is what every component draws
    // through.
    const stage = createStage({ width: WIDTH, height: HEIGHT, dpr: 1 });
    const substitute = createStubCanvas().context2d.ctx;
    stage.screen.canvas.getContext = ((id: string): unknown =>
      id === "2d" ? substitute : null) as HTMLCanvasElement["getContext"];

    const pipeline = new RenderPipeline({
      canvas: stage.stage.canvas,
      width: WIDTH,
      height: HEIGHT,
      screen: stage.screen.canvas,
    });
    disposable.push(pipeline);

    expect(pipeline.screen).toBe(substitute);
  });
});

/** A pipeline whose screen canvas reports every backing-store write. */
function pipelineWithCountedScreenWrites(): {
  pipeline: RenderPipeline & { written: string[] };
  syncScreen(): void;
} {
  const stage = createStage({
    width: WIDTH,
    height: HEIGHT,
    cssWidth: WIDTH,
    cssHeight: HEIGHT,
    dpr: 1,
  });
  const written: string[] = [];
  for (const axis of ["width", "height"] as const) {
    let held = stage.screen.canvas[axis];
    Object.defineProperty(stage.screen.canvas, axis, {
      get: () => held,
      set: (value: number) => {
        written.push(`${axis}=${String(value)}`);
        held = value;
      },
      configurable: true,
    });
  }
  const pipeline = new RenderPipeline({
    canvas: stage.stage.canvas,
    width: WIDTH,
    height: HEIGHT,
    screen: stage.screen.canvas,
  });
  disposable.push(pipeline);
  written.length = 0;
  pipeline.syncScreen();
  return {
    pipeline: Object.assign(pipeline, { written }),
    syncScreen: () => pipeline.syncScreen(),
  };
}

describe("the switches", () => {
  it("draws shaded until a mode is set", () => {
    const { pipeline } = rig();

    expect(pipeline.mode()).toBe("shaded");
  });

  it("holds the mode it is set to", () => {
    const { pipeline } = rig();

    pipeline.setMode("normals");

    expect(pipeline.mode()).toBe("normals");
  });

  it("draws no collision overlay until it is turned on", () => {
    const { pipeline } = rig();

    expect(pipeline.collisionOverlay()).toBe(false);
  });

  it("turns the collision overlay on and off", () => {
    const { pipeline } = rig();

    pipeline.setCollisionOverlay(true);
    expect(pipeline.collisionOverlay()).toBe(true);

    pipeline.setCollisionOverlay(false);
    expect(pipeline.collisionOverlay()).toBe(false);
  });

  it("takes a mode set mid-frame on the next frame, not this one", () => {
    const seen: string[] = [];
    class Switcher extends DrawComponent {
      draw(api: DrawApi): void {
        seen.push(api.mode);
        pipeline.setMode("wireframe");
      }
    }
    const { pipeline, world, spawn } = rig();
    spawn(new Switcher());

    pipeline.renderScreen(world, FIT, FRAME);
    pipeline.renderScreen(world, FIT, FRAME);

    expect(seen).toEqual(["shaded", "wireframe"]);
  });
});

describe("the scene", () => {
  it("gives a mesh component one three mesh", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh());

    pipeline.syncScene(world, 0);

    expect(pipeline.scene.children).toHaveLength(1);
    expect(placed(pipeline)).toBeInstanceOf(THREE.Mesh);
  });

  it("builds the geometry the component declared", () => {
    const { pipeline, world, spawn } = rig();
    spawn(
      new MeshComponent({
        geometry: { kind: "box", width: 2, height: 3, depth: 4 },
      }),
    );

    pipeline.syncScene(world, 0);

    const object = placed<THREE.Mesh>(pipeline);
    expect(object.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(object.geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect((object.geometry as THREE.BoxGeometry).parameters).toMatchObject({
      width: 2,
      height: 3,
      depth: 4,
    });
  });

  it("builds every geometry kind the catalogue names", () => {
    const { pipeline, world, spawn } = rig();
    spawn(new MeshComponent({ geometry: { kind: "sphere", radius: 1 } }));
    spawn(
      new MeshComponent({
        geometry: {
          kind: "cylinder",
          radiusTop: 0,
          radiusBottom: 1,
          height: 2,
        },
      }),
    );
    spawn(
      new MeshComponent({
        geometry: { kind: "capsule", radius: 1, height: 2 },
      }),
    );
    spawn(
      new MeshComponent({ geometry: { kind: "plane", width: 4, height: 2 } }),
    );

    pipeline.syncScene(world, 0);

    const kinds = pipeline.scene.children.map(
      (object) => (object as THREE.Mesh).geometry.constructor.name,
    );
    expect(kinds).toEqual([
      "SphereGeometry",
      "CylinderGeometry",
      "CapsuleGeometry",
      "PlaneGeometry",
    ]);
  });

  it("draws a custom geometry as the game gave it", () => {
    const geometry = new THREE.TorusKnotGeometry(1, 0.2, 16, 8);
    const { pipeline, world, spawn } = rig();
    spawn(new MeshComponent({ geometry: { kind: "custom", geometry } }));

    pipeline.syncScene(world, 0);

    expect(placed<THREE.Mesh>(pipeline).geometry).toBe(geometry);
  });

  it("builds a standard material at the documented defaults", () => {
    const { pipeline, world, spawn } = rig();
    spawn(new MeshComponent({ geometry: { kind: "sphere", radius: 1 } }));

    pipeline.syncScene(world, 0);

    const material = placed<THREE.Mesh>(pipeline)
      .material as THREE.MeshStandardMaterial;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(`#${material.color.getHexString()}`).toBe("#ffffff");
    expect(material.metalness).toBe(0);
    expect(material.roughness).toBe(1);
    expect(material.opacity).toBe(1);
    expect(material.side).toBe(THREE.FrontSide);
  });

  it("builds the material kind the spec named", () => {
    const { pipeline, world, spawn } = rig();
    spawn(
      new MeshComponent({
        geometry: { kind: "sphere", radius: 1 },
        material: { kind: "basic", color: "#ff0000" },
      }),
    );
    spawn(
      new MeshComponent({
        geometry: { kind: "sphere", radius: 1 },
        material: { kind: "lambert" },
      }),
    );

    pipeline.syncScene(world, 0);

    const [basic, lambert] = pipeline.scene.children as THREE.Mesh[];
    expect(basic?.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(lambert?.material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(
      `#${(basic?.material as THREE.MeshBasicMaterial).color.getHexString()}`,
    ).toBe("#ff0000");
  });

  it("places the object at the component's world transform", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    const actor = spawn(body);
    actor.transform.position = vec3(1, 2, 3);
    actor.transform.scale = vec3(2, 2, 2);
    body.offset.position = vec3(0, 1, 0);

    pipeline.syncScene(world, 0);

    const object = placed(pipeline);
    // The offset is composed with the actor's transform under the actor's own
    // scale, which is what makes an offset a place *on* the actor.
    expect(object.position.toArray()).toEqual([1, 4, 3]);
    expect(object.scale.toArray()).toEqual([2, 2, 2]);
  });

  it("carries the component's world rotation onto the object", () => {
    const { pipeline, world, spawn } = rig();
    const actor = spawn(mesh());
    actor.transform.rotation = quatFromEuler(0, Math.PI / 2, 0);

    pipeline.syncScene(world, 0);

    const object = placed(pipeline);
    expect(object.quaternion.y).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    expect(object.quaternion.w).toBeCloseTo(Math.cos(Math.PI / 4), 6);
  });

  it("re-places the same object as the actor moves, rather than rebuilding it", () => {
    const { pipeline, world, spawn } = rig();
    const actor = spawn(mesh());

    pipeline.syncScene(world, 0);
    const first = placed(pipeline);
    actor.transform.position = vec3(5, 0, 0);
    pipeline.syncScene(world, 0);

    expect(placed(pipeline)).toBe(first);
    expect(placed(pipeline).position.toArray()).toEqual([5, 0, 0]);
  });

  it("rebuilds the object when the geometry field is assigned", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    spawn(body);

    pipeline.syncScene(world, 0);
    const before = placed<THREE.Mesh>(pipeline);
    let disposed = 0;
    before.geometry.addEventListener("dispose", () => {
      disposed += 1;
    });

    body.geometry = { kind: "sphere", radius: 2 };
    pipeline.syncScene(world, 0);

    const after = placed<THREE.Mesh>(pipeline);
    expect(after).not.toBe(before);
    expect(after.geometry).toBeInstanceOf(THREE.SphereGeometry);
    expect(disposed).toBe(1);
    expect(pipeline.scene.children).toHaveLength(1);
  });

  it("rebuilds the object when the material field is assigned", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh("#112233");
    spawn(body);

    pipeline.syncScene(world, 0);
    const before = placed<THREE.Mesh>(pipeline).material as THREE.Material;

    body.material = { ...body.material, color: "#445566" };
    pipeline.syncScene(world, 0);

    const after = placed<THREE.Mesh>(pipeline)
      .material as THREE.MeshStandardMaterial;
    expect(after).not.toBe(before);
    expect(`#${after.color.getHexString()}`).toBe("#445566");
  });

  it("rebuilds nothing for a spec mutated without being assigned", () => {
    // Assignment is the change signal: a per-frame tween that mutates a spec in
    // place and never writes the field costs one rebuild, not one per frame.
    const { pipeline, world, spawn } = rig();
    const body = mesh("#112233");
    spawn(body);

    pipeline.syncScene(world, 0);
    const before = placed<THREE.Mesh>(pipeline);
    body.material.color = "#445566";
    pipeline.syncScene(world, 0);

    expect(placed(pipeline)).toBe(before);
    expect(
      `#${(before.material as THREE.MeshStandardMaterial).color.getHexString()}`,
    ).toBe("#112233");
  });

  it("reads layer as the object's render order", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    body.layer = 12;
    spawn(body);

    pipeline.syncScene(world, 0);

    expect(placed(pipeline).renderOrder).toBe(12);
  });

  it("multiplies the component's opacity into the material's", () => {
    const { pipeline, world, spawn } = rig();
    const body = new MeshComponent({
      geometry: { kind: "sphere", radius: 1 },
      material: { opacity: 0.5 },
    });
    body.opacity = 0.5;
    spawn(body);

    pipeline.syncScene(world, 0);

    const material = placed<THREE.Mesh>(pipeline).material as THREE.Material;
    expect(material.opacity).toBeCloseTo(0.25, 6);
    // An object below `1` draws in the transparent pass.
    expect(material.transparent).toBe(true);
  });

  it("does not compound the fade across frames, and restores it at 1", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    body.opacity = 0.5;
    spawn(body);

    pipeline.syncScene(world, 0);
    pipeline.syncScene(world, 0);
    const material = placed<THREE.Mesh>(pipeline).material as THREE.Material;
    expect(material.opacity).toBeCloseTo(0.5, 6);

    body.opacity = 1;
    pipeline.syncScene(world, 0);

    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
  });

  it("clamps an opacity outside 0..1 at the draw", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    body.opacity = 4;
    spawn(body);

    pipeline.syncScene(world, 0);

    expect(
      (placed<THREE.Mesh>(pipeline).material as THREE.Material).opacity,
    ).toBe(1);
  });

  it("draws nothing for a hidden component", () => {
    const { pipeline, gl, world, spawn } = rig();
    const kept = mesh();
    const hidden = mesh();
    spawn(kept);
    spawn(hidden);

    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);
    const both = draws(gl);

    hidden.visible = false;
    gl.forget();
    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    expect(both).toBe(2);
    expect(draws(gl)).toBe(1);
  });

  it("takes a hidden component's object out of the scene, and puts it back", () => {
    // The scene holds one object per enabled, visible world component and
    // nothing else, so a check that hides a component and traverses the scene
    // finds the mesh gone rather than merely marked invisible.
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    spawn(body);

    pipeline.syncScene(world, 0);
    expect(pipeline.scene.children).toHaveLength(1);

    body.visible = false;
    pipeline.syncScene(world, 0);
    expect(pipeline.scene.children).toHaveLength(0);

    body.visible = true;
    pipeline.syncScene(world, 0);
    expect(pipeline.scene.children).toHaveLength(1);
    expect(placed<THREE.Mesh>(pipeline).visible).toBe(true);
  });

  it("takes a disabled component's object out of the scene", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    spawn(body);
    pipeline.syncScene(world, 0);

    body.enabled = false;
    pipeline.syncScene(world, 0);

    expect(pipeline.scene.children).toHaveLength(0);
  });

  it("shows a game subtree the pipeline placed, whatever the game left it at", () => {
    // The only component whose object the pipeline did not build, and so the
    // only one that can arrive already hidden by its author.
    const { pipeline, world, spawn } = rig();
    const group = new THREE.Group();
    group.visible = false;
    spawn(new Object3DComponent({ object: group }));

    pipeline.syncScene(world, 0);

    expect(placed(pipeline).visible).toBe(true);
  });

  it("draws nothing for a disabled component", () => {
    const { pipeline, gl, world, spawn } = rig();
    const body = mesh();
    spawn(body);

    body.enabled = false;
    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    expect(draws(gl)).toBe(0);
  });

  it("takes a destroyed actor's object out of the scene the same frame", () => {
    // Before the end-of-frame flush removes the actor from the world, which is
    // what a check reading the scene after a destroy depends on.
    const { pipeline, world, spawn } = rig();
    const actor = spawn(mesh());

    pipeline.syncScene(world, 0);
    expect(pipeline.scene.children).toHaveLength(1);

    actor.destroy();
    pipeline.syncScene(world, 0);

    expect(pipeline.scene.children).toEqual([]);
  });

  it("takes a detached component's object out of the scene", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    const actor = spawn(body);

    pipeline.syncScene(world, 0);
    actor.detach(body);
    pipeline.syncScene(world, 0);

    expect(pipeline.scene.children).toEqual([]);
  });

  it("disposes what it built for a component that leaves", () => {
    const { pipeline, world, spawn } = rig();
    const actor = spawn(mesh());
    pipeline.syncScene(world, 0);
    const object = placed<THREE.Mesh>(pipeline);
    const gone: string[] = [];
    object.geometry.addEventListener("dispose", () => gone.push("geometry"));
    (object.material as THREE.Material).addEventListener("dispose", () =>
      gone.push("material"),
    );

    actor.destroy();
    pipeline.syncScene(world, 0);

    expect(gone.sort()).toEqual(["geometry", "material"]);
  });

  it("leaves a custom geometry the game supplied undisposed", () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    let disposed = 0;
    geometry.addEventListener("dispose", () => {
      disposed += 1;
    });
    const { pipeline, world, spawn } = rig();
    const actor = spawn(
      new MeshComponent({ geometry: { kind: "custom", geometry } }),
    );

    pipeline.syncScene(world, 0);
    actor.destroy();
    pipeline.syncScene(world, 0);

    expect(disposed).toBe(0);
  });

  it("gives a screen-space component no object at all", () => {
    const { pipeline, world, spawn } = rig();
    spawn(new TextComponent({ text: "score" }));

    pipeline.syncScene(world, 0);

    expect(pipeline.scene.children).toEqual([]);
  });

  it("gives a render component the catalogue does not name no object", () => {
    class Unknown extends RenderComponent {}
    const { pipeline, world, spawn } = rig();
    spawn(new Unknown());

    pipeline.syncScene(world, 0);

    expect(pipeline.scene.children).toEqual([]);
  });
});

describe("lights", () => {
  it("builds the light each spec names", () => {
    const { pipeline, world, spawn } = rig();
    spawn(new LightComponent({ light: { kind: "ambient" } }));
    spawn(new LightComponent({ light: { kind: "hemisphere" } }));
    spawn(new LightComponent({ light: { kind: "directional" } }));
    spawn(new LightComponent({ light: { kind: "point" } }));
    spawn(new LightComponent({ light: { kind: "spot" } }));

    pipeline.syncScene(world, 0);

    expect(
      pipeline.scene.children.map((light) => light.constructor.name),
    ).toEqual([
      "AmbientLight",
      "HemisphereLight",
      "DirectionalLight",
      "PointLight",
      "SpotLight",
    ]);
  });

  it("takes the color and intensity the spec declared", () => {
    const { pipeline, world, spawn } = rig();
    spawn(
      new LightComponent({
        light: { kind: "point", color: "#ff8800", intensity: 2.5 },
      }),
    );

    pipeline.syncScene(world, 0);

    const light = placed<THREE.PointLight>(pipeline);
    expect(`#${light.color.getHexString()}`).toBe("#ff8800");
    expect(light.intensity).toBe(2.5);
  });

  it("aims a directional light along FORWARD turned by its world rotation", () => {
    const { pipeline, world, spawn } = rig();
    const sun = new LightComponent({ light: { kind: "directional" } });
    // A quarter turn about `+Y` points local `-Z` along world `-X`.
    sun.offset.rotation = quatFromEuler(0, Math.PI / 2, 0);
    sun.offset.position = vec3(0, 10, 0);
    spawn(sun);

    pipeline.syncScene(world, 0);
    const light = placed<THREE.DirectionalLight>(pipeline);
    light.updateMatrixWorld(true);

    const at = new THREE.Vector3();
    light.target.getWorldPosition(at);
    expect(at.x).toBeCloseTo(-1, 6);
    expect(at.y).toBeCloseTo(10, 6);
    expect(at.z).toBeCloseTo(0, 6);
  });

  it("leaves an ambient and a hemisphere light unplaced", () => {
    // Neither has a position, and three reads a hemisphere light's position as
    // the direction its *sky* color comes from — so placing one at its actor,
    // usually the origin, would collapse the declared blend into nothing.
    const { pipeline, world, spawn } = rig();
    const fill = new LightComponent({ light: { kind: "ambient" } });
    const sky = new LightComponent({ light: { kind: "hemisphere" } });
    const actor = spawn(fill, sky);
    actor.transform.position = vec3(3, -4, 5);

    pipeline.syncScene(world, 0);

    const [ambient, hemisphere] = pipeline.scene.children;
    expect(ambient?.position.toArray()).toEqual([0, 0, 0]);
    expect(hemisphere?.position.toArray()).toEqual([0, 1, 0]);
  });

  it("places a point light at the component's world position", () => {
    const { pipeline, world, spawn } = rig();
    const lamp = new LightComponent({ light: { kind: "point" } });
    lamp.offset.position = vec3(0, 2, 0);
    const actor = spawn(lamp);
    actor.transform.position = vec3(3, -4, 5);

    pipeline.syncScene(world, 0);

    expect(placed(pipeline).position.toArray()).toEqual([3, -2, 5]);
  });

  it("casts shadows only when the spec asked for them", () => {
    const { pipeline, world, spawn } = rig();
    spawn(new LightComponent({ light: { kind: "directional" } }));
    spawn(new LightComponent({ light: { kind: "spot", castShadow: true } }));

    pipeline.syncScene(world, 0);

    const [plain, caster] = pipeline.scene.children;
    expect(plain?.castShadow).toBe(false);
    expect(caster?.castShadow).toBe(true);
  });

  it("rebuilds the light when the spec is assigned", () => {
    const { pipeline, world, spawn } = rig();
    const lamp = new LightComponent({ light: { kind: "point" } });
    spawn(lamp);

    pipeline.syncScene(world, 0);
    lamp.light = { kind: "ambient", intensity: 0.4 };
    pipeline.syncScene(world, 0);

    expect(placed(pipeline)).toBeInstanceOf(THREE.AmbientLight);
    expect(pipeline.scene.children).toHaveLength(1);
  });

  it("takes no opacity, whatever the component carries", () => {
    const { pipeline, world, spawn } = rig();
    const lamp = new LightComponent({ light: { kind: "point", intensity: 3 } });
    lamp.opacity = 0.25;
    spawn(lamp);

    pipeline.syncScene(world, 0);

    expect(placed<THREE.PointLight>(pipeline).intensity).toBe(3);
  });
});

describe("models and subtrees", () => {
  it("places the clone the component made of its model", () => {
    const { pipeline, world, spawn } = rig();
    const figure = new ModelComponent({ model: model() });
    const actor = spawn(figure);
    actor.transform.position = vec3(0, 2, 0);

    pipeline.syncScene(world, 0);

    const object = placed(pipeline);
    expect(object.getObjectByName("joint")).toBeDefined();
    expect(object.position.toArray()).toEqual([0, 2, 0]);
  });

  it("advances a model's mixer by the world's delta", () => {
    const { pipeline, world, spawn } = rig();
    const figure = new ModelComponent({ model: model(), animation: "wave" });
    spawn(figure);

    pipeline.syncScene(world, 0.5);
    pipeline.syncScene(world, 0.25);

    expect(figure.time).toBeCloseTo(0.75, 6);
  });

  it("advances no animation on a frame worth no time, so a paused world holds its pose", () => {
    const { pipeline, world, spawn } = rig();
    const figure = new ModelComponent({ model: model(), animation: "wave" });
    spawn(figure);

    pipeline.syncScene(world, 0.5);
    pipeline.syncScene(world, 0);

    expect(figure.time).toBeCloseTo(0.5, 6);
  });

  it("never disposes a model's clone or its parts", () => {
    const source = model();
    const { pipeline, world, spawn } = rig();
    const actor = spawn(new ModelComponent({ model: source }));

    pipeline.syncScene(world, 0);
    actor.destroy();
    pipeline.syncScene(world, 0);

    // The template is untouched and the scene is empty: the clone belongs to
    // the component, which the world is about to drop with its actor.
    expect(source.scene.children).toHaveLength(1);
    expect(pipeline.scene.children).toEqual([]);
  });

  it("places an Object3DComponent's subtree root and leaves its contents to the game", () => {
    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial(),
    );
    const group = new THREE.Group();
    group.add(points);
    const { pipeline, world, spawn } = rig();
    const exhaust = new Object3DComponent({ object: group });
    const actor = spawn(exhaust);
    actor.transform.position = vec3(3, 0, 0);

    pipeline.syncScene(world, 0);

    expect(placed(pipeline)).toBe(group);
    expect(group.position.toArray()).toEqual([3, 0, 0]);

    let disposed = 0;
    points.geometry.addEventListener("dispose", () => {
      disposed += 1;
    });
    actor.destroy();
    pipeline.syncScene(world, 0);

    expect(disposed).toBe(0);
    expect(pipeline.scene.children).toEqual([]);
  });

  it("fades a subtree the game built, and puts its opacity back", () => {
    const material = new THREE.MeshBasicMaterial({
      opacity: 0.8,
      transparent: true,
    });
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const group = new THREE.Group();
    group.add(inner);
    const { pipeline, world, spawn } = rig();
    const component = new Object3DComponent({ object: group });
    spawn(component);

    component.opacity = 0.5;
    pipeline.syncScene(world, 0);
    expect(material.opacity).toBeCloseTo(0.4, 6);

    component.opacity = 1;
    pipeline.syncScene(world, 0);

    expect(material.opacity).toBeCloseTo(0.8, 6);
  });

  it("fades two placements of one model apart", () => {
    // "Several components share one loaded model" is a statement about the
    // template, not about the picture: each component's `opacity` writes onto
    // the materials under its own object, so two placements must not be drawn
    // through one material instance.
    const material = new THREE.MeshStandardMaterial();
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
    const loaded: Model = { scene, animations: [], nodes: [] };

    const { pipeline, world, spawn } = rig();
    const ghost = new ModelComponent({ model: loaded });
    ghost.opacity = 0.25;
    spawn(new ModelComponent({ model: loaded }));
    spawn(ghost);
    pipeline.syncScene(world, 0);

    const alphas = pipeline.scene.children.map((root) => {
      let found: THREE.Material | null = null;
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) found = object.material;
      });
      return found as THREE.Material | null;
    });
    expect(alphas[0]).not.toBe(alphas[1]);
    expect(alphas[0]?.opacity).toBe(1);
    expect(alphas[1]?.opacity).toBeCloseTo(0.25, 6);
    // And the template the two were cloned from is untouched.
    expect(material.opacity).toBe(1);
  });

  it("turns a billboard to the camera while keeping its position and scale", () => {
    const { pipeline, world, camera, spawn } = rig();
    const card = new MeshComponent({
      geometry: { kind: "plane", width: 1, height: 1 },
      billboard: true,
    });
    const actor = spawn(card);
    actor.transform.position = vec3(0, 0, -5);
    actor.transform.rotation = quatFromEuler(0.3, 0.4, 0.5);
    camera.rotation = quatFromEuler(0, Math.PI / 4, 0);

    pipeline.syncScene(world, 0);

    const object = placed(pipeline);
    expect(object.position.toArray()).toEqual([0, 0, -5]);
    expect(object.quaternion.y).toBeCloseTo(Math.sin(Math.PI / 8), 6);
    expect(object.quaternion.x).toBeCloseTo(0, 6);
  });

  it("pushes the shadow flags onto a mesh", () => {
    const { pipeline, world, spawn } = rig();
    const body = mesh();
    body.castShadow = true;
    body.receiveShadow = true;
    spawn(body);

    pipeline.syncScene(world, 0);

    const object = placed(pipeline);
    expect(object.castShadow).toBe(true);
    expect(object.receiveShadow).toBe(true);
  });
});

describe("the camera", () => {
  it("adopts a followed target's pose before the picture is taken", () => {
    const { pipeline, world, camera, spawn } = rig();
    const eye = new CameraComponent();
    const actor = spawn(eye);
    actor.transform.position = vec3(4, 5, 6);
    camera.follow(actor);

    pipeline.syncScene(world, 0);

    expect(camera.position).toEqual({ x: 4, y: 5, z: 6 });
    expect(camera.fov).toBe(eye.fov);
  });

  it("clamps the camera to its bounds", () => {
    const { pipeline, world, camera } = rig();
    camera.position = vec3(100, 0, 0);
    camera.bounds = { min: vec3(-10, -10, -10), max: vec3(10, 10, 10) };

    pipeline.syncScene(world, 0);

    expect(camera.position.x).toBe(10);
  });
});

describe("the world pass", () => {
  it("clears the whole canvas while the scissor test is off", () => {
    const { pipeline, gl, world } = rig({ background: "#102030" });

    // Two frames: three caches GL state, so the `disable` that precedes the
    // clear is only issued once the scissor test has actually been enabled.
    pipeline.renderWorld(world, LETTERBOX);
    gl.forget();
    pipeline.renderWorld(world, LETTERBOX);

    const scissorTest = (call: GlCall): boolean =>
      toggles(gl, call, "SCISSOR_TEST");
    const off = firstIndex(
      gl,
      (call) => scissorTest(call) && call.name === "disable",
    );
    const cleared = firstIndex(gl, (call) => call.name === "clear");
    const on = firstIndex(
      gl,
      (call) => scissorTest(call) && call.name === "enable",
    );

    expect(off).toBeGreaterThanOrEqual(0);
    expect(off).toBeLessThan(cleared);
    expect(cleared).toBeLessThan(on);
  });

  it("clears to the background color, so the letterbox bars carry it", () => {
    const { pipeline, gl, world } = rig({ background: "#ff0000" });

    pipeline.renderWorld(world, LETTERBOX);

    const clear = gl.lastCall("clearColor");
    expect(clear?.args[0]).toBeCloseTo(1, 5);
    expect(clear?.args[1]).toBeCloseTo(0, 5);
    expect(clear?.args[2]).toBeCloseTo(0, 5);
    expect(clear?.args[3]).toBe(1);
  });

  it("clears to transparency when the build named no background", () => {
    const { pipeline, gl, world } = rig();

    pipeline.renderWorld(world, LETTERBOX);

    expect(gl.lastCall("clearColor")?.args[3]).toBe(0);
  });

  it("writes the clear color again every frame, so a scene background never becomes the bars'", () => {
    // A game that sets `scene.background` makes three leave the GL clear color
    // set to *its* color, inside the scissor. A clear color written once at
    // construction would silently become the scene's from the first frame that
    // set one, and the bars would stop matching `background`.
    const { pipeline, gl, world } = rig({ background: "#0000ff" });
    pipeline.scene.background = new THREE.Color("#00ff00");

    pipeline.renderWorld(world, LETTERBOX);
    gl.forget();
    pipeline.renderWorld(world, LETTERBOX);

    const clear = gl.callsTo("clearColor")[0];
    expect(clear?.args[2]).toBeCloseTo(1, 5);
    expect(clear?.args[1]).toBeCloseTo(0, 5);
    expect(firstIndex(gl, (call) => call.name === "clearColor")).toBeLessThan(
      firstIndex(gl, (call) => call.name === "clear"),
    );
  });

  it("confines the picture to the letterboxed rectangle, in device pixels", () => {
    const { pipeline, gl, world } = rig();

    pipeline.renderWorld(world, LETTERBOX);

    const expected = [
      LETTERBOX.offsetX,
      LETTERBOX.offsetY,
      WIDTH * LETTERBOX.scale,
      HEIGHT * LETTERBOX.scale,
    ];
    expect(gl.lastCall("viewport")?.args).toEqual(expected);
    expect(gl.lastCall("scissor")?.args).toEqual(expected);
  });

  it("renders the scene through the camera", () => {
    const { pipeline, gl, world, spawn } = rig();
    spawn(mesh());

    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    expect(draws(gl)).toBe(1);
  });

  it("reports no draw counts before the first render", () => {
    const { pipeline } = rig();

    expect(pipeline.counts()).toEqual({ drawCalls: 0, triangles: 0 });
  });

  it("reports the scene's draw counts for the frame most recently rendered", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh());
    spawn(mesh());

    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    const counts = pipeline.counts();
    expect(counts.drawCalls).toBe(2);
    // Two boxes, twelve triangles each.
    expect(counts.triangles).toBe(24);
  });

  it("holds the scene's counts across the composite, which would reset them", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh());

    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);
    const before = pipeline.counts();
    pipeline.composite();

    expect(pipeline.counts()).toEqual(before);
    expect(before.drawCalls).toBe(1);
  });
});

describe("the collision overlay", () => {
  /** An actor carrying one collider, for the overlay to find. */
  function collider(
    responses?: Record<string, "ignore" | "overlap" | "block">,
  ): ColliderComponent {
    return new ColliderComponent({
      shape: { kind: "box", width: 1, height: 1, depth: 1 },
      responses,
    });
  }

  it("draws nothing extra while it is off", () => {
    const { pipeline, gl, world, spawn } = rig();
    spawn(mesh(), collider());

    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    expect(draws(gl)).toBe(1);
  });

  it("draws every enabled collider once it is on", () => {
    const { pipeline, gl, world, spawn } = rig();
    spawn(mesh(), collider());
    spawn(collider());

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    // The mesh, then the two colliders' outlines.
    expect(draws(gl)).toBe(3);
  });

  it("draws over the finished picture rather than into it", () => {
    const { pipeline, gl, world, spawn } = rig();
    spawn(mesh(), collider());

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    // Where in the recorded call stream the scene's own mesh was drawn, taken
    // from inside the draw itself rather than inferred from the order.
    let sceneDrawnAt = -1;
    placed(pipeline).onBeforeRender = (): void => {
      sceneDrawnAt = gl.calls.length;
    };
    pipeline.renderWorld(world, FIT);

    const drawn = indices(gl, isDraw);
    expect(drawn).toHaveLength(2);
    expect(sceneDrawnAt).toBeGreaterThanOrEqual(0);
    // The overlay's draw is the later one, so it lands on a finished picture.
    expect(drawn.at(-1)).toBeGreaterThan(sceneDrawnAt);
  });

  it("draws with depth testing off, so a collider inside a wall is visible", () => {
    const { pipeline, gl, world, spawn } = rig();
    spawn(mesh(), collider());

    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);
    pipeline.setCollisionOverlay(true);
    gl.forget();
    pipeline.renderWorld(world, FIT);

    const off = gl.calls.some(
      (call) =>
        call.name === "disable" && call.args[0] === gl.constant("DEPTH_TEST"),
    );
    expect(off).toBe(true);
  });

  it("skips a disabled collider", () => {
    const { pipeline, gl, world, spawn } = rig();
    const shape = collider();
    shape.enabled = false;
    spawn(shape);

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    expect(draws(gl)).toBe(0);
  });

  it("stops drawing a destroyed actor's collider", () => {
    const { pipeline, gl, world, spawn } = rig();
    const actor = spawn(collider());

    pipeline.setCollisionOverlay(true);
    pipeline.renderWorld(world, FIT);
    expect(draws(gl)).toBe(1);

    actor.destroy();
    gl.forget();
    pipeline.renderWorld(world, FIT);

    expect(draws(gl)).toBe(0);
  });

  it("is independent of the render mode", () => {
    const { pipeline, gl, world, spawn } = rig();
    spawn(collider());

    pipeline.setMode("wireframe");
    pipeline.setCollisionOverlay(true);
    pipeline.renderWorld(world, FIT);

    expect(draws(gl)).toBe(1);
  });
});

describe("the render modes", () => {
  /** A rig with one mesh in the scene and the materials each draw ran through. */
  function drawn(mode: "shaded" | "wireframe" | "unlit" | "normals"): {
    pipeline: RenderPipeline;
    object: THREE.Mesh;
    declared: THREE.Material;
    seen: THREE.Material[];
  } {
    const { pipeline, world, spawn } = rig();
    spawn(mesh("#336699"));
    pipeline.syncScene(world, 0);
    const object = placed<THREE.Mesh>(pipeline);
    const declared = object.material as THREE.Material;
    const seen = watchMaterial(object);
    pipeline.setMode(mode);
    pipeline.renderWorld(world, FIT);
    return { pipeline, object, declared, seen };
  }

  it("draws every material as declared under shaded", () => {
    const { seen, declared } = drawn("shaded");

    expect(seen).toEqual([declared]);
  });

  it("draws every mesh as its edges in one flat color under wireframe", () => {
    const { seen } = drawn("wireframe");

    const material = seen[0] as THREE.MeshBasicMaterial;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(material.wireframe).toBe(true);
    expect(`#${material.color.getHexString()}`).toBe("#ffffff");
  });

  it("draws two meshes through one wireframe material", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh("#111111"));
    spawn(mesh("#222222"));
    pipeline.syncScene(world, 0);
    const watched = pipeline.scene.children.map((object) =>
      watchMaterial(object),
    );

    pipeline.setMode("wireframe");
    pipeline.renderWorld(world, FIT);

    const seen = watched.flat();
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("draws the base color at full opacity with the lights ignored under unlit", () => {
    const { pipeline, world, spawn } = rig();
    const body = new MeshComponent({
      geometry: { kind: "box", width: 1, height: 1, depth: 1 },
      material: { color: "#336699", opacity: 0.5 },
    });
    spawn(body);
    pipeline.syncScene(world, 0);
    const seen = watchMaterial(placed(pipeline));

    pipeline.setMode("unlit");
    pipeline.renderWorld(world, FIT);

    const material = seen[0] as THREE.MeshBasicMaterial;
    expect(material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(`#${material.color.getHexString()}`).toBe("#336699");
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
  });

  it("keeps a material's map under unlit", () => {
    const map = new THREE.Texture();
    const { pipeline, world, spawn } = rig();
    spawn(
      new MeshComponent({
        geometry: { kind: "plane", width: 1, height: 1 },
        material: { map },
      }),
    );
    pipeline.syncScene(world, 0);
    const seen = watchMaterial(placed(pipeline));

    pipeline.setMode("unlit");
    pipeline.renderWorld(world, FIT);

    expect((seen[0] as THREE.MeshBasicMaterial).map).toBe(map);
  });

  it("gives each material its own unlit stand-in", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh("#111111"));
    spawn(mesh("#222222"));
    pipeline.syncScene(world, 0);
    const watched = pipeline.scene.children.map((object) =>
      watchMaterial(object),
    );

    pipeline.setMode("unlit");
    pipeline.renderWorld(world, FIT);

    const seen = watched.flat();
    expect(seen[0]).not.toBe(seen[1]);
    expect(
      `#${(seen[0] as THREE.MeshBasicMaterial).color.getHexString()}`,
    ).toBe("#111111");
    expect(
      `#${(seen[1] as THREE.MeshBasicMaterial).color.getHexString()}`,
    ).toBe("#222222");
  });

  it("follows a material the game mutates in place under unlit", () => {
    // `unlit` is a substitution over what a material *is* on the frame it
    // draws. An `Object3DComponent`'s subtree is the game's to mutate directly,
    // and nothing announces a tint written straight onto its material, so a
    // stand-in that froze the first frame's color would draw last frame's game.
    // The stand-in itself is reused between frames, so what it carried at draw
    // time is read in the hook rather than off the object afterwards.
    const material = new THREE.MeshStandardMaterial({ color: "#ff0000" });
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const group = new THREE.Group();
    group.add(inner);
    const { pipeline, world, spawn } = rig();
    spawn(new Object3DComponent({ object: group }));
    pipeline.syncScene(world, 0);
    const seen: { color: string; side: THREE.Side; wireframe: boolean }[] = [];
    inner.onBeforeRender = (
      _renderer: THREE.WebGLRenderer,
      _scene: THREE.Scene,
      _camera: THREE.Camera,
      _geometry: THREE.BufferGeometry,
      drawn: THREE.Material,
    ): void => {
      const basic = drawn as THREE.MeshBasicMaterial;
      seen.push({
        color: `#${basic.color.getHexString()}`,
        side: basic.side,
        wireframe: basic.wireframe,
      });
    };

    pipeline.setMode("unlit");
    pipeline.renderWorld(world, FIT);

    material.color.set("#00ff00");
    material.side = THREE.DoubleSide;
    material.wireframe = true;
    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    expect(seen).toEqual([
      { color: "#ff0000", side: THREE.FrontSide, wireframe: false },
      { color: "#00ff00", side: THREE.DoubleSide, wireframe: true },
    ]);
  });

  it("follows a map the game hangs on a material after the fact under unlit", () => {
    const map = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial();
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const { pipeline, world, spawn } = rig();
    spawn(new Object3DComponent({ object: inner }));
    pipeline.syncScene(world, 0);
    const seen: (THREE.Texture | null)[] = [];
    inner.onBeforeRender = (
      _renderer: THREE.WebGLRenderer,
      _scene: THREE.Scene,
      _camera: THREE.Camera,
      _geometry: THREE.BufferGeometry,
      drawn: THREE.Material,
    ): void => {
      seen.push((drawn as THREE.MeshBasicMaterial).map);
    };

    pipeline.setMode("unlit");
    pipeline.renderWorld(world, FIT);

    material.map = map;
    pipeline.renderWorld(world, FIT);

    expect(seen).toEqual([null, map]);
  });

  it("follows a point cloud's own material under unlit", () => {
    const material = new THREE.PointsMaterial({
      color: "#ff0000",
      opacity: 0.5,
      transparent: true,
    });
    const points = new THREE.Points(new THREE.BufferGeometry(), material);
    const { pipeline, world, spawn } = rig();
    spawn(new Object3DComponent({ object: points }));
    pipeline.syncScene(world, 0);
    const seen: { color: string; size: number; opacity: number }[] = [];
    points.onBeforeRender = (
      _renderer: THREE.WebGLRenderer,
      _scene: THREE.Scene,
      _camera: THREE.Camera,
      _geometry: THREE.BufferGeometry,
      drawn: THREE.Material,
    ): void => {
      const cloud = drawn as THREE.PointsMaterial;
      seen.push({
        color: `#${cloud.color.getHexString()}`,
        size: cloud.size,
        opacity: cloud.opacity,
      });
    };

    pipeline.setMode("unlit");
    pipeline.renderWorld(world, FIT);

    material.color.set("#0000ff");
    material.size = 7;
    pipeline.renderWorld(world, FIT);

    expect(seen).toEqual([
      { color: "#ff0000", size: 1, opacity: 1 },
      { color: "#0000ff", size: 7, opacity: 1 },
    ]);
    expect(points.material).toBe(material);
  });

  it("colors every surface by its normal under normals", () => {
    const { seen } = drawn("normals");

    expect(seen[0]).toBeInstanceOf(THREE.MeshNormalMaterial);
  });

  it("colors by the WORLD-space normal, so turning the camera repaints nothing", () => {
    // Three's own `MeshNormalMaterial` colors by the view-space normal, which
    // is the one thing the mode exists to rule out. The patch is read off the
    // compiled shader rather than off pixels, which the stub has none of.
    const { seen } = drawn("normals");
    const material = seen[0] as THREE.MeshNormalMaterial;
    const stock = new THREE.MeshNormalMaterial();
    const shader = {
      fragmentShader: THREE.ShaderLib.normal.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;

    material.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);

    expect(shader.fragmentShader).toContain("* viewMatrix");
    expect(shader.fragmentShader).not.toContain(
      "gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5",
    );
    // And it compiles as a program of its own rather than sharing the stock
    // material's, which three keys by the source it thinks the material has.
    expect(material.customProgramCacheKey()).not.toBe(
      stock.customProgramCacheKey(),
    );
  });

  it("puts the declared material back before the frame returns", () => {
    // A check reads a material off the scene after a frame, so a mode must not
    // outlive the render it applied to.
    const { object, declared } = drawn("wireframe");

    expect(object.material).toBe(declared);
  });

  it("puts it back even when the render throws", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh());
    pipeline.syncScene(world, 0);
    const object = placed<THREE.Mesh>(pipeline);
    const declared = object.material;
    pipeline.renderer.render = (): never => {
      throw new Error("context lost");
    };

    pipeline.setMode("normals");
    expect(() => pipeline.renderWorld(world, FIT)).toThrow(/context lost/);

    expect(object.material).toBe(declared);
  });

  it("reaches a subtree the game built, with nothing for the game to implement", () => {
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    const group = new THREE.Group();
    group.add(inner);
    const { pipeline, world, spawn } = rig();
    spawn(new Object3DComponent({ object: group }));
    pipeline.syncScene(world, 0);
    const seen = watchMaterial(inner);

    pipeline.setMode("wireframe");
    pipeline.renderWorld(world, FIT);

    expect((seen[0] as THREE.MeshBasicMaterial).wireframe).toBe(true);
    expect(inner.material).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it("leaves a point cloud's own material alone under wireframe", () => {
    // A point cloud has no edges to reduce to and no surface to face, and a
    // mesh material on a `Points` is a shader that does not compile.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3),
    );
    const material = new THREE.PointsMaterial();
    const points = new THREE.Points(geometry, material);
    const { pipeline, world, spawn } = rig();
    spawn(new Object3DComponent({ object: points }));
    pipeline.syncScene(world, 0);
    const seen = watchMaterial(points);

    pipeline.setMode("wireframe");
    pipeline.renderWorld(world, FIT);

    expect(seen).toEqual([material]);
  });
});

describe("the screen pass", () => {
  /** A rig with the screen layer's operations already forgotten. */
  function screen(options: Partial<RenderPipelineOptions> = {}): Rig {
    const built = rig(options);
    built.layer.forget();
    return built;
  }

  it("clears the whole backing store in device space", () => {
    const { pipeline, layer, world } = screen();

    pipeline.renderScreen(world, LETTERBOX, FRAME);

    const [first, cleared] = layer.ops;
    expect(first?.op).toBe("setTransform");
    expect(first?.args).toEqual([1, 0, 0, 1, 0, 0]);
    expect(cleared?.op).toBe("clearRect");
    expect(cleared?.args).toEqual([0, 0, WIDTH, HEIGHT]);
  });

  it("gives the layer the viewport transform, so a component draws in logical units", () => {
    const { pipeline, layer, world, spawn } = screen();
    spawn(new TextComponent({ text: "hud" }));

    pipeline.renderScreen(world, LETTERBOX, FRAME);

    const fit = [
      LETTERBOX.scale,
      0,
      0,
      LETTERBOX.scale,
      LETTERBOX.offsetX,
      LETTERBOX.offsetY,
    ];
    expect(layer.opsOf("setTransform").at(-1)?.args).toEqual(fit);
    // And it is the transform in force at the draw, not merely one that was set
    // at some point in the frame.
    expect(layer.opsOf("fillText")[0]?.transform).toEqual(fit);
  });

  it("sets image smoothing from the option, before any component draws", () => {
    let seen: boolean | undefined;
    class Probe extends DrawComponent {
      draw(api: DrawApi): void {
        seen = api.ctx.imageSmoothingEnabled;
      }
    }
    const { pipeline, world, spawn } = screen({ imageSmoothing: false });
    spawn(new Probe());

    pipeline.renderScreen(world, FIT, FRAME);

    expect(seen).toBe(false);
  });

  it("resamples bilinearly unless the build asked for nearest-neighbor", () => {
    const { pipeline, layer, world } = screen();

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.ctx.imageSmoothingEnabled).toBe(true);
  });

  it("draws in layer order", () => {
    const { pipeline, layer, world, spawn } = screen();
    const top = new TextComponent({ text: "top", fill: "#ffffff" });
    top.layer = 10;
    const bottom = new TextComponent({ text: "bottom", fill: "#000000" });
    bottom.layer = 0;
    spawn(top);
    spawn(bottom);

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("fillText").map((op) => op.text)).toEqual([
      "bottom",
      "top",
    ]);
  });

  it("orders a shared layer by the owning actor's spawn order", () => {
    const { pipeline, layer, world, spawn } = screen();
    spawn(new TextComponent({ text: "first" }));
    spawn(new TextComponent({ text: "second" }));

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("fillText").map((op) => op.text)).toEqual([
      "first",
      "second",
    ]);
  });

  it("orders one actor's components by attachment order", () => {
    const { pipeline, layer, world, spawn } = screen();
    spawn(
      new TextComponent({ text: "attached first" }),
      new TextComponent({ text: "attached second" }),
    );

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("fillText").map((op) => op.text)).toEqual([
      "attached first",
      "attached second",
    ]);
  });

  it("reproduces the previous order exactly on a redraw with no change", () => {
    const { pipeline, layer, world, spawn } = screen();
    spawn(new TextComponent({ text: "a" }), new TextComponent({ text: "b" }));
    spawn(new TextComponent({ text: "c" }));

    pipeline.renderScreen(world, FIT, FRAME);
    const first = layer.opsOf("fillText").map((op) => op.text);
    layer.forget();
    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("fillText").map((op) => op.text)).toEqual(first);
    expect(first).toEqual(["a", "b", "c"]);
  });

  it("skips a hidden, a disabled, and a destroyed component", () => {
    const { pipeline, layer, world, spawn } = screen();
    const hidden = new TextComponent({ text: "hidden" });
    hidden.visible = false;
    const disabled = new TextComponent({ text: "disabled" });
    disabled.enabled = false;
    spawn(hidden, disabled, new TextComponent({ text: "drawn" }));
    const doomed = spawn(new TextComponent({ text: "doomed" }));
    doomed.destroy();

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("fillText").map((op) => op.text)).toEqual(["drawn"]);
  });

  it("draws no world-space component onto the layer", () => {
    const { pipeline, layer, world, spawn } = screen();
    spawn(mesh());

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.names().filter((name) => name !== "setTransform")).toEqual([
      "clearRect",
    ]);
  });

  it("blits a sprite at its anchored destination, in logical units", () => {
    const { pipeline, layer, world, spawn } = screen();
    const image = bitmap(20, 10);
    const sprite = new SpriteComponent({ image });
    const actor = spawn(sprite);
    actor.transform.position = vec3(100, 50, 0);

    pipeline.renderScreen(world, FIT, FRAME);

    const blit = layer.opsOf("drawImage")[0];
    expect(blit?.args).toEqual([image, 90, 45, 20, 10]);
  });

  it("blits the source region a sheet selects", () => {
    const { pipeline, layer, world, spawn } = screen();
    const image = bitmap(64, 16);
    const sprite = new SpriteComponent({
      image,
      source: { x: 16, y: 0, width: 16, height: 16 },
      anchorX: 0,
      anchorY: 0,
    });
    spawn(sprite);

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("drawImage")[0]?.args).toEqual([
      image,
      16,
      0,
      16,
      16,
      0,
      0,
      16,
      16,
    ]);
  });

  it("blits a tinted sprite through a scratch of its own", () => {
    // The tint flattens the image to the tint color while keeping its alpha,
    // which needs a `source-atop` composite on a surface of the sprite's own:
    // compositing on the layer would tint everything already drawn there. What
    // reaches the layer is the one `drawImage` that blits the scratch.
    const contexts = installCanvasContexts();
    try {
      const { pipeline, layer, world, spawn } = screen();
      spawn(
        new SpriteComponent({
          image: bitmap(8, 8),
          tint: "#ff0000",
          anchorX: 0,
          anchorY: 0,
        }),
      );

      pipeline.renderScreen(world, FIT, FRAME);

      const blit = layer.opsOf("drawImage")[0];
      const source = blit?.args[0] as HTMLCanvasElement;
      expect(source).toBeInstanceOf(HTMLCanvasElement);
      expect(source.width).toBe(8);
      expect(blit?.args).toEqual([source, 0, 0, 8, 8]);

      const scratch = contexts.context2dFor(source);
      expect(scratch?.names()).toEqual(["drawImage", "fillRect"]);
      expect(scratch?.opsOf("fillRect")[0]?.fill).toBe("#ff0000");
    } finally {
      contexts.uninstall();
    }
  });

  it("draws a sprite untinted where the host has no scratch canvas to flatten on", () => {
    // A tint that cannot be composited is dropped rather than dropping the
    // sprite: the picture is missing a color, not a ship.
    const image = bitmap(8, 8);
    const real = document.createElement.bind(document);
    document.createElement = ((name: string): Element => {
      const element = real(name as "canvas");
      if (name === "canvas") {
        (element as HTMLCanvasElement).getContext = ((): null =>
          null) as HTMLCanvasElement["getContext"];
      }
      return element;
    }) as Document["createElement"];

    try {
      const { pipeline, layer, world, spawn } = screen();
      spawn(
        new SpriteComponent({ image, tint: "#ff0000", anchorX: 0, anchorY: 0 }),
      );

      pipeline.renderScreen(world, FIT, FRAME);

      expect(layer.opsOf("drawImage")[0]?.args).toEqual([image, 0, 0, 8, 8]);
    } finally {
      document.createElement = real as Document["createElement"];
    }
  });

  it("draws a shape's fill and its stroke, as it declared them", () => {
    const { pipeline, layer, world, spawn } = screen();
    spawn(
      new ShapeComponent({
        shape: { kind: "rect", width: 40, height: 20 },
        fill: "#00ff00",
        stroke: "#ff00ff",
        strokeWidth: 3,
      }),
    );

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("rect")[0]?.args).toEqual([-20, -10, 40, 20]);
    expect(layer.opsOf("fill")[0]?.fill).toBe("#00ff00");
    expect(layer.names()).toContain("stroke");
    expect(layer.ctx.lineWidth).toBe(3);
  });

  it("traces a circle and a polygon about the component's position", () => {
    const { pipeline, layer, world, spawn } = screen();
    const circle = spawn(
      new ShapeComponent({
        shape: { kind: "circle", radius: 5 },
        fill: "#fff",
      }),
    );
    circle.transform.position = vec3(10, 20, 0);
    spawn(
      new ShapeComponent({
        shape: {
          kind: "polygon",
          points: [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 0, y: 1 },
          ],
        },
        fill: "#fff",
      }),
    );

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("arc")[0]?.args).toEqual([10, 20, 5, 0, Math.PI * 2]);
    expect(layer.opsOf("moveTo")[0]?.args).toEqual([-1, -1]);
    expect(layer.opsOf("lineTo").map((op) => op.args)).toEqual([
      [1, -1],
      [0, 1],
    ]);
    expect(layer.names()).toContain("closePath");
  });

  it("draws a shape with neither a fill nor a stroke as nothing", () => {
    const { pipeline, layer, world, spawn } = screen();
    spawn(new ShapeComponent({ shape: { kind: "circle", radius: 4 } }));

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.names()).not.toContain("fill");
    expect(layer.names()).not.toContain("stroke");
  });

  it("draws text at the logical position with the declared font and alignment", () => {
    const { pipeline, layer, world, spawn } = screen();
    const label = new TextComponent({
      text: "3 - 1",
      font: "24px monospace",
      fill: "#f2f5f7",
      align: "left",
      baseline: "top",
    });
    const actor = spawn(label);
    actor.transform.position = vec3(320, 30, 0);

    pipeline.renderScreen(world, FIT, FRAME);

    const drawn = layer.opsOf("fillText")[0];
    expect(drawn?.args).toEqual(["3 - 1", 320, 30]);
    expect(drawn?.fill).toBe("#f2f5f7");
    expect(layer.ctx.font).toBe("24px monospace");
    expect(layer.ctx.textAlign).toBe("left");
    expect(layer.ctx.textBaseline).toBe("top");
  });

  it("draws a component's opacity as the alpha in force", () => {
    const { pipeline, layer, world, spawn } = screen();
    const label = new TextComponent({ text: "fading" });
    label.opacity = 0.25;
    spawn(label);

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.ctx.globalAlpha).toBe(0.25);
  });

  it("pivots a rotated, scaled component about its own position", () => {
    const { pipeline, layer, world, spawn } = screen();
    const label = new TextComponent({ text: "tilted" });
    const actor = spawn(label);
    actor.transform.position = vec3(100, 60, 0);
    actor.transform.rotation = quatFromEuler(0, 0, Math.PI / 2);
    actor.transform.scale = vec3(2, 3, 1);

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.opsOf("translate").map((op) => op.args)).toEqual([
      [100, 60],
      [-100, -60],
    ]);
    expect(layer.opsOf("rotate")[0]?.args[0]).toBeCloseTo(Math.PI / 2, 6);
    expect(layer.opsOf("scale")[0]?.args).toEqual([2, 3]);
  });

  it("adds no transform for an unrotated, unscaled component", () => {
    const { pipeline, layer, world, spawn } = screen();
    const actor = spawn(new TextComponent({ text: "plain" }));
    actor.transform.position = vec3(100, 60, 0);

    pipeline.renderScreen(world, FIT, FRAME);

    expect(layer.names()).not.toContain("translate");
    expect(layer.names()).not.toContain("rotate");
  });

  it("reads only the yaw about +Z and the two planar scales", () => {
    const { pipeline, layer, world, spawn } = screen();
    const actor = spawn(new TextComponent({ text: "flat" }));
    actor.transform.position = vec3(10, 10, 99);
    actor.transform.scale = vec3(1, 1, 4);

    pipeline.renderScreen(world, FIT, FRAME);

    // `position.z` and `scale.z` play no part, so the component draws as though
    // neither were written.
    expect(layer.opsOf("fillText")[0]?.args).toEqual(["flat", 10, 10]);
    expect(layer.names()).not.toContain("scale");
  });
});

describe("the screen pass under a mode", () => {
  // A tinted sprite is one of the three components below, and flattening a tint
  // needs a scratch canvas of its own; without one the sprite draws untinted
  // and the `unlit` claim would pass for the wrong reason.
  let contexts: InstalledContexts;

  beforeEach(() => {
    contexts = installCanvasContexts();
  });

  afterEach(() => {
    contexts.uninstall();
  });

  function draw(mode: "shaded" | "wireframe" | "unlit" | "normals"): {
    layer: Context2dStub;
  } {
    const built = rig();
    const sprite = new SpriteComponent({
      image: bitmap(),
      tint: "#ff0000",
      anchorX: 0,
      anchorY: 0,
    });
    sprite.opacity = 0.5;
    const shape = new ShapeComponent({
      shape: { kind: "rect", width: 10, height: 10 },
      fill: "#00ff00",
    });
    shape.opacity = 0.5;
    const label = new TextComponent({ text: "hud" });
    label.opacity = 0.5;
    built.spawn(sprite, shape, label);
    built.layer.forget();
    built.pipeline.setMode(mode);
    built.pipeline.renderScreen(built.world, FIT, FRAME);
    return { layer: built.layer };
  }

  it("draws the full picture under shaded", () => {
    const { layer } = draw("shaded");

    expect(layer.names()).toContain("drawImage");
    expect(layer.names()).toContain("fill");
    expect(layer.names()).toContain("fillText");
    expect(layer.ctx.globalAlpha).toBe(0.5);
  });

  it("draws outlines alone under wireframe", () => {
    const { layer } = draw("wireframe");

    expect(layer.names()).not.toContain("fill");
    expect(layer.names()).not.toContain("fillText");
    expect(layer.names()).not.toContain("drawImage");
    expect(layer.names()).toContain("strokeRect");
    expect(layer.names()).toContain("stroke");
    expect(layer.names()).toContain("strokeText");
  });

  it("draws fills and images at full opacity with every tint dropped under unlit", () => {
    const { layer } = draw("unlit");

    expect(layer.ctx.globalAlpha).toBe(1);
    // The image itself rather than the tint scratch: five arguments, the first
    // of them the bitmap the sprite carries.
    const blit = layer.opsOf("drawImage")[0];
    expect(blit?.args).toHaveLength(5);
    expect((blit?.args[0] as { width: number }).width).toBe(16);
    expect(layer.names()).toContain("fill");
  });

  it("draws the full picture under normals, which has nothing to say about a flat layer", () => {
    const { layer } = draw("normals");

    expect(layer.names()).toContain("drawImage");
    expect(layer.names()).toContain("fill");
    expect(layer.names()).toContain("fillText");
    expect(layer.ctx.globalAlpha).toBe(0.5);
  });
});

describe("direct drawing", () => {
  /** A draw component that keeps what it was handed. */
  class Probe extends DrawComponent {
    api: DrawApi | null = null;
    calls = 0;

    draw(api: DrawApi): void {
      this.api = api;
      this.calls += 1;
      api.ctx.fillRect(1, 2, 3, 4);
    }
  }

  it("calls draw once per frame, in the component's place in the layer order", () => {
    const { pipeline, layer, world, spawn } = rig();
    const probe = new Probe();
    probe.layer = 5;
    const under = new TextComponent({ text: "under" });
    under.layer = 0;
    const over = new TextComponent({ text: "over" });
    over.layer = 10;
    spawn(over, probe, under);
    layer.forget();

    pipeline.renderScreen(world, FIT, FRAME);

    expect(probe.calls).toBe(1);
    const order = layer
      .names()
      .filter((name) => name === "fillText" || name === "fillRect");
    expect(order).toEqual(["fillText", "fillRect", "fillText"]);
  });

  it("hands over the screen layer's context, carrying the viewport transform", () => {
    const { pipeline, layer, world, spawn } = rig();
    const probe = new Probe();
    spawn(probe);

    pipeline.renderScreen(world, LETTERBOX, FRAME);

    expect(probe.api?.ctx).toBe(pipeline.screen);
    expect(layer.opsOf("fillRect")[0]?.transform).toEqual([
      LETTERBOX.scale,
      0,
      0,
      LETTERBOX.scale,
      LETTERBOX.offsetX,
      LETTERBOX.offsetY,
    ]);
  });

  it("hands over the mode in force for the frame", () => {
    const { pipeline, world, spawn } = rig();
    const probe = new Probe();
    spawn(probe);

    pipeline.setMode("unlit");
    pipeline.renderScreen(world, FIT, FRAME);

    expect(probe.api?.mode).toBe("unlit");
  });

  it("hands over the frame, the fit, and the camera as snapshots the caller owns", () => {
    const { pipeline, world, camera, spawn } = rig();
    const probe = new Probe();
    spawn(probe);

    pipeline.renderScreen(world, FIT, FRAME);
    const api = probe.api;
    const held = api?.frame();
    const fit = api?.viewport();
    const pose = api?.camera();

    expect(held).toEqual(FRAME);
    expect(held).not.toBe(FRAME);
    expect(fit).toEqual(FIT);
    expect(api?.viewport()).not.toBe(fit);
    expect(pose?.position).toEqual(camera.position);
    expect(api?.camera()).not.toBe(pose);
  });

  it("keeps the values of the frame it was read in", () => {
    const { pipeline, world, spawn } = rig();
    const probe = new Probe();
    spawn(probe);

    pipeline.renderScreen(world, FIT, FRAME);
    const held = probe.api?.frame();
    pipeline.renderScreen(world, FIT, {
      count: 99,
      timeMs: 1600,
      lastDeltaMs: 16,
    });

    expect(held).toEqual(FRAME);
  });
});

describe("the composite", () => {
  it("draws the layer over the whole canvas, bars included", () => {
    const { pipeline, gl, world } = rig();

    pipeline.renderWorld(world, LETTERBOX);
    gl.forget();
    pipeline.composite();

    expect(gl.lastCall("viewport")?.args).toEqual([0, 0, WIDTH, HEIGHT]);
  });

  it("draws after the picture, so the layer is over the world", () => {
    const { pipeline, gl, world, spawn } = rig();
    spawn(mesh());

    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);
    const scene = draws(gl);
    pipeline.composite();

    expect(scene).toBe(1);
    expect(draws(gl)).toBe(2);
  });

  it("draws the layer again on every frame, from one texture rather than a new one", () => {
    const { pipeline, gl, world } = rig();

    pipeline.renderWorld(world, FIT);
    pipeline.composite();
    const first = draws(gl);
    const geometries = pipeline.renderer.info.memory.geometries;
    pipeline.composite();

    // The quad is drawn again — the layer is a canvas the previous frame drew
    // on, so its contents reach the picture only by being drawn again — and it
    // is the same quad: the composite allocates nothing per frame.
    expect(draws(gl)).toBe(first + 1);
    expect(pipeline.renderer.info.memory.geometries).toBe(geometries);
  });

  it("clears nothing of its own", () => {
    const { pipeline, gl, world } = rig();

    pipeline.renderWorld(world, FIT);
    gl.forget();
    pipeline.composite();

    expect(gl.callsTo("clear")).toEqual([]);
  });
});

describe("disposal", () => {
  it("disposes the renderer", () => {
    const { pipeline } = rig();
    let disposed = 0;
    const real = pipeline.renderer.dispose.bind(pipeline.renderer);
    pipeline.renderer.dispose = (): void => {
      disposed += 1;
      real();
    };

    pipeline.dispose();

    expect(disposed).toBe(1);
  });

  it("is idempotent, because teardown races", () => {
    const { pipeline } = rig();
    let disposed = 0;
    const real = pipeline.renderer.dispose.bind(pipeline.renderer);
    pipeline.renderer.dispose = (): void => {
      disposed += 1;
      real();
    };

    pipeline.dispose();
    pipeline.dispose();

    expect(disposed).toBe(1);
  });

  it("gives back everything it built for the world's components", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh());
    pipeline.syncScene(world, 0);
    const object = placed<THREE.Mesh>(pipeline);
    const gone: string[] = [];
    object.geometry.addEventListener("dispose", () => gone.push("geometry"));
    (object.material as THREE.Material).addEventListener("dispose", () =>
      gone.push("material"),
    );

    pipeline.dispose();

    expect(gone.sort()).toEqual(["geometry", "material"]);
    expect(pipeline.scene.children).toEqual([]);
  });

  it("gives back the compositing objects it created", () => {
    const { pipeline, world } = rig();
    pipeline.renderWorld(world, FIT);
    pipeline.composite();
    expect(pipeline.renderer.info.memory.geometries).toBeGreaterThan(0);

    pipeline.dispose();

    expect(pipeline.renderer.info.memory.geometries).toBe(0);
  });

  it("leaves a subtree the game built as it stands", () => {
    const material = new THREE.MeshBasicMaterial();
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const group = new THREE.Group();
    group.add(inner);
    let disposed = 0;
    material.addEventListener("dispose", () => {
      disposed += 1;
    });
    const { pipeline, world, spawn } = rig();
    spawn(new Object3DComponent({ object: group }));
    pipeline.syncScene(world, 0);

    pipeline.dispose();

    expect(disposed).toBe(0);
    expect(group.children).toEqual([inner]);
  });
});

/* -------------------------------------------------------------------------- */
/* What the overlay draws, and the two claims about the whole frame           */
/* -------------------------------------------------------------------------- */

/**
 * Every `renderer.render` the pipeline issues, with what it drew.
 *
 * The overlay is a scene of the pipeline's own, kept out of `engine.scene` so
 * the mode substitution cannot reach it and so a validator reading the scene
 * finds what the *game* placed. That makes the render call the only place its
 * contents are observable, and the shapes in it the only place the overlay's
 * colors and dimensions are.
 */
function captureRenders(
  pipeline: RenderPipeline,
): { scene: THREE.Object3D; camera: THREE.Camera }[] {
  const seen: { scene: THREE.Object3D; camera: THREE.Camera }[] = [];
  const renderer = pipeline.renderer;
  const original = renderer.render.bind(renderer);
  renderer.render = (scene: THREE.Object3D, camera: THREE.Camera): void => {
    seen.push({ scene, camera });
    original(scene as THREE.Scene, camera);
  };
  return seen;
}

describe("the collision overlay's shapes", () => {
  /** A collider of one shape, answering `responses` however it was given. */
  function collider(
    shape: import("./contract").ColliderShape,
    responses?: Record<string, import("./contract").CollisionResponse>,
  ): ColliderComponent {
    return new ColliderComponent({ shape, responses });
  }

  /** The wireframes the overlay drew for one frame. */
  function outlines(
    renders: { scene: THREE.Object3D }[],
  ): readonly THREE.Mesh[] {
    const overlay = renders.at(-1)?.scene;
    return (overlay?.children ?? []) as THREE.Mesh[];
  }

  /** The dimensions a built-in geometry remembers being built at. */
  function dimensions(
    geometry: THREE.BufferGeometry | undefined,
  ): Record<string, unknown> {
    return (geometry as THREE.BoxGeometry | undefined)?.parameters ?? {};
  }

  it("draws each collider in the color of the response it declares", () => {
    const { pipeline, world, spawn } = rig();
    const box = { kind: "box" as const, width: 1, height: 1, depth: 1 };
    spawn(collider(box, { default: "block" }));
    spawn(collider(box, { default: "overlap" }));
    spawn(collider(box, { default: "ignore" }));

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    const renders = captureRenders(pipeline);
    pipeline.renderWorld(world, FIT);

    const colors = outlines(renders).map((outline) =>
      (outline.material as THREE.MeshBasicMaterial).color.getHexString(),
    );
    expect(colors).toEqual(["ff5566", "ffd166", "7f8c9b"]);
    for (const outline of outlines(renders)) {
      expect((outline.material as THREE.MeshBasicMaterial).wireframe).toBe(
        true,
      );
    }
  });

  it("colors a collider by the strongest response it declares", () => {
    // A collider's effective response is decided per pair, so a single collider
    // has no one response of its own: the overlay colors by the most it can do
    // to anything, which is a property of the collider alone.
    const { pipeline, world, spawn } = rig();
    const box = { kind: "box" as const, width: 1, height: 1, depth: 1 };
    spawn(
      collider(box, { walls: "ignore", pickups: "overlap", floor: "block" }),
    );
    spawn(collider(box, { walls: "ignore", pickups: "overlap" }));
    spawn(collider(box, {}));

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    const renders = captureRenders(pipeline);
    pipeline.renderWorld(world, FIT);

    expect(
      outlines(renders).map((outline) =>
        (outline.material as THREE.MeshBasicMaterial).color.getHexString(),
      ),
    ).toEqual(["ff5566", "ffd166", "7f8c9b"]);
  });

  it("scales a shape the way the collision pass scales it", () => {
    const { pipeline, world, spawn } = rig();
    const actor = spawn(
      collider({ kind: "box", width: 1, height: 1, depth: 1 }),
      collider({ kind: "sphere", radius: 1 }),
      collider({ kind: "capsule", radius: 1, height: 2 }),
    );
    actor.transform.position = vec3(5, 0, 0);
    actor.transform.scale = vec3(2, 3, 4);

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    const renders = captureRenders(pipeline);
    pipeline.renderWorld(world, FIT);

    const [box, ball, pill] = outlines(renders);
    // A box's extents take one factor each; a sphere's and a capsule's radius
    // take the largest of the three, because a rounded shape under a
    // non-uniform scale would be an ellipsoid the pair tests have no closed
    // form for. The overlay shows what the engine *tests*, so it scales the way
    // the engine does rather than the way the object would.
    expect(dimensions(box?.geometry)).toMatchObject({
      width: 2,
      height: 3,
      depth: 4,
    });
    expect(dimensions(ball?.geometry)).toMatchObject({ radius: 4 });
    expect(dimensions(pill?.geometry)).toMatchObject({ radius: 4, height: 6 });
    // The scale is in the geometry, so the object carries none: applying it
    // again would stretch a sphere the engine tests as a sphere.
    expect(box?.scale.toArray()).toEqual([1, 1, 1]);
    expect(box?.position.toArray()).toEqual([5, 0, 0]);
  });

  it("rebuilds a geometry only when the placed dimensions change", () => {
    const { pipeline, world, spawn } = rig();
    const shape = collider({ kind: "sphere", radius: 1 });
    const actor = spawn(shape);

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    const renders = captureRenders(pipeline);

    pipeline.renderWorld(world, FIT);
    const first = outlines(renders)[0]?.geometry;
    expect(first).toBeDefined();

    actor.transform.position = vec3(1, 1, 1);
    pipeline.renderWorld(world, FIT);
    expect(outlines(renders)[0]?.geometry).toBe(first);

    // A collider's `shape` is held by reference and a game may write into it,
    // so there is no assignment to watch: the placed numbers are compared, and
    // a shape mutated in place is caught like one replaced.
    const held = shape.shape;
    if (held.kind === "sphere") held.radius = 3;
    pipeline.renderWorld(world, FIT);
    const second = outlines(renders)[0]?.geometry;
    expect(second).not.toBe(first);
    expect(dimensions(second)).toMatchObject({ radius: 3 });
  });

  it("keeps its wireframes out of the scene the game populated", () => {
    const { pipeline, world, spawn } = rig();
    spawn(mesh(), collider({ kind: "sphere", radius: 1 }));

    pipeline.setCollisionOverlay(true);
    pipeline.syncScene(world, 0);
    const renders = captureRenders(pipeline);
    pipeline.renderWorld(world, FIT);

    // `engine.scene` answers what the game placed, so the engine's own chrome
    // must not appear in it — and the overlay is drawn through the same camera,
    // so a collider lands over the thing it belongs to.
    expect(pipeline.scene.children).toHaveLength(1);
    expect(renders).toHaveLength(2);
    expect(renders[1]?.scene).not.toBe(pipeline.scene);
    expect(renders[1]?.camera).toBe(renders[0]?.camera);
  });
});

describe("what the modes reach in the context", () => {
  /** The program bound when the first draw of the recorded stretch was issued. */
  function programAtFirstDraw(gl: GlStub): unknown {
    let program: unknown;
    for (const call of gl.calls) {
      if (call.name === "useProgram") program = call.args[0];
      if (isDraw(call)) return program;
    }
    return undefined;
  }

  it("shows a substitution as a different program in force at the draw", () => {
    // A material reaches the context as a program, so this is the claim every
    // render-mode assertion above ultimately rests on: the substitution is not
    // only visible to `onBeforeRender`, it changes what the draw runs through.
    const shaded = rig();
    shaded.spawn(mesh());
    shaded.pipeline.syncScene(shaded.world, 0);
    shaded.gl.forget();
    shaded.pipeline.renderWorld(shaded.world, FIT);

    const normals = rig();
    normals.spawn(mesh());
    normals.pipeline.setMode("normals");
    normals.pipeline.syncScene(normals.world, 0);
    normals.gl.forget();
    normals.pipeline.renderWorld(normals.world, FIT);

    expect(programAtFirstDraw(shaded.gl)).toBeDefined();
    expect(programAtFirstDraw(normals.gl)).toBeDefined();
    expect(programAtFirstDraw(normals.gl)).not.toBe(
      programAtFirstDraw(shaded.gl),
    );
  });

  it("restores a point cloud's own alpha under unlit", () => {
    const { pipeline, world, spawn } = rig();
    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ opacity: 0.5, transparent: true }),
    );
    const declared = points.material;
    spawn(new Object3DComponent({ object: points }));
    pipeline.syncScene(world, 0);
    const seen = watchMaterial(points);

    pipeline.setMode("unlit");
    pipeline.renderWorld(world, FIT);

    // Every material has a base color and an opacity, so unlit reaches the
    // point-and-line materials too — they are already unlit, so all they need
    // is their alpha back.
    const substituted = seen[0] as THREE.PointsMaterial;
    expect(substituted).toBeInstanceOf(THREE.PointsMaterial);
    expect(substituted).not.toBe(declared);
    expect(substituted.opacity).toBe(1);
    expect(substituted.transparent).toBe(false);
    expect(points.material).toBe(declared);
  });
});

describe("the frame, end to end", () => {
  it("refuses the design size before it reaches for a context", () => {
    // Every refusal in the order the errors table lists them: the size
    // everything else is measured in, then the surface everything is drawn on,
    // then the layer drawn over it.
    expect(
      () =>
        new RenderPipeline({
          canvas: createContextlessCanvas(),
          width: 0,
          height: HEIGHT,
          screen: createContextlessCanvas(),
        }),
    ).toThrow(/finite, positive width/);
  });

  it("builds no renderer for an engine that will not be returned", () => {
    const stage = createStage({ width: WIDTH, height: HEIGHT });
    expect(
      () =>
        new RenderPipeline({
          canvas: stage.stage.canvas,
          width: WIDTH,
          height: HEIGHT,
          screen: createContextlessCanvas(),
        }),
    ).toThrow();

    // Every refusal precedes the renderer, so a rejected construction leaves no
    // GL objects and no drawing buffer behind it.
    expect(stage.stage.gl.calls).toHaveLength(0);
  });

  it("draws through the camera's projection, so what is outside it is culled", () => {
    const { pipeline, gl, world, camera, spawn } = rig();
    spawn(mesh());
    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);
    expect(draws(gl)).toBe(1);

    camera.far = 10;
    camera.position = vec3(0, 0, 5000);
    gl.forget();
    pipeline.syncScene(world, 0);
    pipeline.renderWorld(world, FIT);

    expect(draws(gl)).toBe(0);
  });

  it("gives the layer the viewport transform even on a frame with no HUD", () => {
    const { pipeline, layer, world } = rig();

    pipeline.renderScreen(world, LETTERBOX, FRAME);

    // Step 5 clears the layer *and* gives it the fit, before any component is
    // asked to draw, so a world whose HUD is empty this frame still leaves the
    // layer in logical units.
    expect(layer.opsOf("setTransform").at(-1)?.args).toEqual([
      LETTERBOX.scale,
      0,
      0,
      LETTERBOX.scale,
      LETTERBOX.offsetX,
      LETTERBOX.offsetY,
    ]);
  });

  it("asks for the screen layer's upload on every composite", () => {
    const { pipeline, world } = rig();

    pipeline.renderWorld(world, FIT);
    const before = pipeline.screenTexture.version;
    pipeline.composite();
    const after = pipeline.screenTexture.version;
    pipeline.composite();

    // The canvas is the texture's source and its contents changed this frame,
    // so the upload is asked for explicitly; three re-uploads nothing it is not
    // told about, and a composite that stopped asking would freeze the HUD at
    // whatever the first frame drew without failing anything else.
    expect(after).toBeGreaterThan(before);
    expect(pipeline.screenTexture.version).toBeGreaterThan(after);
    expect(pipeline.screenTexture.image).toBe(pipeline.screenCanvas);
  });
});
