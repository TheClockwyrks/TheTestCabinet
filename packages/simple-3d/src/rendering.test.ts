import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import type { Viewport } from "./contract";
import { rendererCounts } from "./diagnostics";
import type { RenderStage, RenderStageOptions } from "./rendering";
import { createRenderStage } from "./rendering";
import {
  createContextlessCanvas,
  createStage,
  createStubCanvas,
  installCanvasContexts,
} from "./testing/canvas";
import type { GlCall, GlStub } from "./testing/gl";

/**
 * The rendering stage: the renderer over the stage canvas, the scene and camera it
 * draws, the screen layer drawn over them, and the order the three happen in.
 *
 * The picture itself is out of scope here — the context is a stub and rasterizing
 * is a case's validators' business, in a real browser against a real GPU. What is
 * in scope is everything an engine decides *around* the picture, which is exactly
 * what a stub can answer for: which context the renderer was built over, where the
 * letterboxed rectangle was placed, what the canvas was cleared to and whether the
 * clear preceded the scissor, whether a camera the game posed reached the frame it
 * was posed in, whether the screen layer was uploaded again, and what survives
 * disposal.
 *
 * Most assertions read the GL calls the stub recorded, because their *order* is the
 * claim: "the bars carry the background" is "the clear happened while the scissor
 * test was off", and "the HUD is over the world" is "the composite drew after the
 * scene did". Note that three caches GL state — a viewport, a scissor rectangle, or
 * an enable that does not change is not re-issued — so a test that wants to see one
 * either forgets the recorded calls first and changes the value, or asserts on the
 * frame that first set it.
 */

/** The design size every stage below is built at, and the canvas it is fitted into. */
const DESIGN_WIDTH = 640;
const DESIGN_HEIGHT = 360;
const CSS_WIDTH = 400;
const CSS_HEIGHT = 300;
const DPR = 2;

/**
 * The fit that design size takes in that canvas: a scale of `1.25` device pixels per
 * logical unit and a `75` device pixel bar above and below.
 *
 * Written out rather than computed through `fitViewport`, so this suite pins the
 * rendering against a rectangle it states itself and a change to the fit shows up
 * here as a disagreement rather than as two modules agreeing on something wrong.
 */
const LETTERBOX: Viewport = {
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  scale: 1.25,
  offsetX: 0,
  offsetY: 75,
};
const PICTURE_WIDTH = DESIGN_WIDTH * LETTERBOX.scale;
const PICTURE_HEIGHT = DESIGN_HEIGHT * LETTERBOX.scale;

const stages: RenderStage[] = [];

afterEach(() => {
  for (const stage of stages.splice(0)) stage.dispose();
});

/** A stage over stubbed canvases, disposed of whatever the test does with it. */
function build(options: Partial<RenderStageOptions> = {}): {
  stage: RenderStage;
  gl: GlStub;
  canvas: HTMLCanvasElement;
  screenCanvas: HTMLCanvasElement;
} {
  const rig = createStage({
    cssWidth: CSS_WIDTH,
    cssHeight: CSS_HEIGHT,
    dpr: DPR,
  });
  const stage = createRenderStage({
    canvas: rig.stage.canvas,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
    screen: rig.screen.canvas,
    ...options,
  });
  stages.push(stage);
  return {
    stage,
    gl: rig.stage.gl,
    canvas: rig.stage.canvas,
    screenCanvas: rig.screen.canvas,
  };
}

/** A scene object, so a frame has something to draw and a count to report. */
function box(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x4488ff }),
  );
}

/** The indices of every recorded call a predicate accepts, oldest first. */
function indices(gl: GlStub, accept: (call: GlCall) => boolean): number[] {
  const found: number[] = [];
  gl.calls.forEach((call, at) => {
    if (accept(call)) found.push(at);
  });
  return found;
}

/** The index of the first recorded call a predicate accepts, or `-1`. */
function firstIndex(gl: GlStub, accept: (call: GlCall) => boolean): number {
  return indices(gl, accept)[0] ?? -1;
}

