/**
 * Components: the units of appearance and behavior an actor is assembled from.
 *
 * A component is attached to exactly one actor for its lifetime, carries an
 * offset from that actor's transform, and ticks after its actor each frame.
 * Enabled, visible render components are collected by the rendering pipeline
 * every frame, sorted by `layer` ascending, then by the owning actor's spawn
 * order, then by attachment order — a stable, total order, so a frame is
 * reproducible from the world alone.
 *
 * The catalogue here is the declarative half of drawing: a sprite, a shape,
 * text, and the direct-drawing {@link DrawComponent} for a case that measures
 * the drawing itself. What each one *draws* belongs to the rendering pipeline;
 * what each one *is* — its options, their defaults, and the fields they settle
 * into — is decided here, at construction.
 */

import type { Actor } from "./actors";
import type {
  DrawApi,
  EndPlayReason,
  Rect,
  Shape,
  ShapeOptions,
  SpriteOptions,
  TextOptions,
  Transform,
  World,
} from "./contract";

/**
 * One piece of an actor: an appearance, a collider, a camera target, or
 * behavior of its own.
 *
 * The base class's `beginPlay`, `tick`, and `endPlay` do nothing, so a subclass
 * overrides only what it needs.
 */
export class Component {
  /** The actor the component is attached to. Assigned by `attach`, before `beginPlay`. */
  declare readonly actor: Actor;

  /**
   * The component's transform relative to its actor's. Defaults to the
   * identity, so a component drawn without touching `offset` sits exactly on
   * its actor.
   */
  readonly offset: Transform = {
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };

  /**
   * Defaults to `true`. A disabled component skips its tick, draws nothing,
   * and takes no part in collision.
   */
  enabled = true;

  /** The world the owning actor belongs to. */
  get world(): World {
    return this.actor.world;
  }

  /** Runs once, after `actor` is assigned. The base does nothing. */
  beginPlay(): void {}

  /**
   * Runs once per frame with the frame's delta in seconds, after the owning
   * actor's tick. The base does nothing.
   */
  tick(dt: number): void {
    void dt;
  }

  /**
   * Runs once, when the component is detached, when its actor is destroyed,
   * or when the world closes. The base does nothing.
   */
  endPlay(reason: EndPlayReason): void {
    void reason;
  }

  /**
   * The actor's transform composed with `offset`, as a snapshot the caller
   * owns.
   *
   * The offset is scaled and rotated into the actor's frame and then
   * translated by the actor's position — the composition the pipeline draws
   * through and a collider's shape is tested in. Rotations add, scales
   * multiply per axis, and the returned record is fresh on every call, so a
   * held snapshot keeps the values of the moment it was read.
   */
  worldTransform(): Transform {
    const base = this.actor.transform;
    const offset = this.offset;

    // The offset's position in the actor's frame: scale first, then rotate.
    // Rotation is radians, clockwise, with 0 along +x — in the engine's
    // y-down world that is the standard rotation matrix.
    const dx = offset.x * base.scaleX;
    const dy = offset.y * base.scaleY;
    const cos = Math.cos(base.rotation);
    const sin = Math.sin(base.rotation);

    return {
      x: base.x + dx * cos - dy * sin,
      y: base.y + dx * sin + dy * cos,
      rotation: base.rotation + offset.rotation,
      scaleX: base.scaleX * offset.scaleX,
      scaleY: base.scaleY * offset.scaleY,
    };
  }
}

/**
 * The base every drawing component extends. The pipeline collects every
 * enabled, visible one on every live actor, each frame.
 */
export class RenderComponent extends Component {
  /** Orders the pipeline. Lower layers draw first. Defaults to `0`. */
  layer = 0;

  /** Whether the pipeline collects the component. Defaults to `true`. */
  visible = true;

  /** Clamped to `0..1` by the pipeline when it draws. Defaults to `1`. */
  opacity = 1;
}

