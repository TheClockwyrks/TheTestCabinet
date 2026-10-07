// instrumentation/open-challenge-derives-the-tray — `openChallenge` derives the
// tray from the challenge it just opened.
//
// THE RULE. "`openChallenge(mode, index)` — ... the game moves to the editor with
// an empty machine, empty histories, no run, and the tray derived from the
// challenge" (`specs/instrumentation.md`, The challenge). What deriving means is
// `specs/editor.md`: "Its entries are, in order: the challenge's `permitted` part
// kinds, in the order of `PARTS` in `specs/parts.md`; then one `rise` per
// reagent, in reagent order; then one `set` per product, in product order."
//
// HOW A TRAY IS READ. The snapshot carries no tray, so the tray is read where the
// specification makes it observable: "Presses are targeted by these rectangles: a
// press inside entry `k` begins placing that part", entry `k` occupying the
// rectangle `specs/editor.md` fixes; and "A press in the tray outside every entry
// does nothing beyond setting the focus." The live drag is in the snapshot as
// `editor.drag`, in its `place` shape, carrying "`part: <part kind>, index:
// <number | null>`" — so pressing entry `k` names that entry's kind, and pressing
// the slot one past the last names nothing at all, which is what fixes the COUNT.
//
// WHAT IT IS DERIVED FROM is the challenge the snapshot reports open, not a list
// this project keeps: the entries expected are computed from that challenge's own
// `permitted`, `reagents` and `products`, so a build whose Extras shelf differs
// from `specs/challenges.md` fails that item rather than this one.
//
// THE CONFIGURATION. Two Extras challenges whose reagent and product counts
// differ, opened one after the other, in both orders: the wider one first so a
// tray left standing would be too long, and the narrower one first so a tray left
// standing would be too short. Nothing is placed, so no rise or set entry is spent.
//
// THE VERDICT. After each opening, every slot of the tray the OPEN challenge
// derives begins a placement of that entry's kind and index, and the slot one
// past the last begins nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertNotEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { traySlot } from "../field";
import { derivedTray } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  openChallenge,
  openTitle,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Read the tray the editor is showing, one press per slot, releasing each. */
async function trayEntries(
  harness: Harness,
  slots: number,
): Promise<({ part: string; index: number | null } | null)[]> {
  const read: ({ part: string; index: number | null } | null)[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    await pressAt(harness, centerOf(traySlot(slot)));
    const drag = (await harness.snapshot()).editor.drag;
    read.push(
      drag !== null && drag.kind === "place"
        ? { part: drag.part, index: drag.index }
        : null,
    );
    await releasePointer(harness);
  }
  return read;
}

it("shows the tray the challenge just opened derives, not the one before it", async () => {
  await openTitle(h);

  // Two shelves apart in both counts: the check reads whichever way round the
  // build's own shelf has them, so the pair is chosen by what it reports.
  for (const [first, second] of [
    [7, 0],
    [0, 7],
  ] as const) {
    await openChallenge(h, "extras", first);
    const before = (await h.snapshot()).challenge;
    assertNotNull(before, "the first challenge opened is open");
    await openChallenge(h, "extras", second);
    await captureStill(h, "tray");

    const open = (await h.snapshot()).challenge;
    assertNotNull(open, "the second challenge opened is open");
    const expected = open === null ? [] : derivedTray(open);
    const stale = before === null ? [] : derivedTray(before);
    assertNotEqual(
      expected.length,
      stale.length,
      `extras ${first} and ${second} derive trays of different lengths, so a tray left standing is the wrong length`,
    );

    const read = await trayEntries(h, expected.length + 1);
    for (const [slot, entry] of expected.entries()) {
      const found = read[slot] ?? null;
      assertNotNull(
        found,
        `tray slot ${slot} of the challenge opened at index ${second} begins a placement`,
      );
      assertEqual(
        found?.part,
        entry.kind,
        `tray slot ${slot} places the kind the open challenge derives there`,
      );
      assertEqual(
        found?.index,
        entry.index,
        `tray slot ${slot} carries the reagent or product index it derives`,
      );
    }
    assertNull(
      read[expected.length] ?? null,
      "the slot one past the last entry begins nothing, so the tray is this challenge's length",
    );
  }
});
