// assets/icons-produced — all twenty-seven icons are on disk at 24 x 24.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The icons"): "The
// twenty-seven icons are the items as a player knows them: the sixteen weapons,
// base and evolved, the ten passives, and lamp oil. Each is one `24 x 24` sprite
// at `assets/icons/<id>.png`, for each id in `BASE_WEAPON_IDS`, `EVOLUTION_IDS`,
// and `PASSIVE_IDS`, and `assets/icons/lamp-oil.png` for `LAMP_OIL_ID`." Every
// sprite stands on "a transparent, straight-alpha canvas of exactly the size its
// row states", so the canvas is exact.
//
// THE TOLERANCES. Every path and the `24 x 24` canvas are exact figures and are
// read exactly. That each file carries a drawing rather than an empty canvas is
// read against `PAINT_MIN_SHARE`, whose reasoning `assets/sprites.ts` states.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the twenty-seven differ from one
// another is `assets/icons-distinct`; that the HUD's slots and the two overlays
// draw them beside their names is the HUD and screens categories'; that an
// evolved weapon's icon "reads as a transformed version of its base's" is the art
// bar and the presentation domain's aesthetic rating.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { writeImage } from "./media-out";
import {
  assertProducedAt,
  decodeSprites,
  ICON_SPRITES,
  paintSprites,
} from "./sprites";

it("ships all twenty-seven icons as painted 24 x 24 files", async () => {
  const read = await decodeSprites(ICON_SPRITES);
  writeImage(
    "icons",
    await paintSprites("The twenty-seven icons", ICON_SPRITES, {
      checker: true,
      columns: 7,
      cell: 96,
    }),
  );

  for (const [index, icon] of ICON_SPRITES.entries()) {
    assertProducedAt(icon, read[index]!);
  }
});
