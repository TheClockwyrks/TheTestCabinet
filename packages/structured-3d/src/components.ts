/**
 * Components: the units of appearance and behavior an actor is assembled from.
 *
 * A component is attached to exactly one actor for its lifetime, carries an
 * offset from that actor's transform, and ticks after its actor each frame.
 * Enabled, visible render components are collected by the rendering pipeline
 * every frame. Composition is what reserves the `Actor` subclass for behavior:
 * how a thing moves and what it decides belongs to the actor, while what it
 * looks like, what lights it, what it collides with, and where a camera
 * following it looks from are the components it assembles.
 *
 * ## Declarations, not objects
 *
 * The catalogue here is the *declarative* half of drawing. A `MeshComponent`
 * states a {@link MeshGeometry} and a {@link MaterialSpec}; a
 * `LightComponent` states a {@link LightSpec}; a `SpriteComponent` states a
 * bitmap, a region, and a size. None of them owns a `THREE.Mesh`, a
 * `THREE.Light`, or a pixel. The pipeline reads the declaration, builds the one
 * three object it owns for that component, places it at the component's world
 * transform, and rebuilds it when the declaration is replaced — which is what
 * lets the render modes substitute materials at draw time, because the pipeline
 * knows what the game *meant* rather than only what it happened to construct.
 *
 * A game that wants three objects of its own reaches for
 * {@link Object3DComponent}, whose subtree the pipeline places and otherwise
 * leaves alone, or for {@link DrawComponent}, which draws itself onto the
 * screen layer with a 2D context. Both are direct paths, and both give up the
 * declarative pipeline's answer for the render modes in exchange.
 *
 * So what each component *draws* belongs to the rendering module; what each one
 * *is* — its options, their defaults, and the fields they settle into — is
 * decided here, at construction.
 *
 * ## Two spaces, fixed by the class
 *
 * `RenderComponent.space` is read-only and fixed by a component's class rather
 * than chosen per instance, because in three dimensions the two passes are not
 * two ways of drawing one thing. A `world` component is a three object seen
 * through the camera's frustum, with depth deciding occlusion; a `screen`
 * component is a 2D drawing on a canvas laid over the picture, in logical units
 * measured from the top-left of the design field. A mesh cannot be moved onto
 * the screen layer and a text readout has no volume, so the class settles it:
 * {@link MeshComponent}, {@link ModelComponent}, {@link LightComponent}, and
 * {@link Object3DComponent} are `world`, and {@link SpriteComponent},
 * {@link ShapeComponent}, {@link TextComponent}, and {@link DrawComponent} are
 * `screen`.
 *
 * ## Assignment is the change signal
 *
 * `MeshComponent.geometry`, `MeshComponent.material`, and
 * `LightComponent.light` are accessors rather than plain fields for one reason:
 * the pipeline has to know when to throw away the three object it built and
 * build another. Comparing the declaration by identity every frame would say
 * nothing about a game that mutated a spec in place, and comparing it
 * field-by-field would cost more than the rebuild. Assignment is therefore the
 * signal, counted here — a game that mutates a spec's object writes the field
 * again afterwards, and the pipeline reads {@link declarationRevision} to see
 * that it did.
 */

import * as THREE from "three";
import type { Actor } from "./actors";
import { cloneModel } from "./assets";
import type {
  DrawApi,
  EndPlayReason,
  LightSpec,
  Mat4,
  MaterialSpec,
  MeshGeometry,
  Model,
  NodeHandle,
  Quat,
  Rect,
  RenderSpace,
  Shape2D,
  ShapeOptions,
  SpriteOptions,
  TextOptions,
  Transform,
  Vec3,
} from "./contract";
import { composeTransforms, transformToMatrix } from "./math";
import type { World } from "./worlds";

/* -------------------------------------------------------------------------- */
/* ComponentClass                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A component is constructed with whatever arguments its own class takes, then
 * handed to `actor.attach`.
 *
 * `never[]` rather than `unknown[]` because this type is only ever used to
 * *select* by — `actor.component(MeshComponent)` and
 * `actor.componentsOf(ColliderComponent)` — never to construct through. Every
 * component class is assignable to it whatever its constructor asks for, which
 * is exactly what a lookup by class needs and what a factory would need to
 * refuse.
 *
 * Declared here rather than in `contract.ts` because it names
 * {@link Component}, and the contract module is a leaf that mentions no
 * framework class.
 */
