// assets/icons-produced — the twenty-seven item icons are committed, each on
// its 24-pixel square, each carrying paint.
//
// WHAT THIS DECIDES. Twenty-seven files: `assets/icons/<id>.png` for each of
// the ten base weapons, the six evolutions and the ten passives, plus
// `assets/icons/lamp-oil.png`. Each is committed, decodes, sits on exactly
// `24 x 24`, and carries non-transparent paint.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The icons"): "The
// twenty-seven icons are the items as a player knows them: the sixteen
// weapons, base and evolved, the ten passives, and lamp oil. Each is one
// `24 x 24` sprite at `assets/icons/<id>.png`, for each id in
// `BASE_WEAPON_IDS`, `EVOLUTION_IDS`, and `PASSIVE_IDS`, and
// `assets/icons/lamp-oil.png` for `LAMP_OIL_ID`." `ICON_IDS`, `ICON_PATHS`
// and `ICON_SIZE` in `src/constants.ts` are that roster, those paths and that
// square.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the twenty-seven differ from one
// another is `assets/icons-distinct`; whether an evolved weapon's icon "reads
// as a transformed version of its base's" is the art bar and the presentation
// domain's aesthetic rating; and that the HUD's slots and the two overlays
// draw an icon beside a name belongs to the HUD and screen points.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a frame,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on.
//
// THE TOLERANCE. The canvas is exact, because the specification states it
// exactly. The paint floor is `PAINT_MIN_SHARE`, one pixel in a thousand,
// which on a `24 x 24` is a single pixel of its five hundred and seventy-six.

import { afterEach, beforeEach, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertProduced,
  ICON_SPRITES,
  readSprites,
  showSprites,
} from "./produced";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits all twenty-seven icons as painted 24 x 24 sprites", async () => {
  const reads = await readSprites(ICON_SPRITES);
  await showSprites(h, ICON_SPRITES);
  captureStill(h, "icons");

  assertProduced(reads);
});
