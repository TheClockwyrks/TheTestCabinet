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

import { assertEqual, assertTruthy } from "../assert";
import {
  COLLECTOR_WAYPOINT,
  difficultyById,
  mapById,
  tileCenter,
} from "../constants";
import { openYard, releaseUnit, ticks, type Harness } from "../harness";

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
 * three maps, and under this engine every frame of it is a browser frame the
 * harness drives one at a time — frames that buy these two checks nothing, since
 * what they decide is what the victory screen DRAWS. The walk itself is decided
 * where it belongs, by `campaign/finale-dynamo-walks`, which is the point about
 * the walk.
 */
export async function reachVictory(h: Harness): Promise<void> {
  await openYard(h, {
    difficulty: ENDING_DIFFICULTY,
    wave: ENDING_WAVES,
    integrity: VICTORY_INTEGRITY,
  });
  await h.debug.spawnUnit("mote");
  await h.debug.clearUnits();

  const cleared = await h.until((s) => s.phase === "finale", {
    maxFrames: ticks(5),
    poll: 12,
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
  await h.debug.setUnitWaypoint(dynamo.id, COLLECTOR_WAYPOINT);
  await h.debug.setUnitPosition(dynamo.id, at.x, at.y);

  const won = await h.until((s) => s.screen === "victory", {
    maxFrames: ticks(5),
    poll: 12,
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
  await openYard(h, { wave: OVERLOAD_WAVE, integrity: 1, charge: 0 });
  const collector = mapById((await h.snapshot()).map).collector;
  await releaseUnit(h, "mote", {
    waypoint: COLLECTOR_WAYPOINT,
    at: tileCenter(collector.col, collector.row),
  });

  const lost = await h.until((s) => s.screen === "overload", {
    maxFrames: ticks(5),
    poll: 12,
  });
  assertEqual(
    lost.hit,
    true,
    "a leak taking the last point of Grid Integrity to end the run in defeat " +
      "(specs/economy.md, specs/campaign.md)",
  );
}
