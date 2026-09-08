// presentation/attached-load-drawn-at-the-bob — an attached load is drawn where
// it hangs, at the bob.
//
// `specs/overview.md` § Visual design: "AN ATTACHED LOAD VISIBLY HANGS FROM THE
// HOOK on its cable, and its swing is drawn true to the simulation."
// `specs/rigging.md` puts an attached load at the bob, and `specs/state.md`
// reports the bob as `run.bob.pos`.
//
// THE BOB IS PUT SOMEWHERE OF THIS CHECK'S CHOOSING, because a load drawn at a
// fixed point on the crane and one drawn at the bob agree wherever the bob
// happens to rest.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
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

const CLASS = "crate" as const;
const FROM = { x: 7, y: 0, z: -3, yaw: 0 };
const TO = { x: -6, y: 0, z: 8, yaw: 0 };

/** Where the bob is put, well away from where the load waits. */
const BOB = { x: 3, y: 5, z: -2 };

/** How far the load may be drawn from the bob it hangs at. */
const REACH = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws an attached load at the bob it hangs from", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await addOneLoad(h, CLASS, 40, FROM, TO);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setLoadPose(0, BOB.x, BOB.y, BOB.z, 0);
  await h.debug.setLoadPhase(0, "attached");
  await h.advance(1);

  const { run } = await h.snapshot();
  const models = entriesOf(await h.drawn(), "model", CLASS);

  await h.capture("hanging", "The attached load hanging at the bob");

  assertTrue(
    models.length > 0,
    `a \`${CLASS}\` model among what the frame drew`,
  );
  const away = distance3(entryAt(models[0]!), run.bob.pos);
  assertTrue(
    away <= REACH,
    `the attached load drawn within ${REACH} units of the bob at ` +
      `(${run.bob.pos.x.toFixed(2)}, ${run.bob.pos.y.toFixed(2)}, ` +
      `${run.bob.pos.z.toFixed(2)}) — it was drawn ${away.toFixed(2)} away`,
  );
});
