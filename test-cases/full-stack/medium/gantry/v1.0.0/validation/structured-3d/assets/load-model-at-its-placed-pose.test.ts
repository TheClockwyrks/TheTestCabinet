// assets/load-model-at-its-placed-pose — a placed load's model is drawn
// on the pad it was set down on.
//
// `specs/assets.md` § The models: "The game draws each model wherever its subject
// is: … each load's model at its own pose …". `specs/state.md` reports a load's
// pose as the run's own reading — `run.loads[i].pos` and its phase — so both
// halves of this comparison are the build's: where it says the load is, and where
// it says it drew the load's model.
//
// THE PHASE IS POSED RATHER THAN PLAYED. `setLoadPhase` "sets a load's phase"
// and `setLoadPose` "puts a load's lift point at a world position"
// (`specs/instrumentation.md`), which is how this reaches a placed load without
// flying the whole job to reach one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  addOneLoad,
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

/** The class this check carries, and where it waits and is wanted. */
const CLASS = "crate" as const;
const MASS = 40;
const FROM = { x: 7, y: 0, z: -3, yaw: 0 };
const TO = { x: -6, y: 0, z: 8, yaw: 0 };

/** How far the model may be drawn from the pose the run reports. */
const REACH = 1.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the placed load's model at the pose the run reports", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await addOneLoad(h, CLASS, MASS, FROM, TO);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setLoadPose(0, TO.x, TO.y, TO.z, TO.yaw);
  await h.debug.setLoadPhase(0, "placed");
  await h.advance(1);

  const snapshot = await h.snapshot();
  const load = snapshot.run.loads[0]!;
  assertEqual(load.phase, "placed", "the load's phase this check is about");

  const models = entriesOf(await h.drawn(), "model", CLASS);

  await h.capture("placed", "A placed load on its pad");

  assertTrue(models.length > 0, `a \`${CLASS}\` model among what the frame drew`);
  const away = distance3(entryAt(models[0]!), load.pos);
  assertTrue(
    away <= REACH,
    `the load's model drawn within ${REACH} units of the pose the run reports, ` +
      `(${load.pos.x.toFixed(2)}, ${load.pos.y.toFixed(2)}, ` +
      `${load.pos.z.toFixed(2)}) — it was drawn ${away.toFixed(2)} away`,
  );
});