export type ComponentClass<C extends Component = Component> = new (
  ...args: never[]
) => C;

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One piece of an actor: an appearance, a light, a collider, a camera target,
 * or behavior of its own.
 *
 * The base class's `beginPlay`, `tick`, and `endPlay` do nothing, so a subclass
 * overrides only what it needs.
 */
export class Component {
  /**
   * The actor the component is attached to. Assigned by `attach`, before
   * `beginPlay`, so every method that runs after construction can read it.
   */
  declare readonly actor: Actor;

  /**
   * The component's transform relative to its actor's. Defaults to the
   * identity, so a component left alone sits exactly on its actor and moves
   * with it.
   *
   * Mutable in place — both the record and the three vectors inside it — so a
   * turret is mounted with `offset.position = vec3(0, 0.65, 0)` and aimed with
   * `offset.rotation = quatFromAxisAngle(UP, yaw)`. Every component gets its
   * own nested records rather than sharing the frozen `VEC3_ZERO` /
   * `QUAT_IDENTITY` / `VEC3_ONE` constants: those are values a game reads, and
   * this is a record it writes through.
   */
  readonly offset: Transform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };

  /**
   * Defaults to `true`. A disabled component skips its tick, draws nothing,
   * and takes no part in collision — the wider switch that
   * `RenderComponent.visible`, which only takes it out of the picture, sits
   * inside of.
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
   * The actor's transform composed with `offset`, as a fresh `Transform` the
   * caller owns.
   *
   * The composition is `composeTransforms(actor.transform, offset)`: the
   * offset's position is scaled by the actor's scale, rotated by the actor's
   * rotation, and translated by the actor's position; the rotations compose as
   * `quatMultiply(actor.rotation, offset.rotation)`; and the scales multiply
   * per axis. That is scale, then rotation, then translation — the order three
   * composes a matrix from the same three parts — so this and
   * {@link worldMatrix} describe one placement in two shapes.
   *
   * Every record in the result is fresh, the three nested vectors included, so
   * a held snapshot keeps the values of the moment it was read and a caller may
   * write into what it gets back.
   */
  worldTransform(): Transform {
    return composeTransforms(this.actor.transform, this.offset);
  }

  /**
   * The same composition as a column-major {@link Mat4}, the sixteen numbers
   * three's `Matrix4.compose` builds from the same three parts.
   *
   * Sixteen numbers rather than a `THREE.Matrix4` so a validator can read
   * entries `12..14` for the world position without importing three.
   */
  worldMatrix(): Mat4 {
    return transformToMatrix(this.worldTransform());
  }
}

/* -------------------------------------------------------------------------- */
/* RenderComponent                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The base every drawing component extends. The pipeline collects every
 * enabled, visible one on every live actor, each frame.
 */
export class RenderComponent extends Component {
  /**
   * Orders the component's pass. Lower layers draw first. Defaults to `0`.
   *
   * In the world pass it is the three object's `renderOrder`, which orders
   * draws within the same transparency pass while depth testing decides
   * occlusion; in the screen pass it is the outer sort key, ahead of the
   * owning actor's spawn order and then attachment order.
   */
  layer = 0;

  /**
   * Whether the pipeline collects the component. Defaults to `true`. A
   * component taken out of the picture this way keeps ticking; `enabled` is the
   * switch that stops that too.
   */
  visible = true;

  /**
   * Clamped to `0..1` by the pipeline when it draws. Defaults to `1`.
   *
   * A world component's opacity multiplies its material's, and an object below
   * `1` draws in the transparent pass. A {@link LightComponent} takes no
   * opacity at all.
   */
  opacity = 1;

