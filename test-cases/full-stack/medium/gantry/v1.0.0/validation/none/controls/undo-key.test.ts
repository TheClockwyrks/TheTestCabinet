// controls/undo-key — `KeyZ` undoes on the build screen, and nowhere else.
//
// `specs/controls.md` § The actions binds it in one row: the `undo` action, its
// binding `KeyZ`, and what it does — "undo the most recent structure edit, on the
// build screen" — and the paragraph under the table fixes the rest: "Every action
// applies where the table says and does nothing elsewhere." § The build tools
// says what the edit itself is: "`undo` reverses the most recent
// structure-changing edit, as far back as the site was opened, exactly as
// `specs/structure.md` states."
//
// SO THE POINT IS THE BINDING AND ITS SCREEN, WHICH IS ONE REQUIREMENT READ ON
// BOTH SIDES OF ONE LINE: the same key, delivered on the build screen and on the
// program screen, and what separates the two readings is the screen alone. What
// an undo RESTORES is the editor items' own ground; the reading here is
// `historyDepth`, which `specs/instrumentation.md` gives as the "edits the open
// site can still undo".
//
// THE EDIT IS ONE TWO-UNIT STRUT ON A GROUND ANCHOR of site 0: inside
// `STRUT_MAX_LEN`, inside the envelope, `80` against a `3000` budget, with no
// rail and no ring, so nothing in `specs/structure.md`'s refusal list touches it
// and it lands. That it landed is read back before the depth is, because an edit
// that was refused pushes nothing and the check should say so as a refusal rather
// than as a miscount.
//
// The site is opened first, which "empties `history`" (`specs/state.md`), so the
// depth the presses move is the one this check pushed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `undo` action's binding, as `specs/controls.md` fixes it. */
const KEY = BINDINGS.undo[0]!;

/** One two-unit strut standing on a ground anchor of site 0. */
const STRUT = {
  a: { x: 0, y: 0, z: 0 },
  b: { x: 0, y: 2, z: 0 },
} as const;

/** Place it, and fail the check if the placement was refused. */
async function placeStrut(h: Harness, when: string): Promise<void> {
  const { a, b } = STRUT;
  await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "strut");
  await h.advance(1);
  assertLength(
    (await h.snapshot()).structure.members,
    1,
    `the members standing ${when}: the edit has to land before it can be ` +
      "undone (specs/structure.md)",
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("undoes an edit under KeyZ on the build screen and not on the program screen", async () => {
  try {
    await openSite(h, 0);
    const opened = await h.snapshot();
    assertEqual(opened.screen, "build", "the screen a site opening shows");
    const empty = opened.historyDepth;

    // On the build screen, where the table says the action applies.
    await placeStrut(h, "before the undo on the build screen");
    assertEqual(
      (await h.snapshot()).historyDepth,
      empty + 1,
      "historyDepth once the edit has landed (specs/state.md)",
    );

    await h.press(KEY);
    assertEqual(
      (await h.snapshot()).historyDepth,
      empty,
      `historyDepth after ${KEY} on the build screen, where the undo action ` +
        "applies (specs/controls.md)",
    );

    // The same key, on a screen the table does not name.
    await placeStrut(h, "before the undo on the program screen");
    const before = (await h.snapshot()).historyDepth;
    await h.debug.setScreen("program");
    assertEqual(
      (await h.snapshot()).screen,
      "program",
      "the screen the second press is delivered on",
    );

    await h.press(KEY);
    assertEqual(
      (await h.snapshot()).historyDepth,
      before,
      `historyDepth after ${KEY} on the program screen, where the undo action ` +
        "does not apply (specs/controls.md)",
    );
  } finally {
    // In a `finally`, so a check that fails still leaves the picture that
    // shows why.
    await h.debug.setScreen("build");
    await h.advance(1);
    await h.capture("state", "the strut the program screen's undo left standing");
  }
});
