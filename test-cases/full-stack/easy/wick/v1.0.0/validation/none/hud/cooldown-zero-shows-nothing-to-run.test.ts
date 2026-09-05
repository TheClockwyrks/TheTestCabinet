// hud/cooldown-zero-shows-nothing-to-run — a slot whose timer is `0` shows
// nothing left to run.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Cooldowns | On
// each weapon's slot, its cooldown state: ... a weapon whose timer is `0` shows
// nothing left to run".
//
// WHAT "NOTHING LEFT TO RUN" IS READ AS, AND WHY IT TAKES TWO READINGS. A slot
// with nothing left to run is a slot with nothing running: three ticks pass with
// the timer held at `0` and its picture does not move. `specs/instrumentation.md`
// — "The driver switches": while `weaponFire` is off "Every cooldown timer holds
// where it stands and nothing fires or pulses", and `specs/world.md` — "Timers":
// "A timer held by one of the driver switches ... neither counts down nor is
// due". So the timer really is at `0` on all three ticks, and a slot that keeps
// sweeping something across them is drawing from the wall clock rather than from
// the state.
//
// The second reading is what keeps the first from passing a slot that draws no
// cooldown state at all: with the timer posed to `RESTING` seconds the same slot
// must look different from the way it looks at `0`. Together they say the slot
// shows the timer, and shows nothing when the timer is `0`.
//
// THE FIGURES. `RESTING` is `1.0` seconds, under Taper's own `1.35` cooldown at
// level `1` (specs/weapons.md — "Taper"), so it is a timer the weapon could
// really be carrying. `SLOT_HALF` and `CHANGE_MIN` are as
// `hud/cooldown-state-changes-on-fire` states them: `ICON_SIZE` (`24`) units
// either side of the icon covers a slot drawn around it, and one pixel is the
// fewest a sampling can tell from none, the mask being built at a channel floor
// of `0` and the three idle ticks above differing nowhere at all.

import { afterEach, beforeEach, it } from "vitest";
import { ICON_SIZE } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  type Harness,
} from "../harness";
import { iconDraws } from "./readouts";
import { boxAround, changedIn, differenceMask, frame } from "./regions";
import { drawFrame, poseNight } from "./stage";

/** A timer the weapon could be carrying: under Taper's `1.35` at level `1`. */
const RESTING = 1.0;

/** How far out from the icon's centre the slot around it is read. */
const SLOT_HALF = ICON_SIZE.width;

/**
 * The fewest changed pixels a sampling can tell from none. The mask is built at
 * a channel floor of `0` and two renders of one posed scene differ nowhere, so
 * anything the build painted differently into the slot clears this.
 */
const CHANGE_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds Taper's slot still while its timer is 0, and moves it when it is not", async () => {
  await poseNight(h);
  const slot = await holdWeapon(h, "taper", 1);
  await h.debug.setWeaponCooldown(slot, 0);

  await drawFrame(h);
  const icons = iconDraws(await h.lastCalls());
  assertEqual(icons.length, 1, "the icons drawn with Taper held alone");
  const box = boxAround({ x: icons[0]!.cx, y: icons[0]!.cy }, SLOT_HALF);

  const idle = [await frame(h)];
  for (let tick = 0; tick < 2; tick += 1) {
    await h.step(1);
    idle.push(await frame(h));
  }

  await h.debug.setWeaponCooldown(slot, RESTING);
  await h.step(1);
  const running = await frame(h);
  await captureStill(h, "idle");

  const held = await h.snapshot();
  assertEqual(
    (held.run.weapons ?? [])[0]?.cooldown,
    RESTING,
    "the cooldown timer the slot has to show once it was posed",
  );
  for (const [tick, drawn] of idle.slice(1).entries()) {
    assertEqual(
      changedIn(differenceMask(idle[0]!, drawn), box),
      0,
      `the pixels of Taper's slot that changed ${tick + 1} tick(s) after a timer of 0`,
    );
  }
  assertGreaterThanOrEqual(
    changedIn(differenceMask(idle[0]!, running), box),
    CHANGE_MIN,
    `the pixels of Taper's slot that differ between a timer of 0 and one of ${RESTING}`,
  );
});
