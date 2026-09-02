// runs/stop-keeps-the-machine-as-placed — running a machine costs it nothing.
//
// THE RULE. "Stopping a run, from the `back` action in any sim status, discards
// the motes and every runtime pose and RETURNS TO EDITING WITH THE MACHINE
// EXACTLY AS IT WAS PLACED" (`specs/simulation.md`, The run). "The editor's parts
// are locked for the whole run" is the same promise from the other end (The run,
// first paragraph), and `specs/editor.md` fixes what a machine is made of: parts
// in placement order, "the tape panel's row order", a track's path, each arm's
// and wheel's tape, and the cost `specs/parts.md` computes over them.
//
// THE CONFIGURATION is a machine with one of everything the sentence names, so
// nothing it promises goes unread: two arm kinds (an `arm` and a `piston`), a
// `wheel`, an open `track` the piston rides, a transforming sigil, a rise and a
// set, seven parts in a placement order that is not alphabetical and not the
// order `PARTS` lists the kinds in. Each taped part carries a tape of its own,
// and the run moves things — the piston advances a cell and extends, the arm
// turns, the wheel turns and turns back — so "exactly as it was placed" is a
// claim about a machine that really was disturbed.
//
// THE VERDICT is the machine read back as a solution document, which
// `specs/instrumentation.md` defines as "exactly what `loadSolution` would accept
// to rebuild it": identical before the run and after it, part for part in order,
// path for path, tape for tape, with `editor.cost` beside it unchanged. Every
// reading is the build's own reading held against its own earlier one, which is
// what keeps this from asserting a document shape no specification fixes and
// from deciding whether the cost is the RIGHT figure, which is another point's
// business. What keeps the comparison from being two silences compared with each
// other is asserted first: the machine reads back as the seven parts the check
// placed, and its cost is not zero.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
} from "../assert";
import { at } from "../field";
import {
  armPart,
  risePart,
  setPart,
  sigilPart,
  solution,
  trackPart,
} from "../formats";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  readMachine,
  stopRun,
  type Harness,
} from "../harness";

/** The track the piston rides, and the piston's rest cell: its first. */
const TRACK_FIRST = at(-4, 0);
const TRACK_MIDDLE = at(-3, 0);
const TRACK_LAST = at(-2, 0);

/**
 * Seven parts, in a placement order of their own. Every tape's third cell rests
 * — a `grab` on an empty field, and a blank on the wheel — so the two cycles this
 * check runs are bounded on both sides whatever a build's clock does at a
 * boundary.
 */
const MACHINE = solution([
  armPart("arm", 0, -4, 2, 3, ["grab", "rotate-cw", "grab"]),
  sigilPart("bind", 2, 0, 0),
  trackPart([TRACK_FIRST, TRACK_MIDDLE, TRACK_LAST]),
  armPart("piston", TRACK_FIRST.q, TRACK_FIRST.r, 1, 2, [
    "advance",
    "extend",
    "grab",
  ]),
  setPart(0, -2, 3),
  armPart("wheel", 0, 4, 3, 1, ["rotate-cw", "rotate-ccw"]),
  risePart(0, 3, 2),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the same parts in the same order, with the same paths, tapes and cost", async () => {
  await openBareRun(h, { challenge: BARE, machine: MACHINE });

  const placed = await readMachine(h);
  assertLength(
    placed.parts,
    MACHINE.parts.length,
    "the machine reads back as the seven parts the check placed",
  );

  const before = await h.snapshot();
  const cost = before.editor.cost;
  assertGreaterThan(
    cost,
    0,
    "the machine carries priced parts, so its cost is a figure the run could lose",
  );
  const kinds = before.editor.parts.map((part) => part.kind);

  await advanceCycles(h, 2);

  const live = await h.snapshot();
  assertEqual(
    live.sim?.status,
    "running",
    "the run really ran: nothing in the configuration faults",
  );

  await stopRun(h);
  await h.advance(1);
  await captureStill(h, "intact");

  const after = await h.snapshot();
  assertNull(after.sim, "the run is stopped");
  assertDeepEqual(
    await readMachine(h),
    placed,
    "the machine is exactly as it was placed: the same parts, paths and tapes",
  );
  assertDeepEqual(
    after.editor.parts.map((part) => part.kind),
    kinds,
    "the parts are in the same placement order, which is the tape panel's row order",
  );
  assertEqual(after.editor.cost, cost, "the machine's cost is what it was");
});
