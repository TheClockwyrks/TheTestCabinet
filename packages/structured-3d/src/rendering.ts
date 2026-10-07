/**
 * The rendering pipeline: the engine owns drawing.
 *
 * A game states what should be on screen by attaching render components to its
 * actors, and this module collects them, orders them, and draws them once per
 * frame in two passes over one canvas — a `THREE.Scene` rendered through the
 * camera, and an engine-owned 2D canvas, the *screen layer*, composited over it.
 * A build writes simulation; the picture is engine code.
 *
 * The per-frame sequence is fixed and is the contract this module implements.
 * Numbered as the [rendering](../../../apps/docs/src/content/docs/engines/structured-3d/apis/rendering.md)
 * page numbers it:
 *
 * 1. The camera is updated — a world following a view target takes that
 *    target's world position, rotation, and `fov`, then the result is clamped
 *    to `camera.bounds`. ({@link RenderPipeline.syncScene}, delegated to
 *    `camera.ts`, which owns the rule.)
 * 2. Each enabled, visible `world` component's object is synced: rebuilt if its
 *    declaration changed, placed at the component's world transform, visibility
 *    and opacity applied, a billboard turned to the camera, a model's mixer
 *    advanced by the world's delta. ({@link RenderPipeline.syncScene})
 * 3. The canvas is cleared to `background`, or to transparency when none was
 *    given; the letterboxed viewport and scissor are applied; the scene is
 *    rendered through the camera under the mode.
 *    ({@link RenderPipeline.renderWorld})
 * 4. The collision overlay draws, when it is enabled. (same call)
 * 5. The screen layer is cleared and given the viewport transform, and its
 *    image smoothing is set from `imageSmoothing`. Every enabled, visible
 *    `screen` component draws in `layer` order, and within a layer by the
 *    owning actor's spawn order, and within an actor by attachment order.
 *    ({@link RenderPipeline.renderScreen})
 * 6. The recorder captures the frame, when it is armed. (the engine's)
 * 7. The debug overlay draws on the screen layer in device space. (the
 *    diagnostics module's, onto {@link RenderPipeline.screen})
 * 8. The screen layer is composited over the picture.
 *    ({@link RenderPipeline.composite})
 *
 * Six decisions are worth stating once, because every method below assumes
 * them:
 *
 * 1. **The module owns no loop.** Steps 3 to 5 and step 8 are four separate
 *    calls precisely because the engine has work to do *between* them: the
 *    recorder captures after the screen pass and before the composite, and the
 *    diagnostics overlay draws between those two. A loop hidden in here would
 *    be a second place to look for an order that is a fact about the engine.
 * 2. **The renderer is built over a context the engine obtained itself.** The
 *    `webgl2` context is asked for with `antialias` and `alpha` on and handed to
 *    three, rather than letting three create one, so a canvas that cannot give
 *    one is refused by the constructor — naming the canvas — instead of failing
 *    somewhere inside three with a message about a build the author did not
 *    write. Every construction refusal is raised in the order
 *    [the errors table](../../../apps/docs/src/content/docs/engines/structured-3d/apis/engine.md)
 *    lists them, and no renderer is built for an engine that will not be
 *    returned.
 * 3. **`autoClear` is off and every clear is explicit.** The whole canvas is
 *    cleared to `background` *before* the scissor is applied, which is what
 *    makes the letterbox bars carry the background color; the scissor then
 *    confines the scene to the letterboxed rectangle. Leaving `autoClear` on
 *    would also mean the collision overlay and the composite each wiped the
 *    picture they exist to draw over.
 * 4. **The scene is retained and assignment is the change signal.** The object
 *    built for a component on one frame is the object placed on the next;
 *    placement, visibility, and opacity are read fresh, and the object is
 *    rebuilt only when the component's `geometry`, `material`, or `light` field
 *    has been *assigned* — which `components.ts` counts for us as a
 *    {@link declarationRevision}. So a per-frame tween costs one rebuild per
 *    assignment rather than one per frame, and the declaration on the component
 *    and the object in the scene agree at every frame boundary, which is what
 *    lets a check read either one.
 * 5. **The modes substitute materials at draw time.** Everything in the scene is
 *    a three object with a material — an `Object3DComponent`'s subtree and a
 *    loaded model's meshes included — so the world pass swaps each one for the
 *    mode's stand-in, renders, and swaps it back inside a single `renderWorld`
 *    call. That is what makes wireframe, unlit, and normals reach the *direct*
 *    path with nothing for a build to implement, which `scene.overrideMaterial`
 *    could not do for `unlit`: unlit is a different material per object, since
 *    it keeps each one's own base color and map.
 * 6. **The pipeline never reads a pixel and never keeps one.** The whole
 *    picture is a function of the world and the camera at the moment the frame
 *    runs, which is what lets a validator read a screen-layer pixel back and
 *    assert on it, and what lets two runs of one scenario produce the same
 *    recording.
 *
 * What is *not* here: the frame loop, the recorder, the diagnostics overlay,
 * and the camera's follow rule. The first three are the engine's and the last
 * is `camera.ts`'s, and each is called out at the step it belongs to above.
 */

import * as THREE from "three";
import {
  applyRendererViewport,
  applyViewport,
  cameraObject,
  syncScreenCanvas,
  updateCamera,
} from "./camera";
import { ColliderComponent } from "./collision";
import {
  advanceModelAnimation,
  declarationRevision,
  DrawComponent,
  LightComponent,
  MeshComponent,
  modelObject,
  ModelComponent,
  Object3DComponent,
  RenderComponent,
  ShapeComponent,
  SpriteComponent,
  TextComponent,
} from "./components";
import type {
  CameraSnapshot,
  ColliderShape,
  CollisionResponse,
  DrawApi,
  FrameInfo,
  LightSpec,
  MaterialSpec,
  MeshGeometry,
  Quat,
  RenderMode,
  Renderer,
  Shape2D,
  Transform,
  Vec3,
  Viewport,
} from "./contract";
import { quatToEuler } from "./math";
import type { World } from "./worlds";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The stroke width every screen-layer wireframe outline draws at, in logical
 * units.
 *
 * One width for the whole mode — that is what "each component's outline alone,
 * at one stroke width" means — so wireframe shows the geometry a build placed
 * rather than restating each component's own styling decisions.
 */
const WIREFRAME_WIDTH = 1;

/** The color wireframe draws in, on the screen layer and in the world pass. */
const WIREFRAME_COLOR = "#ffffff";

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
const OVERLAY_COLORS: Record<CollisionResponse, number> = {
  block: 0xff5566,
  overlap: 0xffd166,
  ignore: 0x7f8c9b,
};

/**
 * The subdivision counts the round primitives are built at when a spec states
 * none.
 *
 * `MeshGeometry` gives `sphere` and `cylinder` a `segments` field defaulting to
 * `24` and gives `capsule` none at all, so a capsule is built at the same
 * radial count as a sphere of the same radius — the two read as one family
 * beside each other, which is the whole reason the default is stated rather
 * than left to three's (which is `4` cap segments, visibly a bead).
 */
const SEGMENTS = 24;

/** Half as many rings around a cap as there are segments around its axis. */
const CAP_SEGMENTS = 12;

/* -------------------------------------------------------------------------- */
/* Options and counts                                                         */
/* -------------------------------------------------------------------------- */

/**
 * What {@link RenderPipeline} needs out of `EngineOptions`.
 *
 * Named field for field as the engine's own options are, so the engine hands
 * its options object straight over rather than copying seven fields into a
 * shape that would then have to be kept in step with them.
 */
export interface RenderPipelineOptions {
  /** The stage canvas the scene is rendered through and the composite lands on. */
  canvas: HTMLCanvasElement;
  /** The logical design width, and the numerator of the camera's aspect. */
  width: number;
  /** The logical design height, and the denominator of the camera's aspect. */
  height: number;
  /**
   * A CSS color the whole canvas is cleared to before every frame, letterbox
   * bars included. Absent, the canvas is cleared to transparency.
   */
  background?: string;
  /**
   * Whether an image the fit scales on the screen layer is resampled
   * bilinearly. `false` samples nearest-neighbor. Defaults to `true`.
   */
  imageSmoothing?: boolean;
  /**
   * The canvas the screen layer draws on. Absent, one is created from the stage
   * canvas's owning document. Supplying it is what lets a validator read the
   * HUD's pixels back, or substitute its own object for the 2D context.
   */
  screen?: HTMLCanvasElement;
  /** `true` enables the renderer's shadow maps with PCF soft filtering. */
  shadows?: boolean;
}