  /**
   * The space the component draws in, fixed by the component's class rather
   * than chosen per instance.
   *
   * `world` draws through the camera as one three object the pipeline places at
   * the component's world transform. `screen` draws on the screen layer through
   * the viewport alone: the composed transform, every size, and a font size are
   * logical units measured from the top-left of the design field, so the
   * component holds its place on the canvas whatever the camera does. The two
   * passes are sorted separately and every `screen` component draws over every
   * `world` one.
   */
  readonly space: RenderSpace = "world";
}

/* -------------------------------------------------------------------------- */
/* The declaration revision                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How many times a component's declaration has been assigned.
 *
 * Kept in a side table rather than in a field so that a game reading a
 * component sees only what the api page specifies, and so that `toEqual` over a
 * component in a check compares the declared fields rather than engine
 * bookkeeping.
 */
const declarationRevisions = new WeakMap<Component, number>();

/** Records that a declaration field was assigned a value. */
function bumpDeclaration(component: Component): void {
  declarationRevisions.set(
    component,
    (declarationRevisions.get(component) ?? 0) + 1,
  );
}

/**
 * Internal: the number of times {@link MeshComponent.geometry},
 * {@link MeshComponent.material}, or {@link LightComponent.light} has been
 * assigned on `component`, `0` for a component whose declaration is still the
 * one it was constructed with.
 *
 * The pipeline keeps the revision it last built from beside the three object it
 * built, and rebuilds when the two disagree. Assignment is the change signal,
 * so a game that mutates a spec's object in place writes the field again and
 * the rebuild follows; mutating without reassigning changes nothing, which is
 * what makes a per-frame `material.color` tween cost one rebuild per assignment
 * rather than one per frame.
 */
export function declarationRevision(component: Component): number {
  return declarationRevisions.get(component) ?? 0;
}

/* -------------------------------------------------------------------------- */
/* MeshComponent                                                              */
/* -------------------------------------------------------------------------- */

/** What a {@link MeshComponent} is constructed with. */
export interface MeshOptions {
  /** The geometry drawn, centered on the component's transform. */
  geometry: MeshGeometry;
  /** The material drawn with. Defaults to every {@link MaterialSpec} default. */
  material?: MaterialSpec;
  /** `true` turns the mesh to face the camera each frame. Defaults to `false`. */
  billboard?: boolean;
}

/**
 * One of the built-in geometries, drawn with a declared material at the
 * component's world transform.
 *
 * The pipeline builds one three mesh from `geometry` and `material` and
 * rebuilds it when either field is assigned a new value. A `standard` or
 * `lambert` material takes its shading from the scene's lights, so a level
 * drawn with either also carries a {@link LightComponent}; a `basic` material
 * draws its color as given, which is the choice for a marker or a glow that
 * owes nothing to the lighting.
 */
export class MeshComponent extends RenderComponent {
  /** `true` keeps the mesh's position and scale and takes its orientation from the camera. */
  billboard: boolean;

  /** Whether the mesh casts a shadow. Defaults to `false`. */
  castShadow = false;

  /** Whether the mesh receives shadows. Defaults to `false`. */
  receiveShadow = false;

  private declaredGeometry: MeshGeometry;
  private declaredMaterial: MaterialSpec;

  constructor(options: MeshOptions) {
    super();
    // Written through the backing fields rather than the accessors, so a
    // freshly constructed component sits at revision `0` and the pipeline's
    // first build is driven by having no object yet rather than by a bump.
    this.declaredGeometry = options.geometry;
    this.declaredMaterial = options.material ?? {};
    this.billboard = options.billboard ?? false;
  }

  /** The geometry drawn. Assigning rebuilds the mesh. */
  get geometry(): MeshGeometry {
    return this.declaredGeometry;
  }

  set geometry(value: MeshGeometry) {
    this.declaredGeometry = value;
    bumpDeclaration(this);
  }

  /**
   * The material drawn with, held as the game handed it over. Assigning
   * rebuilds the mesh.
   *
   * An absent field means that field's documented default, applied where the
   * three material is built, so an untouched spec is every default and a spec
   * naming one field changes only that one. Spread the current spec into a new
   * one to change a field:
   * `this.body.material = { ...this.body.material, emissive }`.
   */
  get material(): MaterialSpec {
    return this.declaredMaterial;
  }

