// hud/cooldown-zero-shows-nothing-to-run — a weapon whose timer is `0` shows a
// slot with nothing left to run, and a weapon with time on its timer does not.
//
// THE REQUIREMENT. `specs/ui.md` — "`playing`", the HUD table: "Cooldowns | On
// each weapon's slot, its cooldown state: ... a weapon whose timer is `0` shows
// nothing left to run." A state with nothing left to run is a state that does
// not move, so the reading is: the slot's picture is the same on tick after
// tick while the timer stands at `0`, and it is not the picture the same slot
// shows while the timer stands at a second.
//
// THE DRIVE. `specs/instrumentation.md` gives `setWeaponCooldown(slot, seconds)`
// and the `weaponFire` switch, which while OFF holds "Every cooldown timer ...
// where it stands and nothing fires or pulses". So a timer posed with the switch
// off stays posed for as many ticks as the scenario runs, which is what makes
// three ticks of one picture a reading about the timer rather than about time.
// An isolated world holds nothing else at all: no enemy, no zone, no other
// weapon, and every other driver switch off, so a tick changes nothing in the
// slot but a cooldown state.
//
// THE TWO TIMERS. `0` is the figure the spec sentence names. `1.0` is a second,
// which is under Taper's own cooldown at level `1` (`specs/weapons.md` gives it
// `1.35`), so it is a timer the weapon really carries part-way through its
// wait rather than one no state could hold.
//
// WHERE THE SLOT IS. `specs/assets.md` produces one icon file per weapon and
// `specs/ui.md` draws it in the weapon's slot, so the slot is the square of
// canvas around where the frame blitted Taper's icon; both runs draw it in the
// same place, which the scenario checks before comparing the two squares.
//
// WHY EACH TIMER GETS A HARNESS OF ITS OWN. The two runs then sit at the same
// tick and the same run state and differ in the one figure this point is about.

import { afterEach, it } from "vitest";
import { TAPER_LEVELS } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotNull,
  assertPointNear,
} from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  pixelsDiffering,
  type Harness,
  type PixelRect,
} from "../harness";
import { boxAround, type Rect } from "./regions";
import { iconAt } from "./slots";

/** The slot the fresh run's Taper sits in (`specs/ui.md`, "A fresh run"). */
const TAPER_SLOT = 0;

/** The timer with nothing left to run, and one part-way through a wait. */
const RESTING = 0;
const RUNNING = 1.0;

/** How many ticks the resting slot is watched over. */
const WATCHED_TICKS = 3;

/** How far either side of an icon's centre a slot is taken to reach. */
const SLOT_HALF = 32;

/** How far an icon may sit from where the other run drew it and still be its slot. */
const SLOT_DRIFT = 1;

interface Run {
  h: Harness;
  slot: Rect;
}

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

/** An isolated run holding Taper alone, its timer posed and held there. */
async function runAt(timer: number): Promise<Run> {
  const h = await createHarness();
  harnesses.push(h);
  isolate(h, { keepTaper: true });
  h.debug.setWeaponCooldown(TAPER_SLOT, timer);

  const blits = await h.frameBlits();
  const at = iconAt(blits, "taper");
  assertNotNull(at, `where the run at a timer of ${timer} drew Taper's icon`);
  const centre = at as { x: number; y: number };

  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", `the screen at a timer of ${timer}`);
  assertEqual(
    posed.weaponFire,
    false,
    "the weaponFire switch while the timer is held",
  );
  assertEqual(
    posed.run.weapons[TAPER_SLOT].cooldown,
    timer,
    "the timer the slot holds",
  );
  return { h, slot: boxAround(centre.x, centre.y, SLOT_HALF) };
}

/** The slot's picture on the run's current frame. */
function picture(run: Run): PixelRect {
  return run.h.pixelRect(run.slot.x, run.slot.y, run.slot.w, run.slot.h);
}

it("shows nothing left to run on a slot whose timer is zero", async () => {
  assertLessThan(
    RUNNING,
    TAPER_LEVELS[0].cooldown,
    "the running timer, against Taper's own cooldown at level 1",
  );

  const resting = await runAt(RESTING);
  const pictures: PixelRect[] = [picture(resting)];
  for (let tick = 1; tick < WATCHED_TICKS; tick += 1) {
    const after = await advanceTicks(resting.h, 1);
    assertEqual(
      after.run.weapons[TAPER_SLOT].cooldown,
      RESTING,
      `the timer the held switch left after ${tick} ticks`,
    );
    pictures.push(picture(resting));
  }
  captureStill(resting.h, "idle");

  for (let at = 1; at < pictures.length; at += 1) {
    assertEqual(
      pixelsDiffering(pictures[0], pictures[at]),
      0,
      `pixels the resting slot changed by tick ${at + 1} of ${WATCHED_TICKS}`,
    );
  }

  const running = await runAt(RUNNING);
  for (let tick = 1; tick < WATCHED_TICKS; tick += 1) {
    await advanceTicks(running.h, 1);
  }
  assertPointNear(
    { x: running.slot.x, y: running.slot.y },
    { x: resting.slot.x, y: resting.slot.y },
    SLOT_DRIFT,
    "where the two runs drew Taper's slot",
  );

  assertGreaterThan(
    pixelsDiffering(pictures[0], picture(running)),
    0,
    `pixels the slot at a timer of ${RUNNING} differs from the slot at a timer of ${RESTING} in`,
  );
});