/** The scene render's cost for one frame, as the frame metrics report it. */
export interface RenderCounts {
  /** The draw calls the renderer issued for the most recent scene render. */
  readonly drawCalls: number;
  /** The triangles the renderer drew in the most recent scene render. */
  readonly triangles: number;
}

/* -------------------------------------------------------------------------- */
/* Construction refusals                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The logical design size, or a refusal naming it.
 *
 * First of the render-side refusals because it is first in the errors table,
 * and because everything after it — the camera's aspect, the letterboxed
 * rectangle, every logical coordinate a `screen` component states — is
 * arithmetic over these two numbers. A `0`, a negative, or a `NaN` would not
 * fail; it would draw a frame that is empty in a way nothing points back here.
 */
function checkDesignSize(width: number, height: number): void {
  const bad =
    !Number.isFinite(width) || width <= 0
      ? { name: "width", value: width }
      : !Number.isFinite(height) || height <= 0
        ? { name: "height", value: height }
        : null;
  if (bad !== null) {
    throw new Error(
      `createEngine needs a finite, positive ${bad.name}; it was given ${String(
        bad.value,
      )}. The logical design size is what the camera projects into and what every screen-space coordinate is measured in`,
    );
  }
}

/**
 * The `webgl2` context, or a refusal naming the canvas.
 *
 * Asked for rather than left to three so the refusal is the engine's: a canvas
 * that already carries a `2d` context, a canvas in a document with no GL
 * implementation behind it, and a canvas whose context was lost all fail here,
 * at construction, where the mistake is, instead of at the first frame.
 *
 * The attributes are the two the renderer is documented to run with.
 * `antialias` has to be asked for at context creation — it is a property of the
 * drawing buffer, not a renderer setting — and `alpha` is what lets a stage
 * with no `background` clear to transparency and show the page behind it.
 */
function stageContext(canvas: HTMLCanvasElement): WebGL2RenderingContext {
  const gl = canvas.getContext("webgl2", {
    antialias: true,
    alpha: true,
  }) as WebGL2RenderingContext | null;
  if (gl === null) {
    throw new Error(
      "createEngine could not get a webgl2 context from the canvas; the engine renders the world pass through it",
    );
  }
  return gl;
}

/**
 * The canvas the screen layer draws on: the one supplied, or one made from the
 * stage canvas's own document.
 *
 * The stage canvas's document rather than the ambient one, for the same reason
 * the default surface reads its ratio from the canvas's own window: a game
 * rendered inside an iframe has its canvases in that document, and a canvas
 * made from the outer one would be a foreign node in every operation that
 * touches both.
 *
 * A stage canvas with no document behind it is refused, naming the option that
 * would have supplied the canvas instead, because the alternative is an engine
 * that runs and draws no HUD at all.
 */
function screenCanvasFor(
  canvas: HTMLCanvasElement,
  supplied: HTMLCanvasElement | undefined,
): HTMLCanvasElement {
  if (supplied !== undefined) return supplied;

  const owner: Document | null = canvas.ownerDocument ?? null;
  if (owner === null || typeof owner.createElement !== "function") {
    throw new Error(
      "createEngine needs a screen canvas: the stage canvas has no owning document to create one from, so pass one as `screen`",
    );
  }
  return owner.createElement("canvas");
}

/**
 * The screen layer's 2D context, exactly as the screen canvas returned it.
 *
 * Passed through rather than wrapped, which is the whole of the substitution
 * seam a validator uses: a suite that wants the drawing *operations* rather
 * than the pixels overrides `getContext` on the canvas it supplies as `screen`,
 * and whatever that returns is the object every `screen` component, every
 * `DrawComponent`, and the diagnostics overlay draw through.
 *
 * A canvas that yields nothing is refused here. The engine would otherwise hand
 * `null` to a `draw` whose parameter is typed as a context, and the first HUD
 * draw of the first frame would fail somewhere in the game's own code.
 */
function screenContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (ctx === null) {
    throw new Error(
      "createEngine could not get a 2D context from the screen canvas; the screen layer is drawn through it",
    );
  }
  return ctx;
}

/* -------------------------------------------------------------------------- */
/* Building three objects from declarations                                   */
/* -------------------------------------------------------------------------- */

/**
 * One of the built-in geometries, at the dimensions the spec states.
 *
 * `custom` hands back the game's own `THREE.BufferGeometry` unchanged, which is
 * why {@link Placed} records whether the geometry is the pipeline's to dispose:
 * everything else here is built and owned, and that one is borrowed.
 */
function buildGeometry(spec: MeshGeometry): THREE.BufferGeometry {
  switch (spec.kind) {
    case "box":
      return new THREE.BoxGeometry(spec.width, spec.height, spec.depth);
    case "sphere": {
      const segments = spec.segments ?? SEGMENTS;
      return new THREE.SphereGeometry(spec.radius, segments, segments);
    }
    case "cylinder":
      return new THREE.CylinderGeometry(
        spec.radiusTop,
        spec.radiusBottom,
        spec.height,
        spec.segments ?? SEGMENTS,
      );
    case "capsule":
      return new THREE.CapsuleGeometry(
        spec.radius,
        spec.height,
        CAP_SEGMENTS,
        SEGMENTS,
      );
    case "plane":
      return new THREE.PlaneGeometry(spec.width, spec.height);
    case "custom":
      return spec.geometry;
  }
}

/** Which faces a spec's `side` draws, as three names them. */
function materialSide(side: MaterialSpec["side"]): THREE.Side {
  if (side === "back") return THREE.BackSide;
  if (side === "double") return THREE.DoubleSide;
  return THREE.FrontSide;
}

/**
 * The three material a spec declares, with every documented default applied
 * here rather than at the component.
 *
 * The component holds the spec exactly as the game handed it over — an absent
 * field means "the default", not "nothing" — so this is the one place the
 * defaults are written, and a spec naming one field changes only that field.
 *
 * `opacity` is the spec's alone. The component's own `opacity` multiplies it
 * every frame, in {@link applyOpacity}, because it is read fresh rather than
 * assigned, and folding it in here would need a rebuild for every fade.
 */
function buildMaterial(spec: MaterialSpec): THREE.Material {
  const color = new THREE.Color(spec.color ?? "#ffffff");
  const opacity = spec.opacity ?? 1;
  const shared = {
    color,
    map: spec.map ?? null,
    opacity,
    transparent: opacity < 1,
    wireframe: spec.wireframe ?? false,
    side: materialSide(spec.side),
  };

  switch (spec.kind ?? "standard") {
    case "basic":
      // No emissive and no shading model, so the two fields a `basic` material
      // has no answer for are simply not passed rather than passed and ignored.
      return new THREE.MeshBasicMaterial(shared);
    case "lambert":
      return new THREE.MeshLambertMaterial({
        ...shared,
        emissive: new THREE.Color(spec.emissive ?? "#000000"),
        flatShading: spec.flatShading ?? false,
      });
    default:
      return new THREE.MeshStandardMaterial({
        ...shared,
        emissive: new THREE.Color(spec.emissive ?? "#000000"),
        metalness: spec.metalness ?? 0,
        roughness: spec.roughness ?? 1,
        flatShading: spec.flatShading ?? false,
      });
  }
}

/**
 * The three light a spec declares, aimed by its own transform.
 *
 * A directional and a spot light shine from their position toward a target
 * object, so each is given one parented to the light itself and sitting one
 * unit along the light's local `-Z`. `FORWARD` *is* local `-Z`, so the target's
 * world position is the component's world position plus `FORWARD` rotated by
 * its world rotation, which is the documented aim, and it follows the light for
 * free rather than needing a second placement every frame.
 */
