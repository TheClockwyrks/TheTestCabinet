// instrumentation/start-run-only-on-the-build-and-program-screens — the run pose
// applies where the `run` action does, and nowhere else.
//
// `specs/instrumentation.md` § The run and the screens: "`startRun` applies on the
// build and program screens, where the `run` action does", and the rule above the
// tables: "Each pose applies on the screens its section names and does nothing on
// any other, exactly as the control it stands for does." `specs/controls.md` binds
// `run` to "start the run, from build or program", and `specs/program.md` opens
// its last section with "A run starts from the build or program screen through the
// `run` action".
//
// EVERYTHING THAT WOULD OTHERWISE REFUSE A START IS REMOVED FIRST, so the only
// thing left to refuse it on the five screens is the screen. The minimal crane has
// no readiness issue and the tape is not empty, which is the whole of what
// `specs/program.md` refuses a start for — so a build that took the call on the
// title screen would begin a run there, and this check reads that it did not: the
// run stays at its idle placeholder and the screen stays where it was.
//
// THE TWO SCREENS THE POSE DOES APPLY ON CLOSE THE CHECK, because the same call
// must start the run on each: without them a build whose `startRun` did nothing
// anywhere would satisfy all five refusals and pass. The run begun from the
// program screen is put away with `abortRun`, which ends it "with no verdict" and
// returns the build screen (`specs/instrumentation.md`), so the second start is
// made from the same standing crane and tape as the first.
//
// `run` is among the five refused screens deliberately — with no run in progress
// it is a screen like any other, and `startRun` is not what puts a caller on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type Screen,
  type TapeStepSpec,
} from "../harness";

/** One short hoist move: enough for a run to legally start. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
];

/** The five screens the `run` action does not reach. */
const REFUSED: readonly Screen[] = [
  "title",
  "howto",
  "select",
  "run",
  "results",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no run off the build and program screens, and starts one on each", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const off: { screen: string; phase: string }[] = [];
  for (const screen of REFUSED) {
    await h.debug.setScreen(screen);
    await h.debug.startRun();
    const s = await h.snapshot();
    off.push({ screen: s.screen, phase: s.run.phase });
  }

  await h.debug.setScreen("program");
  await h.debug.startRun();
  const onProgram = await h.snapshot();

  await h.debug.abortRun();
  await h.debug.setScreen("build");
  await h.debug.startRun();
  const onBuild = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  for (const [index, screen] of REFUSED.entries()) {
    assertEqual(
      off[index]?.phase,
      "idle",
      `the run after startRun on the ${screen} screen, which the run action ` +
        "does not reach (specs/instrumentation.md)",
    );
    assertEqual(
      off[index]?.screen,
      screen,
      `the screen after startRun on the ${screen} screen, which the call ` +
        "leaves as it stands (specs/instrumentation.md)",
    );
  }
  assertEqual(
    onProgram.run.phase,
    "running",
    "the run after the same call on the program screen, one of the two the " +
      "run action reaches (specs/instrumentation.md)",
  );
  assertEqual(
    onBuild.run.phase,
    "running",
    "the run after the same call on the build screen, the other of the two " +
      "(specs/instrumentation.md)",
  );
});
