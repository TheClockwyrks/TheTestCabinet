// editor/tape-panel-owns-the-shared-corner — the corner the tape panel shares with
// the field and the tray belongs to the tape panel.
//
// THE RULE. `specs/editor.md`'s layout table gives the tape panel "`x`
// `TRAY_REGION_W` (`224`) to `STAGE_W` (`1280`), `y` `TAPE_Y0` (`560`) to `STAGE_H`
// (`720`)", the field "`x` `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y`
// `HEADING_H` (`48`) to `TAPE_Y0` (`560`)", and the tray "`x` `0` to
// `TRAY_REGION_W` (`224`), `y` `HEADING_H` (`48`) to `STAGE_H` (`720`)". The three
// meet at `(224, 560)`, and the rule under the table decides it: "Every extent
// above, and every rectangle this file fixes, includes its lower bound and
// excludes its upper, so a point on a shared edge belongs to the region below and
// to the right of it." The panel includes that point on both axes; the field
// excludes it on `y` and the tray on `x`.
//
// HOW THE VERDICT IS READ. `specs/controls.md` makes the focus the observable
// consequence of which region a press landed in: "A press inside the tape panel's
// extent, `x >= TRAY_REGION_W` (`224`) and `y >= TAPE_Y0` (`560`) as
// `specs/editor.md` fixes them, sets focus to `tape`; a press anywhere else on the
// editor screen sets it to `field`." So a press on that corner reads as `tape`
// focus exactly when the panel owns it.
//
// THE CONFIGURATION. `BARE` opened in the editor with an empty machine — the focus
// rule is a rule about the point, not about what is under it, and the panel with
// no rows is still the panel. The focus is set to `field` first, and read back, so
// the reading below is a change the press made rather than a value it inherited:
// "Focus is `field` on entering the editor" already, and this makes that explicit.
//
// THE VERDICT. After the press at exactly `(TRAY_REGION_W, TAPE_Y0)`,
// `editor.focus` is `tape`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAPE_Y0, TRAY_REGION_W } from "../constants";
import { type StagePoint } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The one point the tray, the field and the tape panel all touch. */
const CORNER: StagePoint = { x: TRAY_REGION_W, y: TAPE_Y0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the focus to tape when the press lands on the shared corner", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.setFocus("field");
  assertEqual(
    (await h.snapshot()).editor.focus,
    "field",
    "the focus is on the field before the press, so tape focus after it is the press's doing",
  );

  await pressAt(h, CORNER);
  await h.advance(1);
  await captureStill(h, "corner");
  const focus = (await h.snapshot()).editor.focus;
  await releasePointer(h);

  assertEqual(
    focus,
    "tape",
    `a press at (${CORNER.x}, ${CORNER.y}) is inside the tape panel, whose extent includes its lower bounds on both axes`,
  );
});
