// scoring/pose — the shared staging the scoring suite reads its awards against.
//
// Every award in specs/scoring.md is an increment ("raises the score by
// exactly ..."), so every scenario here poses a score the session is already
// carrying: an award read back as CARRIED plus the figure is an addition,
// where the figure alone would be the same number reached by a build that
// assigns the award instead of adding it. The stagings pose one target on a
// ring held still, one ball at that target's face or edge gate, or one pod
// falling straight onto the resting deflector — all through the debug surface,
// with nothing else in the world.

import {
  PADDLE_START_ANGLE,
  RINGS,
  ballSpeed,
  ringMidRadius,
  slotArcCenterDeg,
  type PodKind,
} from "../constants";
import {
  isolate,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
  type KesslerSnapshot,
} from "../harness";

/** A score the session already carries, so an award reads as an increment. */
export const CARRIED = 250;

/** How far below a ring's inner contact radius an approaching ball starts. */
const APPROACH = 60;

/** Where a dropped pod starts: well above the 196 catch radius. */
const POD_DROP_RADIUS = 250;

/** A tick budget that covers every approach staged here with room to spare. */
export const SWEEP_TICKS = 200;

/** The sweep predicate every award is read on: the score has left `from`. */
export function scored(from: number): (s: KesslerSnapshot) => boolean {
  return (s) => s.score !== from;
}

/** An emptied playing field, both driver switches off, carrying CARRIED. */
export async function stageCarried(h: Harness): Promise<KesslerSnapshot> {
  await isolate(h);
  await h.debug.setScore(CARRIED);
  return h.snapshot();
}

/**
 * Hold `ring` still at angle 0 and place one target with `hp` hit points in
 * `slot`, so the slot's arc stays exactly where `slotArcCenterDeg` puts it.
 */
export async function armTarget(
  h: Harness,
  ring: number,
  slot: number,
  hp: number,
): Promise<void> {
  await h.debug.setRingAngle(ring, 0);
  await h.debug.setRingSpeed(ring, 0);
  await h.debug.spawnTarget(ring, slot, hp);
}

/** A fresh target's hit points on `ring`, from the ring table. */
export function fullHp(ring: number): number {
  return RINGS[ring - 1].hp;
}

/**
 * One ball outbound along the arc-center radial of `slot`, starting APPROACH
 * below `ring`'s inner contact radius, at the wave-1 ball speed: a face
 * crossing of the inner contact radius a handful of ticks out, with nothing
 * else on the path.
 */
export async function ballAtFaceGate(
  h: Harness,
  ring: number,
  slot: number,
): Promise<void> {
  const inner = RINGS[ring - 1].contactInnerRadius;
  const theta = slotArcCenterDeg(ring, slot, 0);
  await spawnBallPolar(h, inner - APPROACH, theta, ballSpeed(1));
}

/**
 * One ball inside `ring`'s contact band at its mid radius, `leadDeg` past the
 * arc's +theta edge, gliding tangentially toward -theta: an edge crossing into
 * the arc a handful of ticks out, with no radial crossing anywhere near.
 */
export async function ballAtEdgeGate(
  h: Harness,
  ring: number,
  slot: number,
  leadDeg = 4,
): Promise<void> {
  const spec = RINGS[ring - 1];
  const theta =
    slotArcCenterDeg(ring, slot, 0) + spec.targetArcDeg / 2 + leadDeg;
  // -90 off the outward radial is the -theta tangent.
  await spawnBallPolar(h, ringMidRadius(ring), theta, ballSpeed(1), -90);
}

/** One pod of `kind` falling straight onto the deflector resting at 90. */
export async function podOntoDeflector(
  h: Harness,
  kind: PodKind,
): Promise<void> {
  await spawnPodPolar(h, kind, POD_DROP_RADIUS, PADDLE_START_ANGLE);
}
