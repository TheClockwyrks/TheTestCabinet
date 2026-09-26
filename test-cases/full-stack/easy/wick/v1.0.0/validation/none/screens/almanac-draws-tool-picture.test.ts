// screens/almanac-draws-tool-picture — the highlighted tool's picture is the two
// produced files the specification names for it.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "Picture | The
// produced sprite the table below names", and the tab's row of that table:
// "`TOOLS` | the weapon's icon and its effect, animated where the effect is a
// sheet". specs/assets.md names both files for Taper: an icon is "one `24 x 24`
// sprite at `assets/icons/<id>.png`", and the weapon effects table gives Taper
// the still `assets/sprites/effects/taper.png`. So the picture is those two
// files and no others.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. specs/assets.md has a produced
// file "scaled in code to the live shape", so the size and the place a picture
// lands at say nothing about which file it is; the SOURCE says everything. Each
// image the frame drew is matched against the committed file's own pixels, both
// decoded through the same browser, exactly as the presentation category's
// points about a drawn sprite are decided.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which stands it on the `TOOLS` tab with `menuIndex`
// `0`, and Taper is the first of `BASE_WEAPON_IDS`, so the entry whose picture
// is read is the one the screen is entered on and no key is pressed at all.
//
// THE TOLERANCE. The presentation category's, since the comparison is its own: a
// channel of a decoded pixel may miss by `4` on a `0`-`255` scale, and one pixel
// in two hundred may differ, which covers the canvas's premultiplied round trip
// and sits far below any difference between two produced files. At least one
// draw of each file counts, because specs/ui.md fixes what the detail shows and
// leaves whatever else a build puts on the screen to it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { EFFECT_SPRITES, iconFile } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertDrawsProduced, openAlmanac, tabIndex } from "./almanac";
import { shown } from "./stage";

/** The tab and the entry this reads: the first of `BASE_WEAPON_IDS`. */
const TOOLS = tabIndex("TOOLS");
const TOOL = "taper";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws Taper's produced icon and its produced slash effect", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.almanacTab, TOOLS, "the tab the picture is read on");
  assertEqual(opened.menuIndex, 0, "the entry the picture is read on");

  const page = await shown(h);
  await captureStill(h, "picture");

  await assertDrawsProduced(
    h,
    page.calls,
    [iconFile(TOOL)],
    "the highlighted tool's produced icon",
  );
  await assertDrawsProduced(
    h,
    page.calls,
    EFFECT_SPRITES[TOOL].files,
    "the highlighted tool's produced effect",
  );
});