function buildLight(spec: LightSpec): THREE.Light {
  const intensity = spec.intensity ?? 1;
  switch (spec.kind) {
    case "ambient":
      return new THREE.AmbientLight(spec.color ?? "#ffffff", intensity);
    case "hemisphere":
      return new THREE.HemisphereLight(
        spec.sky ?? "#ffffff",
        spec.ground ?? "#444444",
        intensity,
      );
    case "point":
      return new THREE.PointLight(
        spec.color ?? "#ffffff",
        intensity,
        spec.distance ?? 0,
        spec.decay ?? 2,
      );
    case "directional": {
      const light = new THREE.DirectionalLight(
        spec.color ?? "#ffffff",
        intensity,
      );
      aimLight(light, spec.castShadow ?? false);
      return light;
    }
    case "spot": {
      const light = new THREE.SpotLight(
        spec.color ?? "#ffffff",
        intensity,
        spec.distance ?? 0,
        spec.angle ?? Math.PI / 3,
        spec.penumbra ?? 0,
        spec.decay ?? 2,
      );
      aimLight(light, spec.castShadow ?? false);
      return light;
    }
  }
}

/**
 * Whether a light spec is one the component's world transform places.
 *
 * A point light shines from the component's world position, and a directional
 * or spot light shines from it along the component's world forward axis. An
 * ambient light and a hemisphere light have no position at all, and three reads
 * a `HemisphereLight`'s position as the direction its *sky* color comes from, so
 * writing one would be worse than pointless.
 */
function isPlacedLight(spec: LightSpec): boolean {
  return spec.kind !== "ambient" && spec.kind !== "hemisphere";
}

/** Parent a directional or spot light's target to it, one unit along `FORWARD`. */
function aimLight(
  light: THREE.DirectionalLight | THREE.SpotLight,
  castShadow: boolean,
): void {
  light.target.position.set(0, 0, -1);
  light.add(light.target);
  light.castShadow = castShadow;
}

/* -------------------------------------------------------------------------- */
/* Reading and writing a subtree's materials                                  */
/* -------------------------------------------------------------------------- */

/** Every material one object draws with, single or multi-material alike. */
function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const carrier = object as { material?: THREE.Material | THREE.Material[] };
  const held = carrier.material;
  if (held === undefined) return [];
  return Array.isArray(held) ? held : [held];
}

/**
 * What a material's own alpha is, beside the product the pipeline last wrote
 * over it.
 *
 * A component's `opacity` multiplies its material's, and the material may be
 * one the *game* built — inside an `Object3DComponent`'s subtree, or on a
 * loaded model's mesh. Multiplying in place every frame would compound; writing
 * the product of a remembered base and this frame's factor does not, and
 * restores the declaration exactly when the factor returns to `1`.
 *
 * The base cannot be latched at the first write, though, because the subtree an
 * `Object3DComponent` owns is documented to be mutated directly and a fade
 * written straight onto its material has nothing to announce it. So the product
 * is remembered alongside the base: a material whose alpha still reads as that
 * product is one only the pipeline has touched, and a material that reads as
 * anything else has been written by the game, whose value becomes the new base.
 * A factor of `1` is then the identity it is documented to be.
 */
const declaredAlpha = new WeakMap<
  THREE.Material,
  {
    opacity: number;
    transparent: boolean;
    wroteOpacity: number;
    wroteTransparent: boolean;
  }
>();

/** Opacity as the pipeline applies it: clamped to `0..1` at the draw. */
function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1;
  return Math.min(Math.max(opacity, 0), 1);
}

/**
 * Multiply every material under `root` by `factor`, and mark an object below
 * full opacity for the transparent pass.
 *
 * Idempotent by construction — see {@link declaredAlpha} — so it runs on every
 * frame for every world component with no accumulation and no branch on whether
 * the component was faded last frame.
 */
function applyOpacity(root: THREE.Object3D, factor: number): void {
  root.traverse((object) => {
    for (const material of materialsOf(object)) {
      let base = declaredAlpha.get(material);
      if (base === undefined) {
        base = {
          opacity: material.opacity,
          transparent: material.transparent,
          wroteOpacity: material.opacity,
          wroteTransparent: material.transparent,
        };
        declaredAlpha.set(material, base);
      }
      // Anything but the product last written here came from the game, and the
      // game's value is the material's own alpha from now on.
      if (material.opacity !== base.wroteOpacity) {
        base.opacity = material.opacity;
      }
      if (material.transparent !== base.wroteTransparent) {
        base.transparent = material.transparent;
      }
      const opacity = base.opacity * factor;
      const transparent = base.transparent || opacity < 1;
      material.opacity = opacity;
      material.transparent = transparent;
      base.wroteOpacity = opacity;
      base.wroteTransparent = transparent;
    }
  });
}

/** Set `castShadow` and `receiveShadow` on every mesh under `root`. */
function applyShadows(
  root: THREE.Object3D,
  castShadow: boolean,
  receiveShadow: boolean,
): void {
  root.traverse((object) => {
    if (!(object as { isMesh?: boolean }).isMesh) return;
    object.castShadow = castShadow;
    object.receiveShadow = receiveShadow;
  });
}

/* -------------------------------------------------------------------------- */
/* The render modes, as a material substitution                               */
/* -------------------------------------------------------------------------- */

/**
 * The world pass's render modes, applied by swapping each object's material for
 * the mode's stand-in and swapping it back when the frame's scene render is
 * done.
 *
 * A substitution rather than `scene.overrideMaterial` because `unlit` is not
 * one material: it is *each* object's own base color and map, at full opacity,
 * with the lights taken out. Wireframe and normals could have used the override
 * and do not, so that all three modes go through one mechanism and a fourth
 * would too.
 *
 * `wireframe` and `normals` reach meshes alone — a point cloud has no edges to
 * draw and no surface to face, and a `Points` drawn with a mesh material is a
 * shader that does not compile. `unlit` reaches everything, because every
 * material has a base color and an opacity, and the point-and-line materials
 * are already unlit and so need only their opacity restored.
 *
 * The stand-ins are cached rather than rebuilt: one wireframe material and one
 * normal material for the whole engine, and one unlit material per source
 * material, so a mode is a swap of references on the objects and no allocation
 * after the first frame in it.
 */
/**
 * The stand-in `normals` draws every surface with: its **world**-space normal,
 * mapped into a color.
 *
 * Three's own `MeshNormalMaterial` colors by the *view*-space normal, which
 * repaints a wall that never moved the moment the camera turns — the one thing
 * the mode exists to rule out, since a surface's facing is a property of the
 * surface and not of where it is looked at from. The fragment shader is
 * therefore patched at compile time to take the interpolated normal back out of
 * view space before packing it: `viewMatrix` maps world to view, and
 * `vec4(n, 0.0) * viewMatrix` is `transpose(viewMatrix) * n`, which for a matrix
 * whose upper 3x3 is a rotation is the inverse rotation and so the world normal.
 *
 * The cache key is overridden alongside it, because three keys compiled
 * programs by the shader source it *thinks* a material has: without a key of its
 * own, this material and a plain `MeshNormalMaterial` would share one program
 * and whichever compiled first would win.
 */
function worldNormalMaterial(): THREE.MeshNormalMaterial {
  const material = new THREE.MeshNormalMaterial();
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );",
      "gl_FragColor = vec4( normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz ) * 0.5 + 0.5, diffuseColor.a );",
    );
  };
  material.customProgramCacheKey = () => "structured-3d:world-normals";
  return material;
}

/** The texture a material samples, for the materials that have one at all. */
function mapOf(material: THREE.Material): THREE.Texture | null {
  return (material as { map?: THREE.Texture | null }).map ?? null;
}

class ModeSubstitution {
  /** Every mesh as its edges in one flat color, lights ignored. */
  private readonly wireframe = new THREE.MeshBasicMaterial({
    color: WIREFRAME_COLOR,
    wireframe: true,
  });

  /** Every surface colored by its world-space normal, lights ignored. */
  private readonly normals = worldNormalMaterial();

  /** The unlit stand-in for one source material, kept and re-read each frame. */
  private readonly unlit = new WeakMap<THREE.Material, THREE.Material>();

  /** The stand-ins this object built, for disposal; the two above are separate. */
  private readonly built: THREE.Material[] = [];

