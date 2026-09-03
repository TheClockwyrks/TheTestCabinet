// assets/trolley-model-on-the-track — the carriage is drawn at the trolley's own
// position along the track, not somewhere fixed on it.
//
// `specs/assets.md` § The models: "The game draws each model wherever its subject
// is: … the trolley on the track at the trolley position …". The trolley axis is
// the run's, reported as `run.axes.trolley.value` (`specs/state.md`), so this
// moves that axis and asks whether what the build drew moved with it.
//
// TWO POSES RATHER THAN ONE. Where the trolley is drawn at any single value is a
// fact about the crane's geometry, which is the build's; that the drawing FOLLOWS
// the value is the requirement. So the axis is set twice, and what is compared is
// how far the model moved against how far the axis did.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  createHarness,
  distance3,
  entriesOf,
  entryAt,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The two trolley positions, far enough apart to tell one from the other. */
const NEAR_POSE = 2;
const FAR_POSE = 6;

it("draws the trolley model at the trolley axis's own position", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);

  await h.debug.setAxis("trolley", NEAR_POSE);
  await h.advance(1);
  const near = entriesOf(await h.drawn(), "model", "trolley");
  assertTrue(near.length > 0, "a trolley model among what the frame drew");

  await h.debug.setAxis("trolley", FAR_POSE);
  await h.advance(1);
  const far = entriesOf(await h.drawn(), "model", "trolley");

  await h.capture("trolley", "The trolley drawn along its track");

  assertTrue(far.length > 0, "a trolley model after the axis moved");
  const moved = distance3(entryAt(near[0]!), entryAt(far[0]!));
  assertTrue(
    moved > (FAR_POSE - NEAR_POSE) / 2,
    `the trolley model to move with its axis: the axis moved ` +
      `${FAR_POSE - NEAR_POSE} units and the model moved ${moved.toFixed(2)}`,
  );
});
