// hud/cooldown-state-changes-on-fire — a weapon's slot changes on the tick it
// fires.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Cooldowns | On
// each weapon's slot, its cooldown state: the slot's picture on the tick the
// weapon fires differs from its picture on the tick before". The sentence fixes
// the reading exactly, and this point is it.
//
// HOW THE FIRING TICK IS REACHED. `specs/weapons.md` — "Cooldown timers": "On
// acquisition the timer is `0`, so a weapon fires on the first `playing` tick it
// is held", Taper among the weapons that "need no target and fire the same way",
// and "The timers count and the weapons fire on the ticks the `weaponFire` switch
// ... is on". So the night holds every switch, Taper is held with its timer at
// `0`, and one frame is drawn with `weaponFire` off — the tick before, on which
// nothing fires — and then one with it on, which is the tick Taper fires. Both
// are drawn at the same posed tick, so the clock is the same on both and the only
// thing between them is the firing.
//
// WHERE THE SLOT IS. `specs/ui.md` fixes no layout, so the slot is found rather
// than looked for: it is the square around the icon the frame drew, which is the
// one icon on this night, out to `SLOT_HALF`.
//
// THE TOLERANCE. `SLOT_HALF` is `ICON_SIZE` (`24`) units either side of the
// icon, twice the icon the slot holds, which covers a slot drawn generously
// around its icon with its pips and its cooldown state and reaches no further
// than a neighbouring slot's own icon could stand. `CHANGE_MIN` is one pixel:
// the difference mask is built at a channel floor of `0`, and two frames of one
// posed scene differ on no pixels at all, so a single changed pixel is already
// above anything the sampling could invent out of eight-bit rounding or the
// host's antialiasing. It reads whether the slot was drawn differently, not how
// much of it moved. Neither figure is the specification's; `SLOT_HALF` is the
// allowance a reading of an unfixed layout needs.

import { afterEach, beforeEach, it } from "vitest";
import { ICON_SIZE } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  type Harness,
} from "../harness";
import { iconDraws } from "./readouts";
import { boxAround, changedIn, differenceMask, frame } from "./regions";
import { drawFrame, poseNight } from "./stage";

/** How far out from the icon's centre the slot around it is read. */
const SLOT_HALF = ICON_SIZE.width;

/**
 * The fewest changed pixels a sampling can tell from none. The mask is built at
 * a channel floor of `0` and two renders of one posed scene differ nowhere, so
 * anything the build painted into the slot clears this.
 */
const CHANGE_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws Taper's slot differently on the tick Taper fires", async () => {
  await poseNight(h);
  const slot = await holdWeapon(h, "taper", 1);
  await armWeapon(h, slot);

  await drawFrame(h);
  const icons = iconDraws(await h.lastCalls());
  assertEqual(icons.length, 1, "the icons drawn with Taper held alone");
  const box = boxAround({ x: icons[0]!.cx, y: icons[0]!.cy }, SLOT_HALF);
  const before = await frame(h);

  await enable(h, "weaponFire");
  const fired = await drawFrame(h);
  const after = await frame(h);
  await captureStill(h, "fire");

  assertEqual(
    (fired.run.weapons ?? []).length,
    1,
    "the weapons held on the firing tick",
  );
  assertGreaterThanOrEqual(
    changedIn(differenceMask(before, after), box),
    CHANGE_MIN,
    "the pixels of Taper's slot that changed on the tick it fired",
  );
});
