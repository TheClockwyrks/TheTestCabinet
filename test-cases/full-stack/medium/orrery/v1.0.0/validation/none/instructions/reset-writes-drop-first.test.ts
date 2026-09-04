// instructions/reset-writes-drop-first — the first cell a `reset` writes is
// always `drop`.
//
// THE RULE. "Invoked at a cell, `reset` writes, from that cell onward, the
// sequence that returns the arm from its pose at that cell to its rest pose, in
// this order: 1. `drop`, always, as the first instruction"
// (`specs/instructions.md`, `reset`). "Always" is the word being decided: the
// three runs that follow it are each conditional — a length run only "while the
// length is above the rest length" or below it, a rotation run only where the
// rotations differ, a track run only where the cells do — and `drop` is not.
// "An arm already at rest writes `drop` alone" says the same from the other end.
// WHY it is unconditional is in the instruction table: "`drop` | Every gripper
// opens, releasing whatever it held", and a grip "persists across cycles until
// dropped" (`specs/simulation.md`), so an arm returned to its rest pose still
// holding something has not been reset.
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and six
// rows placed at once: an `arm`, a `biarm`, a `triarm`, a `hexarm` and a `piston`
// — every arm kind of `specs/parts.md`'s roster — and a sixth arm mounted on an
// open three-cell track. Their rest rotations and rest lengths are all different,
// and their prefixes reach six different walks: one already AT rest, one reached
// by grabbing alone, two reached by turning, one by lengthening, and one by
// running along a track. So the six expansions the macro writes differ from one
// another in everything except the cell this point is about. Nothing else is
// placed, no run is started, and the focus is posed to `tape`, with the cursor
// posed on each row in turn at the column after that row's prefix.
//
// WHAT IS READ. For each row: the cell AT the cursor's column, which must be
// `drop`, and the cells before it, which the macro "reaches no further" than and
// must have left as they were. Reading both is what makes this about the first
// cell WRITTEN rather than about a `drop` appearing somewhere: a build that
// wrote its expansion one cell early would have a `drop` on the tape and the
// wrong cell before the cursor.
//
// THE VERDICT. All six rows carry `drop` at the cursor's column, and all six
// carry their prefix unchanged before it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution, trackPart, type SolutionPart } from "../formats";
import { BARE } from "../fixtures";
import { type InstructionName, type PartName } from "../constants";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

/** The open track the sixth row rides, clear of every anchor above it. */
const TRACK: readonly Hex[] = [at(2, -3), at(3, -3), at(4, -3)];

/** One row: an arm kind at a rest pose, and the prefix its walk reads. */
interface Row {
  label: string;
  part: SolutionPart;
  prefix: readonly InstructionName[];
}

const ROWS: readonly Row[] = [
  {
    label: "an arm already at its rest pose",
    part: armPart("arm", 0, 0, 0, 1, []),
    prefix: [],
  },
  {
    label: "a biarm turned two steps out",
    part: armPart("biarm", 3, 0, 2, 2, ["rotate-cw", "rotate-cw"]),
    prefix: ["rotate-cw", "rotate-cw"],
  },
  {
    label: "a triarm turned one step out",
    part: armPart("triarm", -3, 0, 0, 3, ["rotate-ccw"]),
    prefix: ["rotate-ccw"],
  },
  {
    label: "a hexarm whose prefix only grabs",
    part: armPart("hexarm", 0, 3, 4, 1, ["grab"]),
    prefix: ["grab"],
  },
  {
    label: "a piston lengthened two steps",
    part: armPart("piston", 0, -3, 1, 1, ["extend", "extend"]),
    prefix: ["extend", "extend"],
  },
  {
    label: "an arm run one cell along its track",
    part: armPart("arm", TRACK[0]?.q ?? 0, TRACK[0]?.r ?? 0, 5, 2, ["advance"]),
    prefix: ["advance"],
  },
];

/** The kinds the six rows are, in placement order after the track. */
const KINDS: readonly PartName[] = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
  "arm",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens every expansion with drop, on every arm and every walked pose", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(
    h,
    solution([trackPart(TRACK, false), ...ROWS.map((row) => row.part)]),
  );
  const ids = (await partIds(h)).slice(1);
  await h.debug.setFocus("tape");

  for (const [index, row] of ROWS.entries()) {
    const id = ids[index] ?? -1;
    assertEqual(
      partById(await h.snapshot(), id)?.kind,
      KINDS[index],
      `the row for ${row.label} is the arm kind it was placed as`,
    );
    await h.debug.setCursor(id, row.prefix.length);
    await pressAction(h, "ins-reset");
  }
  await captureStill(h, "drop-first");

  const written = await h.snapshot();
  for (const [index, row] of ROWS.entries()) {
    const tape = partById(written, ids[index] ?? -1)?.tape;
    assertNotNull(tape, `the row for ${row.label} is still on the machine`);
    assertEqual(
      tape?.[row.prefix.length],
      "drop",
      `reset on ${row.label} writes drop at the cursor, as its first instruction`,
    );
    assertDeepEqual(
      tape?.slice(0, row.prefix.length),
      [...row.prefix],
      `reset on ${row.label} reaches no further back than the cursor: every cell before it stands as it was`,
    );
  }
});
