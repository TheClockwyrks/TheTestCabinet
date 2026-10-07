// scoring/death — the two readings each "a death scores nothing" point is decided
// on, and the account they are read through.
//
// `specs/scoring.md` lists every award the game pays — a row advanced, a bay
// completed, the time left on the clock, a bonus catch, a level cleared, a run
// won — and a death is on none of those lists. `specs/progression.md` gives a
// lost life a `DEATH_PAUSE` hold and a respawn on the near shore, and neither is
// an award either. So the score a player had before a death is the score they
// have after it, through the hold and out the other side.
//
// THE EDGE THE RULES ALREADY IMPLY. Nothing in the specification says "a death
// scores nothing" in so many words; it follows from the award list being closed.
// A build that pays for the rows a respawn walks back, or that awards the time
// left on a clock a death stopped, is what the three points that use this module
// exist to catch.
//
// THREE POINTS, NOT ONE, which is why this is a module beside them rather than a
// prelude inside one file. `specs/progression.md` gives the crossing three
// distinct ways to end badly — a fall into open water, a vehicle arriving on the
// critter, and a bear reaching it — and they run through different code, so a
// build that scores one of them and not the others is named for the one it
// scored. Each point poses its own death, records its own replay, and fails on
// its own.
//
// THE SCORE IS POSED ON THE BOARD FIRST, so the reading is "unchanged" rather
// than "still zero": a build that reset the score to `0` on a death would pass a
// check that started at `0`, and it is the same defect from a player's side as
// one that added to it.
//
// THE READING IS TAKEN TWICE per death — on the frame the life was lost, and
// again once the hold has run out and the crossing has begun again — because the
// respawn is where a build that pays for the rows it walks back would pay.

import { assertEqual } from "../assert";
import { DEATH_PAUSE } from "../constants";
import {
  captureReplay,
  ticksFor,
  type FloeSnapshot,
  type Harness,
} from "../harness";

/** The score standing before each death, so "unchanged" is a real reading. */
export const POSED_SCORE = 4321;

/** How far past `DEATH_PAUSE` the second reading is taken, in seconds. */
const TOLERANCE = 0.1;

/** Whole frames that carry the death's hold out, so the crossing begins again. */
const RESPAWN_TICKS = ticksFor(DEATH_PAUSE + TOLERANCE);

/** The two readings a death is decided on. */
export interface DeathReadings {
  died: FloeSnapshot;
  respawned: FloeSnapshot;
}

/**
 * Run a posed death out and hand back the two readings the point is decided on.
 *
 * The score is posed before the death rather than after it, so what the two
 * readings are compared against is a figure the build was carrying when the
 * life was lost.
 */
export async function die(
  h: Harness,
  outputId: string,
  drive: number,
): Promise<DeathReadings> {
  return captureReplay(h, outputId, async () => {
    await h.advance(drive);
    const died = h.snapshot();
    await h.advance(RESPAWN_TICKS);
    return { died, respawned: h.snapshot() };
  });
}

/** Both readings carry the score the death began with. */
export function scoredNothing(what: string, readings: DeathReadings): void {
  assertEqual(
    readings.died.lives,
    2,
    `${what}: the one life it costs, so a death really happened ` +
      `(specs/progression.md)`,
  );
  assertEqual(
    readings.died.score,
    POSED_SCORE,
    `${what}: the score on the frame the life was lost — a death is on none ` +
      `of the lists specs/scoring.md pays from`,
  );
  assertEqual(
    readings.respawned.score,
    POSED_SCORE,
    `${what}: the score once the hold ran out and the crossing began again — ` +
      `a respawn pays for none of the rows it walks back (specs/scoring.md)`,
  );
}
