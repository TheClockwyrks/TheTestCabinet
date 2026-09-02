/**
 * The read side of the camera: the world-space ray through a point on the stage,
 * the stage point a world point draws at, and the camera's pose as a plain value.
 *
 * A 3D game states every rule it has in **world units** — a crate is one unit
 * across, a jump clears two — and draws every readout it has in **logical units**,
 * the fixed design size handed to `createEngine`. Two mappings carry a coordinate
 * between them and onto the screen:
 *
 * | Space | Unit | Set by |
 * | --- | --- | --- |
 * | World | The game's own | The game, on every scene object |
 * | Logical | The design size | The camera's projection, at aspect `width / height` |
 * | Device | Device pixels | The viewport |
 *
 * This module owns the first of those two: the camera the engine renders through
 * (created here, at the documented defaults) and the `View` that maps a point
 * across it in either direction. The viewport owns the second, and the two compose,
 * so a validator that fixes the design size and the device pixel ratio knows the
 * exact device pixel any world point was drawn into and can sample it.
 *
 * Four decisions are worth stating up front, because a game and a validator both
 * depend on them.
 *
 * 1. **The view is a *reading*, not the live camera.** The camera is a three object
 *    the game's `render` mutates in place, so anything that handed a caller the
 *    camera itself would hand it a pose that a later frame silently overwrites.
 *    {@link createView} copies the camera's world and projection matrices into
 *    matrices of its own on {@link ViewReader.read}, and every answer comes from
 *    that copy. A snapshot, a ray, and a projected point are therefore fresh plain
 *    values the caller owns outright, and holding one across a hundred frames is
 *    safe.
 *
 * 2. **The reading is taken after `render` returns.** That is what makes "the
 *    camera" mean one thing for a whole frame. `update` runs before `render`, so
 *    the camera the player is looking through while their input arrives is the one
 *    the *previous* frame drew — and that is the camera `update` picks against, so
 *    a click resolves against the picture the player aimed at. `render` reads the
 *    same reading, which coincides with the pose it is presently writing whenever
 *    the camera is still. Before the first render there is nothing to have read,
 *    so {@link createView} takes its seed reading at construction, off a camera
 *    still at the defaults {@link createCamera} left it at.
 *
 * 3. **Logical `y` runs *down*.** Normalized device coordinates run `-1..1` with
 *    `+Y` up; the logical field runs `0..width` by `0..height` from the top-left,
 *    because that is where the screen layer's 2D context draws and where the
 *    pointer reports. The two conversions live in {@link ndcToLogical} and
 *    {@link logicalToNdc} and are used nowhere else, so the flip is written once:
 *
 *    ```ts
 *    logicalX = (ndcX + 1) / 2 * width;
 *    logicalY = (1 - ndcY) / 2 * height;
 *    ```
 *
 *    A projected point therefore goes straight onto the screen layer, and a
 *    pointer position goes straight into {@link View.ray}, with no second mapping
 *    for a build to get wrong.
 *
 * 4. **The world is right-handed, `+Y` up, and the camera looks along its local
 *    `-Z`** — three's convention throughout, so a game reasons in the terms every
 *    three tutorial is written in. `fov` is degrees and every other angle is
 *    radians, also three's convention. A quaternion is `{x, y, z, w}` with the
 *    identity `{0, 0, 0, 1}`.
 *
 * One deliberate difference from three is worth flagging for anyone comparing this
 * against `THREE.Raycaster`: through an orthographic camera the ray here starts on
 * the **near plane**, as the Simple 3D specification states, where three's raycaster
 * starts it in the plane of the camera itself. The two describe the same line —
 * only the point it is parameterized from differs, by `near` world units along the
 * view direction — so an intersection computed from either lands in the same place.
 */

import * as THREE from "three";
import type {
  CameraSnapshot,
  Projected,
  Quat,
  Ray,
  SceneCamera,
  Vec3,
  View,
} from "./contract";

/* -------------------------------------------------------------------------- */
/* The camera and its defaults                                                */
/* -------------------------------------------------------------------------- */

