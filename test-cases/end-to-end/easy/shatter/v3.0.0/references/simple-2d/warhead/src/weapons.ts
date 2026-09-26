// Shatter — the torpedo (`specs/weapons.md`).
//
// The ship's second weapon: one guided munition on a slow recharge. Four rules
// shape everything here.
//
//   * ONE CHARGE. A game begins with it full; a launch spends it to zero and it
//     then rises LINEARLY back to one over TORPEDO_RECHARGE. The key does
//     nothing below full.
//   * ONE IN FLIGHT. While a torpedo is up the key launches nothing, whatever
//     the charge reads. That is a separate refusal from the recharge, so a build
//     can fail one without failing the other.
//   * SELF-PROPELLED. A torpedo leaves at TORPEDO_SPEED along the ship's facing
//     and carries NONE of the ship's drift, and the well never pulls it, so its
//     speed is constant and its course is its own.
//   * A FORWARD CONE. Every tick it looks for the nearest rock or saucer whose
//     bearing lies within TORPEDO_CONE of its current heading, and turns onto it
//     at up to TORPEDO_TURN. With no candidate it flies straight, and it
//     re-evaluates every tick, so it acquires, loses and re-acquires.
//
// The guidance is a control force, taken in the control step; the launch happens
// at the END of a tick, beside the gun's, so a torpedo is first seen at the nose
// rather than a tick's travel beyond it.

import {
  TICK_DT,
  TORPEDO_CONE,
  TORPEDO_LIFE,
  TORPEDO_RECHARGE,
  TORPEDO_SPEED,
  TORPEDO_TURN,
} from "./constants";
import { deltaX, deltaY, normalizeAngle } from "./geometry";
import { muzzleOf } from "./ship";
import { takeId, type MutTorpedo, type Sim } from "./sim";
import type { FrameInput } from "./input";

/** Whether a torpedo is ready to fire this instant. */
export function torpedoReady(sim: Sim): boolean {
  return sim.torpedoCharge >= 1;
}

/** Raise the stored charge by one tick's worth of the linear refill. */
export function rechargeTorpedo(sim: Sim): void {
  if (sim.torpedoCharge >= 1) return;
  const next = sim.torpedoCharge + TICK_DT / TORPEDO_RECHARGE;
  sim.torpedoCharge = next >= 1 - 1e-9 ? 1 : next;
}

/** A body a torpedo may acquire: a rock or the saucer. */
interface Candidate {
  readonly x: number;
  readonly y: number;
}

/** The nearest acquirable body inside the torpedo's forward cone, or `null`. */
export function acquire(sim: Sim, torpedo: MutTorpedo): Candidate | null {
  const bodies: Candidate[] = [...sim.rocks];
  if (sim.saucer !== null) bodies.push(sim.saucer);

  let best: Candidate | null = null;
  let bestDistance = Infinity;

  for (const body of bodies) {
    const dx = deltaX(torpedo.x, body.x);
    const dy = deltaY(torpedo.y, body.y);
    const bearing = Math.atan2(dy, dx);
    if (Math.abs(normalizeAngle(bearing - torpedo.heading)) > TORPEDO_CONE) {
      continue;
    }
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = body;
    }
  }
  return best;
}

/**
 * The control step for every torpedo: turn onto a target, then set the velocity.
 *
 * The velocity is rebuilt from the heading every tick rather than integrated, so
 * a turning torpedo holds exactly TORPEDO_SPEED throughout the turn.
 */
export function guideTorpedoes(sim: Sim): void {
  for (const torpedo of sim.torpedoes) {
    if (torpedo.homing) {
      const target = acquire(sim, torpedo);
      if (target !== null) {
        const bearing = Math.atan2(
          deltaY(torpedo.y, target.y),
          deltaX(torpedo.x, target.x),
        );
        const off = normalizeAngle(bearing - torpedo.heading);
        const step = Math.min(Math.abs(off), TORPEDO_TURN * TICK_DT);
        torpedo.heading = normalizeAngle(
          torpedo.heading + Math.sign(off) * step,
        );
      }
    }
    torpedo.vx = Math.cos(torpedo.heading) * TORPEDO_SPEED;
    torpedo.vy = Math.sin(torpedo.heading) * TORPEDO_SPEED;
  }
}

/** Put one torpedo in flight at `(x, y)` along `heading`, appended, guided. */
export function addTorpedoAt(
  sim: Sim,
  x: number,
  y: number,
  heading: number,
): MutTorpedo {
  const torpedo: MutTorpedo = {
    id: takeId(sim),
    x,
    y,
    vx: Math.cos(heading) * TORPEDO_SPEED,
    vy: Math.sin(heading) * TORPEDO_SPEED,
    heading,
    life: TORPEDO_LIFE,
    homing: true,
  };
  sim.torpedoes.push(torpedo);
  return torpedo;
}

/** Launch a torpedo, if the charge is full and none is already in flight. */
export function launchTorpedo(sim: Sim, input: FrameInput): void {
  if (!input.torpedo) return;
  if (!torpedoReady(sim)) return;
  if (sim.torpedoes.length > 0) return;

  const [x, y] = muzzleOf(sim.ship);
  addTorpedoAt(sim, x, y, sim.ship.angle);
  sim.torpedoCharge = 0;
}
