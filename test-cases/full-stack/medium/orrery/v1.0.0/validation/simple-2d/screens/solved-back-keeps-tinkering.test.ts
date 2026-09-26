// screens/solved-back-keeps-tinkering — `back` on the solved panel does what
// KEEP TINKERING does: the run ends, the editor comes back, the machine stands.
//
// THE RULE is the sentence under the solved panel's `confirm` table in
// `specs/ui.md`, The solved panel: "`back` STOPS THE RUN AND RETURNS TO EDITING,
// MACHINE INTACT, EXACTLY AS `KEEP TINKERING` DOES." `specs/controls.md` grants
// the press twice over: `back` "Leaves the current screen; during a run, stops
// it", and the "`editor`, `faulted` or `complete`" row of What each screen reads
// carries "`back` and `mute`" whether or not the panel is up.
//
// What the three halves mean is fixed elsewhere: a stopped run is `sim` "`null`
// while editing" (`specs/state.md`), and stopping "discards the motes and every
// runtime pose and returns to editing WITH THE MACHINE EXACTLY AS IT WAS PLACED"
// (`specs/simulation.md`), which the surface hands back whole as a solution
// document (`readSolution`, `specs/instrumentation.md`).
//
// THE CONFIGURATION is the first Extra, completed, over a machine with something
// of every kind to lose: the set for the challenge's one product (a `set` index),
// a `piston` turned to rotation `4` at length `3` carrying a four-cell tape (a
// pose, a length and a tape), a plain `arm` mounted on a track cell at a
// different rotation, and a five-cell open `track` (a path, in order). A machine
// of one bare part could not tell an intact machine from a rebuilt one. The
// piston opens its tape on `grab` rather than on `extend`, because it stands at
// `ARM_MAX_LEN` (`3`) and `extend` there would fault the run this point needs to
// COMPLETE.
//
// The machine is read back before the run so the comparison holds the build's own
// reading of what it was given rather than the document this file wrote, and the
// tally is posed straight to the `target`, because what completes the run is the
// boundary's own test (`specs/simulation.md`). NOTHING TOUCHES `menuIndex`: the
// whole point of `back` is that it does not depend on which item is highlighted,
// so the highlight is left wherever arriving at the panel put it.
//
// THE VERDICT. After one press of `back`: `sim` is `null`, `screen` is still
// `editor` with the challenge open, and the solution document read back is the
// document read back before the run.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { extra } from "../challenges";
import { at } from "../field";
import { armPart, setPart, solution, trackPart } from "../formats";
import {
  advanceCycles,
  backAction,
  captureReplay,
  createHarness,
  loadMachine,
  openChallenge,
  readMachine,
  type Harness,
} from "../harness";

/** The Extra this check completes: the first of the shelf. */
const INDEX = 0;

/** The track this machine's arm is mounted on: five cells running east. */
const TRACK = [at(-2, 2), at(-1, 2), at(0, 2), at(1, 2), at(2, 2)];

/**
 * A machine carrying one of every fact a solution records: a set's index, a
 * piston's rotation, length and tape, an arm's own rotation, and a track's path.
 */
const MACHINE = solution([
  setPart(0, 0, -3),
  armPart("piston", 3, 0, 4, 3, ["grab", null, "retract", "extend"]),
  armPart("arm", -1, 2, 2, 1, ["rotate-ccw"]),
  trackPart(TRACK),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops the run and returns to editing with the machine intact", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, MACHINE);
  const placed = await readMachine(h);
  assertEqual(
    placed.parts.length,
    MACHINE.parts.length,
    "the machine this point is about really is standing on the field",
  );

  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);

  const panel = await h.snapshot();
  assertNotNull(panel.sim, "the run is still reported once it has completed");
  assertEqual(
    panel.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );

  const kept = await captureReplay(h, "editing", async () => {
    await h.advance(RECORDING_RUN_UP);
    await backAction(h);
    await h.advance(1);
    const editing = await readMachine(h);
    await h.advance(RECORDING_SETTLE);
    return editing;
  });

  const editing = await h.snapshot();
  assertNull(
    editing.sim,
    "back stops the run, exactly as KEEP TINKERING does, and a stopped run is null",
  );
  assertEqual(
    editing.screen,
    "editor",
    "and it returns to EDITING rather than leaving the editor for another screen",
  );
  assertNotNull(
    editing.challenge,
    "the challenge it was editing is still the one open",
  );
  assertDeepEqual(
    kept,
    placed,
    "machine intact: every part, pose, length, track path, rise or set index " +
      "and tape exactly as it was placed",
  );
});