  /** What was on each object before the swap, in the order it was swapped. */
  private readonly swapped: {
    object: { material: THREE.Material | THREE.Material[] };
    material: THREE.Material | THREE.Material[];
  }[] = [];

  /**
   * Swap every material in `scene` for the mode's stand-in.
   *
   * `shaded` swaps nothing, which is why the common case costs not even a
   * traversal. Every other mode leaves the scene in a state {@link restore}
   * must undo before anything reads the scene back, so the two are called as a
   * pair around one `renderer.render`.
   */
  apply(scene: THREE.Scene, mode: RenderMode): void {
    if (mode === "shaded") return;
    scene.traverse((object) => {
      const carrier = object as {
        material?: THREE.Material | THREE.Material[];
        isMesh?: boolean;
      };
      const held = carrier.material;
      if (held === undefined) return;
      const mesh = carrier.isMesh === true;

      const next = Array.isArray(held)
        ? held.map((material) => this.standIn(material, mode, mesh))
        : this.standIn(held, mode, mesh);
      // A mode that has nothing to say about this object — a point cloud under
      // wireframe — leaves it exactly as it was, and is not recorded, so
      // `restore` writes back only what it really changed.
      if (next === held) return;

      this.swapped.push({
        object: carrier as { material: THREE.Material | THREE.Material[] },
        material: held,
      });
      carrier.material = next;
    });
  }

  /** Put every swapped material back, newest first. */
  restore(): void {
    for (let at = this.swapped.length - 1; at >= 0; at -= 1) {
      const entry = this.swapped[at];
      if (entry !== undefined) entry.object.material = entry.material;
    }
    this.swapped.length = 0;
  }

  /** The stand-in one material takes under one mode, or the material itself. */
  private standIn(
    material: THREE.Material,
    mode: RenderMode,
    mesh: boolean,
  ): THREE.Material {
    if (mode === "wireframe") return mesh ? this.wireframe : material;
    if (mode === "normals") return mesh ? this.normals : material;
    if (mode !== "unlit") return material;

    const held = this.unlit.get(material);
    if (held !== undefined) {
      // The mode is a substitution over what the material *is* this frame, not
      // over what it was the first frame the mode was in force. A `MeshComponent`
      // announces a new material by a declaration revision and the pipeline
      // hands over a new object, but the subtree an `Object3DComponent` or a
      // `ModelComponent` owns is documented to be mutated in place, and a tint
      // written there has no revision to announce it. So the stand-in is kept
      // for its compiled program and its fields are read off the source again.
      this.syncUnlit(held, material, mesh);
      return held;
    }
    const made = this.buildUnlit(material, mesh);
    this.unlit.set(material, made);
    this.built.push(made);
    return made;
  }

  /**
   * One material's base color and map, at full opacity, with no lighting.
   *
   * A mesh material becomes a `MeshBasicMaterial` carrying the two fields the
   * mode is defined by, plus the side and the wireframe flag, because those say
   * *which* surface is drawn rather than how it is lit. Anything else — a
   * point, a line, a sprite material — is already unlit, so it is cloned with
   * its alpha restored and nothing else touched.
   */
  private buildUnlit(material: THREE.Material, mesh: boolean): THREE.Material {
    const made = mesh ? new THREE.MeshBasicMaterial() : material.clone();
    this.syncUnlit(made, material, mesh);
    return made;
  }

  /**
   * Bring one stand-in back into agreement with the material it stands in for.
   *
   * The mesh path writes the four fields {@link buildUnlit} is defined by; the
   * other path re-runs the copy a `clone` is built out of, which is how a
   * sprite's or a line's own fields — its map, its color, its size — follow a
   * change the game made after the stand-in was first built. A program is
   * recompiled only when the map's presence flips, because that is the one
   * change among these that three keys a shader program by; the rest are state
   * the renderer reads per draw.
   */
  private syncUnlit(
    target: THREE.Material,
    material: THREE.Material,
    mesh: boolean,
  ): void {
    const had = mapOf(target) !== null;
    if (mesh) {
      const source = material as {
        color?: THREE.Color;
        map?: THREE.Texture | null;
        side?: THREE.Side;
        wireframe?: boolean;
      };
      const basic = target as THREE.MeshBasicMaterial;
      if (source.color === undefined) basic.color.setHex(0xffffff);
      else basic.color.copy(source.color);
      basic.map = source.map ?? null;
      basic.side = source.side ?? THREE.FrontSide;
      basic.wireframe = source.wireframe ?? false;
    } else {
      target.copy(material);
    }
    target.opacity = 1;
    target.transparent = false;
    if (had !== (mapOf(target) !== null)) target.needsUpdate = true;
  }

  /** Dispose every stand-in this object owns. Nothing here is the game's. */
  dispose(): void {
    this.restore();
    this.wireframe.dispose();
    this.normals.dispose();
    for (const material of this.built.splice(0)) material.dispose();
  }
}

/* -------------------------------------------------------------------------- */
/* Collider shapes, for the overlay                                           */
/* -------------------------------------------------------------------------- */

/**
 * A collider's shape carried through a transform's scale, by the same rules the
 * collision module applies when it tests the pair.
 *
 * A box's extents scale per axis; a sphere's and a capsule's radius by the
 * largest of the three factors, because a rounded shape under a non-uniform
 * scale would be an ellipsoid and the enclosing round shape stands in; a
 * capsule's `height` by the `Y` factor. The overlay exists to show *what the
 * engine tests*, so restating those rules here — rather than drawing the
 * declared shape under the object's own scale — is the whole point of it.
 */
function scaledShape(shape: ColliderShape, scale: Vec3): ColliderShape {
  const sx = Math.abs(scale.x);
  const sy = Math.abs(scale.y);
  const sz = Math.abs(scale.z);
  const largest = Math.max(sx, sy, sz);
  switch (shape.kind) {
    case "box":
      return {
        kind: "box",
        width: Math.abs(shape.width) * sx,
        height: Math.abs(shape.height) * sy,
        depth: Math.abs(shape.depth) * sz,
      };
    case "sphere":
      return { kind: "sphere", radius: Math.abs(shape.radius) * largest };
    case "capsule":
      return {
        kind: "capsule",
        radius: Math.abs(shape.radius) * largest,
        height: Math.abs(shape.height) * sy,
      };
  }
}

/** The wireframe geometry one placed collider shape draws as. */
function colliderGeometry(shape: ColliderShape): THREE.BufferGeometry {
  switch (shape.kind) {
    case "box":
      return new THREE.BoxGeometry(shape.width, shape.height, shape.depth);
    case "sphere":
      return new THREE.SphereGeometry(shape.radius, SEGMENTS, CAP_SEGMENTS);
    case "capsule":
      return new THREE.CapsuleGeometry(
        shape.radius,
        shape.height,
        CAP_SEGMENTS,
        SEGMENTS,
      );
  }
}

/**
 * A placed shape's dimensions as one string, so the overlay rebuilds a geometry
 * only when the numbers change.
 *
 * A collider's `shape` is held by reference and a game may write into it, so
 * there is no assignment to watch the way there is for a mesh's declaration.
 * Comparing the numbers is the honest alternative, and it costs one short
 * string per drawn collider per frame against a geometry allocation per
 * collider per frame.
 */
function shapeSignature(shape: ColliderShape): string {
  switch (shape.kind) {
    case "box":
      return `box:${shape.width}:${shape.height}:${shape.depth}`;
    case "sphere":
      return `sphere:${shape.radius}`;
    case "capsule":
      return `capsule:${shape.radius}:${shape.height}`;
  }
}

/** The strongest answer a collider declares, for the overlay's color. */
function strongestResponse(collider: ColliderComponent): CollisionResponse {
  let strongest: CollisionResponse = "ignore";
  for (const response of Object.values(collider.responses)) {
    if (response === "block") return "block";
    if (response === "overlap") strongest = "overlap";
  }
  return strongest;
}

/* -------------------------------------------------------------------------- */
/* What the pipeline holds for one component                                  */
/* -------------------------------------------------------------------------- */

