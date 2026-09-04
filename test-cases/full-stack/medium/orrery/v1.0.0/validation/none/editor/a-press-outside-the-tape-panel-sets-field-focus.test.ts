// editor/a-press-outside-the-tape-panel-sets-field-focus — every press that lands
// anywhere but the tape panel leaves the focus on `field`.
//
// THE RULE. "`state.editor.focus` is `field` or `tape`, and it routes the editing
// keys. A press inside the tape panel's extent, `x >= TRAY_REGION_W` (`224`) and
// `y >= TAPE_Y0` (`560`) as `specs/editor.md` fixes them, sets focus to `tape`; a
// press anywhere else on the editor screen sets it to `field`"
// (`specs/controls.md`, Focus). "Anywhere else" is every one of the editor's other
// four regions, which `specs/editor.md` tabulates: the heading, the tray, the
// field, and the readout.
//
// THE PRESS IS READ AS A CHANGE, NOT AS A VALUE. `field` is also the focus's
// RESTING value — "`editor`... `focus` `"field"`... when nothing is open"
// (`specs/instrumentation.md`) — so a build that read no press at all would
// report `field` forever and pass a check that only looked. Each press here is
// therefore preceded by posing the focus to `tape` through the surface's
// `setFocus`, and the posed value is read back before the press: what the check
// decides is that the press carried the focus from `tape` to `field`.
//
// THE FOUR POINTS. The middle of the heading and of the readout, both display-only
// regions; the middle of the tray's first entry, which is a live tray slot; and
// the centre of the hex at `(0, 0)`, which is a bare hex on an empty field. Each
// press is released where it was made, so a tray entry's place drag "places
// nothing" (`specs/editor.md`, Dragging) and the machine stays empty.
//
// THE VERDICT. `editor.focus` reads `field` after each of the four presses.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  HEADING_REGION,
  READOUT_REGION,
  hexCenter,
  regionCenter,
  traySlot,
  type StagePoint,
} from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  clickAt,
  createHarness,
  openChallengeDocument,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The four places outside the panel a press is made, by the region they lie in. */
const OUTSIDE: readonly { where: string; at: StagePoint }[] = [
  { where: "the field", at: hexCenter(ORIGIN) },
  { where: "the tray", at: regionCenter(traySlot(0)) },
  { where: "the heading", at: regionCenter(HEADING_REGION) },
  { where: "the readout", at: regionCenter(READOUT_REGION) },
];

it("carries the focus back to field from each of the other four regions", async () => {
  await openChallengeDocument(h, BARE);

  const readings = await captureReplay(h, "focus", async () => {
    const seen: { where: string; posed: string; after: string }[] = [];
    for (const press of OUTSIDE) {
      await h.debug.setFocus("tape");
      const posed = (await h.snapshot()).editor.focus;
      await clickAt(h, press.at);
      await h.advance(1);
      seen.push({
        where: press.where,
        posed,
        after: (await h.snapshot()).editor.focus,
      });
    }
    return seen;
  });

  for (const reading of readings) {
    assertEqual(
      reading.posed,
      "tape",
      `the focus stood at tape before the press on ${reading.where}, so the press has something to change`,
    );
    assertEqual(
      reading.after,
      "field",
      `a press on ${reading.where} is a press outside the tape panel, so it sets the focus to field`,
    );
  }

  assertLength(
    (await h.snapshot()).editor.parts,
    0,
    "the four presses changed the focus alone: each was released where it was made, so the tray's drag placed nothing",
  );
});
