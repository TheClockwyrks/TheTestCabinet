// editor/selecting-a-rowless-part-leaves-the-cursor — selecting a sigil, a track, a
// rise, or a set leaves the tape cursor exactly where it stands.
//
// THE RULE. "Selecting an arm or wheel ALSO POINTS THE TAPE CURSOR AT ITS ROW,
// cell `0`" (`specs/editor.md`, Selection on the field) — an arm or a wheel, and
// those alone, because the panel it points into "shows one row per arm and wheel,
// in placement order" (The tape panel). A sigil, a track, a rise, and a set carry
// no row, so a selection of one has nothing to point at and the rule does not
// reach it: the cursor is left as it is.
//
// HOW A PART IS SELECTED here is the player's own gesture: "A press on the field
// targets a hex by the rule in `specs/field.md`. When parts share the hex, the
// topmost is taken: an arm or wheel anchored there, else a track with that cell,
// else the sigil whose footprint covers it. The press selects that part."
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and five
// parts placed so that each press lands on exactly one of them: one ARM on
// `(-3, 0)`, which is the row the cursor is parked on; a `bind` SIGIL anchored on
// `(0, 0)`, whose footprint is `(0, 0)`-`(1, 0)`; a CLOSED TRACK through
// `(0, 3)`, `(1, 3)`, `(0, 4)`, closed so that "A press on any cell of a closed
// track begins a move" rather than a lay; the RISE for reagent `0` on `(0, -3)`;
// and the SET for product `0` on `(3, 0)`. `BARE`'s one reagent and one product
// are each a single mote at `(0, 0)`, so each of those two footprints is its
// anchor hex alone. No footprint meets another and no track cell lies on one, as
// `specs/parts.md`'s placement rules require.
//
// The cursor is parked at column `2` of the ARM's row before each press, so what
// is read afterwards is that press's doing rather than a value carried over from
// the press before it. Each press is released on the hex it began on, which
// "commits no move".
//
// WHY THE SELECTION IS READ BACK. The verdict is that something did NOT move, and
// a build whose field presses do nothing at all would satisfy that for the wrong
// reason. So each case also reads that the press really did select the rowless
// part it landed on: the cursor held across a selection that happened.
//
// THE VERDICT. After each of the four presses `editor.cursor` still names the arm
// at column `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, hexCenter, type Hex } from "../field";
import { BARE, EAST, NORTH, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  placeRise,
  placeSet,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The column the cursor is parked on, and must still be on afterwards. */
const CURSOR_COL = 2;

/** A closed track: three cells, each adjacent to the next and the last to the first. */
const TRACK_CELLS: readonly Hex[] = [at(0, 3), at(1, 3), at(0, 4)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the cursor across a selection of a sigil, a track, a rise, and a set", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", WEST);
  const sigil = await placePart(h, "bind", ORIGIN);
  const track = await placeTrack(h, TRACK_CELLS, true);
  const rise = await placeRise(h, 0, NORTH);
  const set = await placeSet(h, 0, EAST);

  const cases: readonly { kind: string; part: number; hex: Hex }[] = [
    { kind: "sigil", part: sigil, hex: ORIGIN },
    { kind: "track", part: track, hex: at(1, 3) },
    { kind: "rise", part: rise, hex: NORTH },
    { kind: "set", part: set, hex: EAST },
  ];

  for (const posed of cases) {
    await h.debug.setCursor(arm, CURSOR_COL);
    const parked = (await h.snapshot()).editor.cursor?.col;

    await pressAt(h, hexCenter(posed.hex));
    await h.advance(1);
    await captureStill(h, "held");
    const editor = (await h.snapshot()).editor;
    await releasePointer(h);

    assertEqual(
      parked,
      CURSOR_COL,
      `the cursor is parked on the arm's column ${CURSOR_COL} before the press on the ${posed.kind}`,
    );
    assertEqual(
      editor.selected,
      posed.part,
      `the press really did select the ${posed.kind}, so the cursor was held across a selection that happened`,
    );
    assertEqual(
      editor.cursor?.part,
      arm,
      `selecting the ${posed.kind} leaves the cursor on the arm's row: only an arm or a wheel carries a row to point at`,
    );
    assertEqual(
      editor.cursor?.col,
      CURSOR_COL,
      `selecting the ${posed.kind} leaves the cursor at column ${CURSOR_COL}`,
    );
  }
});
