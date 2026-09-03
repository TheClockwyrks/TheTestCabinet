// screens/chest-copy — the chest overlay draws its heading.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"): "An overlay over the
// held world, opened as `specs/progression.md` states. It shows `CHEST_TEXT`
// (`A CHEST OPENS`) and the result in `chestResult`". `CHEST_TEXT` is that
// copy; the three results it shows beneath are their own points.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout, and
// the chest reached the real way: "The chest overlay is reached through
// `spawnPickup("chest", x, y)` at the lamplighter's center and one tick, which
// is the real collection path" (specs/instrumentation.md). With nothing held,
// the rules of specs/evolutions.md fall through to the heal, which is the
// simplest of the three and the one this check does not read: what it reads is
// the heading, which every chest shows. The screen is read back before the
// frame so that a build that opened nothing fails on the precondition.
//
// THE TOLERANCE. The heading is matched folded — lower-cased, with spaces,
// dashes and underscores removed, across consecutive runs of text — because
// specs/ui.md fixes "no palette, no font, no layout, and no styling".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHEST_TEXT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertShows, night, openHealChest, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws A CHEST OPENS on the open overlay", async () => {
  await night(h);
  const opened = await openHealChest(h);
  assertEqual(opened.screen, "chest", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "chest");

  assertShows(page, CHEST_TEXT, "the chest overlay");
});
