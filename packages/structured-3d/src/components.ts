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
 * The catalogue here is the declarative half of drawing: a mesh, a shape, a
 * text billboard, the lights, the camera target, and the direct-drawing
 * {@link DrawComponent} for a case that measures the drawing itself. What each
 * one *draws* belongs to the rendering pipeline; what each one *is* — its
 * options, their defaults, and the fields they settle into — is decided here,
 * at construction. `ColliderComponent` is the one built-in that lives
 * elsewhere: its shape testing belongs to the collision module, which the
 * `collision` API page specifies.
 *
 * Everything here mirrors the `components` API page under
 * `docs/engines/structured-3d/apis/` — that page is the specification, and a
 * member that disagrees with it is wrong.
 */

import type { Actor, EndPlayReason } from "./actors";
import type { MaterialHandle, MeshHandle, TextureHandle } from "./assets";
import type { Color, LightState, RenderMode } from "./contract";
import {
  quatMultiply,
  rotateVec3,
  transformPoint,
  vec3Normalize,
  type Box3,
  type CameraState,
  type Transform,
  type Vec2,
  type Vec3,
  type Viewport,
} from "./math";
import type { FrameInfo, World } from "./worlds";

/* -------------------------------------------------------------------------- */
/* The rendering vocabulary this module lowers onto                           */
/* -------------------------------------------------------------------------- */

/*
 * The scene context and the values it draws are declared here rather than in
 * the rendering module, because the built-in components *are* what the
 * pipeline lowers and the rendering module imports them from this side. The
 * asset handles, the frame read, and the world come from their own modules,
 * imported above, so each of them has exactly one declaration in the package.
 */

/**
 * An engine-owned, immutable procedural geometry.
 * `bounds` is its axis-aligned bounds in local units, which games use for
 * their own collision arithmetic.
 */
export interface Geometry {
  readonly bounds: Box3;
}

/**
 * A material built in code. Every field is optional; the
 * defaults are white base color, roughness `0.8`, metallic `0`, black
 * emissive, opacity `1`, lit.
 */
export interface MaterialSpec {
  baseColor?: Color;
  baseColorMap?: TextureHandle;
  normalMap?: TextureHandle;
  roughness?: number;
  metallic?: number;
  emissive?: Color;
  opacity?: number;
  unlit?: boolean;
}

/**
 * An immutable material `createMaterial` built. `spec` is
 * the spec with defaults filled in, as a frozen copy.
 */
export interface Material {
  readonly spec: Readonly<MaterialSpec>;
}

/**
 * Anything a draw accepts as a material: a loaded material
 * document, one built in code, or a `Color` as shorthand for a standard lit
 * material with that base color and the `MaterialSpec` defaults.
 */
export type MaterialLike = MaterialHandle | Material | Color;

/** Per-draw options for `drawMesh`. */
export interface DrawMeshOptions {
  material?: MaterialLike;
  clip?: string;
  clipTime?: number;
}

/**
 * Options for `drawHudText`. The face is the engine's own
 * monospace face; there is no font option.
 */
export interface HudTextOptions {
  size?: number;
  color?: Color;
  align?: "left" | "center" | "right";
}

/**
 * The whole drawing vocabulary: three state setters, a
 * depth clear, six draw calls, and six producers. The vocabulary is the same
 * one Simple 3D's game renders through, shared verbatim, so both engines'
 * recordings replay in one player. Every draw call is self-contained, naming
 * its full world transform or position explicitly, and no method reads
 * anything back.
 */
export interface SceneContext {
  setCamera(camera: CameraState): void;
  setLights(lights: readonly LightState[]): void;
  setMode(mode: RenderMode): void;

  clearDepth(): void;

  drawMesh(
    mesh: MeshHandle,
    transform: Transform,
    options?: DrawMeshOptions,
  ): void;
  drawGeometry(
    geometry: Geometry,
    material: MaterialLike,
    transform: Transform,
  ): void;
  drawBillboard(texture: TextureHandle, position: Vec3, size: Vec2): void;
  drawLine(points: readonly Vec3[], color: Color): void;
  drawHudText(text: string, position: Vec2, options?: HudTextOptions): void;
  drawHudRect(position: Vec2, size: Vec2, color: Color): void;

