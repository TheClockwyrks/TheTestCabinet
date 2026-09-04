/**
 * The two surfaces a frame draws onto one canvas, and the machinery that joins
 * them: a `THREE.WebGLRenderer` over the stage canvas for the 3D picture, and a
 * second, engine-owned 2D canvas — the *screen layer* — composited over it.
 *
 * A 3D game has the same readouts a 2D game has. A score, a timer, a menu, and a
 * label pinned beside something in the world are text and rectangles placed on the
 * design field, and a 2D context draws each of them in one call where a scene would
 * need geometry, a texture, and a camera-facing quad. So the engine keeps both: the
 * scene holds everything with a position in the *world*, the screen layer holds
 * everything with a position on the *stage*, and this module owns the seam between
 * them.
 *
 * What is decided here, in the order a reader is likely to ask:
 *
 * 1. **The renderer is built over a context the engine obtained itself.** The
 *    `webgl2` context is asked for with `antialias` and `alpha` on and handed to
 *    the renderer, rather than letting three create one, so a canvas that cannot
 *    give one is refused by {@link createRenderStage} — naming the canvas — instead
 *    of failing somewhere inside three with a message about a build the author did
 *    not write.
 * 2. **`autoClear` is off and every clear is explicit.** The whole canvas is cleared
 *    to `background` *before* the scissor is applied, which is what makes the
 *    letterbox bars carry the background color; the scissor then confines the scene
 *    — and the scene's own `background`, which three clears to inside the current
 *    scissor — to the letterboxed rectangle. Leaving `autoClear` on would also mean
 *    the composite pass wiped the frame it exists to draw over.
 * 3. **The clear color is written every frame rather than once.** A game that sets
 *    `scene.background` to a `Color` makes three leave the GL clear color set to
 *    *its* color, so a clear color written once at construction would silently
 *    become the scene's from the first frame that set one, and the bars would stop
 *    matching `background`.
 * 4. **The letterboxed rectangle, the camera's defaults, and the screen canvas's
 *    size are borrowed rather than restated.** `viewport.ts` owns the fit and
 *    therefore the rectangle the renderer is confined to and the size the screen
 *    canvas copies, and `view.ts` owns the camera the view reads and therefore the
 *    defaults it starts at. A second copy of any of the three here would be a
 *    second thing to keep in step — and the one that is *not* obvious, that the GL
 *    viewport needs no vertical flip because the fit centres the field, is written
 *    out where the fit is.
 * 5. **The projection matrix is recomputed every frame.** A perspective camera's
 *    `aspect` is held at the *design* aspect — so the picture keeps the shape the
 *    game was written for and the bars absorb the difference — and both kinds of
 *    camera have `updateProjectionMatrix` called before rendering, so an `fov`, a
 *    `near`, or an orthographic extent written from `render` is in the same frame's
 *    picture rather than the next one's.
 * 6. **The scene's draw counts are captured before the composite.** `renderer.info`
 *    resets at the top of every `render` call, and the composite is a second one, so
 *    reading the counts afterwards would report the engine's own full-screen quad
 *    instead of the game's picture. They are taken the instant the scene is drawn
 *    and handed out through {@link RenderStage.counts}.
 *
 * The module deliberately does *not* own the frame loop: each step is a callable
 * piece and the engine sequences them, because the order — clock, viewport, screen
 * clear, update, render, scene, recorder, overlay, composite — is a fact about the
 * engine rather than about the renderer, and a loop hidden in here would be a second
 * place to look for it.
 */

import * as THREE from "three";
import type { SceneCamera, Viewport } from "./contract";
import { createCamera } from "./view";
import { applyRendererViewport, syncScreenCanvas } from "./viewport";

/**
 * What {@link createRenderStage} needs out of `EngineOptions`.
 *
 * Named field for field as the engine's own options are, so the engine hands its
 * options object straight over rather than copying seven fields into a shape that
 * would then have to be kept in step with them.
 */
