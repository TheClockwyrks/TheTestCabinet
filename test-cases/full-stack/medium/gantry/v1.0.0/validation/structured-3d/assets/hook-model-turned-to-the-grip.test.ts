// assets/hook-model-turned-to-the-grip — the hook block carries the grip's yaw,
// so what the hook is holding turns with it.
//
// `specs/assets.md` § The models: "The game draws each model wherever its subject
// is: … the hook at the bob turned to the grip's yaw …". The grip is one of the
// four axes, reported as `run.axes.grip.value` (`specs/state.md`).
//
// TWO ANGLES, for the reason the slew check gives: what yaw the model carries at
// any single grip value is the build's own zero, and what the requirement fixes
// is that the drawing follows the axis.

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

const FROM = 0;
const TO = 90;
const TOLERANCE = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

const turn = (from: number, to: number): number => {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

it("turns the hook model with the grip axis", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);

  await h.debug.setAxis("grip", FROM);
  await h.advance(1);
  const before = entriesOf(await h.drawn(), "model", "hook");
  assertTrue(before.length > 0, "a hook model among what the frame drew");

  await h.debug.setAxis("grip", TO);
  await h.advance(1);
  const after = entriesOf(await h.drawn(), "model", "hook");

  await h.capture("grip", "The hook turned to the grip");

  assertTrue(after.length > 0, "a hook model after the grip turned");
  const turned = Math.abs(turn(before[0]!.yaw, after[0]!.yaw));
  assertTrue(
    Math.abs(turned - Math.abs(TO - FROM)) <= TOLERANCE,
    `the hook model to turn with the grip: the axis turned ` +
      `${Math.abs(TO - FROM)} degrees and the model turned ${turned.toFixed(1)}`,
  );
});
