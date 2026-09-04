// instructions/only-arms-and-wheels-carry-tapes — a tape belongs to an arm or a
// wheel, and to nothing else.
//
// THE RULE. "Every arm and wheel carries a tape: a row of cells indexed from
// `0`" (`specs/instructions.md`, Tapes and the period), and `specs/state.md`
// fixes the reading for every other kind: "`tape` — the tape, for arms and
// wheels; `null` for everything else." `specs/parts.md` says the same of the
// wheel — "A wheel carries a tape like an arm" — and `specs/formats.md` of the
// document: "Every arm and wheel carries a `tape`, possibly empty", with the
// per-class key table giving `tape` to "Arms and wheels" alone.
//
// The period follows from that membership: "The machine's period `P` is the
// largest tape length across its ARMS AND WHEELS", so a part carrying no tape
// contributes no length to it.
//
// THE CONFIGURATION. One machine holding one of everything the rule sorts:
//
//   * the five arm kinds of `specs/parts.md` — `arm`, `biarm`, `triarm`,
//     `hexarm`, `piston` — and a `wheel`, with tapes of length `1`, `2`, `0`,
//     `0`, `0` and `3`;
//   * a `track` of FIVE cells, a `bind` sigil, the challenge's `rise` and its
//     `set` — one of each class `specs/parts.md` gives no tape.
//
// The track is deliberately longer than every tape, so a build that mistook a
// track's path for a row of cells would report a period of `5`. The footprints
// are laid out disjoint, and no track cell touches one, as
// `specs/parts.md`'s placement rules require.
//
// Nothing runs. Which parts carry a tape and what the period is are both editor
// readings.
//
// THE VERDICT. Every arm and the wheel report a tape; the track, the sigil, the
// rise and the set each report `null`; and the machine's period is the largest of
// the taped rows alone — `3`, the wheel's — which is what the case's own oracle
// computes from the same document.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import type { PartName } from "../constants";
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
import { machinePeriod } from "../parts";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  partsOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One of every class the rule sorts, in placement order. */
const MACHINE = solution([
  armPart("arm", 0, 0, 0, 1, ["grab"]),
  armPart("biarm", 1, 0, 0, 1, ["grab", "drop"]),
  armPart("triarm", 2, 0, 0, 1, []),
  armPart("hexarm", 3, 0, 0, 1, []),
  armPart("piston", 4, 0, 0, 1, []),
  armPart("wheel", 0, 2, 0, 1, ["rotate-cw", "rotate-ccw", "rotate-cw"]),
  trackPart([at(-1, -3), at(0, -3), at(1, -3), at(2, -3), at(3, -3)]),
  sigilPart("bind", -3, 0, 0),
  risePart(0, 0, 4, 0),
  setPart(0, 2, 3, 0),
]);

/** The kinds that carry a tape, in the order the machine places them. */
const TAPED: readonly PartName[] = [
  "arm",
  "biarm",
  "triarm",
  "hexarm",
  "piston",
  "wheel",
];

/** The kinds that carry none, in the order the machine places them. */
const UNTAPED: readonly PartName[] = ["track", "bind", "rise", "set"];

it("gives a tape to every arm and wheel, none to anything else, and counts only those into the period", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, MACHINE);

  await h.advance(1);
  await captureStill(h, "rows");

  const snapshot = await h.snapshot();
  const placed = await partIds(h);
  assertLength(
    placed,
    partsOf(MACHINE).length,
    "the machine holds one part per entry of the document",
  );

  for (const [index, kind] of TAPED.entries()) {
    const part = partById(snapshot, placed[index] ?? -1);
    assertNotNull(part, `the ${kind} is on the machine`);
    assertEqual(part?.kind, kind, `part ${index} is the ${kind}`);
    assertNotNull(
      part?.tape ?? null,
      `every arm and every wheel carries a tape, the ${kind} included`,
    );
  }

  for (const [offset, kind] of UNTAPED.entries()) {
    const index = TAPED.length + offset;
    const part = partById(snapshot, placed[index] ?? -1);
    assertNotNull(part, `the ${kind} is on the machine`);
    assertEqual(part?.kind, kind, `part ${index} is the ${kind}`);
    assertNull(
      part?.tape ?? null,
      `a ${kind} carries no tape, and reports null for one`,
    );
  }

  assertEqual(
    snapshot.editor.period,
    machinePeriod(partsOf(MACHINE)),
    "the period is the largest tape length across the arms and wheels, so the track, the sigil, the rise and the set contribute nothing",
  );
  assertEqual(
    snapshot.editor.period,
    3,
    "the wheel's three-cell tape is the longest row on the machine, though the track has five cells",
  );
});