/** The three object one `world` component has in the scene, and what it cost. */
interface Placed {
  /** The object in the scene: built here, or the game's own, handed over. */
  readonly object: THREE.Object3D;
  /**
   * The declaration revision the object was built at. When
   * {@link declarationRevision} moves past it the object is rebuilt, which is
   * the whole of "assignment is the change signal".
   */
  revision: number;
  /**
   * What the pipeline allocated for this object and must release with it.
   *
   * Empty for a `ModelComponent`'s clone and an `Object3DComponent`'s subtree,
   * and for a mesh built from a `custom` geometry it holds the material alone:
   * those are the game's, and disposing them would take a geometry the game is
   * still drawing with elsewhere.
   */
  readonly owned: readonly { dispose(): void }[];
}

/** One collected `screen` component, with its collection position as tiebreak. */
interface Collected {
  component: RenderComponent;
  /** Position in spawn-then-attachment order, which the layer sort preserves. */
  order: number;
}

/** The wireframe box, sphere, or capsule the overlay draws for one collider. */
interface OverlayShape {
  readonly mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  /** The placed dimensions the geometry was built at. */
  signature: string;
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The engine's implementation of `Renderer`: the two switches reached as
 * `engine.renderer`, the surfaces a frame is drawn onto, and the frame's
 * render-side steps as separate calls the engine's loop sequences.
 *
 * Internal: the engine constructs one, at construction, and keeps it for its
 * whole life. It survives every level transition — the mode, the overlay
 * switch, the two canvases, and the renderer are engine state rather than world
 * state, which is what lets a recording span a transition as one continuous
 * picture — and the objects it holds for a closed world's components are swept
 * on the first sync of the world that replaced it.
 */
export class RenderPipeline implements Renderer {
  /** The renderer, for the counts and the disposal the engine reports and performs. */
  readonly renderer: THREE.WebGLRenderer;

  /** The retained scene the pipeline populates and the world pass draws. */
  readonly scene = new THREE.Scene();

  /** The canvas the screen layer draws on, for a validator reading its pixels. */
  readonly screenCanvas: HTMLCanvasElement;

  /** The screen layer's 2D context, exactly as the screen canvas returned it. */
  readonly screen: CanvasRenderingContext2D;

  /** The stage canvas, the surface both passes end up on. */
  private readonly canvas: HTMLCanvasElement;

  /** The logical design size, the camera's aspect and the screen pass's units. */
  private readonly width: number;
  private readonly height: number;

  /** Whether an image the fit scales is resampled bilinearly. */
  private readonly imageSmoothing: boolean;

  /**
   * The clear, parsed once. `background` is a CSS color a build writes
   * literally, and re-parsing it sixty times a second would buy nothing; the
   * alpha is the whole of the difference between "cleared to a color" and
   * "cleared to transparency".
   */
  private readonly clearColor: THREE.Color;
  private readonly clearAlpha: number;

  /** The mode in force. */
  private renderMode: RenderMode = "shaded";

  /** Whether the collision overlay draws. */
  private overlayEnabled = false;

  /** The mode's material swap, applied around the scene render and undone after. */
  private readonly substitution = new ModeSubstitution();

  /** The three object each live `world` component has in the scene. */
  private readonly placed = new Map<RenderComponent, Placed>();

  /**
   * The overlay's own scene, so the mode substitution — which walks
   * {@link scene} — cannot reach it, and so the overlay's wireframes never
   * appear in the scene a validator reads for what the game placed.
   */
  private readonly overlayScene = new THREE.Scene();

  /** The wireframe the overlay draws for each collider it has seen. */
  private readonly overlayShapes = new Map<ColliderComponent, OverlayShape>();

  /** One depth-test-free wireframe material per response, built once. */
  private readonly overlayMaterials: Record<
    CollisionResponse,
    THREE.MeshBasicMaterial
  >;

  /**
   * The texture the screen layer is composited from.
   *
   * Exposed because it is the only observable proof that the layer is
   * re-uploaded every frame — its `version` advances with each
   * {@link composite} — and a composite that stopped asking for the upload
   * would otherwise freeze the HUD at whatever the first frame drew without
   * failing anything.
   */
  readonly screenTexture: THREE.CanvasTexture;

  /** The quad the layer is composited from, and what draws it. */
  private readonly compositeGeometry: THREE.PlaneGeometry;
  private readonly compositeMaterial: THREE.MeshBasicMaterial;
  private readonly compositeScene = new THREE.Scene();
  private readonly compositeCamera = new THREE.OrthographicCamera(
    -1,
    1,
    1,
    -1,
    0,
    1,
  );

  /** The scene render's counts, held across the passes that would reset them. */
  private drawCalls = 0;
  private triangles = 0;

  /** Teardown races, so {@link dispose} is idempotent. */
  private disposed = false;

  /**
   * The context sprites are tinted through: absent until asked for, `null` once
   * asked for and unavailable.
   *
   * A tint flattens the sprite's pixels to the tint color while keeping its
   * alpha, which needs a `source-atop` composite on a surface of the sprite's
   * own — compositing on the screen layer would tint everything already drawn
   * on it. A host with no second canvas draws the sprite untinted rather than
   * not at all.
   */
  private tintScratch: CanvasRenderingContext2D | null | undefined;

  /**
   * Build the renderer, the scene, the screen layer, and the composite over one
   * canvas.
   *
   * Every construction failure the rendering side of `createEngine` can have is
   * raised here, and in the order the errors table states them — the design
   * size, then the canvas, then the layer drawn over it — so a build with two
   * mistakes in it is told about the one the others are measured or drawn
   * against first. No renderer is constructed for an engine that will not be
   * returned.
   *
   * There is no projection to refuse: unlike the Simple family, a Structured 3D
   * engine takes none as an option. The projection belongs to the world's
   * camera, is typed as the pair, and changes as the game writes it.
   */
  constructor(options: RenderPipelineOptions) {
    const { canvas, width, height } = options;

    checkDesignSize(width, height);
    const gl = stageContext(canvas);
    const screenCanvas = screenCanvasFor(canvas, options.screen);
    const screen = screenContext(screenCanvas);

    this.canvas = canvas;
    this.width = width;
    this.height = height;
    this.screenCanvas = screenCanvas;
    this.screen = screen;
    this.imageSmoothing = options.imageSmoothing ?? true;
    this.clearColor = new THREE.Color(options.background ?? "#000000");
    this.clearAlpha = options.background === undefined ? 0 : 1;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: true,
      alpha: true,
    });
    // sRGB output, named explicitly rather than left to three's default: it is
    // what makes a material's color, a cleared background, and the screen
    // layer's own bytes all land on the canvas as the color they were written
    // as, which is what a validator sampling a pixel asserts against.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Every clear in a frame is written by this module, so three must not
    // perform one of its own: see decision 3 in the module header.
    this.renderer.autoClear = false;
    if (options.shadows === true) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.overlayMaterials = {
      block: overlayMaterial(OVERLAY_COLORS.block),
      overlap: overlayMaterial(OVERLAY_COLORS.overlap),
      ignore: overlayMaterial(OVERLAY_COLORS.ignore),
    };

    // The composite pass: the screen layer as a texture on a quad that covers
    // the clip volume exactly. A private scene and a private camera rather than
    // the game's, because this is engine chrome that must not appear in the
    // scene a validator reads, must not be lit, posed, or picked, and must not
    // move when the game's camera does.
    //
    // `depthTest` and `depthWrite` are off because the layer goes over
    // everything by definition, and `premultipliedAlpha` is on because the
    // drawing buffer three asked the browser for is premultiplied: three's
    // normal blending against such a buffer is `ONE, ONE_MINUS_SRC_ALPHA`,
    // which needs the fragment's color already multiplied by its alpha, and the
    // flag is what makes the shader do it.
    this.screenTexture = new THREE.CanvasTexture(screenCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.minFilter = THREE.LinearFilter;
    this.screenTexture.magFilter = THREE.LinearFilter;
    this.screenTexture.generateMipmaps = false;
    this.compositeGeometry = new THREE.PlaneGeometry(2, 2);
    this.compositeMaterial = new THREE.MeshBasicMaterial({
      map: this.screenTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
    });
    this.compositeScene.add(
      new THREE.Mesh(this.compositeGeometry, this.compositeMaterial),
    );

    // Sized here as well as every frame, so a screen canvas the engine created
    // — which starts at the 300x150 every canvas element starts at — matches
    // the stage before the first frame rather than after it.
    this.syncScreen();
  }

