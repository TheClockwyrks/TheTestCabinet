/**
 * The rendering pipeline: the engine owns drawing.
 *
 * A game configures what to draw by attaching render components to its actors,
 * and the pipeline collects them, orders them, and draws them once per frame.
 * The per-frame sequence is fixed and is the contract this module implements:
 *
 * 1. The camera is updated — a world following a view target adopts that
 *    target's world transform and zoom, then the result is clamped to
 *    `camera.bounds`.
 * 2. The canvas is cleared to `background`, or to transparency when none was
 *    given, and the context's image smoothing is set from `imageSmoothing`, so
 *    every image this frame draws samples the way the option states.
 * 3. Every enabled, visible `RenderComponent` on every live actor is
 *    collected — a destroyed actor stops rendering immediately, before the
 *    end-of-frame flush removes it from the world.
 * 4. The collection is sorted by `layer` ascending, then by the owning actor's
 *    spawn order, then by attachment order. The sort is stable, so a redraw
 *    with no change reproduces the previous order exactly.
 * 5. Each component is drawn with the context carrying the transform of its
 *    `space`. A `world` component draws under the world-to-device transform —
 *    the camera composed onto the viewport, so it states every coordinate,
 *    size, and font size in world units; a `screen` component draws under the
 *    viewport alone, in logical units, wherever the camera is. A
 *    `DrawComponent` receives `DrawApi` and draws itself.
 * 6. The collision overlay draws, when it is enabled: every enabled collider's
 *    shape over the finished picture, in a color per response, independent of
 *    the mode.
 * 7. The debug overlay draws in device space (outside this pipeline, and
 *    outside the recorder's frame bracket).
 *
 * Drawing belongs here and reading input and playing cues belong to the ticks,
 * so a frame's audible and observable behavior comes from the ticks and its
 * picture from the pipeline.
 *
 * Two design points worth stating once:
 *
 * - **The transform is replaced, never composed across components.** Each
 *   component starts from `setTransform(viewport)`, with the camera pushed on
 *   top for a `world` component; its *position* stays in each operation's own
 *   arguments (only a rotation or scale adds a pivot transform), so a
 *   `DrawComponent` that forgets a `restore` costs the components after it
 *   nothing but leaked style properties — and every declarative component sets
 *   the styles it paints with before painting, so even those cannot leak into
 *   the built-in picture.
 * - **The pipeline never reads a pixel and never keeps one.** The whole
 *   picture is a function of the world at the moment `render` runs, which is
 *   what lets a validator read a pixel back and assert on it, and what lets two
 *   runs of one scenario produce the same picture.
 */

import { applyViewport, WorldCamera } from "./camera";
import { ColliderComponent } from "./collision";
import {
  CameraComponent,
  DrawComponent,
  RenderComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
import type {
  Camera,
  CameraSnapshot,
  CollisionResponse,
  DrawApi,
  FrameInfo,
  RenderMode,
  RenderSpace,
  Renderer,
  Shape,
  Transform,
  Viewport,
  World,
} from "./contract";

/**
 * The stroke width every wireframe outline draws at, in world units.
 *
 * One width for the whole mode — that is what "each component's outline alone,
 * at one stroke width" means — so wireframe shows the geometry a build placed
 * rather than restating each component's own styling decisions.
 */
const WIREFRAME_WIDTH = 1;

/** The outline color wireframe falls back to for a component that states none. */
const WIREFRAME_FALLBACK = "#ffffff";

/**
 * The color the collision overlay draws a collider in, by the strongest
 * response the collider declares.
 *
 * A collider's effective response is decided per pair, both directions taken
 * and the stronger kept, so a single collider has no one response of its own.
 * The overlay colors by the strongest answer the collider *declares* — the most
 * it can do to anything — which is a property of the collider alone and
 * therefore drawable without picking a partner for it.
 */
const OVERLAY_COLORS: Record<CollisionResponse, string> = {
  block: "#ff5566",
  overlap: "#ffd166",
  ignore: "#7f8c9b",
};

/** Opacity as the pipeline applies it: clamped to `0..1` at the draw. */
function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1;
  return Math.min(Math.max(opacity, 0), 1);
}

