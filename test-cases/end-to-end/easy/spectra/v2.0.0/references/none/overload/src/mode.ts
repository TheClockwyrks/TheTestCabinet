// Spectra — Overload, the mode this build ships.
//
// `specs/mode.md` settles ONE rule: what a mismatched shot does to the drone it
// hits. Under Overload it does not go to waste — it CHARGES the drone toward an
// overload that makes it more dangerous — and each kind reacts in a way true to it.
//
// Everything else about a mismatched shot is `specs/bands.md`'s and lives in
// `src/combat.ts`: that it destroys nothing, and that the bullet is consumed on
// contact rather than passing through.
//
// THE CHARGE IS THE PRECONDITION AND THE SHOT IS THE TRIGGER. `chargeOnMismatch`
// is only ever reached from a real contact, so the reactions below are outcomes of
// the game's own rules; the debug surface can pose a charge but cannot pose an
// overload.
//
// A SHIMMERING FLUX IS EXEMPT. It has no band to mismatch, so a shot of either band
// during its shimmer neither destroys it nor changes its charge.

import {
  CUES,
  OVERLOAD_AT,
  OVERLOAD_FLUX_SPREAD,
  OVERLOAD_FLUX_SPREAD_ANGLE,
  OVERLOAD_PRISM_ESCORTS,
  SLOT_DX,
  SLOT_DY,
  opposite,
} from "./constants";
import { addDrone, addEnemyBullet, addFannedEnemyBullet } from "./entities";
import { launchDive, returnPath } from "./swarm";
import { shimmering } from "./drones";
import { nextFloat } from "./random";
import type { CueSink } from "./audio";
import type { Band, Drone, SpectraState } from "./types";

/** What a mismatched shot did to the drone it hit. */
export type ChargeOutcome = "immune" | "charged" | "overloaded";

/**
 * Feed one charge to the drone a mismatched shot found.
 *
 * A drone at `OVERLOAD_AT - 1` overloads instead of reaching `OVERLOAD_AT`: it runs
 * the reaction for its kind and its charge returns to `0`, so it can be overloaded
 * again from there. Neither the charge nor the overload adds anything to the score
 * or the meter, which is simply this function not touching either.
 */
export function chargeOnMismatch(
  state: SpectraState,
  drone: Drone,
  cues: CueSink,
): ChargeOutcome {
  if (shimmering(drone, state.stage)) return "immune";
  if (drone.charge + 1 < OVERLOAD_AT) {
    drone.charge += 1;
    return "charged";
  }
  drone.charge = 0;
  react(state, drone, cues);
  cues.raise(CUES.overload);
  return "overloaded";
}

/** Run the reaction for `drone`'s kind. */
function react(state: SpectraState, drone: Drone, cues: CueSink): void {
  if (drone.kind === "shard") {
    plunge(state, drone);
    return;
  }
  if (drone.kind === "flux") {
    spray(state, drone);
    return;
  }
  burstBothBands(state, drone, cues);
}

/**
 * A Shard's reaction: it enters phase `diving` in this very frame and plunges down
 * the field toward the ship's current `x`, faster than a dive.
 */
function plunge(state: SpectraState, drone: Drone): void {
  launchDive(state, drone, true);
}

/**
 * A Flux's reaction: its stored band flips and its band clock returns to `0`,
 * ending the window it was in, and it fires a fan of enemy bullets all carrying its
 * NEW band. It then runs its rhythm on from the fresh window.
 */
function spray(state: SpectraState, drone: Drone): void {
  drone.band = opposite(drone.band);
  drone.bandClock = 0;
  const middle = (OVERLOAD_FLUX_SPREAD - 1) / 2;
  for (let index = 0; index < OVERLOAD_FLUX_SPREAD; index += 1) {
    const degrees = (index - middle) * OVERLOAD_FLUX_SPREAD_ANGLE;
    addFannedEnemyBullet(state, drone.x, drone.y, drone.band, degrees);
  }
}

/**
 * A Prism's reaction: its exposed layer bursts, firing exactly one cyan and one
 * magenta enemy bullet. A shell that bursts also adds `OVERLOAD_PRISM_ESCORTS`
 * Shards beside it, of a band drawn from the game's own generator, entering as an
 * escort does; with only the core left it adds none.
 */
function burstBothBands(
  state: SpectraState,
  drone: Drone,
  _cues: CueSink,
): void {
  addEnemyBullet(state, drone.x - 12, drone.y, "cyan");
  addEnemyBullet(state, drone.x + 12, drone.y, "magenta");
  if (!drone.shellAlive) return;
  for (let index = 0; index < OVERLOAD_PRISM_ESCORTS; index += 1) {
    addEscort(state, drone, index);
  }
}

/** One Shard beside `parent`, flying in to a slot of its own. */
function addEscort(state: SpectraState, parent: Drone, index: number): void {
  const side = index % 2 === 0 ? 1 : -1;
  const band: Band = nextFloat() < 0.5 ? "cyan" : "magenta";
  const x = parent.x + side * SLOT_DX * 0.7;
  const y = parent.y;
  const targetX = parent.slotX + side * SLOT_DX;
  const targetY = parent.slotY + SLOT_DY;
  const escort = addDrone(state, {
    kind: "shard",
    band,
    x,
    y,
    slotX: targetX,
    slotY: targetY,
    group: parent.group,
    released: true,
    phase: "entering",
    ofWave: parent.ofWave,
  });
  escort.path = returnPath({ x, y }, targetX, targetY);
}
