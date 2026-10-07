// screens/title-highlight-distinct — the highlighted title item is drawn
// differently from the other two.
//
// THE RULE, `specs/ui.md`, Screens, `title`: "The item at `state.menuIndex` is
// highlighted and drawn distinctly from the others." How it is made distinct is
// the build's — `specs/ui.md` "fixes no palette, no font, and no background", so
// a marker, a plate behind the words, a weight, a size and a colour are all
// conformant ways of doing it. What the specification fixes is that the player
// can SEE which item the highlight is on, so the reading is the picture: the
// title screen with the first item highlighted and the title screen with the
// second item highlighted are not the same picture.
//
// THE CONFIGURATION is two first frames rather than two consecutive ones. The
// title screen's presentation is free to move — `specs/ui.md`'s What advances on
// each screen holds the GAME still on `title` while "`state.simTime` accumulates
// the frame's delta time on every update, whatever the screen" — so two frames
// taken one after the other could differ for reasons that have nothing to do with
// the highlight. Both frames here are instead the FIRST frame after a `reset`,
// which "restores every declared field of the game's state to its title-screen
// value" and leaves `simTime` at `0` (`specs/instrumentation.md`). The two frames
// therefore stand at the same instant of the game's own clock and differ in
// exactly one field: `menuIndex`.
//
// THE VERDICT. The two frames' pixels are not identical. A build that drew the
// menu the same way whichever item the highlight sat on leaves two identical
// pictures and fails; any distinction at all — one pixel of it — passes, because
// the specification names no particular one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pixelsDiffering,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the title menu differently at menuIndex 0 and at menuIndex 1", async () => {
  assertGreaterThan(
    TITLE_ITEMS.length,
    1,
    "TITLE_ITEMS carries more than one entry, so there are two highlights to tell apart",
  );

  await openTitle(h);
  const first = await h.snapshot();
  await captureStill(h, "first-highlighted");
  assertEqual(
    first.screen,
    "title",
    "the first frame this point reads is the title screen's",
  );
  assertEqual(
    first.menuIndex,
    0,
    "the title opens with its first item highlighted, which is the first frame read",
  );
  const highlighted = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  // The same first frame again, with the highlight one item down and nothing
  // else touched: the reset puts the clock back to `0` so the two frames stand
  // at the same instant.
  await h.debug.reset();
  await h.debug.setMenuIndex(1);
  await h.advance(1);
  const second = await h.snapshot();
  await captureStill(h, "second-highlighted");
  assertEqual(
    second.screen,
    "title",
    "the second frame this point reads is the title screen's too",
  );
  assertEqual(
    second.menuIndex,
    1,
    "the highlight really moved to the second item before the second frame",
  );
  const moved = await h.pixelRect(0, 0, STAGE_W, STAGE_H);

  assertEqual(
    moved.width * moved.height,
    highlighted.width * highlighted.height,
    "the two frames cover the same stage, so their pixels can be compared",
  );
  assertGreaterThan(
    pixelsDiffering(highlighted, moved),
    0,
    `the item at menuIndex is drawn distinctly from the others, so the title ` +
      `frame highlighting ${TITLE_ITEMS[0]} differs from the one highlighting ` +
      `${TITLE_ITEMS[1]}`,
  );
});
