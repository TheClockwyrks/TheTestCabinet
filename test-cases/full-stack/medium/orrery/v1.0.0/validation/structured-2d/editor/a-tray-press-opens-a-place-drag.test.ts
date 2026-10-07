// editor/a-tray-press-opens-a-place-drag — a press inside a tray entry opens a
// `place` drag naming that entry's part kind and its index.
//
// THE RULE. "Presses are targeted by these rectangles: A PRESS INSIDE ENTRY `k`
// BEGINS PLACING THAT PART" (`specs/editor.md`, The tray), where entry `k`
// "occupies the rectangle from `(TRAY_X0, TRAY_Y0 + k * TRAY_SLOT_H)` to
// `(TRAY_X0 + TRAY_W, TRAY_Y0 + (k + 1) * TRAY_SLOT_H)`". What "begins placing"
// leaves behind is the drag shape of `specs/editor.md`: "Placing and moving run
// through one drag shape: a press begins it … From the tray: the ghost is a new
// part at the targeted hex", and `specs/instrumentation.md` writes that shape
// down: `drag: { kind: "place", part: <part kind>, index: <number | null>,
// rotation, length, at } | … | null`.
//
// WHICH ENTRY HOLDS WHICH PART is the tray's own order: "Its entries are, in
// order: the challenge's `permitted` part kinds, in the order of `PARTS` in
// `specs/parts.md`; then one `rise` per reagent, in reagent order; then one `set`
// per product, in product order." A rise or a set is one OF SEVERAL — "A `rise`
// delivers one reagent and a `set` receives one product" (`specs/parts.md`) — so
// its entry carries which one; every other kind is itself alone, and carries no
// index.
//
// THE CONFIGURATION. `TWO_AND_TWO` opened in the editor: two permitted kinds,
// `arm` and `biarm`, two reagents and two products, so its tray holds six entries
// and covers every shape the rule distinguishes — a plain kind with no index, and
// a rise and a set at index `0` and index `1` each. The machine is empty, as
// `loadChallenge` leaves it, so no rise or set entry is spent: "A rise or set
// entry is spent once its part is on the field … and a press on it does nothing
// until the placed part is deleted."
//
// Each press lands in the MIDDLE of its entry's rectangle and is released before
// the next. The pointer never moves onto a hex, so each release lands with no hex
// targeted, which "places nothing" — the six presses leave the field as empty as
// they found it, and each is read on its own.
//
// THE VERDICT. Each press leaves `editor.drag` a drag of kind `place` whose `part`
// is that entry's kind and whose `index` is that entry's index, which is `null`
// for `arm` and `biarm` and `0` or `1` for the rises and the sets.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { traySlot } from "../field";
import { TWO_AND_TWO } from "../fixtures";
import { derivedTray } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The tray `TWO_AND_TWO` derives, in the order `specs/editor.md` lists it. */
const TRAY = derivedTray(TWO_AND_TWO);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a place drag naming each entry's part kind and index", async () => {
  await openChallengeDocument(h, TWO_AND_TWO);
  const standing = (await h.snapshot()).editor.parts.length;

  for (const [slot, entry] of TRAY.entries()) {
    await pressAt(h, centerOf(traySlot(slot)));
    await h.advance(1);
    if (slot === 0) await captureStill(h, "drag");

    const drag = (await h.snapshot()).editor.drag;
    await releasePointer(h);

    assertNotNull(
      drag,
      `a press inside entry ${slot} begins placing that part, so it opens a drag`,
    );
    assertEqual(
      drag?.kind,
      "place",
      `the drag entry ${slot} opens is a place drag`,
    );
    assertEqual(
      drag?.kind === "place" ? drag.part : null,
      entry.kind,
      `entry ${slot} of this tray is the ${entry.kind}, so the drag names that kind`,
    );
    assertEqual(
      drag?.kind === "place" ? drag.index : undefined,
      entry.index,
      entry.index === null
        ? `and a ${entry.kind} entry is itself alone, so the drag carries no index`
        : `and that entry is index ${entry.index} of its list, so the drag carries it`,
    );
  }

  assertEqual(
    standing,
    0,
    "the machine was empty throughout, so no rise or set entry was spent",
  );
});
