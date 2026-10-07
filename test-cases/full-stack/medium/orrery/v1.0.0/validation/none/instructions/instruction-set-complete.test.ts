// instructions/instruction-set-complete — every one of the ten instructions is
// writable into a tape cell, and reads back as itself.
//
// THE RULE. "`INSTRUCTIONS` holds the ten instructions. A tape cell holds one of
// them or is blank" (`specs/instructions.md`, The instruction set). The table
// under that sentence names all ten and nothing else: `grab`, `drop`,
// `rotate-cw`, `rotate-ccw`, `pivot-cw`, `pivot-ccw`, `extend`, `retract`,
// `advance` and `recede`. `specs/formats.md` says the same from the document's
// side: "A `tape` is a list whose entries are instruction names from
// `INSTRUCTIONS` in `specs/instructions.md` or `null` for a blank."
//
// THE CONFIGURATION. One arm on an otherwise empty machine, and one write per
// instruction: `INSTRUCTIONS[i]` into column `i`, in the order
// `specs/instructions.md` tabulates them. Nothing runs — the requirement is the
// editor's — so no run is started and the arm is the only part placed.
//
// THE VERDICT. The tape the snapshot reports is those ten names in those ten
// columns. `specs/state.md` fixes the reading: "`tape` — the tape, for arms and
// wheels ... Its length is trimmed: the last entry is never `null`, and an
// entirely blank tape is the empty array." The tenth cell holds an instruction,
// so a tape of exactly ten entries is the whole of what the writes left. A build
// whose set is missing one of the ten cannot hold that one, and a build that
// folded two together reads one back as the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotNull } from "../assert";
import { INSTRUCTIONS } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  writeTape,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds each of the ten instructions in the cell it was written into", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await writeTape(h, arm, [...INSTRUCTIONS]);

  await h.advance(1);
  await captureStill(h, "ten-cells");

  const snapshot = await h.snapshot();
  const written = partById(snapshot, arm);
  assertNotNull(
    written,
    "the arm is still on the machine after its tape was written",
  );
  assertLength(
    written?.tape ?? [],
    INSTRUCTIONS.length,
    "ten instructions written into columns 0 to 9 leave a tape of ten cells",
  );
  assertDeepEqual(
    written?.tape,
    [...INSTRUCTIONS],
    "INSTRUCTIONS holds the ten instructions, and each written into a cell is held there and read back as that instruction",
  );
});
