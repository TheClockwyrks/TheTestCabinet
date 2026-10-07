// screens/offer-shows-icon — each offer shows its item's icon.
//
// WHAT THIS DECIDES. One thing: every offer on the overlay paints the produced
// icon file of the item it offers, rather than a shape of the build's own or
// another item's picture.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`levelup`, the offer table): "Icon | The item's produced icon."
//   specs/assets.md ("The icons"): "Each is one `24 x 24` sprite at
//   `assets/icons/<id>.png`, for each id in `BASE_WEAPON_IDS`, `EVOLUTION_IDS`,
//   and `PASSIVE_IDS` ... The HUD's slots and the level-up and chest overlays
//   draw them beside the names `specs/ui.md` states".
//   specs/progression.md ("Choosing"): "Each offer shows the item's icon, its
//   display name, and a tag".
//
// THE DRIVE. An isolated `playing` run holding no weapon and no passive, so the
// only icons a frame can paint are the offers' own: an empty loadout draws no
// filled HUD slot. The overlay is opened by the tick a queued level-up opens
// it, with three ids posed through `setNextOffers`, and the frame's blits are
// attributed to files by the path the engine served them from.
//
// THE TOLERANCE. None on identity: a blit either painted the produced file for
// that id or it did not. Nothing about where the icon sits or how large it is
// drawn is read, since specs/ui.md fixes no layout.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { iconPath } from "../constants";
import {
  blitsOfFile,
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

/** Three candidates of an empty loadout's pool: two weapons and one passive. */
const OFFERS = ["ember", "shard", "glass"] as const;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("paints the produced icon of every offered item", async () => {
  isolate(h);
  h.debug.setNextOffers([...OFFERS]);
  const opened = await openLevelUp(h, 1);
  assertDeepEqual(
    opened.run.offers,
    [...OFFERS],
    "the offers the overlay presents",
  );

  const { blits } = await h.frameDraw();
  captureStill(h, "icons");

  assertDeepEqual(
    OFFERS.filter((id) => blitsOfFile(blits, iconPath(id)).length === 0),
    [],
    "the offered items whose produced icon the overlay never painted",
  );
});