  set material(value: MaterialSpec) {
    this.declaredMaterial = value;
    bumpDeclaration(this);
  }
}

/* -------------------------------------------------------------------------- */
/* ModelComponent                                                             */
/* -------------------------------------------------------------------------- */

/** The clone and the mixer one {@link ModelComponent} owns, made at construction. */
interface ModelTree {
  /** The skeleton-aware clone of the model's scene, the tree this component poses. */
  readonly root: THREE.Group;
  /** Drives the clone's clips. Advanced by the pipeline, by the world's delta. */
  readonly mixer: THREE.AnimationMixer;
}

/**
 * Every live {@link ModelComponent}'s clone and mixer.
 *
 * Held in a side table rather than in two private fields so that one lookup
 * serves both the component's own methods and the pipeline's seams at the
 * bottom of this module, with no cast through the class's privates and nothing
 * of three's on the surface the api page specifies.
 */
const modelTrees = new WeakMap<ModelComponent, ModelTree>();

/**
 * The clone and mixer of a component the constructor has finished registering.
 *
 * Every path here runs after that registration — the constructor's own `play`
 * included, which happens on the line after it — so the absent case is
 * unreachable and reported as the engine bug it would be rather than papered
 * over with a second empty tree.
 */
function modelInternals(component: ModelComponent): ModelTree {
  const tree = modelTrees.get(component);
  if (!tree) {
    throw new Error("model component has no clone: it was never constructed");
  }
  return tree;
}

/** What a {@link ModelComponent} is constructed with. */
export interface ModelOptions {
  /** The loaded model to place. Cloned on construction. */
  model: Model;
  /** A clip played looping from the first frame. Throws for a name the model lacks. */
  animation?: string;
}

/** What {@link ModelComponent.play} accepts beside the clip's name. */
export interface PlayAnimationOptions {
  /** Whether the clip repeats. Defaults to `true`. */
  loop?: boolean;
  /** A multiplier on the clip's own rate. Defaults to `1`. */
  speed?: number;
}

/**
 * A loaded glTF model placed on an actor, animating on its own.
 *
 * The component clones `model.scene` on construction, skeleton-aware, so a
 * skinned mesh in the clone keeps its own bones and several components share
 * one loaded model without walking in lockstep. The clone exists from
 * construction, which is why {@link node} may be called in a constructor and
 * the handle it returns carried for the life of the component.
 *
 * Clips play through a three `AnimationMixer` the pipeline advances by the
 * world's delta, so a paused world holds every pose and a scripted clock steps
 * every animation exactly as it steps the simulation. The component's `offset`
 * is where an exporter's units and axes meet the world's: a rig authored at ten
 * units to the meter is scaled down through `offset.scale` and one facing `+Z`
 * is turned to the actor's forward through `offset.rotation`, so the actor's own
 * transform stays in world units and the math over it stays plain.
 */
export class ModelComponent extends RenderComponent {
  /** The loaded model the component was built from. */
  readonly model: Model;

  /** Whether the model's meshes cast shadows. Defaults to `false`. */
  castShadow = false;

  /** Whether the model's meshes receive shadows. Defaults to `false`. */
  receiveShadow = false;

  /** The action `play` started, or `null` when nothing is playing. */
  private action: THREE.AnimationAction | null = null;

  /** The name {@link animation} reports, kept beside the action it names. */
  private playing: string | null = null;

  /**
   * The handles handed out by {@link node}, so a name asked for twice answers
   * with one object and a handle held from `beginPlay` stays the handle the
   * component hands out.
   */
  private readonly handles = new Map<string, NodeHandle>();

  constructor(options: ModelOptions) {
    super();
    this.model = options.model;
    const root = cloneModel(options.model);
    modelTrees.set(this, { root, mixer: new THREE.AnimationMixer(root) });
    if (options.animation !== undefined) this.play(options.animation);
  }

  /**
   * Seconds into the playing animation, `0` when nothing is playing.
   *
   * Writable, so a game scrubs a clip rather than waiting for it: writing `0`
   * restarts the playing clip from its first frame and writing a later value
   * jumps to that moment, which is how two figures started on the same frame
   * are offset by half a cycle. A write with nothing playing has nothing to
   * seek and does nothing.
   */
  get time(): number {
    return this.action?.time ?? 0;
  }

