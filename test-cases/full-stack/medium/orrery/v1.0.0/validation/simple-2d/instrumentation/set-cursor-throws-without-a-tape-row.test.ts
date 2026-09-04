// instrumentation/set-cursor-throws-without-a-tape-row — the parts a cursor
// cannot be pointed at.
//
// THE RULE. "`setCursor(part, col)` | Points the tape cursor at column `col` of
// that part's row... A `part` of `null` clears the cursor, and a part with no tape
// row throws" (`specs/instrumentation.md`, The editor's hands).
//
// WHICH PARTS HAVE NO ROW is `specs/editor.md`: "The panel shows one row per arm
// and wheel, in placement order." A track, a transforming sigil, a rise and a set
// are none of those, so none of them carries a tape row — the snapshot says as
// much in its own terms, carrying `tape` as "the tape, for arms and wheels; `null`
// for everything else". Four kinds, one from each of those four classes, are
// handed to `setCursor` here.
//
// AND THE CURSOR IS LEFT WHERE IT STOOD. "An argument outside the domain its
// operation states is invalid, and the call fails loudly rather than guessing what
// was meant" (`specs/instrumentation.md`, The operations), and a document a
// machine operation refuses "changes nothing" — so a refused call is read twice:
// it threw, and the hand it could not move is still on the cell a legal call put
// it on. A build that threw AFTER moving the cursor would pass the first reading
// and fail the second.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge and a machine holding
// exactly one part of each kind under test plus the one arm the cursor legally
// stands on, laid out so that every footprint is disjoint, no track cell touches
// one, and no two arms share an anchor — the placement rules of `specs/parts.md`,
// which are the only rules a machine operation is checked against. The permitted
// list is a tray rule rather than a placement rule, so a `bind` on a challenge
// permitting `arm` alone is a legal placement here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";

/** The column the cursor legally stands on, and must still stand on afterwards. */
const COLUMN = 1;

/** Whether a call threw, as one word, so a failure reads as an expected/actual pair. */
async function outcomeOf(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "returned";
  } catch {
    return "threw";
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("throws on a track, a sigil, a rise and a set, and leaves the cursor where it stood", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN, 0);
  const track = await placeTrack(h, [at(-2, 2), at(-1, 2)]);
  const sigil = await placePart(h, "bind", at(2, -3), 0);
  const rise = await placeRise(h, 0, at(0, 3), 0);
  const set = await placeSet(h, 0, at(0, -3), 0);

  await h.debug.setCursor(arm, COLUMN);
  const posed = await h.snapshot();
  assertNotNull(posed.editor.cursor, "the cursor stands on the arm's row");
  assertEqual(
    posed.editor.cursor?.col,
    COLUMN,
    "the cursor stands on the posed column",
  );

  const rowless: readonly { kind: string; part: number }[] = [
    { kind: "track", part: track },
    { kind: "bind", part: sigil },
    { kind: "rise", part: rise },
    { kind: "set", part: set },
  ];

  for (const entry of rowless) {
    const outcome = await outcomeOf(() => h.debug.setCursor(entry.part, 0));
    await h.advance(1);
    await captureStill(h, "refused");
    assertEqual(
      outcome,
      "threw",
      `setCursor on a ${entry.kind}, which carries no tape row, throws an Error`,
    );
    const after = await h.snapshot();
    assertNotNull(
      after.editor.cursor,
      `the refused setCursor on a ${entry.kind} left the cursor standing`,
    );
    assertEqual(
      after.editor.cursor?.part,
      arm,
      `the refused setCursor on a ${entry.kind} left the cursor on the arm's row`,
    );
    assertEqual(
      after.editor.cursor?.col,
      COLUMN,
      `the refused setCursor on a ${entry.kind} left the cursor on its column`,
    );
  }
});
