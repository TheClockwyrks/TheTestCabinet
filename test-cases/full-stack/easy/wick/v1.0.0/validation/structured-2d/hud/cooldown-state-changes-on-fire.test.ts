// hud/cooldown-state-changes-on-fire — a weapon's slot shows its cooldown state,
// which changes on the tick the weapon fires.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Cooldowns | On
// each weapon's slot, its cooldown state: the slot's picture on the tick the
// weapon fires differs from its picture on the tick before". That sentence is
// the threshold: the spec states the reading in pixels itself, so this point
// asserts it in pixels and reads no colour, shape, or place.
//
// THE DRIVE. `specs/instrumentation.md` gives `setWeaponCooldown(slot, seconds)`
// and the `weaponFire` switch, which while on has "Cooldown timers count down
// and due weapons fire". Taper is the fresh run's weapon (`specs/ui.md`, "A
// fresh run") and fires on its own with no target (`specs/weapons.md`), so an
// isolated world holding nothing but Taper, its timer posed part-spent and
// `weaponFire` turned back on, runs until the weapon is due and fires. The
// scenario steps ONE tick at a time and keeps the slot's picture from the tick
// before each, so the pair the spec sentence names is the pair compared.
//
// WHICH TICK IS THE FIRING TICK. The one that put a Taper shape in the world:
// `specs/weapons.md` has a firing create the weapon's shape, and the snapshot
// reports every zone with the weapon that made it (`specs/instrumentation.md`,
// "Snapshot shape"). Nothing else in this world creates one, since every other
// driver switch is off and no other weapon is held.
//
// WHERE THE SLOT IS, AND WHY THAT SQUARE. `specs/assets.md` produces one icon
// file per weapon and `specs/ui.md` draws it in the weapon's slot, so the slot is
// the square of canvas around where the frame blitted Taper's icon.
// `SLOT_HALF` reaches well past any slot a build draws around a `ICON_SIZE`
// (`24`) icon, and the comparison is confined to it so that what is read is the
// SLOT's picture rather than the world's: the shape the firing put in the world
// is drawn on the lamplighter at the stage centre, far from any HUD that leaves
// the night legible.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_HZ } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  pixelsDiffering,
  zonesOf,
  type Harness,
  type PixelRect,
} from "../harness";
import { boxAround } from "./regions";
import { iconAt } from "./slots";

/** The slot the fresh run's Taper sits in (`specs/ui.md`, "A fresh run"). */
const TAPER_SLOT = 0;

/**
 * How much of Taper's timer is left when the scenario starts, in seconds. Half
 * a second is long enough that the first frame, which renders the slot the
 * comparison starts from, is not itself the firing tick, and short enough that
 * the wait is thirty ticks.
 */
const TIMER = 0.5;

/** How far the scenario waits for the firing, in ticks: four seconds of night. */
const MAX_TICKS = 4 * TICK_HZ;

/** How far either side of an icon's centre a slot is taken to reach. */
const SLOT_HALF = 32;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("changes the slot's picture on the tick the weapon fires", async () => {
  isolate(h, { taper: true });
  h.debug.setWeaponCooldown(TAPER_SLOT, TIMER);
  h.debug.setWeaponFire(true);

  const blits = await h.frameBlits();
  const at = iconAt(blits, "taper");
  assertNotNull(at, "where the frame drew Taper's icon");
  const slot = boxAround(
    (at as { x: number; y: number }).x,
    (at as { x: number; y: number }).y,
    SLOT_HALF,
  );
  const picture = (): PixelRect => h.pixelRect(slot.x, slot.y, slot.w, slot.h);

  assertEqual(h.snapshot().screen, "playing", "the screen the posed run is on");

  let before = picture();
  for (let tick = 1; tick <= MAX_TICKS; tick += 1) {
    const after = await advanceTicks(h, 1);
    const now = picture();
    if (zonesOf(after, "taper").length > 0) {
      captureStill(h, "fire");
      assertGreaterThan(
        pixelsDiffering(before, now),
        0,
        "pixels Taper's slot changed on the tick it fired",
      );
      return;
    }
    before = now;
  }

  assertTrue(
    false,
    `Taper firing within ${MAX_TICKS} ticks of a timer of ${TIMER}`,
  );
});
