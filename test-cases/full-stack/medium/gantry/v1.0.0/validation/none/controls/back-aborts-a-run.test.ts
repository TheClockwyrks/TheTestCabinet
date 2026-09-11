// controls/back-aborts-a-run — `back` on the run screen ends a run in progress
// and returns to the build screen.
//
// `specs/controls.md` § The actions binds `back` to `Escape` and resolves it
// against the first case that applies; the second row is "The run screen, with a
// run in progress — Aborts the run and returns to the build screen". The same
// thing from the run's side (`specs/program.md`): "The `back` action aborts a run
// early and returns to the build screen; an aborted run has no verdict", and what
// an abort leaves is the idle placeholder — `specs/state.md`: the placeholder "is
// what the run carries before the first run of a site, and what opening a site, a
// `reset`, and aborting a run IN PROGRESS put back."
//
// THE RUN IS A REAL ONE, started by the surface's own `startRun`, which "poses
// the `run` action: the same refusals, the same `run-start`, and the same move to
// the run screen". It is driven ten ticks first, so what `back` ends is a run
// that has ticked rather than one caught at its start.
//
// The tape is one long grip turn: `grip` is the hook's yaw, so it asks nothing of
// the structure, and `360` degrees at `GRIP_MAX_RATE` is eight seconds of run
// clock — the run is still in progress when `back` reaches it, and no verdict of
// its own can arrive first. The yard is emptied, so no load and no obstacle can
// end the run instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** `back`'s binding, as `specs/controls.md` fixes it. */
const BACK = BINDINGS.back[0]!;

/** A tape that keeps a run in progress and asks nothing of the structure. */
const HOLD_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven before the abort, so what it ends is a run under way. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends a running run and shows the build screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, HOLD_TAPE);
  await startRun(h);
  const running = await runTicks(h, TICKS);
  assertEqual(running.screen, "run", "the screen a started run shows");
  assertEqual(running.run.phase, "running", "the run `back` is about to abort");

  await h.press(BACK);
  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "the build screen an aborted run returns to");

  assertEqual(
    s.run.phase,
    "idle",
    "run.phase after `back` on the run screen, which aborts the run with no " +
      "verdict (specs/program.md)",
  );
  assertEqual(
    s.screen,
    "build",
    "the screen `back` returns to from an aborted run (specs/controls.md)",
  );
});
