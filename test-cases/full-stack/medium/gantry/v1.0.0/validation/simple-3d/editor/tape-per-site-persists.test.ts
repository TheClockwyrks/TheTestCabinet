// editor/tape-per-site-persists — the tape written on a site is that site's, and
// it is still there when the site is opened again.
//
// `specs/state.md` § The session: "Per site: the structure and the tape authored
// on it, which persist across visits for the session." § What a site opening does
// says an opening "keeps that site's stored structure and tape", and
// `specs/instrumentation.md` closes the reading: "A site that is not open reports
// the structure and tape stored on it through `structure` and `program` once it
// is opened."
//
// SO THE CHECK MAKES TWO VISITS. A tape is written on site 0, site 1 is opened
// and its tape read, and site 0 is opened again and read once more. The first
// reading is what says the tape is per site — site 1 was never written on, so it
// reports nothing — and the second is what says the authoring survived the trip.
// Both are the one requirement: the tape belongs to the site it was written on.
//
// WHAT IS COMPARED IS THE WHOLE STEP, in order, because that is what "the tape
// authored on it" means: `specs/state.md` § The tape gives it as "The ordered
// steps, each a move carrying one or more commands, at most one per axis, or an
// `attach` or `release` action. A command names an axis, an absolute target, and
// a rate." A build that stored the steps as a set, or kept the axes and dropped
// the targets, comes back with a different tape.
//
// THE THREE STEPS COVER BOTH KINDS AND KEEP THE ORDER READABLE: a move, an
// action, and a second move on another axis, so a tape that came back reversed or
// with its two moves swapped is visible. Every command carries a rate greater
// than `0` and at most its axis's max, which is the whole of what
// `specs/program.md` has the tape editor check — "The tape editor accepts a
// command only with a rate greater than `0` and at most the axis's max rate, and
// a move only with at least one command. Targets are accepted as written" — so no
// structure is needed under it and none is built.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The tape written on site 0: a move, an action, and a move on another axis. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 4, rate: HOIST_MAX_RATE },
    ],
  },
  { kind: "action", action: "attach" },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
  },
];

/** The site written on, and the site visited in between. */
const HOME = 0;
const AWAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a site's tape to itself and hands it back on the next visit", async () => {
  await openSite(h, HOME);
  await clearAll(h);
  await poseTape(h, TAPE);

  await openSite(h, AWAY);
  const away = await h.snapshot();
  assertEqual(away.siteIndex, AWAY, "the site that was opened");
  assertLength(
    away.program,
    0,
    `the steps site ${AWAY} reports: nothing was written on it, and site ` +
      `${HOME}'s tape is not carried onto it (specs/state.md)`,
  );

  await openSite(h, HOME);
  await h.advance(1);
  const home = await h.snapshot();
  assertEqual(home.siteIndex, HOME, "the site that was opened again");
  assertLength(
    home.program,
    TAPE.length,
    `the steps site ${HOME} hands back on the next visit (specs/state.md)`,
  );
  for (const [index, step] of TAPE.entries()) {
    const stored = home.program[index];
    assertEqual(stored?.kind, step.kind, `stored step ${index}'s kind`);
    if (step.kind === "action") {
      assertEqual(
        stored?.kind === "action" ? stored.action : null,
        step.action,
        `stored step ${index}'s action`,
      );
      continue;
    }
    const commands = stored?.kind === "move" ? stored.commands : [];
    assertLength(
      commands,
      step.commands.length,
      `the commands stored step ${index} carries`,
    );
    for (const [at, command] of step.commands.entries()) {
      assertEqual(
        commands[at]?.axis,
        command.axis,
        `step ${index}, command ${at}: its axis`,
      );
      assertEqual(
        commands[at]?.target,
        command.target,
        `step ${index}, command ${at}: its target`,
      );
      assertEqual(
        commands[at]?.rate,
        command.rate,
        `step ${index}, command ${at}: its rate`,
      );
    }
  }

  await h.capture(
    "tape-per-site-persists",
    "Site 1's tape, still written on the second visit",
  );
});
