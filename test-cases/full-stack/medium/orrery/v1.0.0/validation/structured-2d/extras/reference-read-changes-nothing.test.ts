// extras/reference-read-changes-nothing — reading an Extra's reference solution
// moves nothing.
//
// THE RULE. "`referenceSolution(mode, index)` | A PURE READ: the build's own
// reference solution for that challenge, as a solution document, whatever is
// unlocked or solved" (`specs/instrumentation.md`, The challenge). The file says
// what a pure read is, of `snapshot` in the same words — "a pure read of the
// state ... it changes nothing" — and of every reading of the surface: a reading
// "returns plain data built at the call and changes nothing".
//
// WHY IT NEEDS DECIDING AT ALL. A build's easiest route to a reference solution
// is to LOAD it: open the row, put the machine up, read the editor back. That
// answers the right document and leaves the session somewhere else entirely —
// with the player's own machine gone, both histories flattened, and a live run
// stopped. The read is the only route to the references
// (`specs/modes/extras.md`: "reachable through the surface
// `specs/instrumentation.md` defines"), so it has to be the route that costs
// nothing to take.
//
// THE POSE, and every part of it is one clause of the point:
//
//   - THE SCREEN and THE OPEN CHALLENGE: Extras `3` open in the editor.
//   - THE MACHINE: an arm standing on it.
//   - BOTH HISTORIES: two turns of the arm made the player's way, so the undo
//     side is non-empty — "every committed edit to the machine pushes one entry
//     onto the undo history: ... rotating or resizing a part" — then one `undo`,
//     which "moves that edit onto the redo side", so the redo side is too.
//   - A LIVE RUN, started through the surface with the completion switch held
//     off, so nothing the game decides on its own can move while the reads
//     happen.
//   - EVERY SOLVED SET, RECORD AND STASH: another Extra marked solved with a
//     record on it, a campaign row marked solved beside it, and a stash left
//     behind on Extras `1` — "a call to `setScreen` that leaves the editor leaves
//     it exactly as leaving it in play does: ... the open challenge's machine is
//     stashed".
//
// THEN ALL TEN references are read, one after another, with no frame driven
// between the two snapshots — so the two are separated by the reads and by
// nothing else, and the comparison is between two readings of ONE build, which is
// what keeps it from holding a build to a shape the specification never fixed.
//
// THE VERDICT. The screen, the open challenge, the whole editor (the machine and
// both histories with it), the live run, and both modes' progress stand exactly
// as they stood before the ten reads.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { EXTRA_COUNT } from "../constants";
import { at } from "../field";
import {
  captureStill,
  createHarness,
  openChallenge,
  placePart,
  pressAction,
  referenceSolution,
  type Harness,
} from "../harness";

/** The Extra the session is sitting on when the reads are made. */
const OPEN = 2;

/** The Extra a stash is left behind on, so `extras.stashed` is not empty. */
const STASHED = 0;

/** The Extra marked solved, with a record, so neither of those is empty either. */
const SOLVED = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the screen, the challenge, the machine, both histories, the run and all progress as they stood", async () => {
  // A stash on one Extra: a machine built there, then left by the front door.
  await openChallenge(h, "extras", STASHED);
  await placePart(h, "arm", at(0, 0));
  await h.debug.setScreen("title");

  // Progress the read must not touch, in both modes.
  await h.debug.setSolved("extras", SOLVED, true);
  await h.debug.setRecord("extras", SOLVED, "cost", 12);
  await h.debug.setSolved("campaign", 0, true);
  await h.debug.setLast("extras", SOLVED);

  // The editor as it stands when the reads are made.
  await openChallenge(h, "extras", OPEN);
  const arm = await placePart(h, "arm", at(0, 0));
  await h.debug.setFocus("field");
  await h.debug.setSelected(arm);
  await pressAction(h, "part-cw");
  await pressAction(h, "part-cw");
  await pressAction(h, "undo");

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.advance(1);
  await captureStill(h, "unchanged");

  const before = await h.snapshot();
  assertEqual(before.screen, "editor", "the session is sitting in the editor");
  assertNotNull(before.challenge, "with an Extra open on it");
  assertGreaterThan(
    before.editor.parts.length,
    0,
    "and a machine standing on that challenge",
  );
  assertGreaterThan(
    before.editor.undoDepth,
    0,
    "the two turns left an undo history for the read to flatten",
  );
  assertGreaterThan(
    before.editor.redoDepth,
    0,
    "and the undo left a redo history beside it",
  );
  assertNotNull(before.sim, "a run is live while the reads are made");
  assertGreaterThan(
    before.extras.solved.length,
    0,
    "an Extra is marked solved, so a read that cleared the set would show",
  );
  assertNotNull(
    before.extras.records[SOLVED] ?? null,
    "and carries a record, so a read that cleared the records would show",
  );
  assertGreaterThan(
    before.extras.stashed.length,
    0,
    "and another Extra holds a stashed machine, so a read that dropped it would show",
  );

  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    await referenceSolution(h, "extras", index);
  }

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    before.screen,
    "reading a reference solution leaves the screen as it stood",
  );
  assertDeepEqual(
    after.challenge,
    before.challenge,
    "and the open challenge, rather than opening the row it was asked about",
  );
  assertDeepEqual(
    after.editor,
    before.editor,
    "and the machine standing on it, with both histories exactly as deep",
  );
  assertDeepEqual(
    after.sim,
    before.sim,
    "and the live run, which a load would have stopped",
  );
  assertDeepEqual(
    after.extras,
    before.extras,
    "and every solved set, record and stash of the Extras",
  );
  assertDeepEqual(
    after.campaign,
    before.campaign,
    "and the campaign's, which the read is not even about",
  );
});
