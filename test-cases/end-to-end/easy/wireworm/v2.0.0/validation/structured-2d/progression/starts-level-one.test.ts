// progression/starts-level-one — a new run opens at level 1.
//
// specs/progression.md, Starting a run: a new run opens at level `1`, with the
// level reached at `1` as well — the level reached being the highest level the
// run has opened, which is what the end screens report. The run is opened the
// way a player opens one, through `confirm` on `DESCEND` (specs/ui.md).
//
// THE POSE IS THE DISTINGUISHING VALUE. `reset` already leaves level `1` on the
// title screen, so the title is left standing at a LATER level instead: a build
// whose `DESCEND` opened no run, or one that resumed where a previous run left
// off rather than starting a new one, reads that later level back, and only a
// build that ran the start-of-run rule reads `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/**
 * The level the title is left standing at before `DESCEND` is confirmed.
 *
 * A level a run can really reach — `1..TOTAL_LEVELS` (specs/progression.md) —
 * and nowhere near `1`, so a run that opened at the start and a run that carried
 * on from here can never read as the same number.
 */
const STALE_LEVEL = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run at level 1, with the level reached at 1", async () => {
  resetTo(h);
  h.debug.setLevel(STALE_LEVEL);
  h.debug.setReachedLevel(STALE_LEVEL);

  await tapAction(h, "confirm");
  captureStill(h, "opening");

  const opened = h.snapshot();
  assertEqual(opened.level, 1, "the level a new run opens at");
  assertEqual(opened.reachedLevel, 1, "the level a new run has reached");
});
