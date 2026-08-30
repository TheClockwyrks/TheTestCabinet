// progression/level-clears-on-last-segment — removing the last segment clears
// the level.
//
// `specs/progression.md`, Clearing a level: "A level clears on the step in which
// the last of its worm segments is removed." That is a TRANSITION rather than a
// predicate, and this point is the transition half of it: the removal happens,
// and the run leaves the level it was on. The other half — that a board holding
// no segment from which none has been removed is being played rather than
// cleared — is `progression/empty-board-does-not-clear`, and the two are
// separate points because a build that clears on an empty board and a build that
// never clears at all are two different failures.
//
// The board carries the level's whole worm as ONE segment, which is the shortest
// board on which "the last of its segments" exists, and a real bolt takes it
// away. Nothing else stands on the board, so the removal is the only thing that
// could have cleared the level.
//
// WHAT IS READ, AND WHAT IS NOT. That the run went PAST the level it was on —
// the words `specs/progression.md` uses for the clear. By exactly how much the
// level goes up is `progression/level-advances`, and what the clear pays is
// `scoring/level-clear-bonus`; a build that jumped from level `1` to level `12`
// passes here and fails there, which is the split those points are for.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { cutLastSegment } from "./run";

/** The level the run is posed on, with room above it for the clear to go to. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the run past the level whose last segment was cut", async () => {
  await startPlaying(h, { level: LEVEL });

  await cutLastSegment(h);

  await captureStill(h, "cleared");
  const after = await h.snapshot();
  assertLength(
    after.worms,
    0,
    "precondition: the bolt removed the last segment (specs/worm.md)",
  );
  assertGreaterThan(
    after.level,
    LEVEL,
    "the level the run stands on once the last segment was removed",
  );
});
