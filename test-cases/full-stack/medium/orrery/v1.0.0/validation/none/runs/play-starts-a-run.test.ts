// runs/play-starts-a-run — `play` on a complete machine begins a run, running,
// at cycle `0`.
//
// THE RULE. "The `play` action starts a run when every rise and every set is
// placed" (`specs/editor.md`, Running the machine). What it starts is defined next
// door: "A run simulates the machine as placed in the editor. It begins from the
// `play` or `step` action of `specs/editor.md`, which states when those actions
// start one" (`specs/simulation.md`, The run), and the run-start sequence ends
// "The cycle counter starts at `0` and the machine begins cycle `0`."
//
// WHY THE STATUS IS `running` RATHER THAN `paused`. `specs/simulation.md` defers
// it — "Which action produces `running` rather than `paused` is in
// `specs/editor.md`" — and `specs/editor.md` fixes the pair: `step` "starts the
// run paused at its settle", and "While the status is `running` or `paused`,
// `play` toggles between the two". `play` is therefore the action that produces
// the other one of the two, `running`.
//
// THE CONFIGURATION. `BARE` — one reagent, one product — with every part its
// readiness condition names: the rise for reagent `0`, the set for product `0`,
// and one arm at rest with an empty tape between them, so nothing the run does
// afterwards can fault, deliver or complete. The run is started by PRESSING THE
// KEY `specs/controls.md` binds to `play`, never by `startRun`, because
// `specs/instrumentation.md` says of `startRun` that "the readiness condition the
// `play` action applies is not applied" — the two are different on purpose, and
// this point is about the one that applies it.
//
// THE VERDICT. Before the press `sim` is `null`; after it `sim` is a live run
// whose `status` is `running` and whose `cycle` is `0`. And the run is really
// simulated rather than merely labelled: one further cycle of game time carries
// the counter to `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { armPart, risePart, setPart, solution } from "../formats";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  playAction,
  type Harness,
} from "../harness";

/** The rise for reagent `0`, the set for product `0`, and one idle arm between. */
const COMPLETE_MACHINE = solution([
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a live run at cycle 0 when every rise and every set is placed", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, COMPLETE_MACHINE);

  const editing = await h.snapshot();

  await playAction(h);
  await captureStill(h, "running");

  const started = await h.snapshot();
  assertNull(
    editing.sim,
    "no run is live before the press, so the press is what starts one",
  );
  assertNotNull(
    started.sim,
    "play starts a run when every rise and every set is placed",
  );
  assertEqual(
    started.sim?.status,
    "running",
    "play produces the status step does not: step starts the run paused, and play toggles between running and paused",
  );
  assertEqual(
    started.sim?.cycle,
    0,
    "the cycle counter starts at 0 and the machine begins cycle 0",
  );

  await advanceCycles(h, 1);
  assertEqual(
    (await h.snapshot()).sim?.cycle,
    1,
    "the machine is simulated from cycle 0, so one cycle of game time carries the counter to 1",
  );
});