export interface RenderStageOptions {
  /** The canvas the scene is rendered through and the composite lands on. */
  canvas: HTMLCanvasElement;
  /** The logical design width the game draws in, and the numerator of the camera's aspect. */
  width: number;
  /** The logical design height the game draws in, and the denominator of the camera's aspect. */
  height: number;
  /**
   * A CSS color the whole canvas is cleared to before every frame, letterbox bars
   * included. Absent, the canvas is cleared to transparency.
   */
  background?: string;
  /**
   * The canvas the screen layer draws on. Absent, one is created from the stage
   * canvas's owning document. Supplying it is what lets a validator read the HUD's
   * pixels back, or substitute its own object for the 2D context.
   */
  screen?: HTMLCanvasElement;
  /** Which kind of camera to create and render through; `"perspective"` by default. */
  projection?: "perspective" | "orthographic";
  /** `true` enables the renderer's shadow maps with PCF soft filtering. */
  shadows?: boolean;
}

/** The draw counts one frame's scene render cost, as the frame metrics report them. */
export interface RenderCounts {
  /** The draw calls the renderer issued for the most recent scene render. */
  readonly drawCalls: number;
  /** The triangles the renderer drew in the most recent scene render. */
  readonly triangles: number;
}

/**
 * The renderer, the scene, the camera, and the screen layer, with the frame's
 * render-side steps as separate calls the engine's loop sequences.
 *
 * Every member below the six the engine holds is one step of a frame. They are separate
 * because the engine has to do work *between* them: the view is read from the camera
 * after {@link RenderStage.updateWorld} and before the picture exists, and the
 * recorder captures the canvas after {@link RenderStage.render} and before the
 * diagnostics overlay draws on the screen layer, which is only expressible if the
 * composite is a call of its own.
 */
export interface RenderStage {
  /** The renderer, for the counts and the disposal the engine reports and performs. */
  readonly renderer: THREE.WebGLRenderer;
  /** The retained scene the game populates and the engine draws. */
  readonly scene: THREE.Scene;
  /** The camera the engine renders through, engine-owned and game-posed. */
  readonly camera: SceneCamera;
  /** The canvas the screen layer draws on, for a validator reading its pixels. */
  readonly screenCanvas: HTMLCanvasElement;
  /** The screen layer's 2D context, exactly as the screen canvas returned it. */
  readonly screen: CanvasRenderingContext2D;
  /**
   * The texture the screen layer is composited from.
   *
   * Exposed because it is the only observable proof that the layer is re-uploaded
   * every frame — its `version` advances with each {@link RenderStage.composite} —
   * and a composite that stopped asking for the upload would otherwise freeze the
   * HUD at whatever the first frame drew without failing anything.
   */
  readonly screenTexture: THREE.Texture;
  /**
   * Bring the screen canvas's backing store in line with the stage canvas's, so the
   * composite is a pixel-for-pixel lift with nothing resampled. Called after the
   * stage canvas has been synced to the surface and before the screen layer is
   * cleared, since writing either dimension clears the canvas.
   */
  syncScreen(): void;
  /**
   * Hold the camera's aspect at the design aspect, recompute its projection matrix,
   * and update the scene's world matrices. Called after the game's `render` and
   * before the view is read, so the view reads the camera the frame will draw
   * through and a world position read off an object is where it stood this frame.
   */
  updateWorld(): void;
  /**
   * Clear the whole canvas to `background`, confine the picture to the letterboxed
   * rectangle, and draw the scene through the camera.
   */
  render(viewport: Viewport): void;
  /**
   * Upload the screen layer and draw it over the picture as a full-canvas quad with
   * alpha blending, so wherever the layer is transparent the scene shows through.
   */
  composite(): void;
  /** The scene render's draw counts for the most recent frame; zeroes before the first. */
  counts(): RenderCounts;
  /**
   * Dispose the renderer and the compositing objects. Idempotent, because teardown
   * races. The scene and the objects the game placed in it are left as they stand:
   * they are the game's, and a caller that reads the scene after destroying the
   * engine still finds what the last frame left.
   */
  dispose(): void;
}

/**
 * The `webgl2` context, or a refusal naming the canvas.
 *
 * Asked for rather than left to three so the refusal is the engine's: a canvas that
 * already carries a `2d` context, a canvas in a document with no GL implementation
 * behind it, and a canvas whose context was lost all fail here, at construction,
 * where the mistake is, instead of at the first frame.
 *
 * The attributes are the two the renderer is documented to run with. `antialias`
 * has to be asked for at context creation — it is a property of the drawing buffer,
 * not a renderer setting — and `alpha` is what lets a stage with no `background`
 * clear to transparency and show the page behind it.
 */
function stageContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: true,
  }) as WebGL2RenderingContext | null;
  if (gl === null) {
    throw new Error(
      "createEngine could not get a webgl2 context from the canvas; the engine renders the scene through it",
    );
  }
  return gl;
}

