// screens/solved-keep-tinkering-keeps-machine — the machine that finished the run
// is the machine the editor gets back, part for part.
//
// THE RULE is the rest of the second row of the solved panel's `confirm` table in
// `specs/ui.md`, The solved panel: "`KEEP TINKERING` | Stops the run and returns
// to editing, MACHINE INTACT." `specs/simulation.md` says the same of stopping a
// run at all: it "discards the motes and every runtime pose and returns to editing
// WITH THE MACHINE EXACTLY AS IT WAS PLACED". What "exactly as it was placed"
// covers is the solution format of `specs/formats.md`, which a part records as
// "its kind, pose, length, track path, rise or set index, and tape"
// (`specs/state.md`) — and which the surface hands back whole: `readSolution` is
// "The current machine as a solution document" (`specs/instrumentation.md`).
//
// THE CONFIGURATION IS A MACHINE WITH SOMETHING OF EVERY KIND TO LOSE, because a
// machine of one bare part cannot tell an intact machine from a rebuilt one. It
// carries the set for the challenge's one product (a `set` index), a `piston`
// turned to rotation `4` at length `3` with a four-cell tape (a pose, a length
// and a tape), a plain `arm` on a track cell at a different rotation, and a
// five-cell open `track` (a path, in order). Every one of those facts is a fact
// the document records, and every one of them is compared.
//
// The machine is loaded as a DOCUMENT and read back before the run starts, so
// what the comparison holds is the build's own reading of the machine it was
// given rather than the document this file wrote — a build that stores a part
// differently is compared against what it stored, and only a CHANGE across the
// run is a failure.
//
// THE RUN REALLY MOVES THE MACHINE, because "unchanged" is worth nothing over a
// machine nothing ever touched. The plain arm's tape turns it one step
// counterclockwise, so the run carries a LIVE pose — "one entry per arm and
// wheel: its live rotation, length, and base cell" (`specs/state.md`) — that
// differs from the rest pose the editor holds, and the check reads that
// difference back before the press. A build that wrote the live pose onto the
// placed part is exactly what this point catches, and it has something to write.
//
// The tally is posed straight to the `target`, because what completes the run is
// the boundary's own test: "After the rises, if every set's tally has reached the
// challenge's `target`, the run completes" (`specs/simulation.md`). The highlight
// is posed to `KEEP TINKERING`'s index and read back before the press.
//
// THE VERDICT. The solution document read back after the press is the document
// read back before the run: the same parts, in the same order, with the same
// poses, lengths, paths, indices and tapes — and the editor is editing again.
// That the run is OVER is `solved-keep-tinkering-stops-run`'s point rather than
// this one's, so nothing here turns on it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import { SOLVED_ITEMS } from "../constants";
import { extra } from "../challenges";
import { at } from "../field";
import { armPart, setPart, solution, trackPart } from "../formats";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  loadMachine,
  openChallenge,
  partIds,
  poseOf,
  pressAction,
  readMachine,
  type Harness,
} from "../harness";

/** The Extra this check completes: the first, which the shelf holds nine after. */
const INDEX = 0;

/** Where KEEP TINKERING sits when all three items are offered. */
const KEEP_ITEM = 1;

/** The track this machine's arm is mounted on: five cells running east. */
const TRACK = [at(-2, 2), at(-1, 2), at(0, 2), at(1, 2), at(2, 2)];

/**
 * A machine carrying one of every fact a solution records: a set's index, a
 * piston's rotation, length and tape, an arm's own rotation, and a track's path.
 *
 * The piston stands at `ARM_MAX_LEN` (`3`), so its tape opens on `grab` rather
 * than on `extend`: `extend` on a piston already at that length "raises the fault
 * named for it" (`specs/simulation.md`), and this point wants a run that
 * COMPLETES. Only cell `0` is ever fetched, because the completing boundary is
 * the boundary of cycle `0`.
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

it("hands back every part, pose, length, path and tape exactly as it was placed", async () => {
  await openChallenge(h, "extras", INDEX);
  await loadMachine(h, MACHINE);
  const placed = await readMachine(h);
  assertEqual(
    placed.parts.length,
    MACHINE.parts.length,
    "the machine this point is about really is standing on the field",
  );

  const arm = (await partIds(h))[2] as number;
  await h.debug.startRun();
  await h.debug.setTally(0, extra(INDEX).target);
  await advanceCycles(h, 1);
  await h.debug.setMenuIndex(KEEP_ITEM);

  const panel = await h.snapshot();
  assertNotNull(panel.sim, "the run is still reported once it has completed");
  assertEqual(
    panel.sim?.status,
    "complete",
    "the boundary that reached the target completed the run, which is when the panel is up",
  );
  assertEqual(
    panel.menuIndex,
    KEEP_ITEM,
    `the highlight stands on ${String(SOLVED_ITEMS[KEEP_ITEM])}, the second entry of SOLVED_ITEMS`,
  );
  const live = poseOf(panel, arm);
  assertNotNull(live, "the run carries a live pose for the arm it turned");
  assertNotEqual(
    live?.rotation,
    placed.parts[2]?.rotation,
    "the arm's tape turned it, so the run's live pose is not the rest pose the " +
      "editor holds and there is something a careless build could write back",
  );

  const kept = await captureReplay(h, "intact", async () => {
    await pressAction(h, "confirm");
    await h.advance(1);
    return readMachine(h);
  });

  const editing = await h.snapshot();
  assertEqual(
    editing.screen,
    "editor",
    "KEEP TINKERING returns to editing, which is where a machine is read back from",
  );
  assertDeepEqual(
    kept,
    placed,
    "the machine comes back intact: every part, pose, length, track path, rise " +
      "or set index and tape exactly as it was placed",
  );
});
