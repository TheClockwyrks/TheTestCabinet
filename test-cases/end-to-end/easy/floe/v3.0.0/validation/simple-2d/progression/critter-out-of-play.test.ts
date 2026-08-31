// progression/critter-out-of-play — through the death hold the critter is off the
// strait, and a second hazard arriving on the tile it died on costs nothing.
//
// specs/progression.md: "the critter leaves the strait ... Through the whole hold the
// critter is out of play, so nothing on the strait can reach it and no second life is
// lost."
//
// THE SECOND HAZARD IS A REAL ONE, DRIVEN ONTO THE TILE BY THE GAME ITSELF. Both
// vehicles are laid before the drive begins, on one ice lane given a direction and a
// speed of this check's own choosing, so the strait does the whole of the work: the
// first car reaches the critter and takes the life, and the second is six tiles back
// and reaches the same tile well inside the hold that follows. Nothing is posed
// mid-drive and nothing is teleported onto anything.
//
// THE ARITHMETIC, ALL OF IT FROM `LANE_SPEED`. The lane runs rightward at
// `LANE_SPEED` tiles a second, which is `320` units a second. A two-tile car covers
// `[x, x + 64)`, so it covers the critter's centre at `tileCX(20)` (`656`) while its
// left edge is in `(592, 656]`.
//
//   - the first car starts at `tileLeft(18)` (`576`) and passes `592` at `0.05` s,
//     so the life is taken within the first six ticks;
//   - the second starts at `tileLeft(12)` (`384`) and is over that centre from
//     `0.65` s to `0.85` s, which is inside the `DEATH_PAUSE` (`0.9` s) hold begun a
//     twentieth of a second in;
//   - the reading is taken at `0.75` s, a tenth of a second after the second car
//     arrived and two tenths before the hold expires.
//
// WHAT IS READ. That the critter is out of play at both readings, and that the
// counter has not moved between them: exactly one life for the whole hold, however
// many hazards crossed the tile. A build that left the critter in play would take a
// second life from the second car and read a different number.
//
// The second car's arrival is asserted as the SITUATION rather than as the
// requirement, so a build that failed to drive it there fails naming that rather than
// being credited with a hazard that never came.

import { afterEach, beforeEach, it } from "vitest";
import { START_COL, tileCX } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coversX,
  createHarness,
  itemsInRow,
  poseLane,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The ice row the death is taken on, and the three columns in play. */
const ROW = 15;
const CRITTER_COL = START_COL;
const FIRST_CAR_COL = CRITTER_COL - 2;
const SECOND_CAR_COL = CRITTER_COL - 8;

/** The speed and direction this check gives the lane. */
const LANE_SPEED = 10;
const LANE_DIR = 1;

/** The reading that catches the death, and the one taken deep inside the hold. */
const DEATH_READ = ticksFor(0.1);
const HOLD_READ = ticksFor(0.75) - DEATH_READ;

/** Ticks of the hold recorded after the reading, for the replay alone. */
const AFTER_TICKS = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the critter out of play for the whole hold, at the cost of one life", async () => {
  startCrossing(h);
  poseLane(h, ROW, "car", [SECOND_CAR_COL, FIRST_CAR_COL]);
  h.debug.setCritterTile(CRITTER_COL, ROW);
  h.debug.setLaneDirection(ROW, LANE_DIR);
  h.debug.setLaneSpeed(ROW, LANE_SPEED);

  const before = h.snapshot();
  assertEqual(before.phase, "crossing", "a live crossing before the first car");
  assertEqual(
    before.critter.present,
    true,
    "a critter on the strait to be struck",
  );

  const { struck, held } = await captureReplay(h, "pause", async () => {
    await h.advance(DEATH_READ);
    const first = h.snapshot();
    await h.advance(HOLD_READ);
    const second = h.snapshot();
    await h.advance(AFTER_TICKS);
    return { struck: first, held: second };
  });

  // The situation both readings were taken in: a life was lost, and a second vehicle
  // later arrived on the tile the critter died on.
  assertEqual(struck.phase, "dying", "a life lost to the first car");
  assertEqual(
    held.phase,
    "dying",
    "still inside the hold at the second reading",
  );
  assertTrue(
    itemsInRow(held.vehicles, ROW).some((item) =>
      coversX(item, tileCX(CRITTER_COL)),
    ),
    `a second vehicle covering column ${CRITTER_COL} during the hold`,
  );

  assertEqual(
    struck.critter.present,
    false,
    "a critter off the strait the moment the life was lost",
  );
  assertEqual(
    held.critter.present,
    false,
    "a critter still off the strait through the hold (specs/progression.md)",
  );
  assertEqual(
    held.lives,
    struck.lives,
    "no second life lost to the hazard that crossed the tile",
  );
});