/**
 * The canvas the screen layer draws on: the one supplied, or one made from the
 * stage canvas's own document.
 *
 * The stage canvas's document rather than the ambient one, for the same reason the
 * default surface reads its ratio from the canvas's own window: a game rendered
 * inside an iframe has its canvases in that document, and a canvas made from the
 * outer one would be a foreign node in every operation that touches both.
 *
 * A stage canvas with no document behind it is refused, naming the option that
 * would have supplied the canvas instead, because the alternative is an engine that
 * runs and draws no HUD at all.
 */
function screenCanvasFor(
  canvas: HTMLCanvasElement,
  supplied: HTMLCanvasElement | undefined,
): HTMLCanvasElement {
  if (supplied !== undefined) return supplied;

  const document: Document | null = canvas.ownerDocument ?? null;
  if (document === null || typeof document.createElement !== "function") {
    throw new Error(
      "createEngine needs a screen canvas: the stage canvas has no owning document to create one from, so pass one as `screen`",
    );
  }
  return document.createElement("canvas");
}

/**
 * The screen layer's 2D context, exactly as the screen canvas returned it.
 *
 * Passed through rather than wrapped, which is the whole of the substitution seam a
 * validator uses: a suite that wants the drawing *operations* rather than the pixels
 * overrides `getContext` on the canvas it supplies as `screen`, and whatever that
 * returns is the object the game's `render` is handed.
 *
 * A canvas that yields nothing is refused here. The engine would otherwise hand
 * `null` to a `render` whose parameter is typed as a context, and the first HUD draw
 * of the first frame would fail somewhere in the game's own code.
 */
function screenContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (ctx === null) {
    throw new Error(
      "createEngine could not get a 2D context from the screen canvas; the game's HUD is drawn through it",
    );
  }
  return ctx;
}

/**
 * Build the renderer, the scene, the camera, and the screen layer over one canvas.
 *
 * Every construction failure the rendering side of `createEngine` can have is
 * raised from here — no `webgl2` context, no screen canvas and no document to make
 * one from, an unknown projection — so a build that would run and draw nothing is
 * refused where the mistake is rather than at the first frame.
 */
