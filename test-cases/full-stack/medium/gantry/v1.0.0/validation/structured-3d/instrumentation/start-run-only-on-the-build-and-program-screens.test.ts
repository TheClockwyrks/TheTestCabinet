// instrumentation/start-run-only-on-the-build-and-program-screens — the run pose
// starts from every screen, and the structure's readiness is what refuses it.
//
// `specs/instrumentation.md` § The run and the screens: "`startRun` still carries
// the `run` action's own refusals, which are the structure's readiness and not a
// screen: it is refused exactly as the action is, leaving the state as it was, and
// `check` says why it would refuse." The rule above the tables is what removes
// the screen: "No operation asks which screen is showing … Those are how a player
// reaches a control and are not an operation's conditions." The readiness stays
// because it is the act itself — `specs/program.md` refuses a start for a
// readiness issue or an empty tape — and rule B keeps a transaction's own rules.
//
// EVERY SCREEN IS DRIVEN, because the screens are not alike: `run` with no run in
// progress is a screen like any other, and the menu screens are where a build
// that gated on "a yard screen" would differ from one that gated on the two the
// `run` ACTION reaches. The minimal crane has no readiness issue and the tape is
// not empty, so the only thing that could hold a start off is the screen, and
// none of these may. Each run is put away with `abortRun`, which ends it "with no
// verdict" and returns the build screen, so every start is made from the same
// standing crane and tape.
//
// THE READINESS CLOSES THE CHECK, because without it a build whose `startRun`
// began a run out of nothing would satisfy every assertion above: the tape is
// emptied and the same call is made from the title screen, and it must begin no
// run and `check` must name `empty-program`.
//
// THE ACTION'S OWN SCREEN GATE IS UNTOUCHED, and is decided by
// `controls/run-key-does-nothing-on-the-run-screen` and
// `controls/run-key-from-the-build-screen` next door: a KEY press is the player's
// route and is still bound to the two screens `specs/controls.md` names.

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

/** The five screens the `run` ACTION does not reach, and this pose does. */
const ELSEWHERE: readonly Screen[] = [
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

it("starts a run from every screen, the readiness deciding rather than the screen", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  const started: { screen: string; phase: string }[] = [];
  for (const screen of ELSEWHERE) {
    await h.debug.setScreen(screen);
    await h.debug.startRun();
    const s = await h.snapshot();
    started.push({ screen, phase: s.run.phase });
    await h.debug.abortRun();
  }

  await h.debug.setScreen("program");
  await h.debug.startRun();
  const onProgram = await h.snapshot();

  await h.debug.abortRun();
  await h.debug.setScreen("build");
  await h.debug.startRun();
  const onBuild = await h.snapshot();

  // The readiness is what still refuses a start: the tape is emptied, and the
  // same call from the title screen begins nothing.
  await h.debug.abortRun();
  await h.debug.clearProgram();
  await h.debug.setScreen("title");
  await h.debug.startRun();
  const unready = await h.snapshot();
  const issues = (await h.check()).issues;

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  for (const [index, screen] of ELSEWHERE.entries()) {
    assertEqual(
      started[index]?.phase,
      "running",
      `the run after startRun on the ${screen} screen: the screen is a ` +
        "player's route to the run action and not the operation's condition " +
        "(specs/instrumentation.md)",
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
  assertEqual(
    unready.run.phase,
    "idle",
    "the run after startRun with an empty tape: the readiness is the act's " +
      "own rule and still refuses the start (specs/program.md)",
  );
  assertEqual(
    issues.includes("empty-program"),
    true,
    "the issue check names for the refused start (specs/structure.md)",
  );
});
