// instrumentation/draw-pod-returns-an-outcome — every call answers with a
// kind name or null.
//
// specs/instrumentation.md, `drawPod()`: it "returns what it decided: the kind
// of the pod it would shed, one of the five kind names, or `null` for a draw
// that sheds nothing", and "each call is one independent draw". The check
// makes a run of calls and reads the shape of every answer: a build whose
// `drawPod` returns `undefined`, a boolean, or a name off the table fails on
// the first such answer. Whether the answers follow the odds is the pods
// category's; that the calls change nothing is `draw-pod-changes-nothing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { POD_KINDS } from "../constants";
import {
  captureStill,
  drawPods,
  isolate,
  openHarness,
  type Harness,
} from "../harness";

/** Calls made, each read for the shape of its answer. */
const DRAWS = 200;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("answers each call with a kind name or null", async () => {
  await isolate(h);
  const outcomes = await drawPods(h, DRAWS);
  await h.tick(1);
  await captureStill(h, "drawn");

  assertLength(outcomes, DRAWS, "one answer per call");
  for (const outcome of outcomes) {
    assertTrue(
      outcome === null || (POD_KINDS as readonly string[]).includes(outcome),
      `an outcome that is a kind name or null (got ${String(outcome)})`,
    );
  }
});