  /* ---------------------------------------------------------------------- */
  /* The two switches                                                       */
  /* ---------------------------------------------------------------------- */

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
   * collider's shape as a wireframe in the world pass, in a color per response,
   * after the scene and with depth testing off, and is independent of the mode.
   */
  setCollisionOverlay(enabled: boolean): void {
    this.overlayEnabled = enabled;
  }

  /* ---------------------------------------------------------------------- */
  /* The frame                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * Bring the screen canvas's backing store in line with the stage canvas's, so
   * the composite is a pixel-for-pixel lift with nothing resampled.
   *
   * Called after the stage canvas has been synced to the surface and before the
   * screen layer is cleared, since writing either dimension clears the canvas.
   */
  syncScreen(): void {
    syncScreenCanvas(this.screenCanvas, this.canvas);
  }

  /**
   * Steps 1 and 2: the camera, then every `world` component's object.
   *
   * `dt` is the world's delta in seconds, which a model's mixer is advanced by
   * — so a paused world, whose delta is zero, holds every pose, and a scripted
   * clock steps every animation exactly as it steps the simulation.
   *
   * The scene holds one object per **enabled, visible** `world` component and
   * nothing else. A component that has left the world since the last sync — its
   * actor destroyed, the component detached, the whole world closed — and a
   * component that is merely disabled or hidden both lose their object here,
   * and everything the pipeline allocated for one is disposed. They share a
   * path because they are the same claim: the scene answers what the pipeline
   * *drew*, so a check that hides a component and finds its mesh gone is
   * reading the picture rather than the declaration, which the component itself
   * still carries.
   */
  syncScene(world: World, dt: number): void {
    updateCamera(world.camera);

    const seen = new Set<RenderComponent>();
    for (const actor of world.actors()) {
      if (!actor.alive) continue;
      for (const component of actor.components) {
        if (!(component instanceof RenderComponent)) continue;
        if (component.space === "screen") continue;
        // Read fresh every frame, and before the object is even asked for, so a
        // component leaves the picture the moment either field is cleared.
        if (!component.enabled || !component.visible) continue;
        const placed = this.placedFor(component);
        if (placed === null) continue;
        seen.add(component);
        this.syncOne(component, placed, world, dt);
      }
    }

    for (const [component, placed] of this.placed) {
      if (seen.has(component)) continue;
      this.placed.delete(component);
      this.drop(placed);
    }
  }

  /**
   * Step 3 and step 4: the clear, the letterboxed picture under the mode, and
   * the collision overlay over it.
   *
   * The clear covers the whole canvas, so the scissor from the previous frame
   * has to be off before it: with it on, the bars would keep whatever the frame
   * before them left there. The viewport is left alone on purpose — a clear is
   * bounded by the scissor box and the write masks, and by nothing else.
   */
  renderWorld(world: World, viewport: Viewport): void {
    // The mode is captured once, before the first draw of the pass: the ticks
    // are behind us, so a `setMode` one of them issued is already in force and
    // this frame draws under it, while a `setMode` a `DrawComponent`'s `draw`
    // issues later in this same frame waits for the next one. Either way every
    // draw of this frame agrees with the `api.mode` the screen pass reports.
    const mode = this.renderMode;
    const camera = cameraObject(world.camera, this.width, this.height);

    this.renderer.setScissorTest(false);
    this.renderer.setClearColor(this.clearColor, this.clearAlpha);
    this.renderer.clear();

    // The picture, confined to the letterboxed rectangle the screen layer's own
    // transform maps onto, so the two surfaces line up pixel for pixel.
    applyRendererViewport(this.renderer, viewport);

    this.substitution.apply(this.scene, mode);
    try {
      this.renderer.render(this.scene, camera);
    } finally {
      // In a `finally` because a scene left holding stand-in materials is a
      // scene a check would read the *mode's* colors off, and because the
      // objects a throw would strand are the game's own.
      this.substitution.restore();
    }

    // Read here rather than at the metrics' leisure: the overlay and the
    // composite are two more `render` calls, and three resets these counts at
    // the top of each one. Taking them the instant the scene is drawn is what
    // makes the figure the game's picture rather than the engine's chrome.
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;

    if (this.overlayEnabled) this.drawCollisionOverlay(world, camera);
  }

  /**
   * Step 5: the screen layer, cleared and redrawn from every enabled, visible
   * `screen` component in layer order.
   */
  renderScreen(world: World, viewport: Viewport, frame: FrameInfo): void {
    const ctx = this.screen;
    const mode = this.renderMode;

    // The whole backing store, cleared in device space: the layer is composited
    // over the picture, so anything left from the previous frame would show
    // through as a ghost rather than being painted over.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.screenCanvas.width, this.screenCanvas.height);
    // Once per frame rather than per blit, and before any component draws: the
    // pipeline never `save`/`restore`s, so the value holds for every component
    // of the frame, a `DrawComponent` receives the context already carrying it,
    // and the scratch a tinted sprite is flattened on samples the same way.
    ctx.imageSmoothingEnabled = this.imageSmoothing;
    // The layer is given the fit here, as part of being cleared, rather than
    // only when the first component asks for it: a world whose HUD is empty
    // this frame still leaves the layer in logical units, so whatever draws on
    // it next — a later frame's first component, or a caller reading the
    // context back — finds the transform the step is specified to leave.
    applyViewport(ctx, viewport);

    const collected: Collected[] = [];
    let order = 0;
    for (const actor of world.actors()) {
      if (!actor.alive) continue;
      for (const component of actor.components) {
        if (!(component instanceof RenderComponent)) continue;
        if (component.space !== "screen") continue;
        if (!component.enabled || !component.visible) continue;
        collected.push({ component, order });
        order += 1;
      }
    }
    // A stable sort by layer alone: the collection is already in spawn order
    // and, within an actor, attachment order, and the explicit tiebreak keeps
    // that true whatever the host's sort does with equal keys.
    collected.sort(
      (a, b) => a.component.layer - b.component.layer || a.order - b.order,
    );

    const camera = world.camera.snapshot();
    const api = this.drawApi(camera, mode, frame, viewport);
    for (const entry of collected) {
      this.drawOne(entry.component, api, mode, viewport);
    }
  }

