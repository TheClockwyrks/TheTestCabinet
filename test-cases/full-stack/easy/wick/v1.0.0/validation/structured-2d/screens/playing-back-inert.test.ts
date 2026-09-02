// Wick — screens/playing-back-inert: `back` does nothing on the playing
// screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "What each
// screen reads", gives the `playing` row "`pause` opens `paused`; `mute`" and
// no `back`, and beneath the table "An action a row omits does nothing on that
// screen." `back` is bound to `Escape` in "Actions and bindings", where it
// "leaves the screen, as the screen table below states".
//
// THE DRIVE. An isolated `playing` night holding nothing alive, given a weapon
// at a level, a passive at a level, a level of its own, health short of full
// and a kill count — none of them a fresh run's, so that a build which routed
// `back` the way `paused` routes it shows up in the run as well as in the
// screen. Then one real `Escape`, delivered by one frame.
//
// WHAT THE FRAME TICKS. `specs/controls.md` reads a frame's edges against the
// screen the frame began on and runs the frame's update "on the screen the
// edges left", so the frame carrying this press ticks the night. The clock and
// the timers move with it and go unread; the slots, the level, health and
// kills are what a tick over a night with nothing alive leaves untouched, and
// they are what this reads.
//
// THE TOLERANCE. None: a screen name, a level, health, a kill count, and the
// slots' ids and levels.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  tap,
  type Harness,
  type SnapshotRun,
} from "../harness";

/** Figures the night carries, none of them a fresh run's. */
const POSED = { level: 7, hp: 77, kills: 250 };

/** The slots as this point reads them: what each holds, and at what level. */
function loadout(run: SnapshotRun): string[] {
  return [
    ...run.weapons.map((held) => `weapon ${held.id} ${held.level}`),
    ...run.passives.map((held) => `passive ${held.id} ${held.level}`),
  ];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves playing and the night's loadout, level, health and kills after Escape", async () => {
  isolate(h);
  holdWeapon(h, "ember", 3);
  holdPassive(h, "brass", 2);
  h.debug.setLevel(POSED.level);
  h.debug.setHp(POSED.hp);
  h.debug.setKills(POSED.kills);
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the press is made on");
  assertEqual(before.run.player.hp, POSED.hp, "the health the press finds");
  const posed = loadout(before.run);

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "playing", "the screen after Escape");
  assertDeepEqual(loadout(after.run), posed, "the slots after Escape");
  assertEqual(after.run.level, POSED.level, "the level after Escape");
  assertEqual(after.run.player.hp, POSED.hp, "the health after Escape");
  assertEqual(after.run.kills, POSED.kills, "the kills after Escape");
});
