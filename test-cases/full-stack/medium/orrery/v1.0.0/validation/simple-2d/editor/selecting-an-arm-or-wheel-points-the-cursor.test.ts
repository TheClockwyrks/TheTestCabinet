// editor/selecting-an-arm-or-wheel-points-the-cursor — selecting an arm, or a
// wheel, points the tape cursor at that part's row, cell `0`.
//
// THE RULE. "Selecting an arm or wheel also points the tape cursor at its row,
// cell `0`, leaving the focus on the field" (`specs/editor.md`, Selection on the
// field). Both kinds carry a row for it to point at: "The panel shows one row per
// arm and wheel, in placement order" (The tape panel), and `specs/parts.md` says a
// wheel "carries a tape like an arm". What the cursor is, is fixed by
// `specs/instrumentation.md`'s snapshot shape: `cursor: { part, col } | null`.
//
// HOW A PART IS SELECTED here is the player's own gesture, the press of
// `specs/editor.md`: "A press on the field targets a hex by the rule in
// `specs/field.md` … The press selects that part." The surface's `setSelected`
// is not used: it "Selects that part" and nothing more
// (`specs/instrumentation.md`), so it is not the selecting this rule is about.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, with one
// ARM anchored on `(-3, 0)` and one WHEEL anchored on `(3, 0)` — six hexes apart,
// so the arm's gripper hex `(-2, 0)` and the wheel's ring around `(3, 0)` cannot
// meet, and the hex each press targets carries exactly one of them. The cursor is
// CLEARED before each press, so what is read afterwards is that press's doing
// rather than a value it inherited; each press is released on the hex it began on,
// which "commits no move".
//
// THE VERDICT. After the press on the arm, `editor.cursor` names the arm at column
// `0`; after the press on the wheel, it names the wheel at column `0`. Each was
// `null` immediately before its press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { hexCenter, type Hex } from "../field";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
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

it("points the cursor at the selected arm's row, and at the selected wheel's row", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", WEST);
  const wheel = await placePart(h, "wheel", EAST);

  const cases: readonly {
    output: string;
    part: number;
    hex: Hex;
    kind: string;
  }[] = [
    { output: "arm", part: arm, hex: WEST, kind: "arm" },
    { output: "wheel", part: wheel, hex: EAST, kind: "wheel" },
  ];

  for (const posed of cases) {
    await h.debug.setCursor(null, 0);
    const cleared = (await h.snapshot()).editor.cursor;

    await pressAt(h, hexCenter(posed.hex));
    await h.advance(1);
    await captureStill(h, posed.output);
    const cursor = (await h.snapshot()).editor.cursor;
    await releasePointer(h);

    assertNull(
      cleared,
      `the cursor is cleared before the press on the ${posed.kind}, so what it reads afterwards is that press's doing`,
    );
    assertNotNull(
      cursor,
      `selecting the ${posed.kind} points the cursor rather than leaving it cleared`,
    );
    assertEqual(
      cursor?.part,
      posed.part,
      `selecting the ${posed.kind} points the cursor at that part's row`,
    );
    assertEqual(
      cursor?.col,
      0,
      `selecting the ${posed.kind} points the cursor at cell 0 of its row`,
    );
  }
});
