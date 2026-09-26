// contact/end-shows-no-chest-overlay — an ending tick collects a chest and
// applies its result but opens no chest overlay.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn": "A tick that ends the
// run opens no overlay: a chest it collected has its result applied and no
// overlay shown". The phase order puts the collection in step 8, the ending
// in step 11, and the overlays last, step 12: "A tick that ends the run opens
// no overlay. Otherwise a tick that collected a chest opens the chest
// overlay". `specs/progression.md`, The level-up overlay, repeats it: "A tick
// that ends the run ends it and opens no overlay, chest or level-up."
//
// WHY THE CHEST'S RESULT IS A LEVEL, NOT A HEAL. The ending must still hold
// AFTER the chest applies its result in phase 8, and a chest whose first two
// rules find nothing heals for `30` (`specs/evolutions.md`, Opening a chest),
// which from a posed `hp` of `0` would lift the lamplighter back to `30`
// before phase 11 read the condition, and nothing would end. So the loadout
// holds exactly one thing a chest can act on: Taper at level `1`, "One held
// item below its max level", which the second rule levels to `2`. `hp` posed
// to `0` then stays `0` through the collection, and the tick ends fallen.
//
// THE POSE. `isolate` places Taper (its `taper`) and nothing else; a chest
// posed at the lamplighter's center, within `PICKUP_ITEM_RADIUS +
// PLAYER_RADIUS` so phase 8 collects it; `hp` `0` through `setHp`;
// `weaponFire` off so Taper does not slash. The reading is the screen, with
// the collection read first so a build whose chest was never collected fails
// on that rather than on an overlay it never had to decide about.
//
// THE TOLERANCE. A screen name and a count, exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placePickup,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends fallen rather than on the chest overlay when the ending tick collects a chest", async () => {
  const start = isolate(h, { taper: true });
  assertDeepEqual(
    start.run.weapons.map((weapon) => `${weapon.id}:${weapon.level}`),
    ["taper:1"],
    "the one held item, below its max, that the chest can level",
  );
  h.debug.setHp(0);
  const { player } = start.run;
  placePickup(h, "chest", player.x, player.y);

  const after = await advanceTicks(h, 1);
  captureStill(h, "ended");

  assertEqual(
    after.run.pickups.length,
    0,
    "the chest at the lamplighter's center was collected (specs/world.md, Collection)",
  );
  assertEqual(
    after.screen,
    "fallen",
    "the screen at the end of a tick that both ends the run and collected a chest (specs/world.md, Fallen and dawn)",
  );
});
