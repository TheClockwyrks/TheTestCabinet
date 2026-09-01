// Spectra — putting live drone-bursts on the field, for the `instrumentation/*`
// points that read the burst roster. CASE-PROVIDED.
//
// THE SURFACE HAS NO OPERATION THAT ADDS ONE, AND THAT IS DELIBERATE.
// specs/instrumentation.md: "There is no operation that adds one. A burst is an
// outcome of a drone being destroyed, and the two removals exist so a scenario
// that has already popped something can start its count from an empty roster." So
// a validator that needs bursts standing on the field has to earn them the way
// play does: pose a drone, fire a matching shot at it, and keep what the kill
// leaves behind (specs/bands.md, specs/assets.md).
//
// WHY A KEEPER DRONE STANDS WHILE THE SHOTS ARE FIRED. specs/stages.md: "A
// standard stage clears in the moment the last drone of its wave is destroyed."
// Destroying the only drone on the field therefore ends the stage, and the
// scenario a validator was building would be read on the stage-cleared
// interstitial instead of on a live wave. One extra drone stands well clear of
// every shot for the length of the arrangement and is then taken off with
// `clearDrones`, which REMOVES rather than destroys and so clears no stage.
//
// WHAT IT LEAVES BEHIND. The bursts, and nothing else: the drones are cleared and
// the player's bullets are cleared. It does NOT put the score or the meter back —
// each kill pays `specs/scoring.md` and fills `specs/resonance.md` — so a
// validator that reads either poses it after this returns.

import { fireAt, lastBurst, poseDrone, type Harness } from "../harness";

/**
 * The lane the sacrificial drones stand on, in logical units.
 *
 * Geometry, not a threshold: `y = 300` is well inside the play field (`y` in
 * `[64, 656]`, specs/field.md), clear of both HUD strips and far above the ship's
 * lane at `SHIP_Y` (`600`), so each shot meets the drone it was fired at and
 * nothing else.
 */
const BURST_Y = 300;

/** Where the first one stands, and how far apart the next ones are placed. */
const BURST_X0 = 260;
const BURST_DX = 180;

/**
 * Where the keeper stands: on the far right of the field, `160` units clear of
 * the rightmost sacrificial column even at three bursts, and higher up the field
 * than any of them, so no shot fired straight up from a burst column can reach
 * it.
 */
const KEEPER_X = 1060;
const KEEPER_Y = 200;

/** The band both the targets and the shots carry: a match by specs/bands.md. */
const MATCH = "cyan" as const;

/**
 * Put `count` live drone-bursts on the field and report their ids, newest last.
 *
 * Each is a real kill: a Shard is posed, one matching shot is flown into it by
 * the game's own contact rule, and the burst the destroyed drone left behind is
 * read off the roster. Every faculty of every drone posed here is off, so nothing
 * travels, oscillates or fires while the arrangement is built.
 *
 * A burst plays for `BURST_DURATION` (`0.7` s), and each kill costs the flight of
 * one shot — `SHOT_GAP` at `PLAYER_BULLET_SPEED`, under a tenth of a second — so
 * a caller has the rest of that window to pose the field it is really about.
 */
export async function poseBursts(h: Harness, count: number): Promise<number[]> {
  poseDrone(h, "shard", KEEPER_X, KEEPER_Y, { band: "magenta" });

  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = BURST_X0 + i * BURST_DX;
    poseDrone(h, "shard", x, BURST_Y, { band: MATCH });
    await fireAt(h, x, BURST_Y, MATCH);
    ids.push(lastBurst(h.snapshot()).id);
  }

  h.debug.clearDrones();
  h.debug.clearPlayerBullets();
  return ids;
}