  set time(value: number) {
    if (this.action) this.action.time = value;
  }

  /**
   * Plays the named clip from its first frame.
   *
   * `loop` defaults to `true`; a clip played with `loop: false` plays once and
   * holds its final pose, and {@link animation} keeps reporting it, so a
   * one-shot is followed by reading {@link time} against the clip's own
   * `duration`. `speed` defaults to `1` and multiplies the clip's own rate.
   *
   * Throws naming the animation when the model carries no clip by that name, so
   * a typo surfaces the first time the tick reaches it rather than as a figure
   * that quietly never moves.
   */
  play(animation: string, options?: PlayAnimationOptions): void {
    const clip = this.model.animations.find((c) => c.name === animation);
    if (!clip) {
      const carried = this.model.animations
        .map((c) => `"${c.name}"`)
        .join(", ");
      throw new Error(
        `the model has no animation named "${animation}"; it carries ${
          carried === "" ? "none" : carried
        }`,
      );
    }

    const loop = options?.loop ?? true;
    const speed = options?.speed ?? 1;

    // Stopping the outgoing action rather than fading it keeps the pose a check
    // reads after `play` the pose of the clip it named, on the frame it named
    // it, with nothing of the previous clip blended in.
    if (this.action) this.action.stop();

    const action = modelInternals(this).mixer.clipAction(clip);
    action.reset();
    action.setLoop(
      loop ? THREE.LoopRepeat : THREE.LoopOnce,
      loop ? Infinity : 1,
    );
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    action.play();

    this.action = action;
    this.playing = animation;
  }

  /** Stops the playing clip, after which {@link animation} reports `null`. */
  stop(): void {
    if (this.action) this.action.stop();
    this.action = null;
    this.playing = null;
  }

  /**
   * The name of the playing clip, or `null`.
   *
   * A one-shot that has reached its final pose is still the playing clip: it is
   * holding that pose, and a tick that chose it is entitled to see that its
   * choice is still in force until it chooses another.
   */
  animation(): string | null {
    return this.playing;
  }

  /**
   * A live handle onto the named node's local transform inside this
   * component's clone, or `null` for a name the model lacks.
   *
   * `model.nodes` lists every name this accepts. Writing the handle's
   * `position`, `rotation`, or `scale` poses that node directly, which is how a
   * game drives a joint the voxel exporter named without owning the tree.
   * Reading one hands back a fresh record, like every other value this engine
   * hands out, so a value read is the caller's and the way to move a node is to
   * assign a whole field rather than to write inside one it read.
   *
   * A playing clip poses the nodes its tracks animate when the pipeline
   * advances the mixer, after every tick, so a write from a tick to one of those
   * nodes is replaced by the clip's pose for that frame. Drive the nodes a clip
   * leaves alone, or stop the clip and drive the whole rig from the tick.
   */
  node(name: string): NodeHandle | null {
    const held = this.handles.get(name);
    if (held) return held;

    const object = modelInternals(this).root.getObjectByName(name);
    if (!object) return null;

    const handle = nodeHandle(object);
    this.handles.set(name, handle);
    return handle;
  }
}

