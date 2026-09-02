// instrumentation/set-tally — `setTally` sets one product's tally, the readout
// shows it, and the next delivery adds to it.
//
// THE RULE. "`setTally(index, n)` | Sets the tally of the open challenge's
// product `index` to `n`, a whole number of at least `0`"
// (`specs/instrumentation.md`, The run). What the readout owes the figure:
// "During a run the readout shows at least the status, the cycle count, the
// period, the speed step, and each set's tally against the challenge's `target`"
// (`specs/editor.md`, Layout). And what a delivery does with it: "An accepted
// constellation is consumed whole, and the set's tally rises by `1` for a plain
// product" (`specs/sigils.md`, `set`).
//
// THE WORLD IS POSED, NOT SEARCHED. A bare run on a challenge whose one product
// is a single `sol`, carrying one part: the set for that product, east of the
// field's middle. The field is emptied, so the only constellation that ever
// reaches the set is the one this check spawns, and the completion switch is
// held off, so a satisfied target cannot end the run under it.
//
// THE VERDICT. `sim.tallies` reads back the posed `4`; the readout carries the
// posed figure and the challenge's `target` (how a build words the pair is the
// build's, so what is read is that both figures are drawn in the readout's
// region); and the delivery that follows leaves `5` — the tally rose FROM the
// posed figure rather than from `0`, and the constellation it accepted is gone
// from the field.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull, assertTrue } from "../assert";
import { READOUT_REGION } from "../field";
import { setPart, solution } from "../formats";
import { BARE, EAST, TARGET } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  moteAt,
  openBareRun,
  pauseRun,
  resumeRun,
  spawnMote,
  tallyOf,
  textIn,
  type Harness,
} from "../harness";

/** The posed tally: short of the target, so the delivery cannot complete a run. */
const POSED_TALLY = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses one product's tally, shows it against the target, and adds the next delivery to it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([setPart(0, EAST.q, EAST.r)]),
  });

  await h.debug.setTally(0, POSED_TALLY);
  const posed = await h.snapshot();

  // The clock is held still for the frame that draws the readout, so the picture
  // and the reading are of one moment and the delivery below still starts from a
  // cycle boundary ("The fraction advances only while the status is `running`",
  // `specs/simulation.md`).
  await pauseRun(h);
  await h.advance(1);
  await captureStill(h, "tally");
  const drawn = await h.lastCalls();
  await resumeRun(h);

  await spawnMote(h, EAST, "sol");
  await advanceCycles(h, 1);
  const delivered = await h.snapshot();

  assertNotNull(posed.sim, "the run is live at the pose");
  assertEqual(
    tallyOf(posed, 0),
    POSED_TALLY,
    "setTally(0, 4) sets product 0's tally to the posed figure",
  );
  const shown = textIn(drawn, READOUT_REGION).map((draw) => draw.text);
  assertTrue(
    shown.some((text) => text.includes(String(POSED_TALLY))),
    `the readout shows the posed tally 4; it drew ${JSON.stringify(shown)}`,
  );
  assertTrue(
    shown.some((text) => text.includes(String(TARGET))),
    `the readout shows the tally against the challenge's target ${TARGET}; it drew ${JSON.stringify(shown)}`,
  );
  assertEqual(
    tallyOf(delivered, 0),
    POSED_TALLY + 1,
    "the set consumed one constellation, so its tally rose by 1 from the posed figure rather than from 0",
  );
  assertNull(
    moteAt(delivered, EAST),
    "the accepted constellation was consumed whole, so a delivery really happened",
  );
});