export function createRenderStage(options: RenderStageOptions): RenderStage {
  const { canvas, width, height } = options;

  // Every refusal before the renderer, and in the order the errors table states
  // them — the canvas, then the layer drawn over it, then how it is looked at —
  // so a build with two mistakes in it is told about the surface first, which is
  // the one the other two are drawn on. No renderer is ever constructed for an
  // engine that will not be returned.
  const gl = stageContext(canvas);
  const screenCanvas = screenCanvasFor(canvas, options.screen);
  const screen = screenContext(screenCanvas);
  // `projection` is defaulted here rather than inside the camera's own builder,
  // which takes the value as stated so that a build naming something outside the
  // pair is refused instead of quietly getting the default.
  const camera = createCamera(
    options.projection ?? "perspective",
    width,
    height,
  );

  const renderer = new THREE.WebGLRenderer({
    canvas,
    context: gl,
    antialias: true,
    alpha: true,
  });
  // sRGB output, named explicitly rather than left to three's default: it is what
  // makes a material's color, a cleared background, and the screen layer's own
  // bytes all land on the canvas as the color they were written as, which is what
  // a validator sampling a pixel asserts against.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Every clear in a frame is written here, so three must not perform one of its
  // own: see the module header.
  renderer.autoClear = false;
  if (options.shadows === true) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const scene = new THREE.Scene();

  // Parsed once. `background` is a CSS color string a build writes literally, and
  // re-parsing it sixty times a second would buy nothing; the alpha is the whole of
  // the difference between "cleared to a color" and "cleared to transparency".
  const clearColor = new THREE.Color(options.background ?? "#000000");
  const clearAlpha = options.background === undefined ? 0 : 1;

  /**
   * The composite pass: the screen layer as a texture on a quad that covers the
   * clip volume exactly.
   *
   * A private scene and a private camera rather than the game's, because this is
   * engine chrome that must not appear in the scene a validator reads, must not be
   * lit, posed, or picked, and must not move when the game's camera does. The
   * geometry is a two-by-two plane and the camera an orthographic one spanning
   * `-1..1`, so the quad *is* the viewport whatever the canvas's size.
   *
   * `depthTest` and `depthWrite` are off because the layer goes over everything by
   * definition, and `premultipliedAlpha` is on because the drawing buffer three
   * asked the browser for is premultiplied: three's normal blending against such a
   * buffer is `ONE, ONE_MINUS_SRC_ALPHA`, which needs the fragment's colour already
   * multiplied by its alpha, and the flag is what makes the shader do it.
   */
  const screenTexture = new THREE.CanvasTexture(screenCanvas);
  screenTexture.colorSpace = THREE.SRGBColorSpace;
  screenTexture.minFilter = THREE.LinearFilter;
  screenTexture.magFilter = THREE.LinearFilter;
  screenTexture.generateMipmaps = false;
  const compositeGeometry = new THREE.PlaneGeometry(2, 2);
  const compositeMaterial = new THREE.MeshBasicMaterial({
    map: screenTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
  });
  const compositeScene = new THREE.Scene();
  compositeScene.add(new THREE.Mesh(compositeGeometry, compositeMaterial));
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  /** The scene render's counts, held across the composite that would reset them. */
  let drawCalls = 0;
  let triangles = 0;
  let disposed = false;

  const syncScreen = (): void => {
    syncScreenCanvas(screenCanvas, canvas);
  };

  /**
   * The camera's aspect and projection matrix, brought up to date.
   *
   * Cheap and idempotent, so both {@link RenderStage.updateWorld} and the render
   * call it and neither has to trust the other to have run first. The forced world
   * update is *not* here: three's own `render` updates world matrices, so putting
   * it in both places would walk the whole graph twice a frame for nothing.
   */
  const syncProjection = (): void => {
    if (camera instanceof THREE.PerspectiveCamera) {
      // Held at the *design* aspect rather than the canvas's, which is what makes
      // the picture keep the shape the game was written for however the element is
      // shaped; the letterbox bars absorb the difference.
      camera.aspect = width / height;
    }
    // Unconditional, and for both kinds: a projection field written from `render`
    // — an `fov`, a `near`, an orthographic extent — otherwise waits a frame, or
    // never arrives at all if the game never calls this itself.
    camera.updateProjectionMatrix();
  };

  const updateWorld = (): void => {
    syncProjection();
    // Forced, because the view is read from these matrices before anything has
    // rendered: an object whose parent moved this frame would otherwise report the
    // position it held last frame, and a validator reading a world position after
    // an `advance` would be reading the frame before the one it ran.
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
  };

  const render = (viewport: Viewport): void => {
    // The clear covers the whole canvas, so the scissor from the previous frame has
    // to be off before it: with it on, the bars would keep whatever the frame
    // before them left there. The viewport is left alone on purpose — a clear is
    // bounded by the scissor box and the write masks, and by nothing else.
    renderer.setScissorTest(false);
    renderer.setClearColor(clearColor, clearAlpha);
    renderer.clear();

    // The picture, confined to the letterboxed rectangle the screen layer's own
    // transform maps onto, so the two surfaces line up pixel for pixel.
    applyRendererViewport(renderer, viewport);

    syncProjection();
    renderer.render(scene, camera);

    // Read here rather than at the metrics' leisure: the composite is a second
    // `render` call, and three resets these counts at the top of each one.
    drawCalls = renderer.info.render.calls;
    triangles = renderer.info.render.triangles;
  };

  const composite = (): void => {
    // Over the whole canvas, bars included: the diagnostics overlay draws in device
    // space and may land in a bar, and a layer clipped to the picture would cut it
    // in half.
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    // The canvas is the texture's source and its contents changed this frame, so
    // the upload is asked for explicitly; three re-uploads nothing it is not told
    // about.
    screenTexture.needsUpdate = true;
    renderer.render(compositeScene, compositeCamera);
  };

  // Sized here as well as every frame, so a screen canvas the engine created — which
  // starts at the 300x150 every canvas element starts at — matches the stage before
  // the first frame rather than after it.
  syncScreen();

  return {
    renderer,
    scene,
    camera,
    screenCanvas,
    screen,
    screenTexture,
    syncScreen,
    updateWorld,
    render,
    composite,
    counts: (): RenderCounts => ({ drawCalls, triangles }),
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      // The engine's own objects only. The scene the game populated is left whole,
      // and the geometries and materials in it are the game's to dispose.
      screenTexture.dispose();
      compositeMaterial.dispose();
      compositeGeometry.dispose();
      renderer.dispose();
    },
  };
}
