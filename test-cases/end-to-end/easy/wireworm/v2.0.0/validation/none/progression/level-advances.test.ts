// progression/level-advances — a clear takes the run up exactly one level.
//
// `specs/progression.md`, Clearing a level, on a clear below `TOTAL_LEVELS`
// (`12`): "2. The level goes up by one, and the level reached goes up with it."
//
// The run is posed at level `4` and its whole worm — one segment — is cut away,
// so the clear is the only thing that could have moved the level. A build that
// advances by one answers `5`; one that never advances answers `4`; one that
// counts the clear twice, or that skips a level, answers `6`; one that sends a
// clear straight to the end of the run answers `12`. THAT the removal clears the
// level at all is `progression/level-clears-on-last-segment`; by how much it
// advances is this.
//
// The level reached is read alongside, because the specification moves the two
// together in one sentence and `specs/ui.md` has the end screens report the
// second: a build whose level advances while its level reached stands still
// would misreport every run that ended after a clear.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { cutLastSegment } from "./run";

/** The level the run is posed on, well inside the twelve. */
const LEVEL = 4;

/** What the clear leaves: one level higher, and one only. */
const AFTER_CLEAR = LEVEL + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("advances level 4 to level 5", async () => {
  await startPlaying(h, { level: LEVEL });
  await h.debug.setReachedLevel(LEVEL);

  await cutLastSegment(h);

  await captureStill(h, "advanced");
  const after = await h.snapshot();
  assertLength(
    after.worms,
    0,
    "precondition: the bolt removed the last segment (specs/worm.md)",
  );
  assertEqual(
    after.level,
    AFTER_CLEAR,
    `the level after clearing level ${LEVEL}`,
  );
  assertEqual(
    after.reachedLevel,
    AFTER_CLEAR,
    `the level reached after clearing level ${LEVEL}`,
  );
});
