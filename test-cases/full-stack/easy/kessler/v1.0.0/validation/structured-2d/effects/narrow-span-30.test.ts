// effects/narrow-span-30 — catching a narrow pod sets the deflector's span to
// 30 degrees on the catch tick.
//
// specs/pods.md fixes the effect ("`narrow` | The deflector's span becomes
// `30` degrees.") and the catch ("In a tick where the pod's center radius
// moves from `prev_r > 196` to `new_r <= 196` with its center angle within
// the deflector's span, the pod is caught ... and the kind's effect applies").
// The span is a stated whole-degree state figure, so the reading is exact; the
// crossing itself is staged with a clear margin around the 196 boundary
// rather than on it (spawned at 197, falling 2 units in the tick).
//
// THE WORLD IS ONE POD AND THE DEFLECTOR. The field is emptied and both
// driver switches are off, so the only event the tick can resolve is the
// catch.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  open,
  record,
  SPAN_BASE,
  SPAN_NARROW,
  world,
  type Harness,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("sets the span to 30 on the catch tick", async () => {
  const posed = await world(h);
  assertEqual(
    posed.paddle.spanDeg,
    SPAN_BASE,
    "the baseline span before the catch",
  );

  const after = await record(h, "narrow-catch", () => dropPod(h, "narrow"));

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertEqual(after.paddle.spanDeg, SPAN_NARROW, "the span on the catch tick");
});