/** A live view onto one `THREE.Object3D`'s local transform. */
function nodeHandle(node: THREE.Object3D): NodeHandle {
  return {
    get position(): Vec3 {
      return { x: node.position.x, y: node.position.y, z: node.position.z };
    },
    set position(value: Vec3) {
      node.position.set(value.x, value.y, value.z);
    },
    get rotation(): Quat {
      const { x, y, z, w } = node.quaternion;
      return { x, y, z, w };
    },
    set rotation(value: Quat) {
      node.quaternion.set(value.x, value.y, value.z, value.w);
    },
    get scale(): Vec3 {
      return { x: node.scale.x, y: node.scale.y, z: node.scale.z };
    },
    set scale(value: Vec3) {
      node.scale.set(value.x, value.y, value.z);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* LightComponent                                                             */
/* -------------------------------------------------------------------------- */

/** What a {@link LightComponent} is constructed with. */
export interface LightOptions {
  /** The light declared. */
  light: LightSpec;
}

/**
 * A light in the world pass, declared as a spec.
 *
 * The pipeline builds one three light from `light` and rebuilds it when the
 * field is assigned a new value. A light rides its actor like any other
 * component: an ambient or hemisphere light has no position, a point light
 * shines from the component's world position, and a directional or spot light
 * shines from that position along the component's world forward axis, `FORWARD`
 * rotated by its world rotation — so aiming a light is turning its offset.
 *
 * `visible`, `enabled`, and the owning actor's life switch the light with the
 * rest of the picture, and `opacity` has no effect on it.
 */
export class LightComponent extends RenderComponent {
  private declaredLight: LightSpec;

  constructor(options: LightOptions) {
    super();
    this.declaredLight = options.light;
  }

  /** The light declared. Assigning rebuilds the three light. */
  get light(): LightSpec {
    return this.declaredLight;
  }

  set light(value: LightSpec) {
    this.declaredLight = value;
    bumpDeclaration(this);
  }
}

/* -------------------------------------------------------------------------- */
/* Object3DComponent                                                          */
/* -------------------------------------------------------------------------- */

/** What an {@link Object3DComponent} is constructed with. */
export interface Object3DOptions {
  /** The root of the game's own subtree. */
  object: THREE.Object3D;
}

/**
 * The direct path into the world pass: the game's own three objects.
 *
 * The pipeline places `object` at the component's world transform every frame
 * and applies `visible` and `opacity` to it; everything inside the subtree is
 * the game's, mutated directly, and the render modes substitute its materials
 * at draw time as they do for any other component. The subtree is in the
 * component's local frame, so an exhaust plume built once in the constructor
 * follows its ship without the tick placing it.
 */
export class Object3DComponent extends RenderComponent {
  /** The root of the game's subtree, placed by the pipeline. */
  readonly object: THREE.Object3D;

  constructor(options: Object3DOptions) {
    super();
    this.object = options.object;
  }
}

/* -------------------------------------------------------------------------- */
/* SpriteComponent                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A decoded bitmap drawn on the screen layer at the component's composed
 * transform.
 *
 * The anchor defaults center the sprite on its transform. An image is loaded
 * through the assets loader before the component is constructed, so a sprite
 * reads its bitmap as a plain value, and the image is sampled as
 * `EngineOptions.imageSmoothing` states — bilinearly by default,
 * nearest-neighbor when it is `false`.
 */
export class SpriteComponent extends RenderComponent {
  /** A sprite draws on the screen layer, in logical units. */
  override readonly space: RenderSpace = "screen";

  /** The decoded bitmap the component draws. */
  image: ImageBitmap;

  /** A region of a sprite sheet, in the image's pixels. `null` selects the whole image. */
  source: Rect | null;

  /** The drawn width, in logical units. Defaults to the source region's pixel width. */
  width: number;

  /** The drawn height, in logical units. Defaults to the source region's pixel height. */
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
    // logical unit per pixel.
    this.width = options.width ?? this.source?.width ?? options.image.width;
    this.height = options.height ?? this.source?.height ?? options.image.height;
    this.anchorX = options.anchorX ?? 0.5;
    this.anchorY = options.anchorY ?? 0.5;
    this.tint = options.tint ?? null;
  }
}

/* -------------------------------------------------------------------------- */
/* ShapeComponent                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A filled and/or stroked flat shape drawn on the screen layer at the
 * component's composed transform. A component with neither a fill nor a stroke
 * draws nothing.
 *
 * The shape is two-dimensional because the screen layer is: the volumetric
 * shape a collider is tested with is `ColliderShape`, under collision.
 */
export class ShapeComponent extends RenderComponent {
  /** A shape draws on the screen layer, in logical units. */
  override readonly space: RenderSpace = "screen";

  /** The geometry drawn. */
  shape: Shape2D;

  /** A CSS color filled inside the shape, or `null` for none. */
  fill: string | null;

  /** A CSS color stroked around the outline, or `null` for none. */
  stroke: string | null;

  /** The stroke width, in logical units. Defaults to `1`. */
  strokeWidth: number;

  constructor(options: ShapeOptions) {
    super();
    this.shape = options.shape;
    this.fill = options.fill ?? null;
    this.stroke = options.stroke ?? null;
    this.strokeWidth = options.strokeWidth ?? 1;
  }
}

/* -------------------------------------------------------------------------- */
/* TextComponent                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A string drawn on the screen layer at the component's composed transform.
 *
 * The font size inside `font` is a logical unit like every other size a screen
 * component states, so a readout keeps its size on the canvas whatever the
 * camera does.
 */
export class TextComponent extends RenderComponent {
  /** Text draws on the screen layer, in logical units. */
  override readonly space: RenderSpace = "screen";

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

/* -------------------------------------------------------------------------- */
/* DrawComponent                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The direct-drawing path onto the screen layer, for a case that measures the
 * drawing itself.
 *
 * The engine calls {@link draw} in the component's place in the screen pass's
 * layer order, with the context already carrying the viewport transform, so the
 * component draws in logical units from the top-left of the design field. A
 * component drawing against the world reads `api.camera()` and projects world
 * points through the camera's `worldToLogical`. Render modes belong to the
 * declarative pipeline, so a `DrawComponent` reads `api.mode` and supplies its
 * own.
 */
export abstract class DrawComponent extends RenderComponent {
  /** A direct drawing lands on the screen layer, in logical units. */
  override readonly space: RenderSpace = "screen";

  /** Called in the component's place in the screen pass's layer order. */
  abstract draw(api: DrawApi): void;
}

/* -------------------------------------------------------------------------- */
/* CameraComponent                                                            */
/* -------------------------------------------------------------------------- */

/** What a {@link CameraComponent} is constructed with. */
export interface CameraComponentOptions {
  /** The vertical field of view in degrees the camera takes. Defaults to `60`. */
  fov?: number;
}

/**
 * Marks its actor as a view target.
 *
 * The world's camera follows the first enabled `CameraComponent` its target
 * holds, at that component's world position and rotation and its `fov`, and
 * then clamps the result to `camera.bounds`. Because the component's `offset` is
 * composed with the actor's transform, a chase camera is an offset behind and
 * above the pawn rather than a second actor: it rides the pawn's frame and
 * turns with it.
 *
 * A plain component rather than a render one — it draws nothing, it decides
 * where the drawing is seen from.
 */
export class CameraComponent extends Component {
  /**
   * The vertical field of view, in degrees, the camera takes while following.
   * Degrees rather than the radians every other angle in the engine is stated
   * in, because that is what three's `PerspectiveCamera` takes and what a
   * lens is spoken of in.
   */
  fov: number;

  constructor(options?: CameraComponentOptions) {
    super();
    // The camera's own default `fov` is `60`; a view target that states none
    // keeps the projection at that angle.
    this.fov = options?.fov ?? 60;
  }
}

/* -------------------------------------------------------------------------- */
/* Internal wiring                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Internal: the clone a {@link ModelComponent} made of its model, for the
 * pipeline to place in the scene.
 *
 * The clone is the component's, made once at construction and never replaced,
 * so the pipeline adds it on the frame the component first appears and removes
 * it when the component leaves. A game reaches its contents by name through
 * {@link ModelComponent.node} rather than through the tree, which is what keeps
 * a build from re-parenting what the pipeline is placing.
 */
export function modelObject(component: ModelComponent): THREE.Group {
  return modelInternals(component).root;
}

/**
 * Internal: advance a {@link ModelComponent}'s animation mixer by `dt` seconds.
 *
 * Called from the pipeline's sync step, with the world's delta, after every
 * tick has run — so a clip's pose for the frame is written over whatever a tick
 * wrote to the nodes that clip animates, a paused world advances none, and a
 * scripted clock steps every animation exactly as it steps the simulation.
 */
export function advanceModelAnimation(
  component: ModelComponent,
  dt: number,
): void {
  modelInternals(component).mixer.update(dt);
}
