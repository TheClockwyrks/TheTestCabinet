// runs/step-from-editing-starts-paused-at-the-settle — pressing `step` while editing
// a machine that is ready to run starts the run and stops it at its settle, before
// cycle `0` has run.
//
// THE RULE. "The `play` action starts a run when every rise and every set is placed;
// otherwise it does nothing and the heading states which are missing. `step` under
// the same condition starts the run paused at its settle" (`specs/editor.md`,
// Running the machine). What the settle is, and where it leaves the counter, is
// `specs/simulation.md`'s run-start sequence: "Every arm and wheel takes its rest
// pose ... The settle runs: one pass of the boundary sequence defined below, on a
// field holding only fixtures. The cycle counter starts at `0` and the machine
// begins cycle `0`." One pass of that sequence includes the rises: "the sigil phase,
// then sets, then rises". `specs/controls.md` binds `step` to `KeyN` and gives
// "`editor`, while editing" the row that reads it.
//
// THE CONFIGURATION. `BARE`, whose one reagent and one product are both a lone `sol`,
// with the machine the readiness condition asks for and nothing more: its one rise at
// `(-3, 0)` and its one set at `(3, 0)`, both placed through the surface, which
// "throws an `Error` naming the first rule it breaks" on an illegal placement. No arm
// is placed, so nothing the settle raises can be carried, collide, or be delivered:
// what is on the field afterwards is what the settle put there.
//
// THE RUN IS READ AS ABSENT FIRST. `sim` reports `null` while editing
// (`specs/instrumentation.md`, "`sim` | `null` while editing"), and that is read back
// before the press, so the run this check reads is a run the press started.
//
// THE VERDICT is the item's four readings. `sim.status` is `paused` — not `running`,
// which is what `play` would have left; `sim.cycle` is `0` and `sim.fraction` is `0`,
// so no cycle has run; and the rise's `sol` is resting on `(-3, 0)`, so the settle's
// pass of the boundary sequence did run. The fraction is read through `assertNear` at
// `FRACTION_TOLERANCE`, since `specs/instrumentation.md` carries it as a running sum
// whose figures "agree to within the rounding of that sum rather than bit for bit".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull, assertNull } from "../assert";
import { FRACTION_TOLERANCE } from "../constants";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  moteAt,
  openChallengeDocument,
  placeRise,
  placeSet,
  stepAction,
  type Harness,
} from "../harness";

/** The lone mote `BARE`'s one reagent is made of, which its rise spawns. */
const REAGENT = "sol";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the run paused at cycle 0, fraction 0, with the settle's rise spawned", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await placeRise(h, 0, WEST);
  await placeSet(h, 0, EAST);

  const editing = await h.snapshot();
  assertEqual(editing.screen, "editor", "the challenge is open in the editor");
  assertNull(
    editing.sim,
    "sim reports null while editing, so the run read below is one the press started",
  );

  await stepAction(h);
  await captureStill(h, "settled");

  const started = await h.snapshot();
  assertNotNull(
    started.sim,
    "step on a machine with every rise and every set placed starts a run",
  );
  assertEqual(
    started.sim?.status,
    "paused",
    "step starts the run PAUSED at its settle, where play would have left it running",
  );
  assertEqual(
    started.sim?.cycle,
    0,
    "the cycle counter starts at 0: the settle is not a cycle",
  );
  assertNear(
    started.sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "no part of cycle 0 has run, so the fraction stands at 0",
  );
  assertEqual(
    moteAt(started, WEST)?.type,
    REAGENT,
    "the settle ran one pass of the boundary sequence, so the rise has spawned its reagent",
  );
});