/**
 * Which projection a camera is.
 *
 * Taken off {@link CameraSnapshot} rather than declared afresh, so this module
 * cannot drift from the contract's spelling of the same two strings.
 */
export type Projection = CameraSnapshot["projection"];

/**
 * Every projection the engine will build, in the order the error message lists
 * them. Exported because a caller validating an option before it reaches
 * {@link createCamera} should be checking against this array rather than
 * re-typing the pair.
 */
export const PROJECTIONS: readonly Projection[] = ["perspective", "orthographic"];

/**
 * The pose and projection figures a camera starts at, shared by both classes.
 *
 * The orthographic extents are absent because they are derived from the design
 * size rather than fixed: an orthographic camera spans `-width/2..width/2` by
 * `-height/2..height/2`, which is what puts one world unit to one logical unit on
 * the `z = 0` plane, with the world origin at the centre of the field and world
 * `+Y` pointing up the screen. A game with a fixed top-down or isometric picture
 * therefore places its objects around the origin and never touches the camera.
 */
export interface CameraDefaults {
  /** The camera's world position: back along `+Z`, looking at the origin. */
  readonly position: Readonly<Vec3>;
  /** The vertical field of view in degrees. Perspective only. */
  readonly fov: number;
  /** The near clipping plane, in world units along the view direction. */
  readonly near: number;
  /** The far clipping plane, in world units along the view direction. */
  readonly far: number;
  /** The zoom factor, which both classes carry. */
  readonly zoom: number;
}

/**
 * The documented camera defaults.
 *
 * Frozen because {@link createCamera} reads it on every construction and a test
 * or a build that mutated it would change the defaults for every engine built
 * afterwards in the same process — a bug that would surface as one suite's camera
 * depending on whether another suite ran first.
 */
export const CAMERA_DEFAULTS: CameraDefaults = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 10 }),
  fov: 60,
  near: 0.1,
  far: 1000,
  zoom: 1,
});

/**
 * Build the camera the engine renders through, at the defaults above.
 *
 * The class is fixed here and holds for the engine's life, which is what lets a
 * game narrow with `instanceof` once and stay narrowed. A perspective camera's
 * `aspect` is set to the *design* aspect rather than the canvas's, because the
 * picture keeps its declared shape whatever size the element is and the letterbox
 * bars absorb the difference; the engine holds it there for the life of the run.
 *
 * `projection` is typed `string` rather than {@link Projection} on purpose. The
 * option is documented as a closed pair, but a produced build is JavaScript by the
 * time it runs and a case's configuration is data, so the check has to exist at
 * runtime — and the message names both valid values, since the mistake is almost
 * always a typo and the fix is the list itself.
 *
 * @throws Error if `projection` is neither `"perspective"` nor `"orthographic"`.
 */
