// assets/ring-model-turns-with-the-arm — the ring model is turned to the slew,
// so it reads as the bearing the arm rides on.
//
// `specs/assets.md` § The models has the ring drawn "on the slew axis", and
// `specs/overview.md` asks the machine to read as one: a bearing drum that stood
// still while the arm swung over it would read as scenery rather than as the
// joint it is. The slew axis is the run's own, reported as
// `run.axes.slew.value` (`specs/state.md`).
//
// TWO ANGLES, NOT ONE. What yaw the model carries at any single slew is the
// build's own zero; that the drawing FOLLOWS the axis is the requirement. So the
// axis is set twice and the two yaws are compared against the turn between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  entriesOf,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A move that keeps the run running and moves nothing (`specs/rigging.md`). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** The two slew angles, and the turn between them. */
const FROM = 0;
const TO = 90;

/** How far the model's turn may fall short of the axis's. */
const TOLERANCE = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The signed difference between two yaws, wrapped into -180..180. */
const turn = (from: number, to: number): number => {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

it("turns the ring model with the slew axis", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);

  await h.debug.setAxis("slew", FROM);
  await h.advance(1);
  const before = entriesOf(await h.drawn(), "model", "ring");
  assertTrue(before.length > 0, "a ring model among what the frame drew");

  await h.debug.setAxis("slew", TO);
  await h.advance(1);
  const after = entriesOf(await h.drawn(), "model", "ring");

  await h.capture("slew", "The ring after the arm has swung");

  assertTrue(after.length > 0, "a ring model after the arm swung");
  const turned = Math.abs(turn(before[0]!.yaw, after[0]!.yaw));
  assertTrue(
    Math.abs(turned - Math.abs(TO - FROM)) <= TOLERANCE,
    `the ring model to turn with the slew: the axis turned ` +
      `${Math.abs(TO - FROM)} degrees and the model turned ${turned.toFixed(1)}`,
  );
});