/**
 * The flat color a silhouette layer fills in.
 *
 * A deterministic function of the layer number alone — the golden-angle hue
 * walk — so two components on one layer share a color, adjacent layers land far
 * apart on the wheel, and the same world silhouettes identically on every run
 * and every host.
 */
function layerColor(layer: number): string {
  const turn = Number.isFinite(layer) ? layer : 0;
  const hue = (((turn * 137.50776405) % 360) + 360) % 360;
  return `hsl(${Number(hue.toFixed(3))}, 70%, 60%)`;
}

/** What the engine hands the pipeline to draw one frame from. */
export interface RenderScene {
  /** The context the frame draws through — the recorder's wrapper. */
  ctx: CanvasRenderingContext2D;
  /** The world whose picture this frame is. */
  world: World;
  /** The fit this frame renders through. */
  viewport: Viewport;
  /** The loop's position, as `DrawApi.frame` reports it. */
  frame: FrameInfo;
  /** The color the canvas clears to, or `null` for transparency. */
  background: string | null;
  /**
   * Whether an image the fit scales is resampled bilinearly, or sampled
   * nearest-neighbor when `false`.
   */
  imageSmoothing: boolean;
  /** The logical design width, for the camera's projection center. */
  width: number;
  /** The logical design height, for the camera's projection center. */
  height: number;
}

/** One collected component, with the collection position as the sort tiebreak. */
interface Collected {
  component: RenderComponent;
  /** Position in spawn-then-attachment order, which the layer sort preserves. */
  order: number;
}

/**
 * One axis of the bounds clamp: keep a window of `extent` centred on `center`
 * inside `[start, start + size]`, centering when it cannot fit.
 *
 * The same rule `WorldCamera.clampToBounds` applies, restated here against the
 * plain `Camera` interface so the pipeline clamps whatever camera
 * implementation a world carries.
 */
function clampAxis(
  center: number,
  start: number,
  size: number,
  extent: number,
): number {
  if (extent >= size) return start + size / 2;
  const min = start + extent / 2;
  const max = start + size - extent / 2;
  return Math.min(Math.max(center, min), max);
}

/**
 * The engine's implementation of the `Renderer` interface: the pipeline's two
 * switches, reached as `engine.renderer` and available from construction, and
 * the internal entry point the frame calls to draw.
 *
 * Internal: the engine alone constructs it, once, and it survives every level
 * transition (the mode and the overlay switch are engine state, not world
 * state).
 */
export class RenderPipeline implements Renderer {
  /** The mode in force. */
  private renderMode: RenderMode = "shaded";

  /** Whether the collision overlay draws. */
  private overlayEnabled = false;

  /**
   * The context sprites are tinted through: absent until asked for, `null`
   * once asked for and unavailable.
   *
   * A tint flattens the sprite's pixels to the tint color while keeping its
   * alpha, which needs a `source-atop` composite on a surface of the sprite's
   * own — compositing on the main canvas would tint everything already drawn.
   * A host with no second canvas draws the sprite untinted rather than not at
   * all.
   */
  private tintScratch: CanvasRenderingContext2D | null | undefined;

  /** The mode in force, `shaded` until it is set. */
  mode(): RenderMode {
    return this.renderMode;
  }

  /** Sets the mode. The next frame the pipeline runs draws under it. */
  setMode(mode: RenderMode): void {
    this.renderMode = mode;
  }

  /** Whether the collision overlay draws. */
  collisionOverlay(): boolean {
    return this.overlayEnabled;
  }

  /**
   * Turns the collision overlay on or off. The overlay draws every enabled
   * collider's shape over the finished picture, in a color per response, and is
   * independent of the mode.
   */
  setCollisionOverlay(enabled: boolean): void {
    this.overlayEnabled = enabled;
  }