export function createCamera(
  projection: string,
  width: number,
  height: number,
): SceneCamera {
  if (projection !== "perspective" && projection !== "orthographic") {
    throw new Error(
      `createEngine needs a projection of "perspective" or "orthographic", got ${JSON.stringify(projection)}`,
    );
  }

  const camera: SceneCamera =
    projection === "perspective"
      ? new THREE.PerspectiveCamera(
          CAMERA_DEFAULTS.fov,
          width / height,
          CAMERA_DEFAULTS.near,
          CAMERA_DEFAULTS.far,
        )
      : new THREE.OrthographicCamera(
          -width / 2,
          width / 2,
          height / 2,
          -height / 2,
          CAMERA_DEFAULTS.near,
          CAMERA_DEFAULTS.far,
        );

  const { x, y, z } = CAMERA_DEFAULTS.position;
  camera.position.set(x, y, z);
  camera.zoom = CAMERA_DEFAULTS.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

/* -------------------------------------------------------------------------- */
/* Plain math                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A three vector as the plain {@link Vec3} the contract speaks in.
 *
 * Every value that leaves this module goes through here rather than being handed
 * out as a `THREE.Vector3`: the vectors below are scratch objects reused across
 * calls, so returning one would hand every caller the same aliased instance and
 * the second call would silently rewrite the first caller's answer.
 */
export function toVec3(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/** A three quaternion as the plain {@link Quat} the contract speaks in. */
export function toQuat(q: THREE.Quaternion): Quat {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/**
 * A normalized device coordinate pair onto the logical design field.
 *
 * NDC runs `-1..1` with `+Y` up and the logical field runs `0..width` by
 * `0..height` with `y` down, so this is a flip as well as a scale. The result is
 * deliberately *not* clamped: a point outside the frustum still reports where it
 * would have landed, which is what lets a game clamp an off-screen marker to the
 * field's edge in the direction of the thing it marks.
 */
function ndcToLogical(
  ndcX: number,
  ndcY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: ((ndcX + 1) / 2) * width, y: ((1 - ndcY) / 2) * height };
}

/**
 * A logical design point onto normalized device coordinates — the inverse of
 * {@link ndcToLogical}, and the first half of casting a ray.
 *
 * A point inside a letterbox bar maps outside `0..width` or `0..height` and so to
 * an NDC pair outside `-1..1`. That is not an error: the ray through it is a
 * perfectly well-defined line outside the picture, and whether to clamp the point
 * onto the field or treat it as a miss is the game's decision, not the engine's.
 */
function logicalToNdc(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return { x: (x / width) * 2 - 1, y: 1 - (y / height) * 2 };
}

/* -------------------------------------------------------------------------- */
/* The view                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The {@link View} together with the one call that advances it.
 *
 * Split this way because the two halves have opposite audiences. `view` is handed
 * to the game and to any caller outside it and is read-only in every one of them;
 * `read` belongs to the engine's frame loop alone, which calls it once per frame
 * after the game's `render` has returned and the world matrices have been updated.
 * A game that could call `read` could make `update` observe a camera it posed
 * mid-frame, which is exactly the drawing-decision-inside-the-simulation this
 * separation exists to prevent.
 */
export interface ViewReader {
  /** The read side handed to the game and to callers outside it. */
  readonly view: View;
  /**
   * Take a fresh reading of the camera: refresh its world and projection matrices
   * and copy both, along with the pose and projection figures a snapshot reports.
   *
   * Every later `view()` answer comes from this reading until the next call.
   */
  read(): void;
}

/**
 * Build the reader over `camera`, seeded with a reading taken immediately.
 *
 * The seed is what "before the first render it answers from the camera defaults"
 * means in practice: the camera has just come back from {@link createCamera} and
 * no game code has run, so reading it now captures the defaults. Seeding *eagerly*
 * rather than deferring until the first `read` matters, because a validator may
 * pose `engine.camera` before it ever advances a frame, and the specification says
 * a `view()` taken then still reports the defaults — the pose reaches the view
 * when the frame that drew with it ends, not when it is written.
 *
 * `width` and `height` are the logical design size, fixed for the engine's life,
 * so the map between NDC and the logical field never changes underneath a reading.
 */
export function createView(
  camera: SceneCamera,
  width: number,
  height: number,
): ViewReader {
  // The reading. These are copies rather than references to the camera's own
  // matrices precisely so that the camera moving does not move the view.
  const matrixWorld = new THREE.Matrix4();
  const matrixWorldInverse = new THREE.Matrix4();
  const projectionMatrix = new THREE.Matrix4();
  const projectionMatrixInverse = new THREE.Matrix4();
  const viewProjection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();

  // The decomposed world pose. `scale` is decomposed because `Matrix4.decompose`
  // requires somewhere to put it, and discarded because a camera's scale has no
  // meaning in the picture.
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  // The projection figures, held flat so a snapshot is an object literal rather
  // than a second round of narrowing on the camera's class.
  let projection: Projection = "perspective";
  let fov = 0;
  let near = 0;
  let far = 0;
  let zoom = 1;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;

  // Scratch, never handed out. `ray` and `project` run per pointer sample and per
  // labelled object, so allocating three vectors per call would put the engine's
  // own garbage on the frame budget of the very games most likely to be tight on
  // it.
  const scratchPoint = new THREE.Vector3();
  const scratchTarget = new THREE.Vector3();
  const scratchDirection = new THREE.Vector3();

  function read(): void {
    // Both refreshes are recomputations of derived matrices from fields the camera
    // already carries, never policy: `updateMatrixWorld` folds in a position or a
    // `lookAt` the game just wrote (and its parent's transform, if the game hung
    // the camera under a rig), and `updateProjectionMatrix` folds in a `fov` or a
    // set of extents. Doing them here is what makes the reading agree with the
    // picture the renderer is about to draw, whatever order the loop's steps run
    // in around it.
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    matrixWorld.copy(camera.matrixWorld);
    matrixWorldInverse.copy(matrixWorld).invert();
    projectionMatrix.copy(camera.projectionMatrix);
    projectionMatrixInverse.copy(projectionMatrix).invert();

    // The frustum is derived from the combined matrix rather than from the NDC
    // box, because it answers correctly for a point *behind* the camera: a naive
    // `-1..1` test on the divided coordinates would call such a point visible,
    // since dividing by a negative `w` folds it back into the box.
    viewProjection.multiplyMatrices(projectionMatrix, matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection);

    matrixWorld.decompose(position, rotation, scale);

    near = camera.near;
    far = camera.far;
    zoom = camera.zoom;
    if (camera instanceof THREE.PerspectiveCamera) {
      projection = "perspective";
      fov = camera.fov;
      left = 0;
      right = 0;
      top = 0;
      bottom = 0;
    } else {
      // Every field is present whichever class the camera is, with the other
      // class's fields reading `0`, so a check reads a figure without narrowing on
      // `projection` first.
      projection = "orthographic";
      fov = 0;
      left = camera.left;
      right = camera.right;
      top = camera.top;
      bottom = camera.bottom;
    }
  }

  const view: View = {
    camera(): CameraSnapshot {
      return {
        projection,
        position: toVec3(position),
        rotation: toQuat(rotation),
        fov,
        near,
        far,
        zoom,
        left,
        right,
        top,
        bottom,
      };
    },

    ray(x: number, y: number): Ray {
      const ndc = logicalToNdc(x, y, width, height);

      if (projection === "perspective") {
        // Every ray through a perspective camera passes through its eye point, so
        // the origin is the camera's world position and the direction is towards
        // the stage point unprojected at *any* depth. The middle of the depth
        // range is the numerically comfortable choice, far from both clip planes.
        scratchTarget
          .set(ndc.x, ndc.y, 0.5)
          .applyMatrix4(projectionMatrixInverse)
          .applyMatrix4(matrixWorld);
        scratchDirection.copy(scratchTarget).sub(position).normalize();
        return { origin: toVec3(position), direction: toVec3(scratchDirection) };
      }

      // An orthographic camera's rays are parallel, so the stage point picks the
      // origin and the camera's own facing picks the direction. NDC `z = -1` is
      // the near plane, which is where the specification places the origin.
      scratchTarget
        .set(ndc.x, ndc.y, -1)
        .applyMatrix4(projectionMatrixInverse)
        .applyMatrix4(matrixWorld);
      // `transformDirection` applies the rotation alone and normalizes, so the
      // direction is unit length under a scaled or nested camera too.
      scratchDirection.set(0, 0, -1).transformDirection(matrixWorld);
      return { origin: toVec3(scratchTarget), direction: toVec3(scratchDirection) };
    },

    project(point: Vec3): Projected {
      scratchPoint.set(point.x, point.y, point.z);

      // Read visibility from the world point, before the transform overwrites it
      // in place.
      const visible = frustum.containsPoint(scratchPoint);

      // World to view to clip, with `Vector3.applyMatrix4` performing the
      // perspective divide — the same two steps `THREE.Vector3.project` takes,
      // against this reading's matrices rather than the live camera's.
      scratchPoint.applyMatrix4(matrixWorldInverse).applyMatrix4(projectionMatrix);
      const logical = ndcToLogical(scratchPoint.x, scratchPoint.y, width, height);

      return { x: logical.x, y: logical.y, depth: scratchPoint.z, visible };
    },
  };

  read();
  return { view, read };
}