/**
 * A decoded bitmap drawn at the component's world transform.
 *
 * The anchor defaults center the sprite on its transform. An image is loaded
 * through the assets loader before the component is constructed, so a sprite
 * reads its bitmap as a plain value.
 */
export class SpriteComponent extends RenderComponent {
  /** The decoded bitmap the component draws. */
  image: ImageBitmap;

  /** A region of a sprite sheet. `null` selects the whole image. */
  source: Rect | null;

  /** The drawn width, in world units. Defaults to the source region's pixel width. */
  width: number;

  /** The drawn height, in world units. Defaults to the source region's pixel height. */
  height: number;

  /** The horizontal anchor, as a fraction of the drawn size. Defaults to `0.5`. */
  anchorX: number;

  /** The vertical anchor, as a fraction of the drawn size. Defaults to `0.5`. */
  anchorY: number;

  /** A CSS color the image is tinted with, or `null` for none. */
  tint: string | null;

  constructor(options: SpriteOptions) {
    super();
    this.image = options.image;
    this.source = options.source ?? null;
    // The drawn size defaults to the source region's pixel size — the whole
    // image's when no region was given — so an untouched sprite draws at a
    // world unit per pixel.
    this.width = options.width ?? this.source?.width ?? options.image.width;
    this.height = options.height ?? this.source?.height ?? options.image.height;
    this.anchorX = options.anchorX ?? 0.5;
    this.anchorY = options.anchorY ?? 0.5;
    this.tint = options.tint ?? null;
  }
}

/**
 * A filled and/or stroked shape drawn at the component's world transform. A
 * component with neither a fill nor a stroke draws nothing.
 */
export class ShapeComponent extends RenderComponent {
  /** The geometry drawn. */
  shape: Shape;

  /** A CSS color filled inside the shape, or `null` for none. */
  fill: string | null;

  /** A CSS color stroked around the outline, or `null` for none. */
  stroke: string | null;

  /** The stroke width, in world units. Defaults to `1`. */
  strokeWidth: number;

  constructor(options: ShapeOptions) {
    super();
    this.shape = options.shape;
    this.fill = options.fill ?? null;
    this.stroke = options.stroke ?? null;
    this.strokeWidth = options.strokeWidth ?? 1;
  }
}

/**
 * A string drawn at the component's world transform. The font size is world
 * units, scaled by the camera like every other drawn quantity.
 */
export class TextComponent extends RenderComponent {
  /** The string drawn. */
  text: string;

  /** A CSS font shorthand. Defaults to `"16px sans-serif"`. */
  font: string;

  /** The fill color. Defaults to `"#ffffff"`. */
  fill: string;

  /** Horizontal alignment against the component's transform. */
  align: "left" | "center" | "right";

  /** Vertical alignment against the component's transform. */
  baseline: "top" | "middle" | "bottom";

  constructor(options: TextOptions) {
    super();
    this.text = options.text;
    this.font = options.font ?? "16px sans-serif";
    this.fill = options.fill ?? "#ffffff";
    this.align = options.align ?? "center";
    this.baseline = options.baseline ?? "middle";
  }
}

/**
 * The direct-drawing path, for a case that measures the drawing itself.
 *
 * The engine calls {@link draw} in the component's place in the layer order,
 * with the context already carrying the world-to-device transform, so the
 * component draws in world units. Render modes belong to the declarative
 * pipeline, so a `DrawComponent` reads `api.mode` and supplies its own.
 */
export abstract class DrawComponent extends RenderComponent {
  /** Called in the component's place in the layer order. */
  abstract draw(api: DrawApi): void;
}

/**
 * Marks its actor as a view target.
 *
 * The world's camera follows the first enabled `CameraComponent` its target
 * holds, at that component's world transform and zoom.
 */
export class CameraComponent extends Component {
  /** Logical units per world unit the camera takes while following. */
  zoom: number;

  constructor(options?: { zoom?: number }) {
    super();
    // The camera's own default zoom is `1`; a view target that states none
    // keeps the projection at that scale.
    this.zoom = options?.zoom ?? 1;
  }
}
