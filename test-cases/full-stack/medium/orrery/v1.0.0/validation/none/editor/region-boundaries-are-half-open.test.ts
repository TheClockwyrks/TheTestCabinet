// editor/region-boundaries-are-half-open — a region includes its lower bound and
// excludes its upper, so one unit decides which region a press lands in.
//
// THE RULE. "Every extent above, and every rectangle this file fixes, includes its
// lower bound and excludes its upper, so a point on a shared edge belongs to the
// region below and to the right of it" (`specs/editor.md`, Layout). The two
// regions that share the edge at `x` `TRAY_REGION_W` (`224`) are the tray, "`x` `0`
// to `TRAY_REGION_W` (`224`), `y` `HEADING_H` (`48`) to `STAGE_H` (`720`)", and the
// field, "`x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y` `HEADING_H`
// (`48`) to `TAPE_Y0` (`560`)". So `x` `223` is the tray's last column and `x`
// `224` is the field's first, and `y` `HEADING_H` (`48`) belongs to both of them
// rather than to the heading above.
//
// WHAT EACH SIDE DOES, so the two are told apart by consequence rather than by
// name. On the tray side, `(223, 48)` lies outside every entry rectangle — entries
// run `x` `TRAY_X0` (`8`) to `TRAY_X0 + TRAY_W` (`216`) and begin at `y` `TRAY_Y0`
// (`56`) — and "A press in the tray outside every entry does nothing beyond
// setting the focus", so the selection stands. On the field side, `(224, 48)` is
// the field's included upper-left corner, and no hex center is anywhere near it:
// `specs/field.md` spans the field's centers "stage `x` `376` to `856` and `y`
// `96.15` to `511.85`". A press there targets no hex, and "a press on a bare hex,
// or off every part, clears the selection".
//
// THE CONFIGURATION. `BARE` opened in the editor with one arm on the field and
// that arm selected. The two presses are made in that order, the selection put
// back between them, and they differ by a single unit of `x`.
//
// THE VERDICT. The press at `x` `223` leaves `editor.selected` naming the arm; the
// press at `x` `224` clears it. Neither begins a drag: the tray press landed on no
// entry, and the field press landed on no part.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HEADING_H, TRAY_REGION_W } from "../constants";
import { targetHex, type StagePoint } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The tray's last column, on the tray's first row of `y`. */
const TRAY_SIDE: StagePoint = { x: TRAY_REGION_W - 1, y: HEADING_H };

/** The field's included upper-left corner, one unit to the right of it. */
const FIELD_SIDE: StagePoint = { x: TRAY_REGION_W, y: HEADING_H };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads x 223 as a tray press and x 224 as a field press", async () => {
  assertNull(
    targetHex(FIELD_SIDE.x, FIELD_SIDE.y),
    "the field's upper-left corner has no hex center within HEX_HIT_R, so a press there targets no hex",
  );

  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setSelected(arm);

  await pressAt(h, TRAY_SIDE);
  await h.advance(1);
  await captureStill(h, "tray-side");
  const afterTray = (await h.snapshot()).editor;
  await releasePointer(h);

  assertEqual(
    afterTray.selected,
    arm,
    `a press at (${TRAY_SIDE.x}, ${TRAY_SIDE.y}) is a tray press, outside every entry, so the arm stays selected`,
  );
  assertNull(
    afterTray.drag,
    "that press lands on no tray entry, so it begins no placement",
  );

  await h.debug.setSelected(arm);
  assertEqual(
    (await h.snapshot()).editor.selected,
    arm,
    "the arm is selected again before the second press",
  );

  await pressAt(h, FIELD_SIDE);
  await h.advance(1);
  await captureStill(h, "field-side");
  const afterField = (await h.snapshot()).editor;
  await releasePointer(h);

  assertNull(
    afterField.selected,
    `a press at (${FIELD_SIDE.x}, ${FIELD_SIDE.y}) is a field press off every hex, so it clears the selection`,
  );
  assertNull(
    afterField.drag,
    "that press lands on no part, so it begins no move",
  );
});
