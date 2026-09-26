// progression/bays-survive-death — a death and the crossing that follows it leave
// the level's filled bays exactly as they stood.
//
// specs/progression.md fixes it twice over: what a fresh crossing keeps — "the
// filled bays stay exactly as they are" — and what expiring the death hold leads
// to, "a fresh crossing begins, on the same level, with the filled bays kept".
// specs/bays.md says the same from the bays' side: a bay filled by a hop "stays
// filled through every later crossing of the level, and through a death".
//
// TWO BAYS ARE POSED FILLED, AND THEY ARE NEITHER THE FIRST NOR THE LAST. The
// whole point of a two-of-five pose is that every wrong model reads a DIFFERENT
// array: a build that opened the bays on a death reads five open, one that took
// the death for a level change reads five open at a new level, one that filled
// the bay the critter died near reads three filled, and one that shifted its bay
// array reads the two marks in the wrong places. Bays `1` and `3` are apart from
// each other and away from both ends, so a build that lost track of WHICH bays
// were filled cannot read the right array by symmetry.
//
// THE BAYS ARE POSED RATHER THAN HOPPED INTO, because `setBay` "scores nothing
// and clears no level" (specs/instrumentation.md) and this point is about what a
// DEATH does to bays that already stand filled, not about what fills them —
// that is `bays/fill-on-entry`'s requirement. Three bays stay open, so the pose
// is a level under way rather than one on the edge of clearing.
//
// THE DEATH IS THE CHEAPEST ONE TO REACH: the critter is posed on the emptied
// water band and falls in on the very next tick (specs/water.md). Which death was
// taken is not on this point's route — the hold is the same one whatever began
// it — and `startCrossing` leaves `START_LIVES` (`3`) in hand, so the hold
// expires into a fresh crossing rather than into a game over.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAY_COUNT, DEATH_PAUSE, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksPast,
  type Harness,
} from "../harness";

/** The two bays posed filled: apart from each other, and away from both ends. */
const FILLED_BAYS: readonly number[] = [1, 3];

/** The water tile the death is taken on. */
const DEATH_COL = START_COL;
const DEATH_ROW = 5;

/** The five bays as they are posed, and as they must still read afterwards. */
const POSED: boolean[] = Array.from({ length: BAY_COUNT }, (_, bay) =>
  FILLED_BAYS.includes(bay),
);

/** The one tick the fall needs. */
const FALL_TICKS = 1;

/**
 * The hold, driven out: `DEATH_PAUSE` (`0.9` s) is `108` whole ticks at the
 * `TICK_HZ` (`120`) `specs/overview.md` fixes.
 */
const HOLD_TICKS = ticksPast(DEATH_PAUSE);

/**
 * Two ticks of room past the hold.
 *
 * The hold's own length is `progression/death-pause`'s requirement, not this
 * one's; all this point needs is to be standing on the far side of it, with the
 * fresh crossing already begun. The two ticks cover a build that tests its hold
 * before subtracting the tick rather than after, and the rounding of a hundred
 * and eight subtractions of a hundred-and-twentieth.
 */
const TOLERANCE_TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves exactly the bays that were filled filled across a death", async () => {
  await startCrossing(h);
  for (const bay of FILLED_BAYS) await h.debug.setBay(bay, true);
  await h.debug.setCritterTile(DEATH_COL, DEATH_ROW);

  const posed = await h.snapshot();
  assertDeepEqual(
    posed.bays,
    POSED,
    `bays ${FILLED_BAYS.join(" and ")} filled`,
  );

  const { dying, fresh } = await captureReplay(h, "respawn", async () => {
    await h.advance(FALL_TICKS);
    const lost = await h.snapshot();
    await h.advance(HOLD_TICKS + TOLERANCE_TICKS);
    return { dying: lost, fresh: await h.snapshot() };
  });

  // The situation the reading was taken in: a life really was lost, and the hold
  // it began really did expire into a fresh crossing.
  assertEqual(dying.phase, "dying", "a life lost on the emptied water band");
  assertEqual(fresh.phase, "crossing", "the crossing the hold gave back");
  assertEqual(fresh.critter.present, true, "a critter back on the strait");

  assertDeepEqual(
    fresh.bays,
    POSED,
    "the same bays filled after the death (specs/progression.md)",
  );
});
