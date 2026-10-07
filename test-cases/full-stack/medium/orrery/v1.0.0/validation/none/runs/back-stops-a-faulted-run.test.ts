// runs/back-stops-a-faulted-run — a fault is not a dead end.
//
// THE RULE, in two sentences that say the same thing. "A fault freezes the run
// where it stood: the status becomes `faulted` and nothing advances further.
// `back` returns to editing" (`specs/simulation.md`, Faults). And "Stopping a
// run, from the `back` action IN ANY SIM STATUS, discards the motes and every
// runtime pose and returns to editing with the machine exactly as it was placed"
// (`specs/simulation.md`, The run). `specs/editor.md` routes the key: at
// `faulted` the editor reads `back`.
//
// THE CONFIGURATION. One arm carrying `advance` while mounted on no track, which
// `specs/simulation.md` faults as `unmounted` at the fetch of cycle `0` — the
// earliest and cheapest fault there is, so what the check is deciding is the way
// out rather than the way in. Nothing else is on the field.
//
// THE VERDICT. After `back`, `sim` is `null` on the editor screen with the
// challenge still open, and the editor takes an edit again: a drag out of the
// tray places a second arm beside the one that faulted. A build that left the
// player staring at a frozen field would report a live `sim`, or would swallow
// the drag, and fails on one or the other.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  backAction,
  captureStill,
  createHarness,
  dragFromTray,
  openBareRun,
  type Harness,
} from "../harness";

/** One arm told to `advance` while mounted on no track: an `unmounted` fetch fault. */
const UNMOUNTED = solution([
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["advance"]),
]);

/** Where the arm placed after the fault is dropped. */
const PLACED = at(2, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops a faulted run and takes edits again", async () => {
  await openBareRun(h, { challenge: BARE, machine: UNMOUNTED });
  await advanceCycles(h, 1);

  const faulted = await h.snapshot();
  assertNotNull(faulted.sim, "the run is live up to the fault");
  assertEqual(
    faulted.sim?.status,
    "faulted",
    "`advance` on a part mounted on no track faults, which is the state back must leave",
  );
  assertEqual(
    faulted.sim?.fault?.kind,
    "unmounted",
    "the fault is the one the configuration raises",
  );

  await backAction(h);
  await captureStill(h, "editing");

  const stopped = await h.snapshot();
  assertNull(
    stopped.sim,
    "back stops the faulted run, so the snapshot reports no sim",
  );
  assertEqual(stopped.screen, "editor", "back from a fault returns to editing");
  assertNotNull(
    stopped.challenge,
    "the challenge stays open: back stopped the run rather than leaving the editor",
  );
  assertLength(
    stopped.editor.parts,
    1,
    "the machine returns exactly as it was placed: the one arm that faulted",
  );

  await dragFromTray(h, 0, PLACED);

  const edited = await h.snapshot();
  assertLength(
    edited.editor.parts,
    2,
    "the editor takes an edit again, so a fault is never a dead end",
  );
  assertEqual(
    edited.editor.parts[1]?.kind,
    "arm",
    "tray entry 0 is the challenge's one permitted kind",
  );
});
