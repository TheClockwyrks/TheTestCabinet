// screens/outcomes — reaching the two screens a run can end on.
//
// CASE-PROVIDED, and not a suite: vitest collects `*.test.ts` alone, so this file
// is a module the checks next door import and never a point in its own right.
//
// Both endings are reached by the game's own rules rather than posed.
// `specs/instrumentation.md` gives the surface no operation that ends a run — that
// would be posing an outcome, which the precondition guardrail forbids — so the
// only way onto the victory screen is to clear the final wave and let the finale
// run, and the only way onto the overload screen is to let Grid Integrity reach
// `0`. What is posed is the precondition each ending needs: which wave the run is
// on, and how much Grid Integrity is left.

import { ConstantClock } from "@clockwyrks/simple-2d";
import { assertEqual, assertTruthy } from "../assert";
import {
  createHarness,
  type Harness,
  openYard,
  releaseUnit,
  TICK_HZ,
  TICK_MS,
} from "../harness";
import {
  COLLECTOR_WAYPOINT,
  difficultyById,
  mapById,
  tileCenter,
} from "../constants";

/**
 * The frame rate a run is driven to its ending at: `30` Hz, a quarter of this
 * project's default.
 *
 * The specification deliberately fixes no frame size — "an interval of simulation
 * time reaches the same state however it was divided into frames"
 * (`specs/instrumentation.md`), a guarantee `instrumentation/frame-division-movement`
 * and `instrumentation/frame-division-projectile` decide — and nothing either
 * ending reads depends on a fine step: no projectile travels here, so the one step
 * size this project has to respect does not arise, and a `33` ms frame is an
 * ordinary frame. What these checks decide is which SCREEN the run arrives on and
 * what it draws there, which is a handful of frames either side of a transition.
 */
const ENDING_HZ = 30;

/** Frames of the ending clock covering `s` seconds, rounded up. */
function endingTicks(seconds: number): number {
  return Math.ceil(seconds * ENDING_HZ);
}

/** A harness whose clock runs at the rate a run is driven to its ending at. */
export function createEndingHarness(): Promise<Harness> {
  return createHarness({
    clock: new ConstantClock((TICK_MS * TICK_HZ) / ENDING_HZ),
  });
}

/** The difficulty both endings are driven at: the shortest run, so `N` is 40. */
export const ENDING_DIFFICULTY = "easy";

/** The waves that difficulty runs, `N`. */
export const ENDING_WAVES = difficultyById(ENDING_DIFFICULTY).waves;

/**
 * The Grid Integrity a won run is left holding.
 *
 * A number of its own, sharing no digits with the wave count, so that reading it
 * off the victory screen's text cannot pick up some other figure by accident.
 */
export const VICTORY_INTEGRITY = 13;

/** The wave a lost run is lost on. */
export const OVERLOAD_WAVE = 17;

/**
 * Win the run: clear wave `N`, let the finale run, and arrive at the victory
 * screen.
 *
 * The final wave is opened and emptied rather than fought: `clearUnits` kills
 * nothing and leaks nothing, so no bounty is paid and no Grid Integrity is lost,
 * and "a wave with nothing left to release and nothing left on the yard clears on
 * the next advance" (`specs/instrumentation.md`). Clearing wave `N` with Grid
 * Integrity remaining is exactly the victory condition of `specs/campaign.md`, so
 * everything after that — the finale, the Overload Dynamo's grounding out at the
 * collector, and the victory screen behind it — is the game's own.
 *
 * THE DYNAMO IS PUT ON THE COLLECTOR RATHER THAN WALKED TO IT, which is the same
 * posing `reachOverload` does below with the mote that ends a lost run: the unit
 * the game itself released is moved to a point, and the game then decides what
 * that means. Nothing about the ending is posed — the wave still clears on its
 * own advance, the finale still opens on `endWave`'s own rule, and the victory
 * screen still arrives through the leak the Dynamo grounds out on.
 *
 * WHY IT IS NOT WALKED. The walk is a minute or so of simulation on any of the
 * three maps, and every frame of it is a real update AND a real render — frames
 * that buy these two checks nothing, since what they decide is what the victory
 * screen DRAWS. The walk itself is decided where it belongs, by
 * `campaign/finale-dynamo-walks`, which is the point about the walk.
 */
export async function reachVictory(h: Harness): Promise<void> {
  openYard(h, {
    difficulty: ENDING_DIFFICULTY,
    wave: ENDING_WAVES,
    integrity: VICTORY_INTEGRITY,
  });
  h.debug.spawnUnit("mote");
  h.debug.clearUnits();

  const cleared = await h.until((s) => s.phase === "finale", {
    maxFrames: endingTicks(5),
    poll: 3,
  });
  assertEqual(
    cleared.hit,
    true,
    `clearing wave ${ENDING_WAVES}, the last of an ${ENDING_DIFFICULTY} run, ` +
      "to put the run into the finale (specs/campaign.md)",
  );

  // The finale releases exactly one Overload Dynamo; it is the only unit the
  // emptied yard can be carrying.
  const released = cleared.snapshot.units.filter(
    (unit) => unit.type === "overload",
  );
  assertTruthy(
    released.length === 1,
    "the finale to release its Overload Dynamo onto the emptied yard " +
      `(specs/campaign.md); the yard carries ${
        cleared.snapshot.units.length === 0
          ? "no units"
          : cleared.snapshot.units.map((unit) => unit.type).join(", ")
      }`,
  );
  const dynamo = released[0]!;

  const collector = mapById(cleared.snapshot.map).collector;
  const at = tileCenter(collector.col, collector.row);
  h.debug.setUnitWaypoint(dynamo.id, COLLECTOR_WAYPOINT);
  h.debug.setUnitPosition(dynamo.id, at.x, at.y);

  const won = await h.until((s) => s.screen === "victory", {
    maxFrames: endingTicks(5),
    poll: 3,
  });
  assertEqual(
    won.hit,
    true,
    "the finale's Overload Dynamo to ground out at the collector and the run " +
      "to arrive at the victory screen (specs/campaign.md)",
  );
}

/**
 * Lose the run: one unit grounds out at the collector with the last point of Grid
 * Integrity on the counter.
 *
 * The unit is released through the real spawner and put on the collector heading
 * for it, so the leak is the game's own — `specs/economy.md` costs a Mote `1` Grid
 * Integrity for grounding out, and "Grid Integrity reaching `0` or below ends the
 * run in defeat immediately".
 */
export async function reachOverload(h: Harness): Promise<void> {
  openYard(h, { wave: OVERLOAD_WAVE, integrity: 1, charge: 0 });
  const collector = mapById(h.snapshot().map).collector;
  releaseUnit(h, "mote", {
    waypoint: COLLECTOR_WAYPOINT,
    at: tileCenter(collector.col, collector.row),
  });

  const lost = await h.until((s) => s.screen === "overload", {
    maxFrames: endingTicks(5),
    poll: 3,
  });
  assertEqual(
    lost.hit,
    true,
    "a leak taking the last point of Grid Integrity to end the run in defeat " +
      "(specs/economy.md, specs/campaign.md)",
  );
}