  /**
   * Step 8: the screen layer uploaded and drawn over the picture as a
   * full-canvas quad with alpha blending, so wherever the layer is transparent
   * the world pass shows through.
   */
  composite(): void {
    // Over the whole canvas, bars included: the diagnostics overlay draws in
    // device space and may land in a bar, and a layer clipped to the picture
    // would cut it in half.
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.canvas.width, this.canvas.height);
    // The canvas is the texture's source and its contents changed this frame,
    // so the upload is asked for explicitly; three re-uploads nothing it is not
    // told about.
    this.screenTexture.needsUpdate = true;
    this.renderer.render(this.compositeScene, this.compositeCamera);
  }

  /** The scene render's draw counts for the most recent frame; zeroes before the first. */
  counts(): RenderCounts {
    return { drawCalls: this.drawCalls, triangles: this.triangles };
  }

  /**
   * Dispose the renderer, the compositing objects, and everything the pipeline
   * built for the world's components. Idempotent, because teardown races.
   *
   * A `ModelComponent`'s clone, an `Object3DComponent`'s subtree, a `custom`
   * geometry, and every texture a game loaded are left as they stand: they are
   * the game's, and a caller that reads the scene after destroying the engine
   * still finds what the last frame placed.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const [, placed] of this.placed) this.drop(placed);
    this.placed.clear();

    for (const [, shape] of this.overlayShapes) {
      this.overlayScene.remove(shape.mesh);
      shape.geometry.dispose();
    }
    this.overlayShapes.clear();
    for (const material of Object.values(this.overlayMaterials)) {
      material.dispose();
    }

    this.substitution.dispose();
    this.screenTexture.dispose();
    this.compositeMaterial.dispose();
    this.compositeGeometry.dispose();
    this.renderer.dispose();
  }

  /* ---------------------------------------------------------------------- */
  /* The world pass                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * The object a `world` component has in the scene, built or rebuilt as its
   * declaration requires, or `null` for a component the catalogue does not
   * name.
   *
   * A `RenderComponent` subclass in `world` space that is none of the four
   * built-ins draws nothing: the pipeline places what it can name, and a game
   * that wants its own three objects has `Object3DComponent` for exactly that.
   */
  private placedFor(component: RenderComponent): Placed | null {
    const revision = declarationRevision(component);
    const held = this.placed.get(component);
    if (held !== undefined) {
      if (held.revision === revision) return held;
      // The declaration was assigned since the object was built, so the object
      // is stale. Dropping it first releases what the old one owned before the
      // new one allocates, which keeps a per-second material tween flat rather
      // than growing.
      this.placed.delete(component);
      this.drop(held);
    }

    const built = this.build(component, revision);
    if (built === null) return null;
    this.placed.set(component, built);
    this.scene.add(built.object);
    return built;
  }

  /** One three object from one component's declaration. */
  private build(component: RenderComponent, revision: number): Placed | null {
    if (component instanceof MeshComponent) {
      const geometry = buildGeometry(component.geometry);
      const material = buildMaterial(component.material);
      const owned: { dispose(): void }[] = [material];
      // A `custom` geometry is the game's: it may be shared between components,
      // pulled off a loaded model, or drawn with elsewhere, so the pipeline
      // draws with it and never disposes it.
      if (component.geometry.kind !== "custom") owned.push(geometry);
      return { object: new THREE.Mesh(geometry, material), revision, owned };
    }
    if (component instanceof ModelComponent) {
      // The clone is the component's, made at construction and never replaced,
      // so the pipeline adds it and later removes it and owns nothing of it.
      return { object: modelObject(component), revision, owned: [] };
    }
    if (component instanceof LightComponent) {
      const light = buildLight(component.light);
      return { object: light, revision, owned: [light] };
    }
    if (component instanceof Object3DComponent) {
      return { object: component.object, revision, owned: [] };
    }
    return null;
  }

  /** One component's object, placed, switched, faded, and advanced. */
  private syncOne(
    component: RenderComponent,
    placed: Placed,
    world: World,
    dt: number,
  ): void {
    const object = placed.object;
    // Everything that reaches here is enabled and visible — `syncScene` turned
    // the rest away — so the object is shown unconditionally. The write is not
    // redundant: an `Object3DComponent`'s subtree is the game's own object, and
    // it may carry a `visible` of `false` from whatever built it.
    object.visible = true;

    // `layer` is the object's render order: three sorts the opaque draws and
    // then the transparent ones, orders each set by this, and depth testing
    // decides which surface is seen where they overlap.
    object.renderOrder = component.layer;

    if (
      component instanceof LightComponent &&
      !isPlacedLight(component.light)
    ) {
      // An ambient light shines from nowhere, and a hemisphere light's *sky*
      // direction is what three reads its position as — so placing one at its
      // actor, which is usually the origin, would collapse the sky-to-ground
      // blend the spec declared into nothing. Neither is placed at all.
      return;
    }

    const at = component.worldTransform();
    object.position.set(at.position.x, at.position.y, at.position.z);
    if (component instanceof MeshComponent && component.billboard) {
      // A billboard keeps its position and scale and takes its orientation from
      // the camera — which step 1 has already settled for this frame, so the
      // card faces the view the frame is actually drawn through.
      poseQuaternion(object, world.camera.rotation);
    } else {
      poseQuaternion(object, at.rotation);
    }
    object.scale.set(at.scale.x, at.scale.y, at.scale.z);

    if (component instanceof LightComponent) {
      // A light takes no opacity at all, and it has no material to take one on.
      return;
    }
    applyOpacity(object, clampOpacity(component.opacity));

    if (component instanceof MeshComponent) {
      applyShadows(object, component.castShadow, component.receiveShadow);
      return;
    }
    if (component instanceof ModelComponent) {
      applyShadows(object, component.castShadow, component.receiveShadow);
      // After every tick, by the world's delta: a clip's pose for the frame is
      // written over whatever a tick wrote to the nodes that clip animates.
      advanceModelAnimation(component, dt);
    }
  }

  /** Take one component's object out of the scene and release what it owned. */
  private drop(placed: Placed): void {
    this.scene.remove(placed.object);
    for (const owned of placed.owned) owned.dispose();
  }

  /**
   * Step 4: every enabled collider's shape as a wireframe over the finished
   * scene, in a color per response, with depth testing off.
   *
   * The shapes are drawn from their *placed* dimensions rather than by scaling
   * a unit geometry, because a sphere's and a capsule's radius take the largest
   * scale factor while a box's extents take one factor each — the rules the
   * collision module tests under. The overlay shows what the engine tests, so
   * it has to scale the way the engine does.
   */
  private drawCollisionOverlay(world: World, camera: THREE.Camera): void {
    const seen = new Set<ColliderComponent>();
    for (const actor of world.actors()) {
      if (!actor.alive) continue;
      for (const collider of actor.componentsOf(ColliderComponent)) {
        if (!collider.enabled) continue;
        seen.add(collider);

        const at = collider.worldTransform();
        const shape = scaledShape(collider.shape, at.scale);
        const signature = shapeSignature(shape);

        let held = this.overlayShapes.get(collider);
        if (held === undefined) {
          const geometry = colliderGeometry(shape);
          held = {
            mesh: new THREE.Mesh(geometry, this.overlayMaterials.ignore),
            geometry,
            signature,
          };
          this.overlayShapes.set(collider, held);
          this.overlayScene.add(held.mesh);
        } else if (held.signature !== signature) {
          held.geometry.dispose();
          held.geometry = colliderGeometry(shape);
          held.mesh.geometry = held.geometry;
          held.signature = signature;
        }

        held.mesh.material = this.overlayMaterials[strongestResponse(collider)];
        held.mesh.position.set(at.position.x, at.position.y, at.position.z);
        poseQuaternion(held.mesh, at.rotation);
        // The scale is already in the geometry's own dimensions, so the object
        // carries none: scaling it again would apply the factor twice, and
        // would apply it per axis to a sphere the engine tests as a sphere.
        held.mesh.scale.set(1, 1, 1);
      }
    }

    for (const [collider, shape] of this.overlayShapes) {
      if (seen.has(collider)) continue;
      this.overlayShapes.delete(collider);
      this.overlayScene.remove(shape.mesh);
      shape.geometry.dispose();
    }

    // A second render into the same rectangle with `autoClear` off, so it lands
    // over the picture; the materials carry `depthTest: false`, so it lands
    // over the picture's *depth* too and a collider inside a wall is visible.
    this.renderer.render(this.overlayScene, camera);
  }

  /* ---------------------------------------------------------------------- */
  /* The screen pass                                                        */
  /* ---------------------------------------------------------------------- */

  /** The API a `DrawComponent`'s `draw` receives, built once per frame. */
  private drawApi(
    camera: CameraSnapshot,
    mode: RenderMode,
    frame: FrameInfo,
    viewport: Viewport,
  ): DrawApi {
    const held: FrameInfo = { ...frame };
    const fit: Viewport = { ...viewport };
    return {
      ctx: this.screen,
      mode,
      // Snapshots the caller owns: a held one keeps this frame's values.
      frame: (): FrameInfo => ({ ...held }),
      viewport: (): Viewport => ({ ...fit }),
      camera: (): CameraSnapshot => ({ ...camera }),
    };
  }

  /** One `screen` component, in its place in the layer order. */
  private drawOne(
    component: RenderComponent,
    api: DrawApi,
    mode: RenderMode,
    viewport: Viewport,
  ): void {
    const ctx = this.screen;
    // `setTransform` replaces whatever the previous component left, so every
    // component starts from the same map and none can shear the ones after it
    // — which is also why the pipeline balances no `save`/`restore` around a
    // `DrawComponent`: a forgotten `restore` costs the components after it
    // nothing but leaked style properties, and every built-in sets the styles
    // it paints with before painting.
    applyViewport(ctx, viewport);

    if (component instanceof DrawComponent) {
      // The direct-drawing path: the context carries the viewport transform and
      // nothing else, so the component draws at absolute logical coordinates
      // and reads `api.mode` to supply its own render modes.
      component.draw(api);
      return;
    }

    // The position stays in each operation's own arguments — the recorded
    // operations carry the coordinates the game asked for, not a chain of
    // translates — so only a yaw or a scale earns a transform, and it pivots
    // about the component's logical position to leave those arguments in
    // logical coordinates too.
    const at = screenPlacement(component.worldTransform());
    applyLocalTransform(ctx, at);

    if (component instanceof SpriteComponent) {
      this.drawSprite(ctx, component, at, mode);
    } else if (component instanceof ShapeComponent) {
      drawShape(ctx, component, at, mode);
    } else if (component instanceof TextComponent) {
      drawText(ctx, component, at, mode);
    }
    // A `screen` `RenderComponent` subclass the catalogue does not know draws
    // nothing; `DrawComponent` is the path for a game that wants its own.
  }

  /** A sprite, under the frame's mode and the frame's sampling. */
  private drawSprite(
    ctx: CanvasRenderingContext2D,
    component: SpriteComponent,
    at: ScreenPlacement,
    mode: RenderMode,
  ): void {
    const width = component.width;
    const height = component.height;
    const dx = at.x - component.anchorX * width;
    const dy = at.y - component.anchorY * height;

    if (mode === "wireframe") {
      // The image reduced to its bounds, at the one wireframe width.
      ctx.globalAlpha = 1;
      ctx.strokeStyle = WIREFRAME_COLOR;
      ctx.lineWidth = WIREFRAME_WIDTH;
      ctx.strokeRect(dx, dy, width, height);
      return;
    }
    if (mode === "unlit") {
      ctx.globalAlpha = 1;
      this.blitSprite(ctx, component, dx, dy, width, height, null);
      return;
    }
    ctx.globalAlpha = clampOpacity(component.opacity);
    this.blitSprite(ctx, component, dx, dy, width, height, component.tint);
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
  ): void {
    const source = component.source;
    const tinted = tint === null ? null : this.tint(component, tint);
    if (tinted !== null) {
      // The scratch holds the selected region already flattened to the tint, so
      // it blits whole.
      ctx.drawImage(tinted, dx, dy, width, height);
      return;
    }
    if (source === null) {
      ctx.drawImage(component.image, dx, dy, width, height);
      return;
    }
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

  /**
   * The sprite's selected region flattened to `tint`, on the shared scratch, or
   * `null` where the host has no second canvas to composite on.
   *
   * The scratch samples as the frame does, so a tinted sprite and an untinted
   * one are drawn the same way, and its preparation stays off the screen layer:
   * what reaches the layer is the one `drawImage` that blits it.
   */
  private tint(
    component: SpriteComponent,
    tint: string,
  ): HTMLCanvasElement | null {
    this.tintScratch ??= buildTintScratch();
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
    scratch.imageSmoothingEnabled = this.imageSmoothing;
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
}

/* -------------------------------------------------------------------------- */
/* The screen layer's placement and its three built-ins                       */
/* -------------------------------------------------------------------------- */

/**
 * A composed transform read as a placement on the logical field.
 *
 * A `screen` component's transform is a three-dimensional record like any
 * other, and this is where it is read as the two-dimensional thing it means:
 * `position.x` and `position.y` in logical units from the top-left of the
 * design field, the quaternion's yaw about `+Z`, and `scale.x` and `scale.y`.
 * `position.z` and the other two axes of the rotation are simply not part of a
 * placement on a flat surface, and reading them would give a HUD element a
 * depth and a pitch that no coordinate on the layer could express.
 */
interface ScreenPlacement {
  /** The logical x the component draws at. */
  readonly x: number;
  /** The logical y the component draws at. */
  readonly y: number;
  /** The rotation about `+Z`, in radians. */
  readonly yaw: number;
  /** The horizontal scale factor. */
  readonly scaleX: number;
  /** The vertical scale factor. */
  readonly scaleY: number;
}

/** Read a composed transform as a placement on the logical field. */
function screenPlacement(at: Transform): ScreenPlacement {
  return {
    x: at.position.x,
    y: at.position.y,
    // Through the engine's own decomposition rather than a formula of its own,
    // so a component posed with `quatFromEuler(0, 0, angle)` draws at exactly
    // `angle` and the two halves cannot drift apart.
    yaw: quatToEuler(at.rotation).z,
    scaleX: at.scale.x,
    scaleY: at.scale.y,
  };
}

/**
 * A component's yaw and scale, pivoted about its logical position.
 *
 * The position itself is folded into the drawing operations' arguments, so an
 * unrotated, unscaled component — the common case — draws with the context
 * carrying the viewport transform alone.
 */
function applyLocalTransform(
  ctx: CanvasRenderingContext2D,
  at: ScreenPlacement,
): void {
  if (at.yaw === 0 && at.scaleX === 1 && at.scaleY === 1) return;
  ctx.translate(at.x, at.y);
  ctx.rotate(at.yaw);
  ctx.scale(at.scaleX, at.scaleY);
  ctx.translate(-at.x, -at.y);
}

/** A shape, under the frame's mode. */
function drawShape(
  ctx: CanvasRenderingContext2D,
  component: ShapeComponent,
  at: ScreenPlacement,
  mode: RenderMode,
): void {
  tracePath(ctx, component.shape, at);

  if (mode === "wireframe") {
    // The outline alone, at one stroke width, in the component's own color
    // where it states one so a wireframe of a busy HUD is still readable.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = component.stroke ?? component.fill ?? WIREFRAME_COLOR;
    ctx.lineWidth = WIREFRAME_WIDTH;
    ctx.stroke();
    return;
  }

  // `unlit` drops the tint axis and draws at full opacity; a shape has no tint,
  // so unlit differs from the full picture only in the alpha.
  ctx.globalAlpha = mode === "unlit" ? 1 : clampOpacity(component.opacity);
  if (component.fill !== null) {
    ctx.fillStyle = component.fill;
    ctx.fill();
  }
  if (component.stroke !== null) {
    ctx.strokeStyle = component.stroke;
    ctx.lineWidth = component.strokeWidth;
    ctx.stroke();
  }
}

/** A string, under the frame's mode. */
function drawText(
  ctx: CanvasRenderingContext2D,
  component: TextComponent,
  at: ScreenPlacement,
  mode: RenderMode,
): void {
  ctx.font = component.font;
  ctx.textAlign = component.align;
  ctx.textBaseline = component.baseline;

  if (mode === "wireframe") {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = component.fill;
    ctx.lineWidth = WIREFRAME_WIDTH;
    ctx.strokeText(component.text, at.x, at.y);
    return;
  }

  ctx.globalAlpha = mode === "unlit" ? 1 : clampOpacity(component.opacity);
  ctx.fillStyle = component.fill;
  ctx.fillText(component.text, at.x, at.y);
}

/** The path a flat shape traces, centered on `at` in logical coordinates. */
function tracePath(
  ctx: CanvasRenderingContext2D,
  shape: Shape2D,
  at: ScreenPlacement,
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
    case "polygon":
      shape.points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(at.x + point.x, at.y + point.y);
        else ctx.lineTo(at.x + point.x, at.y + point.y);
      });
      ctx.closePath();
      return;
  }
}

/** A canvas to tint through, or `null` where the host cannot supply one. */
function buildTintScratch(): CanvasRenderingContext2D | null {
  try {
    if (
      typeof document === "undefined" ||
      typeof document.createElement !== "function"
    ) {
      return null;
    }
    return document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Write a `Quat` onto a three object's orientation. */
function poseQuaternion(object: THREE.Object3D, rotation: Quat): void {
  object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

/**
 * One response's overlay material: a flat wireframe that ignores depth.
 *
 * `depthTest` off is what makes a collider inside a wall visible, which is the
 * whole use of the overlay — what the engine tests for collision seen through
 * whatever the game drew in front of it — and `depthWrite` off keeps the
 * overlay from occluding the composite that follows it.
 */
function overlayMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    depthTest: false,
    depthWrite: false,
  });
}
