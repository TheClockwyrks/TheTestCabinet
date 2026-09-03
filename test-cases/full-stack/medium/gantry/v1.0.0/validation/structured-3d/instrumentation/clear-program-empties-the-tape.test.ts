// instrumentation/clear-program-empties-the-tape — the pose empties the open
// site's tape, whatever it held, and leaves the structure alone.
//
// `specs/instrumentation.md` § The tape: "`clearProgram` | Empties the open
// site's tape." The tape it reaches is the OPEN site's — "`site`, `structure`,
// and `program` report the open site's" (§ Snapshot shape) — and the snapshot
// reports it as `program`, a list of steps, so what the requirement asks for is
// that the list is empty afterwards.
//
// "WHATEVER IT HELD" IS WHY THE TAPE IS A MIXED ONE. Five steps are appended,
// three moves and two actions, the two kinds `specs/program.md` gives, and one
// of the moves carries two commands: a build that emptied only its move steps,
// only its action steps, or all but the last would be caught, where a tape of
// one step would let all three pass.
//
// AND IT LEAVES THE STRUCTURE ALONE. The tape and the structure are two things
// the site holds — "`clearStructure` | Empties the open site's structure"
// (§ The structure) is the operation for the other one — so the whole structure
// is read before and after and compared, rather than a member count that a swap
// could survive.
//
// The world is emptied first and a crane stood, so what stands is exactly what
// this pose is asked to leave standing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { HOIST_MAX_RATE, SLEW_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Three moves and two actions, one move carrying two commands. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: 2, rate: TROLLEY_MAX_RATE },
      { axis: "hoist", target: 4, rate: HOIST_MAX_RATE },
    ],
  },
  { kind: "action", action: "attach" },
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 2, rate: HOIST_MAX_RATE }],
  },
  { kind: "action", action: "release" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the open site's tape and leaves the structure standing", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.setScreen("program");
  await poseTape(h, TAPE);

  const before = await h.snapshot();
  assertLength(
    before.program,
    TAPE.length,
    "the steps the tape holds before it is emptied",
  );
  assertGreaterThan(
    before.structure.members.length,
    0,
    "the structure standing before the tape is emptied",
  );

  await h.debug.clearProgram();
  const after = await h.snapshot();

  await h.capture("empty", "The program screen with the tape emptied");

  assertLength(
    after.program,
    0,
    "the steps left after clearProgram (specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(after.structure),
    JSON.stringify(before.structure),
    "the structure across clearProgram, which reaches the tape alone " +
      "(specs/instrumentation.md)",
  );
});
