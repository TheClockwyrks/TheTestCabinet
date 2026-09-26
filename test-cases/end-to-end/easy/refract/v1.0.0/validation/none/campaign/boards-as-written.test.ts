// Refract — campaign/boards-as-written: the course is the twenty-four boards
// specs/campaign-boards.md writes, in the order it writes them.
//
// specs/modes/campaign.md: "specs/campaign-boards.md is authoritative for
// every board's layout ... Build each board exactly as written there. Do not
// substitute, reorder, resize, or rework a board." Campaign progress carries
// no pose (specs/instrumentation.md), so the walk is honest: each board is
// really solved — through routes the case precomputed from the notation under
// the specs/beams.md rules, never from any implementation — to reach the
// next, and each board is held on entry against the parsed notation:
// dimensions, node kinds, channels, and charges. A node's `x`, `y`, and a
// crystal's `spent` are derivations other items own.
//
// A build playing a board of its own invention fails the comparison on entry,
// before the stored routes could stumble over it, so the failure names the
// first board that is not the one specified.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  driveCourse,
  type Harness,
} from "../harness";
import { CAMPAIGN_LENGTH, parseBoard } from "../notation";
import { CAMPAIGN_BOARDS } from "../routes";
import { plainNodes } from "./reading";

/** The board captured as the `course` output: board 12, mid-course in Set B. */
const CAPTURED_INDEX = 11;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters all twenty-four boards exactly as specs/campaign-boards.md writes them", async () => {
  await driveCourse(h, CAMPAIGN_LENGTH, async (snapshot, index) => {
    if (index === CAPTURED_INDEX) {
      // The entry snapshot is already read; the frame just renders it.
      await h.advance(1);
      await captureStill(h, "course");
    }
    const written = parseBoard(CAMPAIGN_BOARDS[index].notation);
    const entered = boardFromSnapshot(snapshot);
    assertEqual(entered.cols, written.cols, `board ${index + 1}: cols`);
    assertEqual(entered.rows, written.rows, `board ${index + 1}: rows`);
    assertDeepEqual(
      plainNodes(entered),
      plainNodes(written),
      `board ${index + 1}: nodes as written`,
    );
  });
});