  createBox(size: Vec3): Geometry;
  createSphere(radius: number): Geometry;
  createCylinder(radius: number, height: number): Geometry;
  createCapsule(radius: number, height: number): Geometry;
  createPlane(width: number, depth: number): Geometry;
  createMaterial(spec: MaterialSpec): Material;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A component class `actor.component` and `actor.componentsOf` select by. A
 * component is constructed with whatever arguments its own class takes, then
 * handed to `actor.attach`.
 */
export type ComponentClass<C extends Component = Component> = new (
  ...args: never[]
) => C;

/**
 * One piece of an actor: an appearance, a light, a camera target, or behavior
 * of its own.
 *
 * The base class's `beginPlay`, `tick`, and `endPlay` do nothing, so a subclass
 * overrides only what it needs.
 */
export class Component {
  /** The actor the component is attached to. Assigned by `attach`, before `beginPlay`. */
  declare readonly actor: Actor;

  /**
   * The component's transform relative to its actor's. Defaults to the
   * identity — position `(0, 0, 0)`, identity rotation, scale `(1, 1, 1)` —
   * so a component drawn without touching `offset` sits exactly on its actor.
   */
  readonly offset: Transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
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
   * The composition is TRS on both sides: the offset's position is scaled and
   * rotated into the actor's frame and then translated by the actor's
   * position (`transformPoint`), the two rotations compose
   * (`quatMultiply(actor, offset)` — the offset turns first, in the actor's
   * frame), and the two scales multiply componentwise. The returned record is
   * fresh on every call, nested values included, so a held snapshot keeps the
   * values of the moment it was read.
   */
  worldTransform(): Transform {
    const base = this.actor.transform;
    const offset = this.offset;

    return {
      position: transformPoint(base, offset.position),
      rotation: quatMultiply(base.rotation, offset.rotation),
      scale: {
        x: base.scale.x * offset.scale.x,
        y: base.scale.y * offset.scale.y,
        z: base.scale.z * offset.scale.z,
      },
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Render components                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The base every drawing component extends. The pipeline collects every
 * enabled, visible one on every live actor, each frame, and sorts the
 * collection by `layer` ascending, then by the owning actor's spawn order,
 * then by attachment order — stably, so a redraw with no change reproduces
 * the previous order exactly.
 */
export class RenderComponent extends Component {
  /**
   * Orders the pipeline. Lower layers draw first, and the depth buffer is
   * cleared between layers. Defaults to `0`.
   */
  layer = 0;

  /** Whether the pipeline collects the component. Defaults to `true`. */
  visible = true;

  /**
   * Clamped to `0..1` by the pipeline when it draws. A component below `1`
   * draws in its layer's transparent pass. Defaults to `1`.
   */
  opacity = 1;
}

/** Options for {@link MeshComponent}. */
export interface MeshOptions {
  mesh: MeshHandle;
  material?: MaterialHandle;
  color?: Color;
  clip?: string;
  clipTime?: number;
}

/**
 * A loaded glTF mesh drawn at the component's world transform, its local
 * units scaled by the transform's scale.
 *
 * The pose is a pure function of `clip` and `clipTime`, and the engine never
 * advances `clipTime`: a game animates by advancing it in a tick, so the pose
 * is readable state and a scripted run reproduces it exactly. A `clip` naming
 * a clip the mesh does not carry throws when the component is drawn — the
 * pipeline's check, not construction's, because both fields stay mutable.
 */
export class MeshComponent extends RenderComponent {
  /** The loaded mesh the component draws, at the component's world transform. */
  mesh: MeshHandle;

  /**
   * A material applied over every surface of the mesh. `null` draws the
   * materials the mesh file carries.
   */
  material: MaterialHandle | null;

  /** A CSS color multiplied onto the base color, the 3D tint. `null` for none. */
  color: Color | null;

  /**
   * The animation clip posing the mesh, a name from `mesh.clips`. `null`
   * draws the bind pose.
   */
  clip: string | null;

  /** Seconds into the clip the pose is sampled at. Wraps at the clip's duration. */
  clipTime: number;

  constructor(options: MeshOptions) {
    super();
    this.mesh = options.mesh;
    this.material = options.material ?? null;
    this.color = options.color ?? null;
    this.clip = options.clip ?? null;
    this.clipTime = options.clipTime ?? 0;
  }
}

/**
 * A drawn or collided primitive: a box by full extents, a sphere by radius,
 * or a capsule whose axis runs along the component's local +Y with `height`
 * the distance between the centers of its two hemispherical caps (total
 * extent along the axis `height + 2 * radius`). Every shape is centered on
 * the component's world transform and oriented by its rotation. The same
 * type describes a drawn shape and a collider's shape.
 */
export type Shape3 =
  | { kind: "box"; size: Vec3 }
  | { kind: "sphere"; radius: number }
  | { kind: "capsule"; radius: number; height: number };

/** Options for {@link ShapeComponent}. */
export interface ShapeOptions {
  shape: Shape3;
  color?: Color;
  material?: MaterialHandle;
}

/**
 * A primitive drawn at the component's world transform. Each primitive
 * carries its own texture parameterization; a case that must assert on exact
 * texel placement uses a {@link MeshComponent} with authored coordinates
 * instead.
 */
export class ShapeComponent extends RenderComponent {
  /** The primitive drawn. */
  shape: Shape3;

  /** The surface's base color. Defaults to `"#ffffff"`. */
  color: Color;

  /** A material applied over the primitive. Its maps multiply with `color`. */
  material: MaterialHandle | null;

  constructor(options: ShapeOptions) {
    super();
    this.shape = options.shape;
    this.color = options.color ?? "#ffffff";
    this.material = options.material ?? null;
  }
}

/** Options for {@link TextComponent}. */
export interface TextOptions {
  text: string;
  font?: string;
  fill?: Color;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
}

/**
 * A string drawn as a billboard: a quad at the component's world position
 * that always faces the camera, positioned against the transform by `align`
 * and `baseline`. The billboard ignores the component's rotation, and the
 * transform's x and y scale factors scale the quad. Text draws unlit in every
 * render mode except `wireframe`, where its quad's outline draws in `fill`.
 *
 * The pipeline lowers the component onto the scene context's own vocabulary:
 * it rasterizes the string in the engine's monospace face into a texture, in
 * `fill`, and issues a `drawBillboard` with it — {@link textHeightOf} is the
 * seam that reads the size out of `font`, and the rasterizing itself belongs
 * to the rendering module.
 */
export class TextComponent extends RenderComponent {
  /** The string drawn. */
  text: string;

  /**
   * A CSS font shorthand. Only the size is read, as world units of text
   * height; the face is always the engine's own monospace face, so the same
   * string letters the same in every build and in the player. Defaults to
   * `"16px monospace"`.
   */
  font: string;

  /** The fill color. Defaults to `"#ffffff"`. */
  fill: Color;

  /** Horizontal alignment against the component's transform. Defaults to `"center"`. */
  align: "left" | "center" | "right";

  /** Vertical alignment against the component's transform. Defaults to `"middle"`. */
  baseline: "top" | "middle" | "bottom";

  constructor(options: TextOptions) {
    super();
    this.text = options.text;
    this.font = options.font ?? "16px monospace";
    this.fill = options.fill ?? "#ffffff";
    this.align = options.align ?? "center";
    this.baseline = options.baseline ?? "middle";
  }
}

/**
 * What a {@link DrawComponent.draw} receives: the scene context the pipeline
 * draws through — with this frame's camera, lights, and mode already in
 * force — beside snapshots of the frame, the fit, and the camera.
 */
export interface DrawApi {
  /** The scene context the pipeline draws through. */
  readonly scene: SceneContext;
  /** The render mode in force for this frame. */
  readonly mode: RenderMode;
  /** The frame counter, the accumulated simulated time, and the most recent delta. */
  frame(): FrameInfo;
  /** The current logical-to-device fit, as a snapshot the caller owns. */
  viewport(): Viewport;
  /** The camera's state for this frame, as a `CameraState` the caller owns. */
  camera(): CameraState;
}

/**
 * The direct-drawing path, for a case that measures the drawing itself.
 *
 * The component issues scene-context draw calls in world units, in its place
 * in the layer order, and the vocabulary is the same one Simple 3D's game
 * renders through, so both engines' recordings replay in one player. The
 * render mode is renderer state the scene context holds, so the calls are
 * drawn under the mode in force without the component implementing anything;
 * `api.mode` remains readable for a component that draws differently per
 * mode. A `DrawComponent` does not set the scene context's camera, lights, or
 * mode, and does not clear depth; those belong to the pipeline, and the
 * pipeline makes a call to `setCamera`, `setLights`, `setMode`, or
 * `clearDepth` from `draw` throw, naming the rule.
 */
export abstract class DrawComponent extends RenderComponent {
  /** Called in the component's place in the layer order. */
  abstract draw(api: DrawApi): void;
}

/* -------------------------------------------------------------------------- */
/* Camera target                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Marks its actor as a view target.
 *
 * The world's camera follows the first enabled `CameraComponent` its target
 * holds, adopting that component's world position and rotation and its
 * `fovY`; `near` and `far` stay the camera's own.
 */
export class CameraComponent extends Component {
  /**
   * The vertical field of view the camera takes while following, in radians.
   * Defaults to `Math.PI / 3`, the camera's own default.
   */
  fovY: number;

  constructor(options?: { fovY?: number }) {
    super();
    this.fovY = options?.fovY ?? Math.PI / 3;
  }
}

/* -------------------------------------------------------------------------- */
/* Lights                                                                    */
/* -------------------------------------------------------------------------- */

/** Options shared by every light component. */
export interface LightOptions {
  color?: Color;
  intensity?: number;
}

/** Options for {@link PointLightComponent}: the shared pair plus `range`. */
export interface PointLightOptions extends LightOptions {
  range?: number;
}

/**
 * The base of the three lights. Lighting is world content: a light is a
 * component on an actor, so it moves with its actor, is collected while it is
 * enabled and its actor alive, and is rebuilt with the world like everything
 * else.
 */
export abstract class LightComponent extends Component {
  /** The light's color. Defaults to `"#ffffff"`. */
  color: Color;

  /** The light's strength. Non-negative. Defaults to `1`. */
  intensity: number;

  constructor(options?: LightOptions) {
    super();
    this.color = options?.color ?? "#ffffff";
    this.intensity = options?.intensity ?? 1;
  }
}

/** Lights every surface evenly from nowhere. */
export class AmbientLightComponent extends LightComponent {}

/**
 * Shines along the component's world orientation applied to local −Z, the
 * direction a camera looks, so an actor aims a light by rotating.
 */
export class DirectionalLightComponent extends LightComponent {}

/**
 * Shines from the component's world position, falling off to nothing at
 * `range`.
 */
export class PointLightComponent extends LightComponent {
  /**
   * The distance the light reaches, in world units, unscaled by the
   * transform. `0` reaches everywhere. Defaults to `0`.
   */
  range: number;

  constructor(options?: PointLightOptions) {
    // `PointLightOptions` extends `LightOptions`, so the same object carries
    // `color` and `intensity`; forwarding it is what keeps a point light's two
    // inherited fields settable the way every other light's are.
    super(options);
    this.range = options?.range ?? 0;
  }
}

/* -------------------------------------------------------------------------- */
/* Internal wiring seams                                                      */
/* -------------------------------------------------------------------------- */

/*
 * The helpers below are the rendering and collision modules' half of the
 * component catalogue — how a declared shape scales, how a light becomes the
 * plain `LightState` a renderer state and a recording carry, and how a text
 * component's font resolves to a size. They are exported for the engine's own
 * wiring and are not part of the package's public surface.
 */

/**
 * Internal: `shape` under the world transform's `scale`, as a fresh value.
 *
 * The documented rules, verbatim: scale applies per axis to a box's `size`; a
 * sphere's radius, and a capsule's radius, scale by the largest of the three
 * scale factors' magnitudes; a capsule's `height` scales by the y factor.
 * Extents come out as magnitudes — a mirrored scale flips nothing about a
 * centered primitive's extent, so the sign is dropped rather than producing a
 * negative size.
 */
export function scaleShape3(shape: Shape3, scale: Vec3): Shape3 {
  const largest = Math.max(
    Math.abs(scale.x),
    Math.abs(scale.y),
    Math.abs(scale.z),
  );
  switch (shape.kind) {
    case "box":
      return {
        kind: "box",
        size: {
          x: Math.abs(shape.size.x * scale.x),
          y: Math.abs(shape.size.y * scale.y),
          z: Math.abs(shape.size.z * scale.z),
        },
      };
    case "sphere":
      return { kind: "sphere", radius: shape.radius * largest };
    case "capsule":
      return {
        kind: "capsule",
        radius: shape.radius * largest,
        height: shape.height * Math.abs(scale.y),
      };
  }
}

/**
 * Internal: `light` as the plain `LightState` the pipeline snapshots into the
 * renderer state — an ambient as color and intensity, a directional with
 * `direction` the unit world vector its rotation aims local −Z along, and a
 * point with the component's world position and its unscaled `range`. Fresh
 * plain data on every call; the walk order across components (owning actors'
 * spawn order, then attachment order) belongs to the pipeline.
 */
export function lightStateOf(light: LightComponent): LightState {
  if (light instanceof PointLightComponent) {
    return {
      type: "point",
      color: light.color,
      intensity: light.intensity,
      position: light.worldTransform().position,
      range: light.range,
    };
  }
  if (light instanceof DirectionalLightComponent) {
    return {
      type: "directional",
      color: light.color,
      intensity: light.intensity,
      // A unit quaternion carries a unit vector to a unit vector, so the
      // rotated −Z needs no re-normalizing.
      direction: rotateVec3(light.worldTransform().rotation, {
        x: 0,
        y: 0,
        z: -1,
      }),
    };
  }
  return { type: "ambient", color: light.color, intensity: light.intensity };
}

/**
 * The default rig's directional direction, computed once as a module constant
 * so the recorded `LightState` is canonical — every frame lit by the rig
 * writes the same nine-significant-digit numbers and dedups to one `states`
 * entry.
 */
const DEFAULT_RIG_DIRECTION: Vec3 = vec3Normalize({ x: -1, y: -2, z: -1 });

/**
 * Internal: the engine's default light rig, as a fresh list the caller owns —
 * one ambient light, `#ffffff` at intensity `0.4`, and one directional light,
 * `#ffffff` at intensity `0.8`, direction
 * `vec3Normalize({ x: -1, y: -2, z: -1 })`. It lights any frame the world
 * holds no enabled light component, appears in the renderer state and so in a
 * recording (a recording states what lit it), and withdraws on any frame the
 * world holds one.
 */
export function defaultLightRig(): readonly LightState[] {
  return [
    { type: "ambient", color: "#ffffff", intensity: 0.4 },
    {
      type: "directional",
      color: "#ffffff",
      intensity: 0.8,
      direction: { ...DEFAULT_RIG_DIRECTION },
    },
  ];
}

/**
 * Internal: the text height a `TextComponent.font` shorthand names, in world
 * units.
 *
 * Only the size is read — the face is always the engine's own monospace face,
 * which is what keeps lettering deterministic in Node and identical in the
 * player — so this takes the first `<number>px` token of the shorthand and
 * ignores everything else. A shorthand naming no pixel size answers the
 * default `16`, the documented default's own size, rather than refusing: the
 * field is mutable prose, and a wrong face-only value should letter at the
 * default size instead of killing the frame.
 */
export function textHeightOf(font: string): number {
  for (const token of font.split(/\s+/)) {
    const match = /^(\d*\.?\d+)px$/.exec(token);
    if (match !== null) return Number(match[1]);
  }
  return 16;
}
