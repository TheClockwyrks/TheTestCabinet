// bays/five-bays — a freshly laid-out level carries five bays, and all five are
// open.
//
// specs/strait.md: `BAY_COUNT` is `5`, and the bay row is solid far shore except
// at those five two-column mouths. specs/bays.md: "A level opens with all
// `BAY_COUNT` (`5`) bays open." specs/progression.md says the same of a run: it
// opens "with the strait laid out for level `1`, all five bays open".
//
// THE RUN IS OPENED THE WAY A PLAYER OPENS IT, from the reset title by confirming
// the highlighted first item, and not posed. A pose is exactly what cannot decide
// this point: `clearBays` would open the five bays the check then read back, and
// `setLevel` lays a strait out without starting anything. What is read here has
// to be what the build's own level layout produced.
//
// The screen is read first, as the situation rather than the requirement: a
// build whose title menu never started a run would leave five open bays sitting
// on the title screen, and this point would pass on a level that was never laid
// out at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { BAY_COUNT } from "../constants";
import {
  captureStill,
  createHarness,
  startRunFromTitle,
  type Harness,
} from "../harness";

/** Five bays, none of them filled: what `specs/bays.md` opens a level with. */
const ALL_OPEN: boolean[] = Array.from({ length: BAY_COUNT }, () => false);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays out five bays and opens every one of them", async () => {
  await startRunFromTitle(h);

  await h.step();
  await captureStill(h, "scene");

  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    "the title menu's first item starts a run (specs/ui.md)",
  );
  assertLength(opened.bays, BAY_COUNT, "bays, one per mouth of the far shore");
  assertDeepEqual(opened.bays, ALL_OPEN, "every bay open at a level's start");
});
