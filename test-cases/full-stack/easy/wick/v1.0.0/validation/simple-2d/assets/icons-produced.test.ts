// Wick — assets/icons-produced: all twenty-seven icons are committed files on
// their stated canvas, each painted.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The icons): "The twenty-seven icons are the items as a
//     player knows them: the sixteen weapons, base and evolved, the ten
//     passives, and lamp oil. Each is one `24 x 24` sprite at
//     `assets/icons/<id>.png`, for each id in `BASE_WEAPON_IDS`,
//     `EVOLUTION_IDS`, and `PASSIVE_IDS`, and `assets/icons/lamp-oil.png` for
//     `LAMP_OIL_ID`."
//   - specs/assets.md (The sprites): every sprite is "of exactly the size its
//     row states".
//   - `constants.ts` carries the ids as `ICON_IDS`, the path as `iconPath`, and
//     the square as `ICON_SIZE`.
//
// WHAT IS READ. All twenty-seven files, each decoding, each exactly `24 x 24`,
// each carrying at least one pixel that is not fully transparent.
//
// WHAT IT DELIBERATELY DOES NOT READ. That no two icons are the same picture is
// `assets/icons-distinct`; where an icon is drawn, and which slot or offer
// carries which, is the HUD's and the overlays' own points.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is the twenty-seven files laid out as a grid.
//
// TOLERANCE. None. Twenty-seven exact paths, an exact canvas, and a count.

import { it } from "vitest";
import { captureCanvas } from "../harness";
import { ICON_SPRITES, assertProduced, readSprites, sheetOf } from "./produced";

it("commits twenty-seven painted 24 x 24 icons", async () => {
  const reads = await readSprites(ICON_SPRITES);

  captureCanvas(
    await sheetOf(ICON_SPRITES, {
      title: "assets/icons — sixteen weapons, ten passives, lamp oil",
    }),
    "icons",
  );

  for (const read of reads) assertProduced(read);
});
