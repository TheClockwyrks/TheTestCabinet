// audio/refused-start-plays-no-run-start-cue — a refused start is silent.
//
// specs/ui.md § Audio binds `run-start` to "a run starts", and specs/program.md §
// Starting and ending a run says which starts do not: "Starting is refused, with
// the issues listed and no run begun, when the structure has a readiness issue
// (`specs/structure.md`) or the tape is empty (`empty-program`). A refused start
// leaves the player where they were." No run begins, so there is no event for the
// cue to play on; the refusal is read out on the screen instead — "A refused
// start stays on the screen and shows the refusing issues by name" (specs/ui.md §
// Build).
//
// BOTH REFUSALS ARE POSED, because they are the two halves of one sentence and
// they exercise the same edge the same way: a ready crane with an empty tape, and
// a written tape over a crane with no ring. A build that gates the cue on the
// tape alone sounds on the second; one that gates it on readiness alone sounds on
// the first.
//
// THE START IS POSED THROUGH THE SURFACE, not through the key. `startRun` "poses
// the `run` action: the same refusals, the same `run-start`"
// (specs/instrumentation.md), so a build with a mis-bound `run` key fails the
// binding's own point and is graded here on its audio alone. The harness's
// `startRun` helper is deliberately NOT used: it fails a check whose start was
// refused, and a refused start is the whole of this scenario.
//
// THE WORLD IS EMPTY BUT FOR THE CRANE. The yard is cleared, so no load or
// obstacle stands in either arrangement, and the phase and the screen are read
// back after each so the silence is read against a start that really was refused
// rather than one that quietly began.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** A tape with one step in it: enough that `empty-program` is not the issue. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 90, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays no run-start cue when the start is refused", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.advance(1);
  await h.cues();

  /* ---- A ready crane and an empty tape ---------------------------------- */

  const emptyTape = await h.check();
  assertContains(
    emptyTape.issues,
    "empty-program",
    "the issue an empty tape raises, which refuses the start " +
      "(specs/program.md § Starting and ending a run)",
  );
  await h.debug.startRun();
  await h.advance(1);
  const onEmptyTape = await h.cues();
  const afterEmptyTape = await h.snapshot();

  assertEqual(
    afterEmptyTape.run.phase,
    "idle",
    "the run after a start refused for an empty tape: no run begun " +
      "(specs/program.md)",
  );
  assertEqual(
    afterEmptyTape.screen,
    "build",
    "the screen a refused start leaves the player on (specs/ui.md § Build)",
  );
  assertLength(
    onEmptyTape,
    0,
    "the sounds a start refused for `empty-program` plays: `run-start` " +
      'follows "a run starts" (specs/ui.md § Audio) and no run began. They ' +
      `sounded ${JSON.stringify(onEmptyTape)}`,
  );

  /* ---- A written tape and a crane with no ring -------------------------- */

  await poseTape(h, TAPE);
  await h.debug.clearRing();
  await h.advance(1);
  await h.cues();

  const noRing = await h.check();
  assertContains(
    noRing.issues,
    "no-ring",
    "the readiness issue a crane with no slew ring raises, which refuses the " +
      "start (specs/structure.md, specs/program.md)",
  );
  await h.debug.startRun();
  await h.advance(1);
  const onNoRing = await h.cues();
  const afterNoRing = await h.snapshot();
  await h.capture("refused-start", "The build screen after the refused start");

  assertEqual(
    afterNoRing.run.phase,
    "idle",
    "the run after a start refused for a readiness issue: no run begun " +
      "(specs/program.md)",
  );
  assertEqual(
    afterNoRing.screen,
    "build",
    "the screen a refused start leaves the player on (specs/ui.md § Build)",
  );
  assertLength(
    onNoRing,
    0,
    'the sounds a start refused for `no-ring` plays: `run-start` follows "a ' +
      'run starts" (specs/ui.md § Audio) and no run began. They sounded ' +
      `${JSON.stringify(onNoRing)}`,
  );
});
