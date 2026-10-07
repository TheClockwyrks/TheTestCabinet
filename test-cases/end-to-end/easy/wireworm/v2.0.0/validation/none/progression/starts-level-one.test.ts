// progression/starts-level-one — a new run opens at level 1.
//
// `specs/progression.md`, Starting a run: the same table gives Level `1` and
// "The level reached" `1`. Both are read, because both are the one rule — a run
// begins at the first level and has reached no further — and `specs/ui.md` has
// the end screens report the second of them, so a run that opened reporting a
// level it never played would report it at the end.
//
// The title is left standing at level `9`, with the level reached at `9` to
// match: a run that ended there is exactly where a title screen comes from. A
// build that lays the starting level answers `1` and `1`; one that carries the
// old run's level into the new one answers `9`; one that lays the level but not
// the level reached answers `1` and `9`, which is the model the end screens
// would misreport.
//
// The lives and the score the same opening lays are the two points next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openRunFrom } from "./run";

/** The level the title is left standing at, and the level it says it reached. */
const STALE_LEVEL = 9;

/** The level a run opens at, and the level it has reached on opening. */
const FIRST_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a run at level 1, having reached level 1", async () => {
  await openRunFrom(h, async (debug) => {
    await debug.setLevel(STALE_LEVEL);
    await debug.setReachedLevel(STALE_LEVEL);
  });

  await captureStill(h, "opening");
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    "precondition: DESCEND opened a run (specs/ui.md)",
  );
  assertEqual(opened.level, FIRST_LEVEL, "the level the new run reports");
  assertEqual(
    opened.reachedLevel,
    FIRST_LEVEL,
    "the level reached the new run reports",
  );
});
