/**
 * Sunfront — the low oblique command camera (specs/overview.md, specs/playfield.md).
 *
 * A **perspective** camera at a fixed steep-but-angled pitch and a fixed yaw, framing
 * a fixed span so the **entire ~480-unit combat corridor width** is always in view at
 * 16:9. Its yaw points along the main diagonal toward the enemy corner, so advancing
 * toward `(1200,1200)` recedes into the screen. There is **no zoom control**; the only
 * navigation is **panning along the diagonal** (the corridor's length). The default
 * view on load is centred on the player's own corner.
 *
 * The camera keeps a fixed 16:9 aspect; the renderer letterboxes that view into the
 * window (see {@link World}). The pan target is a distance ALONG the diagonal; the
 * camera sits behind and above it and looks down the diagonal at the fixed pitch.
 */

import * as THREE from "three";
import { ASPECT_RATIO, ARENA_SIZE, PLAYER_BASE, CORRIDOR_WIDTH } from "../constants";
import { alongDiagonal, fromDiagonal } from "../mathutil";

/** Fixed pitch below horizontal — steep enough to read height, low enough to be oblique. */
const PITCH_DEG = 52;
/** Fixed vertical field of view. */
const VFOV_DEG = 42;
/**
 * The cross-corridor span the view frames, in logical units: the full ~480 corridor
 * width plus a small margin so units at the corridor edge sit inside the frame.
 */
const COVER_WIDTH = CORRIDOR_WIDTH + 90;
/** Pan limits along the diagonal (logical units), clamped to the arena's diagonal. */
const ARENA_DIAGONAL = alongDiagonal({ x: ARENA_SIZE, z: ARENA_SIZE });
const PAN_MIN = -40;
const PAN_MAX = ARENA_DIAGONAL + 40;
/** Default pan target: the player's own corner (the base's distance along the diagonal). */
const DEFAULT_PAN = alongDiagonal(PLAYER_BASE);
/** Pan speed for held keys (logical units per second). */
export const PAN_SPEED = 520;

/** The unit advance direction on the ground (toward the enemy corner). */
const DIAG = new THREE.Vector3(1, 0, 1).normalize();

export class CommandCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Distance from camera to its ground target along the view ray. */
  private readonly dist: number;
  /** Horizontal / vertical offsets of the camera from its target. */
  private readonly back: number;
  private readonly height: number;
  private panAlong = DEFAULT_PAN;
  private readonly target = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(VFOV_DEG, ASPECT_RATIO, 1, 8000);
    // Solve the framing: at 16:9 the horizontal FOV follows the vertical one; the
    // cross-corridor span (perpendicular to the view ray, and unforeshortened on the
    // ground) is 2·dist·tan(hFov/2). Solve dist so that span == COVER_WIDTH.
    const vFov = THREE.MathUtils.degToRad(VFOV_DEG);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * ASPECT_RATIO);
    this.dist = COVER_WIDTH / (2 * Math.tan(hFov / 2));
    const pitch = THREE.MathUtils.degToRad(PITCH_DEG);
    this.back = this.dist * Math.cos(pitch);
    this.height = this.dist * Math.sin(pitch);
    this.update();
  }

  /** Recentre on the player's corner (specs/flow.md — recenter-on-base key). */
  recenter(): void {
    this.panAlong = DEFAULT_PAN;
    this.update();
  }

  /** Pan along the diagonal by `delta` logical units (positive = toward the enemy). */
  pan(delta: number): void {
    this.panAlong = THREE.MathUtils.clamp(this.panAlong + delta, PAN_MIN, PAN_MAX);
    this.update();
  }

  /**
   * Jump the view so its target sits at `along` logical units down the diagonal,
   * clamped to the same pan limits as {@link pan}. Drives the minimap's click-to-jump
   * (specs/flow.md — a minimap you can click to jump the camera).
   */
  panTo(along: number): void {
    this.panAlong = THREE.MathUtils.clamp(along, PAN_MIN, PAN_MAX);
    this.update();
  }

  /** The current pan target on the ground plane (for HUD / picking). */
  get targetPoint(): THREE.Vector3 {
    return this.target;
  }

  /** Reposition the camera from the current pan value. */
  private update(): void {
    const g = fromDiagonal(this.panAlong, 0);
    this.target.set(g.x, 0, g.z);
    this.camera.position
      .copy(this.target)
      .addScaledVector(DIAG, -this.back);
    this.camera.position.y = this.height;
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }
}
