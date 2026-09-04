// extras/all-ten-open-from-start — any of the ten Extras can be the first one
// entered.
//
// THE RULE. "It is a fixed shelf of standalone challenges, OPEN FROM THE START"
// and "Every challenge is unlocked from the start and can be entered in any
// order" and "Every row can be entered" (`specs/modes/extras.md`, The shelf,
// Progression, The select screen). The Extras lock nothing: "The Extras lock
// nothing, as `specs/modes/extras.md` states" (`specs/instrumentation.md`,
// `setUnlockedCount`). What entering a row does is the campaign's rule, which
// `specs/modes/extras.md` adopts: "`confirm` on an unlocked or solved challenge
// opens it in the editor" (`specs/modes/campaign.md`, The select screen), and the
// editor it opens carries the tray "derived from the challenge"
// (`specs/instrumentation.md`), which `specs/editor.md` composes as "the
// challenge's `permitted` part kinds, in the order of `PARTS`; then one `rise`
// per reagent, in reagent order; then one `set` per product, in product order".
//
// EACH ROW IS ENTERED FIRST, IN ITS OWN FRESH SESSION. The point's sentence is
// "so any of the ten can be the FIRST one entered", so the session is reset
// before every row: `reset` leaves the game "indistinguishable from a freshly
// started session ... nothing is solved" (`specs/instrumentation.md`), which is
// read back before each entry. A build that opened the shelf's later rows only
// after their predecessors had been played would pass a walk down one session and
// fails here.
//
// THE ROW IS ENTERED THE PLAYER'S WAY. The highlight is put on the row through
// `setSelectIndex`, which "Sets the highlighted row of the current mode's select
// screen" — a pose, so how the highlight MOVES stays its own item — and then the
// registered `confirm` action is pressed, which is the thing under test.
//
// WHAT THE TRAY IS READ WITH. The snapshot carries no tray, so it is read where
// `specs/editor.md` makes it observable: "a press inside entry `k` begins placing
// that part", and the live drag is in the snapshot in its `place` shape carrying
// the kind and the rise or set index it is placing. The tray is compared against
// the one the OPEN challenge derives, so this point decides that the row opened
// its OWN tray without also deciding which challenge sits at which index.
//
// THE VERDICT. For each of the ten rows, in a session with nothing solved,
// `confirm` leaves the screen at `editor` over that mode's challenge at that
// index, and each tray entry begins placing exactly the part the open challenge
// derives for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { EXTRA_COUNT } from "../constants";
import { traySlot } from "../field";
import { derivedTray } from "../formats";
import {
  captureStill,
  centerOf,
  createHarness,
  pressAction,
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

/** What tray entry `slot` begins placing, or `null` when it begins no placement. */
async function slotEntry(
  slot: number,
): Promise<{ kind: string; index: number | null } | null> {
  await pressAt(h, centerOf(traySlot(slot)));
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);
  return drag !== null && drag.kind === "place"
    ? { kind: drag.part, index: drag.index }
    : null;
}

/** Confirm on Extras row `index` in a session that has never entered a challenge. */
async function enterFirst(index: number): Promise<void> {
  await h.debug.reset();
  assertLength(
    (await h.snapshot()).extras.solved,
    0,
    "the session this row is entered from has nothing solved, so nothing the " +
      "row opens can have been earned",
  );
  await h.debug.setMode("extras");
  await h.debug.setScreen("select");
  await h.debug.setSelectIndex(index);
  await h.advance(1);
  await pressAction(h, "confirm");
}

it("opens each of the ten rows, with its own tray, as the session's first entry", async () => {
  for (let index = 0; index < EXTRA_COUNT; index += 1) {
    await enterFirst(index);
    if (index === EXTRA_COUNT - 1) await captureStill(h, "tenth-first");

    const after = await h.snapshot();
    assertEqual(
      after.screen,
      "editor",
      `confirm on Extras row ${index + 1} opens it in the editor, from a ` +
        "session in which no Extra has been entered or solved",
    );
    const open = after.challenge;
    assertNotNull(
      open,
      `Extras row ${index + 1} opens a challenge rather than an empty editor`,
    );
    assertEqual(
      open?.source,
      "extras",
      `Extras row ${index + 1} opens the Extras' own challenge`,
    );
    assertEqual(
      open?.index,
      index,
      `Extras row ${index + 1} opens the challenge at that row, rather than ` +
        "some other row's",
    );

    const tray = derivedTray({
      name: open?.name ?? "",
      reagents: open?.reagents ?? [],
      products: open?.products ?? [],
      permitted: open?.permitted ?? [],
      target: open?.target ?? 0,
    });
    for (const [slot, entry] of tray.entries()) {
      const found = await slotEntry(slot);
      assertNotNull(
        found,
        `Extras ${index + 1}'s tray entry ${slot} begins a placement`,
      );
      assertEqual(
        found?.kind,
        entry.kind,
        `Extras ${index + 1}'s tray entry ${slot} places ${entry.kind}, which ` +
          "is what the open challenge derives for that entry",
      );
      assertEqual(
        found?.index ?? null,
        entry.index,
        `Extras ${index + 1}'s tray entry ${slot} places the reagent or product ` +
          `numbered ${String(entry.index)}`,
      );
    }
  }
});