  /**
   * Draw one frame: the camera update, the clear, the sorted components, and
   * the collision overlay, in that order.
   *
   * Internal: the engine calls it once per frame, after the ticks and after any
   * transition, through the recorder's wrapper, so the whole picture is inside
   * the recording's frame bracket.
   */
  render(scene: RenderScene): void {
    this.updateCamera(scene);
    this.clear(scene);
    this.applySampling(scene);

    const collected = this.collect(scene.world);
    // A stable sort by layer alone: the collection is already in spawn order
    // and, within an actor, attachment order, and the explicit tiebreak keeps
    // that true whatever the host's sort does with equal keys.
    collected.sort(
      (a, b) => a.component.layer - b.component.layer || a.order - b.order,
    );

    const camera = scene.world.camera.snapshot();
    // The mode is captured once per frame: a `setMode` issued mid-pipeline
    // (from a `DrawComponent.draw`, say) waits for the next frame, and
    // `api.mode` agrees with every draw this frame makes. One API per space,
    // so `api.space` names the transform the context arrived under.
    const mode = this.renderMode;
    const apis: Record<RenderSpace, DrawApi> = {
      world: this.drawApi(scene, camera, mode, "world"),
      screen: this.drawApi(scene, camera, mode, "screen"),
    };
    for (const entry of collected) {
      const component = entry.component;
      // Anything but `screen` is world space, matching the transform applied.
      const api = component.space === "screen" ? apis.screen : apis.world;
      this.drawOne(scene, camera, component, api, mode);
    }

    if (this.overlayEnabled) this.drawCollisionOverlay(scene, camera);
  }

  /**
   * Step 1: a camera with a view target adopts the target's world transform
   * and zoom, and the result is clamped to `camera.bounds`.
   *
   * The figures come from the first *enabled* `CameraComponent` the target
   * holds; a target carrying none leaves the projection where the game wrote
   * it. The clamp applies whenever `bounds` is set, followed or not, so a
   * hand-driven camera is kept inside the same region a following one is.
   */
  private updateCamera(scene: RenderScene): void {
    const camera = scene.world.camera;
    const target = camera.target;
    if (target !== null && target.alive) {
      const lens = target
        .componentsOf(CameraComponent)
        .find((component) => component.enabled);
      if (lens !== undefined) {
        const at = lens.worldTransform();
        camera.x = at.x;
        camera.y = at.y;
        camera.rotation = at.rotation;
        camera.zoom = lens.zoom;
      }
    }
    this.clampCamera(camera, scene.width, scene.height);
  }

  /**
   * Keep the camera's visible region inside its bounds.
   *
   * A `WorldCamera` clamps itself — it holds the design size the extent is
   * computed from — and any other `Camera` implementation is clamped here with
   * the same rule, from the design size the scene carries. A degenerate zoom
   * implies no extent the clamp can compare, so the position stands.
   */
  private clampCamera(camera: Camera, width: number, height: number): void {
    if (camera instanceof WorldCamera) {
      camera.clampToBounds();
      return;
    }
    const bounds = camera.bounds;
    if (bounds === null) return;
    if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return;
    camera.x = clampAxis(camera.x, bounds.x, bounds.width, width / camera.zoom);
    camera.y = clampAxis(
      camera.y,
      bounds.y,
      bounds.height,
      height / camera.zoom,
    );
  }

  /** Step 2: the whole backing store, cleared in device space. */
  private clear(scene: RenderScene): void {
    const { ctx, background } = scene;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (background === null) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
  }

  /**
   * Step 2, second half: the context's image smoothing, set from the option
   * once per frame and before any component draws.
   *
   * Once rather than per blit, so a frame records one `set` for it: the
   * pipeline never `save`/`restore`s, so the value holds for every component
   * of the frame, and a `DrawComponent` that changes it is expected to restore
   * it, as it is every other style the pipeline handed over.
   */
  private applySampling(scene: RenderScene): void {
    scene.ctx.imageSmoothingEnabled = scene.imageSmoothing;
  }

  /**
   * Step 3: every enabled, visible `RenderComponent` on every live actor, in
   * spawn order and then attachment order.
   *
   * `enabled` comes from the component and `visible` from its
   * `RenderComponent` fields, read here each frame, so a component leaves the
   * picture the moment either is cleared. `alive` is checked even though the
   * world lists live actors, because a destroyed actor must stop rendering in
   * the same frame whatever the listing does.
   */
  private collect(world: World): Collected[] {
    const collected: Collected[] = [];
    let order = 0;
    for (const actor of world.actors()) {
      if (!actor.alive) continue;
      for (const component of actor.components) {
        if (!(component instanceof RenderComponent)) continue;
        if (!component.enabled || !component.visible) continue;
        collected.push({ component, order });
        order += 1;
      }
    }
    return collected;
  }

