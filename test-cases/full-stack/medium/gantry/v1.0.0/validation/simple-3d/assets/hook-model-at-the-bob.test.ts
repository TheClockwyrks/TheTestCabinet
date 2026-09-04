// assets/hook-model-at-the-bob — the hook block is drawn where the bob is, so it
// goes where the bob goes.
//
// `specs/assets.md` § The models says where the model goes: "The game draws each
// model wherever its subject is: … the hook at the bob turned to the grip's yaw
// …". `specs/state.md` gives the bob as the run's own reading, `run.bob.pos`, so
// the two halves of this reading are both the build's: where it says the bob is,
// and where it says it drew the hook.
//
// THE BOB IS PUT SOMEWHERE OF THE CHECK'S CHOOSING rather than left where a run
// leaves it, because a hook drawn at a fixed point on the crane and a hook drawn
// at the bob agree wherever the bob happens to start. `setBob` "puts the pendulum
// bob at a world position" (`specs/instrumentation.md`), and the model must
// follow it there.
//
// THE TOLERANCE IS THE MODEL'S OWN HALF-HEIGHT. A model is drawn AT a point by
// standing its own middle there, and `specs/assets.md` sizes the hook "about
// 0.6 x 1 x 0.6 units", so a whole unit of reach is generous against the figure
// the specification states and still far short of anywhere else on the crane.

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

/** Where the bob is put, well away from anywhere the crane rests it. */
const BOB = { x: 4, y: 5, z: -3 };

/** How far the hook may be drawn from the bob (`specs/assets.md`). */
const REACH = 1;

it("draws the hook model where the run says the bob is", async () => {
  await openSite(h, 0);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.advance(1);

  const snapshot = await h.snapshot();
  const bob = snapshot.run.bob.pos;
  const hooks = entriesOf(await h.drawn(), "model", "hook");

  await h.capture("hook", "The hook block drawn at the bob");

  assertTrue(hooks.length > 0, "a hook model among what the frame drew");
  const away = distance3(entryAt(hooks[0]!), bob);
  assertTrue(
    away <= REACH,
    `the hook drawn within ${REACH} unit of the bob at ` +
      `(${bob.x}, ${bob.y}, ${bob.z}) — it was drawn ${away.toFixed(2)} away, ` +
      "at (" +
      `${hooks[0]!.x.toFixed(2)}, ${hooks[0]!.y.toFixed(2)}, ` +
      `${hooks[0]!.z.toFixed(2)})`,
  );
});