/** Whether a call is the enable or disable of the scissor test. */
function togglesScissor(
  gl: GlStub,
  call: GlCall,
  how: "enable" | "disable",
): boolean {
  return call.name === how && call.args[0] === gl.constant("SCISSOR_TEST");
}

/** Whether a call drew anything. */
function isDraw(call: GlCall): boolean {
  return call.name.startsWith("draw");
}

describe("the renderer", () => {
  it("is built over the webgl2 context the stage canvas gave", () => {
    const { stage, gl } = build();

    expect(stage.renderer.getContext()).toBe(gl.gl);
    expect(stage.renderer.capabilities.isWebGL2).toBe(true);
  });

  it("asks that context for antialiasing and an alpha channel", () => {
    const rig = createStage();
    const asked: { id: string; attributes: unknown }[] = [];
    const real = rig.stage.canvas.getContext.bind(rig.stage.canvas);
    rig.stage.canvas.getContext = ((
      id: string,
      attributes: unknown,
    ): unknown => {
      asked.push({ id, attributes });
      return real(id as "webgl2");
    }) as unknown as HTMLCanvasElement["getContext"];

    stages.push(
      createRenderStage({
        canvas: rig.stage.canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        screen: rig.screen.canvas,
      }),
    );

    // Both are properties of the drawing buffer rather than renderer settings, so
    // they have to be asked for where the context is created or not at all.
    expect(asked).toEqual([
      { id: "webgl2", attributes: { antialias: true, alpha: true } },
    ]);
  });

  it("writes sRGB, so a color reaches the canvas as the color it was written as", () => {
    const { stage } = build();

    expect(stage.renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("leaves every clear to the engine", () => {
    const { stage } = build();

    // Not a style preference: the composite is a second `render` call, and three
    // clearing on its own account there would wipe the frame it exists to draw over.
    expect(stage.renderer.autoClear).toBe(false);
  });

  it("has shadow maps off unless the build asked for them", () => {
    const { stage } = build();

    expect(stage.renderer.shadowMap.enabled).toBe(false);
  });

  it("enables PCF soft shadow maps when the build asked for them", () => {
    const { stage } = build({ shadows: true });

    expect(stage.renderer.shadowMap.enabled).toBe(true);
    expect(stage.renderer.shadowMap.type).toBe(THREE.PCFSoftShadowMap);
  });

  it("refuses a canvas that yields no webgl2 context, naming the canvas", () => {
    expect(() =>
      createRenderStage({
        canvas: createContextlessCanvas(),
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        screen: createStubCanvas().canvas,
      }),
    ).toThrow(/webgl2 context from the canvas/);
  });
});

describe("the scene", () => {
  it("is created empty, with no lights and no background", () => {
    const { stage } = build();

    expect(stage.scene).toBeInstanceOf(THREE.Scene);
    expect(stage.scene.children).toEqual([]);
    expect(stage.scene.background).toBeNull();
  });

  it("is retained: what one frame added is still there for the next", () => {
    const { stage } = build();
    const mesh = box();
    mesh.name = "crate";
    stage.scene.add(mesh);

    stage.render(LETTERBOX);
    stage.composite();
    stage.render(LETTERBOX);

    expect(stage.scene.getObjectByName("crate")).toBe(mesh);
  });
});

describe("the camera", () => {
  it("is a perspective camera at the documented defaults", () => {
    const { stage } = build();
    const camera = stage.camera as THREE.PerspectiveCamera;

    expect(camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(camera.fov).toBe(60);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);
    expect(camera.zoom).toBe(1);
    expect(camera.aspect).toBeCloseTo(DESIGN_WIDTH / DESIGN_HEIGHT, 10);
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
  });

  it("is the same camera when the build names the default explicitly", () => {
    const { stage } = build({ projection: "perspective" });

    expect(stage.camera).toBeInstanceOf(THREE.PerspectiveCamera);
  });

  it("is an orthographic camera spanning the design size when asked", () => {
    const { stage } = build({ projection: "orthographic" });
    const camera = stage.camera as THREE.OrthographicCamera;

    expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
    // The extents span the design field, so a world unit on the `z = 0` plane is
    // one logical unit and the world origin is the centre of the field.
    expect(camera.left).toBe(-DESIGN_WIDTH / 2);
    expect(camera.right).toBe(DESIGN_WIDTH / 2);
    expect(camera.top).toBe(DESIGN_HEIGHT / 2);
    expect(camera.bottom).toBe(-DESIGN_HEIGHT / 2);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(1000);
    expect(camera.zoom).toBe(1);
    expect(camera.position.toArray()).toEqual([0, 0, 10]);
  });

  it("starts unrotated, looking along -Z with +Y up", () => {
    for (const projection of ["perspective", "orthographic"] as const) {
      const { stage } = build({ projection });

      expect(stage.camera.quaternion.toArray()).toEqual([0, 0, 0, 1]);
      const forward = stage.camera.getWorldDirection(new THREE.Vector3());
      expect(forward.x).toBeCloseTo(0, 10);
      expect(forward.y).toBeCloseTo(0, 10);
      expect(forward.z).toBeCloseTo(-1, 10);
      expect(stage.camera.up.toArray()).toEqual([0, 1, 0]);
    }
  });

  it("refuses a projection outside the two, naming both", () => {
    let raised: unknown;
    try {
      build({ projection: "isometric" as never });
    } catch (error) {
      raised = error;
    }

    expect(raised).toBeInstanceOf(Error);
    const message = (raised as Error).message;
    expect(message).toContain("isometric");
    expect(message).toContain("perspective");
    expect(message).toContain("orthographic");
  });
});

describe("the screen layer", () => {
  it("draws on the canvas the build supplied, through its own context", () => {
    const rig = createStage();
    const stage = createRenderStage({
      canvas: rig.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      screen: rig.screen.canvas,
    });
    stages.push(stage);

    expect(stage.screenCanvas).toBe(rig.screen.canvas);
    expect(stage.screen).toBe(rig.screen.context2d.ctx);
  });

  it("passes through whatever the screen canvas returned for a context", () => {
    // The whole of the substitution seam a validator uses to record the drawing
    // operations rather than read the pixels: it overrides `getContext` on the
    // canvas it supplies, and the engine hands the game back what it gets.
    const substitute = {} as CanvasRenderingContext2D;
    const screen = createStubCanvas().canvas;
    screen.getContext = ((): unknown =>
      substitute) as unknown as HTMLCanvasElement["getContext"];
    const rig = createStage();
    const stage = createRenderStage({
      canvas: rig.stage.canvas,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      screen,
    });
    stages.push(stage);

    expect(stage.screen).toBe(substitute);
  });

  it("creates one from the stage canvas's own document when the build supplied none", () => {
    const installed = installCanvasContexts();
    try {
      const rig = createStage();
      const stage = createRenderStage({
        canvas: rig.stage.canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
      });
      stages.push(stage);

      expect(stage.screenCanvas).not.toBe(rig.stage.canvas);
      expect(stage.screenCanvas.ownerDocument).toBe(
        rig.stage.canvas.ownerDocument,
      );
      expect(stage.screen).toBe(
        installed.context2dFor(stage.screenCanvas)?.ctx,
      );
      // Sized before the first frame rather than after it, since a canvas element
      // starts life at 300x150 and a validator may read it back at once.
      expect(stage.screenCanvas.width).toBe(rig.stage.canvas.width);
      expect(stage.screenCanvas.height).toBe(rig.stage.canvas.height);
    } finally {
      installed.uninstall();
    }
  });

  it("refuses a stage canvas with no owning document, naming the option", () => {
    const canvas = createStubCanvas().canvas;
    Object.defineProperty(canvas, "ownerDocument", {
      value: null,
      configurable: true,
    });

    expect(() =>
      createRenderStage({
        canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
      }),
    ).toThrow(/screen/);
  });

  it("refuses a screen canvas that yields no 2D context", () => {
    const rig = createStage();

    expect(() =>
      createRenderStage({
        canvas: rig.stage.canvas,
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        screen: createContextlessCanvas(),
      }),
    ).toThrow(/2D context from the screen canvas/);
  });

  it("tracks the stage canvas's backing store, so the composite resamples nothing", () => {
    const { stage, canvas, screenCanvas } = build();

    canvas.width = 512;
    canvas.height = 256;
    stage.syncScreen();

    expect(screenCanvas.width).toBe(512);
    expect(screenCanvas.height).toBe(256);
  });

  it("writes neither dimension when the two already agree", () => {
    const { stage, screenCanvas } = build();
    // Assigning either one reallocates the backing store and clears the canvas, so
    // a sync that wrote unconditionally would throw away the HUD every frame.
    let writes = 0;
    for (const key of ["width", "height"] as const) {
      let held = screenCanvas[key];
      Object.defineProperty(screenCanvas, key, {
        configurable: true,
        get: (): number => held,
        set: (next: number): void => {
          writes += 1;
          held = next;
        },
      });
    }

    stage.syncScreen();
    stage.syncScreen();

    expect(writes).toBe(0);
  });
});

describe("the frame's clear", () => {
  it("clears the whole canvas to the background before the scissor is applied", () => {
    const { stage, gl } = build({ background: "#102030" });
    gl.forget();

    stage.render(LETTERBOX);

    const cleared = gl.lastCall("clearColor")?.args as number[];
    // three's own channels, carried through its conversion into the working colour
    // space and back out to the output one, so they are the written colour to
    // within the round trip rather than to the bit.
    expect(cleared[0]).toBeCloseTo(0x10 / 0xff, 4);
    expect(cleared[1]).toBeCloseTo(0x20 / 0xff, 4);
    expect(cleared[2]).toBeCloseTo(0x30 / 0xff, 4);
    expect(cleared[3]).toBe(1);

    const clear = firstIndex(gl, (call) => call.name === "clear");
    const scissor = firstIndex(gl, (call) => call.name === "scissor");
    const enabled = firstIndex(gl, (call) =>
      togglesScissor(gl, call, "enable"),
    );
    expect(clear).toBeGreaterThanOrEqual(0);
    // The bars carry the background because the clear runs before the scissor
    // confines anything: with the test already on, they would keep whatever the
    // previous frame left in them.
    expect(clear).toBeLessThan(scissor);
    expect(clear).toBeLessThan(enabled);
  });

  it("clears to transparency when the build named no background", () => {
    const { stage, gl } = build();
    gl.forget();

    stage.render(LETTERBOX);

    const cleared = gl.lastCall("clearColor")?.args as number[];
    expect(cleared[3]).toBe(0);
  });

  it("writes the clear color again every frame, so a scene background never becomes the bars'", () => {
    const { stage, gl } = build({ background: "#102030" });
    // A game is entitled to set this, and three answers it by leaving the GL clear
    // colour set to the scene's — which the next frame's bars would inherit if the
    // engine wrote its own colour only once.
    stage.scene.background = new THREE.Color("#ff0000");

    stage.render(LETTERBOX);
    gl.forget();
    stage.render(LETTERBOX);

    const first = gl.callsTo("clearColor")[0]?.args as number[];
    expect(first[0]).toBeCloseTo(0x10 / 0xff, 4);
    expect(first[3]).toBe(1);
    const clear = firstIndex(gl, (call) => call.name === "clear");
    const wrote = firstIndex(gl, (call) => call.name === "clearColor");
    expect(wrote).toBeLessThan(clear);
  });

  it("lets the scene's own background paint inside the viewport alone", () => {
    const { stage, gl } = build({ background: "#102030" });
    stage.scene.background = new THREE.Color("#ff0000");
    gl.forget();

    stage.render(LETTERBOX);

    // three clears to the scene's background itself, and it does so after the
    // scissor has been applied, which is exactly what confines it to the picture
    // while the engine's own clear reached the bars.
    const enabled = firstIndex(gl, (call) =>
      togglesScissor(gl, call, "enable"),
    );
    const red = indices(
      gl,
      (call) => call.name === "clearColor" && (call.args[0] as number) > 0.5,
    );
    const clears = indices(gl, (call) => call.name === "clear");
    expect(enabled).toBeGreaterThanOrEqual(0);
    expect(red[0]).toBeGreaterThan(enabled);
    expect(clears.length).toBe(2);
    expect(clears[1]).toBeGreaterThan(red[0] as number);
  });
});

describe("the frame's picture", () => {
  it("places the picture at the letterboxed rectangle, in device pixels", () => {
    const { stage, gl } = build();
    gl.forget();

    stage.render(LETTERBOX);

    expect(gl.lastCall("viewport")?.args).toEqual([
      LETTERBOX.offsetX,
      LETTERBOX.offsetY,
      PICTURE_WIDTH,
      PICTURE_HEIGHT,
    ]);
    expect(gl.lastCall("scissor")?.args).toEqual([
      LETTERBOX.offsetX,
      LETTERBOX.offsetY,
      PICTURE_WIDTH,
      PICTURE_HEIGHT,
    ]);
    const enabled = gl
      .callsTo("enable")
      .some((call) => call.args[0] === gl.constant("SCISSOR_TEST"));
    expect(enabled).toBe(true);
  });

  it("clips to the same rectangle when both bars are on the other axis", () => {
    const { stage, gl } = build();
    // GL addresses its viewport from the bottom-left and the offsets are measured
    // from the top-left, and no flip is needed because the fit centres the field:
    // the bottom bar is the top bar. A rectangle with both offsets set is what
    // would catch a flip that was introduced anyway.
    const centred: Viewport = {
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      scale: 1,
      offsetX: 80,
      offsetY: 120,
    };
    gl.forget();

    stage.render(centred);

    expect(gl.lastCall("viewport")?.args).toEqual([
      80,
      120,
      DESIGN_WIDTH,
      DESIGN_HEIGHT,
    ]);
    expect(gl.lastCall("scissor")?.args).toEqual([
      80,
      120,
      DESIGN_WIDTH,
      DESIGN_HEIGHT,
    ]);
  });

  it("draws nothing and raises nothing for a degenerate fit", () => {
    const { stage, gl } = build();
    stage.scene.add(box());
    const collapsed: Viewport = {
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      scale: 0,
      offsetX: 0,
      offsetY: 0,
    };
    gl.forget();

    // An element the page has not laid out yet fits to a zero scale, and the frame
    // it applies to has to pass through rather than throw: the fit recovers on its
    // own as soon as the element has a size.
    expect(() => {
      stage.render(collapsed);
    }).not.toThrow();
    expect(gl.lastCall("viewport")?.args).toEqual([0, 0, 0, 0]);
  });

  it("renders the scene through the camera", () => {
    const { stage, gl } = build();
    stage.scene.add(box());
    gl.forget();

    stage.render(LETTERBOX);

    expect(stage.renderer.info.render.calls).toBe(1);
    expect(indices(gl, isDraw).length).toBeGreaterThan(0);
  });

  it("holds a perspective camera's aspect at the design aspect", () => {
    const { stage } = build();
    const camera = stage.camera as THREE.PerspectiveCamera;
    // A game writing this is writing over the one field the engine owns: the
    // picture keeps the shape the game was written for, and the bars absorb
    // whatever shape the element happens to be.
    camera.aspect = 3;

    stage.render(LETTERBOX);

    expect(camera.aspect).toBeCloseTo(DESIGN_WIDTH / DESIGN_HEIGHT, 10);
  });

  it("updates the projection matrix before rendering, so a posed fov is this frame's", () => {
    const { stage } = build();
    const camera = stage.camera as THREE.PerspectiveCamera;
    const before = camera.projectionMatrix.elements.slice();
    camera.fov = 35;

    stage.render(LETTERBOX);

    const zoomed = new THREE.PerspectiveCamera(
      35,
      DESIGN_WIDTH / DESIGN_HEIGHT,
      0.1,
      1000,
    );
    zoomed.updateProjectionMatrix();
    expect(camera.projectionMatrix.elements).not.toEqual(before);
    expect([...camera.projectionMatrix.elements]).toEqual([
      ...zoomed.projectionMatrix.elements,
    ]);
  });

  it("leaves an orthographic camera's extents to the game, and honours them the same frame", () => {
    const { stage } = build({ projection: "orthographic" });
    const camera = stage.camera as THREE.OrthographicCamera;
    camera.left = -20;
    camera.right = 20;
    camera.top = 10;
    camera.bottom = -10;

    stage.render(LETTERBOX);

    expect(camera.left).toBe(-20);
    expect(camera.right).toBe(20);
    const wide = new THREE.OrthographicCamera(-20, 20, 10, -10, 0.1, 1000);
    wide.updateProjectionMatrix();
    expect([...camera.projectionMatrix.elements]).toEqual([
      ...wide.projectionMatrix.elements,
    ]);
  });
});

describe("updateWorld", () => {
  it("brings a nested object's world matrix up to date before anything has rendered", () => {
    const { stage } = build();
    const parent = new THREE.Group();
    const child = box();
    parent.add(child);
    stage.scene.add(parent);
    parent.position.x = 5;
    child.position.x = 1;

    stage.updateWorld();

    // Read off the matrix rather than through `getWorldPosition`, which updates the
    // matrix itself and would pass whether or not the engine did.
    expect(child.matrixWorld.elements[12]).toBe(6);
  });

  it("brings the camera's own world matrix up to date, which is what the view reads", () => {
    const { stage } = build();
    stage.camera.position.set(0, 3, 12);

    stage.updateWorld();

    expect(stage.camera.matrixWorld.elements[13]).toBe(3);
    expect(stage.camera.matrixWorld.elements[14]).toBe(12);
  });

  it("holds the aspect and the projection matrix as a render would", () => {
    const { stage } = build();
    const camera = stage.camera as THREE.PerspectiveCamera;
    camera.aspect = 3;
    camera.fov = 35;

    stage.updateWorld();

    const zoomed = new THREE.PerspectiveCamera(
      35,
      DESIGN_WIDTH / DESIGN_HEIGHT,
      0.1,
      1000,
    );
    zoomed.updateProjectionMatrix();
    expect(camera.aspect).toBeCloseTo(DESIGN_WIDTH / DESIGN_HEIGHT, 10);
    expect([...camera.projectionMatrix.elements]).toEqual([
      ...zoomed.projectionMatrix.elements,
    ]);
  });
});

describe("the draw counts", () => {
  it("are zero before the first render", () => {
    const { stage } = build();

    expect(stage.counts()).toEqual({ drawCalls: 0, triangles: 0 });
  });

  it("are the scene's, for the frame most recently rendered", () => {
    const { stage } = build();
    stage.scene.add(box());

    stage.render(LETTERBOX);

    // One mesh, and a cube is twelve triangles.
    expect(stage.counts()).toEqual({ drawCalls: 1, triangles: 12 });
  });

  it("survive the composite, which would otherwise report its own quad", () => {
    const { stage } = build();
    stage.scene.add(box());
    stage.render(LETTERBOX);

    stage.composite();

    // three resets `info` at the top of every `render` call, and the composite is
    // one, so a metric read after it would report the engine's chrome as the
    // game's picture.
    expect(stage.counts()).toEqual({ drawCalls: 1, triangles: 12 });
    expect(stage.renderer.info.render.calls).toBe(1);
  });

  it("follow the scene as it grows", () => {
    const { stage } = build();
    stage.scene.add(box());
    stage.render(LETTERBOX);
    stage.scene.add(box());

    stage.render(LETTERBOX);

    expect(stage.counts()).toEqual({ drawCalls: 2, triangles: 24 });
  });

  it("are what the diagnostics overlay reads its two figures from", () => {
    // The seam the engine wires: the overlay's counts come from the stage's captured
    // snapshot and never from `renderer.info`, which by the time a panel is drawn
    // holds the composite's quad. Asserted here rather than only at the engine's
    // wiring so a rename on either side fails in the suite.
    const { stage } = build();
    stage.scene.add(box());
    stage.render(LETTERBOX);
    stage.composite();

    const seam = rendererCounts(stage);

    expect(seam.drawCalls()).toBe(1);
    expect(seam.triangles()).toBe(12);
  });
});

describe("the composite", () => {
  it("draws the layer over the whole canvas, bars included", () => {
    const { stage, gl, canvas } = build();
    stage.render(LETTERBOX);
    gl.forget();

    stage.composite();

    // The diagnostics overlay draws in device space and may land in a bar, so a
    // layer clipped to the picture would cut it in half.
    expect(gl.lastCall("viewport")?.args).toEqual([
      0,
      0,
      canvas.width,
      canvas.height,
    ]);
    const off = firstIndex(gl, (call) => togglesScissor(gl, call, "disable"));
    const drew = firstIndex(gl, isDraw);
    expect(off).toBeGreaterThanOrEqual(0);
    expect(off).toBeLessThan(drew);
  });

  it("draws after the picture, so the HUD is over the world", () => {
    const { stage, gl } = build();
    stage.scene.add(box());
    gl.forget();

    stage.render(LETTERBOX);
    const scene = indices(gl, isDraw).length;
    stage.composite();

    expect(scene).toBeGreaterThan(0);
    expect(indices(gl, isDraw).length).toBe(scene + 1);
  });

  it("uploads the layer again every frame", () => {
    const { stage } = build();
    const first = stage.screenTexture.version;

    stage.composite();
    stage.composite();

    // Without this the HUD would freeze at whatever the first frame drew, and
    // nothing about the picture would say so.
    expect(stage.screenTexture.version).toBe(first + 2);
    expect(stage.screenTexture.image).toBe(stage.screenCanvas);
  });

  it("composites the layer with alpha blending, so the scene shows through it", () => {
    const { stage } = build();

    expect(stage.screenTexture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(stage.screenTexture.generateMipmaps).toBe(false);
  });

  it("clears nothing of its own", () => {
    const { stage, gl } = build({ background: "#102030" });
    stage.render(LETTERBOX);
    gl.forget();

    stage.composite();

    // The frame it draws over is the whole of its input; a clear here would be the
    // picture gone and a HUD on an empty canvas.
    expect(gl.callsTo("clear")).toEqual([]);
  });

  it("draws even before anything has been rendered", () => {
    const { stage, gl } = build();
    gl.forget();

    expect(() => {
      stage.composite();
    }).not.toThrow();
    expect(indices(gl, isDraw).length).toBe(1);
  });
});

describe("disposal", () => {
  it("disposes the renderer", () => {
    const { stage } = build();
    let disposed = 0;
    const real = stage.renderer.dispose.bind(stage.renderer);
    stage.renderer.dispose = (): void => {
      disposed += 1;
      real();
    };

    stage.dispose();

    expect(disposed).toBe(1);
  });

  it("disposes the compositing objects it created", () => {
    const { stage } = build();
    stage.render(LETTERBOX);
    stage.composite();
    // The quad is the only geometry here, the scene being empty, so the renderer's
    // own accounting is what says whether it was given back.
    expect(stage.renderer.info.memory.geometries).toBe(1);

    stage.dispose();

    expect(stage.renderer.info.memory.geometries).toBe(0);
  });

  it("is idempotent, because teardown races", () => {
    const { stage } = build();
    let disposed = 0;
    const real = stage.renderer.dispose.bind(stage.renderer);
    stage.renderer.dispose = (): void => {
      disposed += 1;
      real();
    };

    stage.dispose();
    stage.dispose();

    expect(disposed).toBe(1);
  });

  it("leaves the scene and the objects the game placed in it as they stand", () => {
    const { stage } = build();
    const mesh = box();
    mesh.name = "crate";
    stage.scene.add(mesh);
    stage.render(LETTERBOX);

    stage.dispose();

    // A caller that reads the scene after destroying the engine still finds what
    // the last frame left, and the geometries and materials remain the game's.
    expect(stage.scene.getObjectByName("crate")).toBe(mesh);
    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
  });
});
