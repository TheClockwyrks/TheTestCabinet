// screens/editor-actions-do-nothing-off-the-editor — the editor's own verbs are
// dead keys on the title, the how-to and the select screen.
//
// THE RULE. `specs/controls.md` tabulates What each screen reads, and closes the
// table with one sentence: "An action a row omits does nothing on that screen."
// The three rows the check drives read these actions and no others:
//
//   `title`  | `up` and `down` move the highlight; `confirm` takes it; `mute`.
//   `howto`  | `left` and `right` turn the page; `confirm` and `back` return to
//              `title`; `mute`.
//   `select` | `up` and `down` move the highlight; `confirm` opens the highlighted
//              challenge when the mode's progression allows; `back` returns to
//              `title`; `mute`.
//
// None of the three names `play`, `step`, `undo`, `redo`, `part-cw` or `ins-grab`
// — every one of which the table gives to the editor alone, under Global, Field
// focus and Tape focus — so on these three screens each of them does nothing.
// `specs/ui.md` says the same from the other side: on `title`, `howto` and
// `select`, what advances is "Nothing."
//
// THE PRESSES ARE REAL PRESSES. Each action is fired through the key
// `specs/controls.md` binds to it, on the runtime's own keyboard, exactly as a
// player's finger fires it — `Space`, `KeyN`, `KeyU`, `KeyI`, `KeyE` and `KeyG`.
// None of those is a key any of the three rows binds, so nothing the check presses
// is an action the screen is entitled to read.
//
// THE POSE. Each screen in turn, carrying figures away from their resting values
// so that "changes nothing" is a reading of something rather than of nothing:
// three campaign challenges unlocked, one solved and carrying a record, the
// title's highlight on the last of `TITLE_ITEMS`, the how-to on a middle page,
// and the `extras` select screen — the mode `specs/modes/extras.md` leaves
// entirely unlocked — highlighting a middle row. No challenge is open on any of
// the three, so `challenge` and `sim` rest at `null` and the editor rests empty,
// which is exactly the state these six verbs would have to invent something out
// of in order to change anything.
//
// THE VERDICT. On each of the three screens, field by field, the snapshot after
// the six presses reports exactly what it reported before them, `simTime` alone
// excepted — the frames the presses run accumulate it, as they accumulate it on
// every screen (`specs/ui.md`). A build that started a run off the play key, or
// stepped one, would report a `sim` where there was none.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { HOWTO_PAGES, TITLE_ITEMS, type ActionName } from "../constants";
import {
  captureStill,
  createHarness,
  openHowto,
  openSelect,
  openTitle,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The editor's own verbs, in the order the check presses them. */
const EDITOR_ACTIONS: readonly ActionName[] = [
  "play",
  "step",
  "undo",
  "redo",
  "part-cw",
  "ins-grab",
];

/** The figures posed away from rest, so every one of them is a real reading. */
const HIGHLIGHT = TITLE_ITEMS.length - 1;
const MIDDLE_PAGE = Math.floor((HOWTO_PAGES - 1) / 2);
const ROW = 3;
const UNLOCKED = 3;
const SOLVED = 1;
const RECORD_COST = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every field the snapshot reports stands exactly as it stood, `simTime` apart.
 *
 * Read field by field rather than as one deep comparison of the whole object, so
 * a build that acted on one of the presses fails naming the figure it moved. The
 * field LIST is compared as well, so a field that went missing or appeared is
 * caught too.
 */
function assertHeld(
  after: OrrerySnapshot,
  before: OrrerySnapshot,
  where: string,
): void {
  const names = (snapshot: OrrerySnapshot): string[] =>
    Object.keys(snapshot)
      .filter((key) => key !== "simTime")
      .sort();
  assertDeepEqual(
    names(after),
    names(before),
    `${where}: the snapshot reports the same fields`,
  );
  for (const key of names(before)) {
    assertDeepEqual(
      (after as unknown as Record<string, unknown>)[key],
      (before as unknown as Record<string, unknown>)[key],
      `${where}: ${key}`,
    );
  }
}

/** Press every one of the editor's verbs, each through its own bound key. */
async function pressEditorActions(): Promise<void> {
  for (const action of EDITOR_ACTIONS) await pressAction(h, action);
}

it("changes nothing the snapshot reports on title, howto or select", async () => {
  await openTitle(h);
  await h.debug.setMenuIndex(HIGHLIGHT);
  await h.debug.setUnlockedCount(UNLOCKED);
  await h.debug.setSolved("campaign", SOLVED, true);
  await h.debug.setRecord("campaign", SOLVED, "cost", RECORD_COST);

  const beforeTitle = await h.snapshot();
  assertEqual(beforeTitle.screen, "title", "the first round runs on the title");
  assertEqual(
    beforeTitle.menuIndex,
    HIGHLIGHT,
    "with the highlight posed away from its resting value",
  );
  await pressEditorActions();
  // Before the assertions, so a failing check still leaves the picture of the
  // screen the presses landed on.
  await captureStill(h, "off-screen-inert");
  assertHeld(
    await h.snapshot(),
    beforeTitle,
    "on title, after play, step, undo, redo, part-cw and ins-grab",
  );

  await openHowto(h);
  await h.debug.setHowtoPage(MIDDLE_PAGE);
  const beforeHowto = await h.snapshot();
  assertEqual(beforeHowto.screen, "howto", "the second round runs on the how-to");
  assertEqual(
    beforeHowto.howtoPage,
    MIDDLE_PAGE,
    "with a page on either side of the one shown",
  );
  await pressEditorActions();
  assertHeld(
    await h.snapshot(),
    beforeHowto,
    "on howto, after play, step, undo, redo, part-cw and ins-grab",
  );

  await openSelect(h, "extras");
  await h.debug.setSelectIndex(ROW);
  const beforeSelect = await h.snapshot();
  assertEqual(beforeSelect.screen, "select", "the third round runs on select");
  assertEqual(beforeSelect.mode, "extras", "on the mode that locks nothing");
  assertEqual(
    beforeSelect.selectIndex,
    ROW,
    "with a row on either side of the one highlighted",
  );
  await pressEditorActions();
  assertHeld(
    await h.snapshot(),
    beforeSelect,
    "on select, after play, step, undo, redo, part-cw and ins-grab",
  );
});
