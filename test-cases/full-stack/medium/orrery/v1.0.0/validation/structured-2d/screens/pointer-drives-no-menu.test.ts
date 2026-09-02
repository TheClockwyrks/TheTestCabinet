// screens/pointer-drives-no-menu — the pointer works no menu.
//
// THE RULE is one sentence of `specs/controls.md`, The pointer: "The pointer
// operates the editor alone." `specs/ui.md` says the same from the menus' side,
// under Menu navigation: "Menus and select lists are worked from the keyboard
// alone, through the registered actions of `specs/controls.md`." So on the title
// and on a select screen a press, a move and a release are inert: they move no
// highlight and open nothing.
//
// THE CONFIGURATION sweeps the WHOLE stage on both menu screens, on a lattice of
// `PROBE_STEP` logical units, because a build that hit-tested a menu would do it
// somewhere in particular and nothing in `specs/` says where a menu is drawn.
// Every probe is a full gesture — a press, a move and a release — and one drag is
// dragged across the whole stage through every probe in turn, so a build that
// answered a MOVE rather than a press is swept too. One gesture on each screen is
// made with the real device instead of through the surface, so what is read is
// not merely the surface's own path: `h.mousePress`/`mouseGlide`/`mouseRelease`
// drive the runtime's pointer a frame at a time.
//
// THE HIGHLIGHTS ARE POSED OFF THEIR ARRIVAL VALUES first, onto the second title
// item and the third select row. That is what makes the point decidable in both
// directions: a build that moved a highlight to whatever the pointer was over
// fails, and so does one that snapped a highlight back to `0`, which a check
// starting at `0` could not tell from a build that did nothing.
//
// THE VERDICT. On the title, `menuIndex` and `screen` are where they were left;
// on the select screen, `selectIndex` and `screen` are. `state.pointer` itself is
// expected to move — it "mirrors the pointer's position and press state every
// frame" (`specs/controls.md`) — and nothing here reads it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STAGE_CX, STAGE_CY, STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureReplay,
  clickAt,
  createHarness,
  drag,
  gridPoints,
  openSelect,
  openTitle,
  type Harness,
} from "../harness";

/** How far apart the probes sit, in logical stage units. */
const PROBE_STEP = 80;

/** Every point on the stage a gesture is made at. */
const PROBES = gridPoints({ x: 0, y: 0, w: STAGE_W, h: STAGE_H }, PROBE_STEP);

/** Where the title's highlight is held: away from its arrival value. */
const HELD_ITEM = 1;

/** Where the select screen's highlight is held: away from its arrival value. */
const HELD_ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Press, move and release at every probe, then drag one gesture across them all. */
async function sweep(): Promise<void> {
  for (const at of PROBES) await clickAt(h, at);
  await drag(h, { x: 0, y: 0 }, { x: STAGE_W - 1, y: STAGE_H - 1 }, PROBES);
  await h.mousePress(STAGE_CX, STAGE_CY);
  await h.mouseGlide(STAGE_CX / 2, STAGE_CY / 2);
  await h.mouseRelease();
}

it("moves no highlight and opens nothing, anywhere on the title or a select screen", async () => {
  assertGreaterThan(
    PROBES.length,
    0,
    "the stage is swept at more than one point",
  );
  assertGreaterThan(
    TITLE_ITEMS.length,
    HELD_ITEM,
    "TITLE_ITEMS carries an entry the title's highlight can be held on",
  );

  await openTitle(h);
  await h.debug.setMenuIndex(HELD_ITEM);
  await h.advance(1);
  const onTitle = await h.snapshot();
  assertEqual(
    onTitle.screen,
    "title",
    "the first sweep is made on the title screen",
  );
  assertEqual(
    onTitle.menuIndex,
    HELD_ITEM,
    "the title's highlight is held away from its arrival value before the sweep",
  );

  const afterTitle = await captureReplay(h, "unmoved", async () => {
    await sweep();
    await h.advance(1);
    return h.snapshot();
  });
  assertEqual(
    afterTitle.screen,
    "title",
    "no press, move or release anywhere on the title leaves the screen",
  );
  assertEqual(
    afterTitle.menuIndex,
    HELD_ITEM,
    "no press, move or release anywhere on the title moves the highlight",
  );

  await openSelect(h, "campaign");
  const listed = await h.snapshot();
  assertGreaterThan(
    listed.campaign.count,
    HELD_ROW,
    "the shipped course holds the row the select highlight is held on",
  );
  await h.debug.setSelectIndex(HELD_ROW);
  await h.advance(1);
  const onSelect = await h.snapshot();
  assertEqual(
    onSelect.screen,
    "select",
    "the second sweep is made on a select screen",
  );
  assertEqual(
    onSelect.selectIndex,
    HELD_ROW,
    "the select highlight is held away from its arrival value before the sweep",
  );

  await sweep();
  await h.advance(1);

  const afterSelect = await h.snapshot();
  assertEqual(
    afterSelect.screen,
    "select",
    "no press, move or release anywhere on a select screen leaves the screen",
  );
  assertEqual(
    afterSelect.selectIndex,
    HELD_ROW,
    "no press, move or release anywhere on a select screen moves the highlight",
  );
});
