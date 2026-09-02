// instrumentation/machine-ops-enforce-the-placement-rules — a placement that
// breaks one of the six rules is refused, and places nothing.
//
// THE RULE. Of the whole machine group, "Each placement is checked against the
// placement rules of `specs/parts.md` alone, and throws an `Error` naming the
// first rule it breaks" (`specs/instrumentation.md`, The machine), and a call that
// fails "fails loudly rather than guessing what was meant". The six rules are
// `specs/parts.md`'s, and they hold "whether by hand in the editor or through a
// loaded solution":
//
//   1. "Every hex of the part is on the field."
//   2. "Sigil footprints, rise and set footprints included, are pairwise
//      disjoint, and no track cell lies on any of them."
//   3. "No hex is a cell of two tracks, or of one track twice."
//   4. "No two arms or wheels share an anchor hex, and no two wheels'
//      rings meet..."
//   5. "Each rise and each set is placed at most once."
//   6. "A track's consecutive cells are adjacent..."
//
// THE CONFIGURATION. Eight attempts, one per way of breaking a rule the item
// names, each on a world cleared down to what that attempt needs and nothing else:
// an arm anchored off the field; a sigil laid over another sigil's footprint; a
// track cell laid on a sigil footprint; a track cell laid on another track's cell;
// a wheel anchored on an arm's anchor hex; the same rise placed twice; the same
// set placed twice; and a track extended onto a hex that is not adjacent to its
// live end. Every attempt is legal but for the one rule it breaks, so what refuses
// it is that rule.
//
// WHAT IS NOT ASSERTED. Which words the `Error` names the rule in. The
// specification requires the message to name the rule and fixes no wording for it,
// so what is read here is that an `Error` with something to say is thrown, and that
// the machine is exactly as it stood.
//
// THE VERDICT. Every one of the eight throws an `Error` carrying a message, and
// after every one of them the machine is byte for byte the machine that stood
// before the attempt: nothing placed, no path grown.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Everything about the machine a refused placement must leave untouched. */
function machineOf(snapshot: OrrerySnapshot): string {
  return JSON.stringify(
    snapshot.editor.parts.map((part) => [
      part.kind,
      part.q,
      part.r,
      part.rotation,
      part.length,
      (part.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
      part.closed,
      part.index,
      part.tape,
    ]),
  );
}

/** One attempt: what it broke, whether it was refused, and what it left behind. */
interface Attempt {
  label: string;
  message: string;
  changed: boolean;
}

it("refuses a placement breaking any of the six rules, and places nothing", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);

  const attempts: Attempt[] = [];
  const attempt = async (
    label: string,
    pose: () => Promise<unknown>,
    illegal: () => Promise<unknown>,
  ): Promise<void> => {
    await h.debug.clearMachine();
    await pose();
    const before = machineOf(await h.snapshot());
    let message = "";
    try {
      await illegal();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const after = machineOf(await h.snapshot());
    attempts.push({ label, message, changed: after !== before });
  };

  // 1 — every hex of the part is on the field. `(9, 0)` is off it.
  await attempt(
    "rule 1: an arm anchored off the field",
    async () => undefined,
    () => h.debug.placePart("arm", 9, 0, 0),
  );

  // 2 — sigil footprints are pairwise disjoint. `bind`'s footprint runs
  // `(0, 0)`-`(1, 0)`; `wane`'s is its anchor alone.
  await attempt(
    "rule 2: two sigil footprints overlapping",
    async () => {
      await placePart(h, "bind", at(0, 0), 0);
    },
    () => h.debug.placePart("wane", 1, 0, 0),
  );

  // 2 — and no track cell lies on any of them.
  await attempt(
    "rule 2: a track cell on a sigil footprint",
    async () => {
      await placePart(h, "bind", at(0, 0), 0);
    },
    () => h.debug.placeTrack(1, 0),
  );

  // 3 — no hex is a cell of two tracks.
  await attempt(
    "rule 3: a hex in two tracks",
    async () => {
      await placeTrack(h, [at(0, 3), at(1, 3)]);
    },
    () => h.debug.placeTrack(1, 3),
  );

  // 4 — no two arms or wheels share an anchor hex.
  await attempt(
    "rule 4: two arms or wheels on one anchor",
    async () => {
      await placePart(h, "arm", at(2, -2), 0);
    },
    () => h.debug.placePart("wheel", 2, -2, 0),
  );

  // 5 — each rise is placed at most once.
  await attempt(
    "rule 5: a rise placed twice",
    async () => {
      await placeRise(h, 0, at(-4, 0), 0);
    },
    () => h.debug.placeRise(0, -4, 2, 0),
  );

  // 5 — and each set is placed at most once.
  await attempt(
    "rule 5: a set placed twice",
    async () => {
      await placeSet(h, 0, at(4, 0), 0);
    },
    () => h.debug.placeSet(0, 4, -2, 0),
  );

  // 6 — a track's consecutive cells are adjacent. `(2, -3)` is two hexes from
  // the live end at `(0, -3)`.
  let stub = -1;
  await attempt(
    "rule 6: a non-adjacent track extension",
    async () => {
      stub = await placeTrack(h, [at(0, -3)]);
    },
    () => h.debug.extendTrack(stub, 2, -3),
  );

  await h.advance(1);
  await captureStill(h, "refused");

  assertDeepEqual(
    attempts
      .filter((entry) => entry.message === "")
      .map((entry) => entry.label),
    [],
    "every illegal placement throws an Error naming what it broke",
  );
  assertDeepEqual(
    attempts.filter((entry) => entry.changed).map((entry) => entry.label),
    [],
    "a refused placement places nothing and grows no path",
  );
});
