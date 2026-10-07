// targets/rig.ts — the shared scaffolding of the Targets suite.
//
// Every figure here is a specification figure re-exported through ../constants
// (specs/rings.md's table, specs/field.md's contact radii, specs/scoring.md's
// hit award) — never a reading of the reference implementation. The suite's
// scenarios all reduce to the same few moves: freeze a ring at a posed angle,
// place one lone target, send one posed ball at it, and read the target's hit
// points and the ball's velocity after the crossing ticks — so those moves live
// here, spelled once, over the surface's atomic operations alone.
//
// The helpers are async even where this engine's poses are synchronous, so the
// suite's test files read identically across the three engines, exactly as the
// movement suites of coil do.

import {
  HIT_SCORE,
  RINGS,
  STAGE_CX,
  STAGE_CY,
  STRUCTURAL_GAP_DEG,
  ballSpeedAtWave,
} from "../constants";
import {
  normalizeDeg,
  polarToXy,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

const RAD = Math.PI / 180;

/** One ring's layout and contact figures, as specs/rings.md and specs/field.md state them. */
export interface RingFigures {
  slots: number;
  slotWidthDeg: number;
  arcDeg: number;
  fullHp: number;
  innerRadius: number;
  outerRadius: number;
  contactInner: number;
  contactOuter: number;
}

/** Ring 1 first; `figures(ring)` is the guarded accessor. */
export const RING_FIGURES: readonly RingFigures[] = RINGS.map((ring) => ({
  slots: ring.slots,
  slotWidthDeg: ring.slotWidthDeg,
  arcDeg: ring.arcWidthDeg,
  fullHp: ring.hitPoints,
  innerRadius: ring.innerRadius,
  outerRadius: ring.outerRadius,
  contactInner: ring.contactInner,
  contactOuter: ring.contactOuter,
}));

/** "a structural gap of `2` degrees at each side of the slot" (specs/rings.md). */
export const GAP_DEG = STRUCTURAL_GAP_DEG;

/** "A hit that leaves the target alive: `50`" (specs/scoring.md). */
export const HIT_AWARD = HIT_SCORE;

/**
 * Hit points a probed target is posed with: enough that a probe's single hit
 * never destroys, so a probe reads `hp` fell by exactly one and no
 * destruction machinery (burst, pod draw, clearing) joins the scenario.
 */
export const PROBE_HP = 3;

/** The speed probes fly at: the wave-1 ball speed, 4 units per tick. */
export const PROBE_SPEED = ballSpeedAtWave(1);

/** Ring `ring`'s figures, 1-based as the specification numbers rings. */
export function figures(ring: number): RingFigures {
  const fig = RING_FIGURES[ring - 1];
  if (fig === undefined) throw new Error(`no ring ${ring}`);
  return fig;
}

/**
 * Where slot `slot`'s target arc begins under ring angle `ringAngleDeg`:
 * "Slot `k` ... begins at the ring's angle plus `k` times the slot width. The
 * slot's target arc begins `2` degrees into the slot" (specs/rings.md).
 */
export function arcStartDeg(
  ring: number,
  slot: number,
  ringAngleDeg: number,
): number {
  return normalizeDeg(
    ringAngleDeg + slot * figures(ring).slotWidthDeg + GAP_DEG,
  );
}

/** The center of slot `slot`'s target arc under ring angle `ringAngleDeg`. */
export function arcCenterDeg(
  ring: number,
  slot: number,
  ringAngleDeg: number,
): number {
  return normalizeDeg(
    arcStartDeg(ring, slot, ringAngleDeg) + figures(ring).arcDeg / 2,
  );
}

/** The live target in `slot` of `ring`, or `undefined` when the slot is empty. */
export function targetAt(
  snapshot: KesslerSnapshot,
  ring: number,
  slot: number,
): { slot: number; hp: number } | undefined {
  return snapshot.rings[ring - 1]?.targets.find((t) => t.slot === slot);
}

/**
 * Pose ring `ring` still at `angleDeg`, so a probed layout holds exactly where
 * it was posed: `setRingAngle` moves every target with the ring, and
 * `setRingSpeed(ring, 0)` holds until the next `setWave` or wave transition
 * (specs/instrumentation.md).
 */
export async function freezeRing(
  h: Harness,
  ring: number,
  angleDeg: number,
): Promise<void> {
  h.debug.setRingAngle(ring, angleDeg);
  h.debug.setRingSpeed(ring, 0);
}

/** Place one target through the surface, "exactly as a wave-start target does". */
export async function placeTarget(
  h: Harness,
  ring: number,
  slot: number,
  hp: number,
): Promise<void> {
  h.debug.spawnTarget(ring, slot, hp);
}

/** Remove every ball, so the next probe's ball is the world's only one. */
export async function clearBalls(h: Harness): Promise<void> {
  h.debug.clearBalls();
}

/**
 * Spawn one unparked ball by the polar figures every contact rule is written
 * in: radius `r`, stage angle `thetaDeg`, radial speed `vr` (outward positive)
 * and tangential speed `vt` (toward `+theta` positive) — specs/field.md's own
 * `n` and `t` axes at that angle.
 */
export async function ballAt(
  h: Harness,
  r: number,
  thetaDeg: number,
  vr: number,
  vt: number,
): Promise<void> {
  const at = polarToXy(r, thetaDeg);
  const rad = thetaDeg * RAD;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  h.debug.spawnBall(at.x, at.y, vr * nx - vt * ny, vr * ny + vt * nx);
}

/** A snapshot ball's polar reading: radius, angle, and `n`/`t` velocity components. */
export function ballPolar(ball: {
  x: number;
  y: number;
  vx: number;
  vy: number;
}): { r: number; thetaDeg: number; vr: number; vt: number } {
  const dx = ball.x - STAGE_CX;
  const dy = ball.y - STAGE_CY;
  const r = Math.hypot(dx, dy);
  const nx = dx / r;
  const ny = dy / r;
  return {
    r,
    thetaDeg: normalizeDeg(Math.atan2(dy, dx) / RAD),
    vr: ball.vx * nx + ball.vy * ny,
    vt: -ball.vx * ny + ball.vy * nx,
  };
}

/**
 * The velocity the reflection pipeline of specs/deflector-and-ball.md leaves a
 * ball that arrived at `at` with velocity `v` and met a STATIONARY ring:
 * specular by surface type (a face contact reflects the radial component, an
 * edge contact the tangential), no ring kick (the ring is still), the speed
 * renormalized to the arrival speed, then orbital decay — "rotate the velocity
 * toward the local radial axis by `min(6, |phi|)` degrees, where `phi` is the
 * signed angle from the nearer radial direction, outward or inward, to the
 * velocity".
 */
export function expectedReflection(
  at: { x: number; y: number },
  v: { vx: number; vy: number },
  kind: "face" | "edge",
): { vx: number; vy: number } {
  const dx = at.x - STAGE_CX;
  const dy = at.y - STAGE_CY;
  const rr = Math.hypot(dx, dy);
  const nx = dx / rr;
  const ny = dy / rr;
  let vr = v.vx * nx + v.vy * ny;
  let vt = -v.vx * ny + v.vy * nx;
  if (kind === "face") vr = -vr;
  else vt = -vt;
  const speed = Math.hypot(vr, vt);
  // Orbital decay, in the (n, t) frame: `a` is the velocity's angle from the
  // outward radial; `phi` the same angle taken from whichever radial is nearer.
  const a = Math.atan2(vt, vr);
  const outward = Math.abs(a) <= Math.PI / 2;
  const phi = outward ? a : a - Math.sign(a) * Math.PI;
  const decayed = Math.abs(phi) - Math.min(6 * RAD, Math.abs(phi));
  const phi2 = Math.sign(phi) * decayed;
  const a2 = outward ? phi2 : phi2 + Math.sign(a) * Math.PI;
  vr = speed * Math.cos(a2);
  vt = speed * Math.sin(a2);
  return { vx: vr * nx - vt * ny, vy: vr * ny + vt * nx };
}

/**
 * One layout probe: a fresh lone target with `PROBE_HP` hit points in `slot`
 * of `ring`, and one fresh ball sent radially inward at `thetaDeg` from just
 * above the ring's outer contact radius, crossing it on the second tick.
 * Returns the hit points the target has left after the crossing ticks —
 * `PROBE_HP - 1` when the crossing hit, `PROBE_HP` when it passed untouched.
 */
export async function probeArc(
  h: Harness,
  ring: number,
  slot: number,
  thetaDeg: number,
): Promise<number> {
  h.debug.clearTargets();
  await placeTarget(h, ring, slot, PROBE_HP);
  await clearBalls(h);
  await ballAt(h, figures(ring).contactOuter + 5, thetaDeg, -PROBE_SPEED, 0);
  await h.tick(4);
  const target = targetAt(h.snapshot(), ring, slot);
  return target === undefined ? 0 : target.hp;
}
