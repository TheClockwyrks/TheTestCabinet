// presentation/swing-drawn-true — the drawn load follows the bob the pendulum
// computes, rather than a swing of the drawing's own.
//
// `specs/overview.md` § Visual design: "An attached load visibly hangs from the
// hook on its cable, and ITS SWING IS DRAWN TRUE TO THE SIMULATION." The
// simulation's own answer is `run.bob.pos` each tick (`specs/state.md`), so what
// this asks is that the drawing tracks it as it moves.
//
// THE BOB IS MOVED AND THE DRAWING FOLLOWED. A load drawn at one pose agrees with
// the bob by accident; a load drawn at the bob agrees with it at every pose. So
// the bob is put in two places and the drawing is read at both.

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

/** Two bob poses, far enough apart that a fixed drawing cannot pass both. */
const FIRST = { x: 3, y: 5, z: -2 };
const SECOND = { x: -3, y: 4, z: 2 };

const REACH = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the load at the bob at each of two poses", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await addOneLoad(h, CLASS, 40, FROM, TO);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");

  for (const [index, at] of [FIRST, SECOND].entries()) {
    await h.debug.setBob(at.x, at.y, at.z);
    await h.debug.setLoadPose(0, at.x, at.y, at.z, 0);
    await h.advance(1);
    const { run } = await h.snapshot();
    const models = entriesOf(await h.drawn(), "model", CLASS);
    assertTrue(
      models.length > 0,
      `a \`${CLASS}\` model among what the frame drew, at pose ${index + 1}`,
    );
    const away = distance3(entryAt(models[0]!), run.bob.pos);
    if (index === 1) {
      await h.capture("swing", "The load drawn at the swinging bob");
    }
    assertTrue(
      away <= REACH,
      `the load drawn within ${REACH} units of the bob at pose ${index + 1} — ` +
        `it was drawn ${away.toFixed(2)} away`,
    );
  }
});
