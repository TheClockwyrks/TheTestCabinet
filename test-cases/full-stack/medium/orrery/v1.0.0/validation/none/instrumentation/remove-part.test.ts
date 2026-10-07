// instrumentation/remove-part — `removePart` takes one part off the machine with
// its tape and its row, and leaves the rest standing.
//
// THE RULE. "`removePart(part)` | Removes one placed part, discarding its tape and
// its tape-panel row exactly as `part-delete` does, and clearing a selection or
// cursor the removal invalidates" (`specs/instrumentation.md`, The machine). What
// `part-delete` does is `specs/editor.md`'s: "An edit changes the edited part
// alone... deleting an arm or wheel discards its tape and its row." The panel's
// rows ARE the machine's arms and wheels in order — "The panel shows one row per
// arm and wheel, in placement order" — and the discarded tape shows in the
// machine's period, "the largest tape length across its arms and wheels, and `1`
// when every tape is empty" (`specs/instructions.md`), which the snapshot reports
// as `editor.period`.
//
// THE CONFIGURATION. Three arms in placement order, the MIDDLE one carrying the
// only long tape: an arm at `(-2, 0)` with a one-cell tape, an arm at `(0, 0)`
// with a three-cell tape, and an arm at `(2, 0)` with a one-cell tape. The machine
// therefore runs on period `3`, and that period belongs to the part being removed
// alone. Nothing else is placed, so what stands afterwards is exactly what the
// removal left.
//
// THE VERDICT. `editor.parts` holds the outer two arms, in their original order,
// and no entry for the removed one; the period falls to `1`, because the tape
// went with it; and the cost is the two arms' cost, so the row is gone from the
// machine rather than merely hidden.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { armPart, solution } from "../formats";
import { machineCost } from "../parts";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes one part with its tape and its row, leaving the others in place", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", -2, 0, 0, 1, ["grab"]),
      armPart("arm", 0, 0, 0, 1, ["grab", "rotate-cw", "drop"]),
      armPart("arm", 2, 0, 0, 1, ["grab"]),
    ]),
  );
  const placed = await partIds(h);
  const west = placed[0] ?? -1;
  const middle = placed[1] ?? -1;
  const east = placed[2] ?? -1;
  const before = await h.snapshot();

  await h.debug.removePart(middle);
  await h.advance(1);
  await captureStill(h, "removed");
  const after = await h.snapshot();

  assertEqual(
    before.editor.period,
    3,
    "the machine ran on the removed arm's three-cell tape before the removal",
  );
  assertDeepEqual(
    after.editor.parts.map((part) => part.id),
    [west, east],
    "the other two arms stand, in placement order, and the removed one is gone",
  );
  assertNull(
    partById(after, middle),
    "the machine reports no entry for the removed part",
  );
  assertEqual(
    after.editor.period,
    1,
    "the removed arm's tape went with it, so the period falls to 1",
  );
  assertEqual(
    after.editor.cost,
    machineCost([
      armPart("arm", -2, 0, 0, 1, ["grab"]),
      armPart("arm", 2, 0, 0, 1, ["grab"]),
    ]),
    "the machine costs the two arms that remain",
  );
});
