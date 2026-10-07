// runs/play-pauses-a-running-run — one press of `play` on a run that is going takes
// it to `paused`.
//
// THE RULE. "While the status is `running` or `paused`, `play` toggles between the
// two" (`specs/editor.md`, Running the machine). `specs/controls.md` binds it —
// "`play` | `Space` | Editor: starts the run, or toggles running and paused" — and
// its screen table gives the row "`editor`, `running` or `paused` | `play`, `step`,
// `speed-up`, `speed-down`, `back`, `mute`", so the press is read here. The two
// statuses are `specs/simulation.md`'s: "`sim.status` is one of `running`, `paused`,
// `faulted`, and `complete`."
//
// THE CONFIGURATION. A live run on a posed challenge with an EMPTY machine and an
// EMPTY field. Nothing can fault and nothing can be delivered, so the status this
// check reads back is the status the press left rather than one a fault or a
// completion reached first — the two statuses `play` does nothing in. The run is
// read as `running` before the press rather than assumed to be.
//
// THE VERDICT. `sim.status` is `paused` after one press, and the run is still live:
// `play` toggles a run between two statuses rather than stopping it, which is
// `back`'s job — "`back` stops the run and returns to editing from any status".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  playAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets sim.status to paused from running", async () => {
  await openBareRun(h, { challenge: BARE });

  const opened = await h.snapshot();
  assertNotNull(
    opened.sim,
    "startRun leaves a live run for the press to act on",
  );
  assertEqual(
    opened.sim?.status,
    "running",
    "the run is running, which is the status this point presses play in",
  );

  await playAction(h);
  await captureStill(h, "paused");

  const after = await h.snapshot();
  assertNotNull(
    after.sim,
    "play toggles the run's status rather than stopping the run",
  );
  assertEqual(
    after.sim?.status,
    "paused",
    "play toggles a running run to paused",
  );
});