  /**
   * The API a `DrawComponent`'s `draw` receives, built once per frame and per
   * space.
   */
  private drawApi(
    scene: RenderScene,
    camera: CameraSnapshot,
    mode: RenderMode,
    space: RenderSpace,
  ): DrawApi {
    const frame: FrameInfo = { ...scene.frame };
    const viewport: Viewport = { ...scene.viewport };
    return {
      ctx: scene.ctx,
      mode,
      space,
      // Snapshots the caller owns: a held one keeps this frame's values.
      frame: (): FrameInfo => ({ ...frame }),
      viewport: (): Viewport => ({ ...viewport }),
      camera: (): CameraSnapshot => ({ ...camera }),
    };
  }

  /**
   * Point the context at world space: the camera composed onto the viewport.
   *
   * `setTransform` replaces whatever the previous component left, so every
   * component starts from the same map and none can shear the ones after it.
   * The camera half inverts `worldToLogical`: center the logical field, scale
   * by the zoom, turn by the rotation, then step back to the camera's position.
   */
  private applyWorldTransform(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    camera: CameraSnapshot,
  ): void {
    applyViewport(ctx, viewport);
    ctx.translate(viewport.width / 2, viewport.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.rotate(-camera.rotation);
    ctx.translate(-camera.x, -camera.y);
  }

  /**
   * Point the context at the space a component draws in: world space is the
   * camera composed onto the viewport, screen space the viewport alone.
   */
  private applySpaceTransform(
    ctx: CanvasRenderingContext2D,
    viewport: Viewport,
    camera: CameraSnapshot,
    space: RenderSpace,
  ): void {
    if (space === "screen") {
      applyViewport(ctx, viewport);
      return;
    }
    this.applyWorldTransform(ctx, viewport, camera);
  }

  /** Step 5: one component, in its place in the layer order. */
  private drawOne(
    scene: RenderScene,
    camera: CameraSnapshot,
    component: RenderComponent,
    api: DrawApi,
    mode: RenderMode,
  ): void {
    const { ctx } = scene;
    this.applySpaceTransform(ctx, scene.viewport, camera, component.space);

    // The direct-drawing path: the context carries the transform of the
    // component's space and nothing else, so the component draws at absolute
    // coordinates in that space and reads `api.mode` to supply its own render
    // modes.
    if (component instanceof DrawComponent) {
      component.draw(api);
      return;
    }

    // The position stays in each operation's own arguments — the stream
    // records the coordinates the game asked for, not a chain of translates —
    // so only a rotation or a scale earns a transform, and it pivots about the
    // component's position to leave those arguments in the space's
    // coordinates too. A `screen` component's composed transform is read as
    // logical units, so the same arithmetic serves both spaces.
    const at = component.worldTransform();
    this.applyLocalTransform(ctx, at);

    if (component instanceof SpriteComponent) {
      this.drawSprite(ctx, component, at, mode, scene.imageSmoothing);
    } else if (component instanceof ShapeComponent) {
      this.drawShape(ctx, component, at, mode);
    } else if (component instanceof TextComponent) {
      this.drawText(ctx, component, at, mode);
    }
    // A RenderComponent subclass the catalogue does not know draws nothing:
    // the pipeline draws what it can name, and a game that wants custom
    // drawing has the DrawComponent path for exactly that.
  }

  /**
   * A component's rotation and scale, pivoted about its world position.
   *
   * The position itself is folded into the drawing operations' arguments, so
   * an unrotated, unscaled component — the common case — draws with the
   * context carrying the world-to-device transform alone.
   */
  private applyLocalTransform(
    ctx: CanvasRenderingContext2D,
    at: Transform,
  ): void {
    if (at.rotation === 0 && at.scaleX === 1 && at.scaleY === 1) return;
    ctx.translate(at.x, at.y);
    ctx.rotate(at.rotation);
    ctx.scale(at.scaleX, at.scaleY);
    ctx.translate(-at.x, -at.y);
  }

  /** A shape, under the frame's mode. */
  private drawShape(
    ctx: CanvasRenderingContext2D,
    component: ShapeComponent,
    at: Transform,
    mode: RenderMode,
  ): void {
    this.tracePath(ctx, component.shape, at);
    switch (mode) {
      case "shaded": {
        ctx.globalAlpha = clampOpacity(component.opacity);
        if (component.fill !== null) {
          ctx.fillStyle = component.fill;
          ctx.fill();
        }
        if (component.stroke !== null) {
          ctx.strokeStyle = component.stroke;
          ctx.lineWidth = component.strokeWidth;
          ctx.stroke();
        }
        return;
      }
      case "wireframe": {
        ctx.globalAlpha = 1;
        ctx.strokeStyle =
          component.stroke ?? component.fill ?? WIREFRAME_FALLBACK;
        ctx.lineWidth = WIREFRAME_WIDTH;
        ctx.stroke();
        return;
      }
      case "unlit": {
        // Full opacity with the tint axis dropped; a shape has no tint, so
        // unlit differs from shaded only in the alpha.
        ctx.globalAlpha = 1;
        if (component.fill !== null) {
          ctx.fillStyle = component.fill;
          ctx.fill();
        }
        if (component.stroke !== null) {
          ctx.strokeStyle = component.stroke;
          ctx.lineWidth = component.strokeWidth;
          ctx.stroke();
        }
        return;
      }
      case "silhouette": {
        ctx.globalAlpha = 1;
        ctx.fillStyle = layerColor(component.layer);
        ctx.fill();
        return;
      }
    }
  }

  /** A sprite, under the frame's mode and the frame's sampling. */
  private drawSprite(
    ctx: CanvasRenderingContext2D,
    component: SpriteComponent,
    at: Transform,
    mode: RenderMode,
    smoothing: boolean,
  ): void {
    const width = component.width;
    const height = component.height;
    const dx = at.x - component.anchorX * width;
    const dy = at.y - component.anchorY * height;

    switch (mode) {
      case "shaded": {
        ctx.globalAlpha = clampOpacity(component.opacity);
        this.blitSprite(
          ctx,
          component,
          dx,
          dy,
          width,
          height,
          component.tint,
          smoothing,
        );
        return;
      }
      case "wireframe": {
        // The image reduced to its bounds, at the one wireframe width.
        ctx.globalAlpha = 1;
        ctx.strokeStyle = WIREFRAME_FALLBACK;
        ctx.lineWidth = WIREFRAME_WIDTH;
        ctx.strokeRect(dx, dy, width, height);
        return;
      }
      case "unlit": {
        ctx.globalAlpha = 1;
        this.blitSprite(ctx, component, dx, dy, width, height, null, smoothing);
        return;
      }
      case "silhouette": {
        ctx.globalAlpha = 1;
        ctx.fillStyle = layerColor(component.layer);
        ctx.fillRect(dx, dy, width, height);
        return;
      }
    }
  }

  /** The sprite's image, with its source region and tint applied. */
  private blitSprite(
    ctx: CanvasRenderingContext2D,
    component: SpriteComponent,
    dx: number,
    dy: number,
    width: number,
    height: number,
    tint: string | null,
    smoothing: boolean,
  ): void {
    const source = component.source;
    const tinted = tint === null ? null : this.tint(component, tint, smoothing);
    if (tinted !== null) {
      // The scratch holds the selected region already flattened to the tint,
      // so it blits whole.
      ctx.drawImage(tinted, dx, dy, width, height);
      return;
    }
    if (source === null) {
      ctx.drawImage(component.image, dx, dy, width, height);
    } else {
      ctx.drawImage(
        component.image,
        source.x,
        source.y,
        source.width,
        source.height,
        dx,
        dy,
        width,
        height,
      );
    }
  }

  /**
   * The sprite's selected region flattened to `tint`, on the shared scratch,
   * or `null` where the host has no second canvas to composite on.
   *
   * The scratch is a canvas of its own, so its preparation stays outside the
   * recording; the recorded operation is the `drawImage` that blits it, whose
   * source is a mutable canvas the recorder captures by content. The scratch
   * samples as the frame does, so a tinted sprite and an untinted one are
   * drawn the same way.
   */
  private tint(
    component: SpriteComponent,
    tint: string,
    smoothing: boolean,
  ): HTMLCanvasElement | null {
    this.tintScratch ??= this.buildTintScratch();
    const scratch = this.tintScratch;
    if (scratch === null) return null;
    const source = component.source;
    const sw = source?.width ?? component.image.width;
    const sh = source?.height ?? component.image.height;
    if (sw < 1 || sh < 1) return null;
    // Writing the size blanks the canvas, which is the preparation each tint
    // needs.
    scratch.canvas.width = sw;
    scratch.canvas.height = sh;
    scratch.imageSmoothingEnabled = smoothing;
    if (source === null) {
      scratch.drawImage(component.image, 0, 0);
    } else {
      scratch.drawImage(
        component.image,
        source.x,
        source.y,
        sw,
        sh,
        0,
        0,
        sw,
        sh,
      );
    }
    scratch.globalCompositeOperation = "source-atop";
    scratch.fillStyle = tint;
    scratch.fillRect(0, 0, sw, sh);
    scratch.globalCompositeOperation = "source-over";
    return scratch.canvas;
  }

  /** A canvas to tint through, or `null` where the host cannot supply one. */
  private buildTintScratch(): CanvasRenderingContext2D | null {
    try {
      if (
        typeof document === "undefined" ||
        typeof document.createElement !== "function"
      ) {
        return null;
      }
      const canvas = document.createElement("canvas");
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  }

  /** A string, under the frame's mode. */
  private drawText(
    ctx: CanvasRenderingContext2D,
    component: TextComponent,
    at: Transform,
    mode: RenderMode,
  ): void {
    ctx.font = component.font;
    ctx.textAlign = component.align;
    ctx.textBaseline = component.baseline;
    switch (mode) {
      case "shaded": {
        ctx.globalAlpha = clampOpacity(component.opacity);
        ctx.fillStyle = component.fill;
        ctx.fillText(component.text, at.x, at.y);
        return;
      }
      case "wireframe": {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = component.fill;
        ctx.lineWidth = WIREFRAME_WIDTH;
        ctx.strokeText(component.text, at.x, at.y);
        return;
      }
      case "unlit": {
        ctx.globalAlpha = 1;
        ctx.fillStyle = component.fill;
        ctx.fillText(component.text, at.x, at.y);
        return;
      }
      case "silhouette": {
        ctx.globalAlpha = 1;
        ctx.fillStyle = layerColor(component.layer);
        ctx.fillText(component.text, at.x, at.y);
        return;
      }
    }
  }

  /** The path a shape traces, centered on `at` in world coordinates. */
  private tracePath(
    ctx: CanvasRenderingContext2D,
    shape: Shape,
    at: Transform,
  ): void {
    ctx.beginPath();
    switch (shape.kind) {
      case "rect":
        ctx.rect(
          at.x - shape.width / 2,
          at.y - shape.height / 2,
          shape.width,
          shape.height,
        );
        return;
      case "circle":
        ctx.arc(at.x, at.y, shape.radius, 0, Math.PI * 2);
        return;
      case "polygon": {
        shape.points.forEach((point, index) => {
          if (index === 0) ctx.moveTo(at.x + point.x, at.y + point.y);
          else ctx.lineTo(at.x + point.x, at.y + point.y);
        });
        ctx.closePath();
        return;
      }
    }
  }

  /**
   * Step 6: every enabled collider's shape over the finished picture, in a
   * color per response, independent of the mode.
   */
  private drawCollisionOverlay(
    scene: RenderScene,
    camera: CameraSnapshot,
  ): void {
    const { ctx } = scene;
    for (const actor of scene.world.actors()) {
      if (!actor.alive) continue;
      for (const collider of actor.componentsOf(ColliderComponent)) {
        if (!collider.enabled) continue;
        this.applyWorldTransform(ctx, scene.viewport, camera);
        const at = collider.worldTransform();
        this.applyLocalTransform(ctx, at);
        this.tracePath(ctx, collider.shape, at);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = OVERLAY_COLORS[this.strongestResponse(collider)];
        ctx.lineWidth = WIREFRAME_WIDTH;
        ctx.stroke();
      }
    }
  }

  /** The strongest answer a collider declares, for the overlay's color. */
  private strongestResponse(collider: ColliderComponent): CollisionResponse {
    let strongest: CollisionResponse = "ignore";
    for (const response of Object.values(collider.responses)) {
      if (response === "block") return "block";
      if (response === "overlap") strongest = "overlap";
    }
    return strongest;
  }
}
