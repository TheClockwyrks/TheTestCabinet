// screens/playing-back-inert — back does nothing on the playing screen.
//
// WHAT THIS DECIDES. One thing: an `Escape` press while the night is running
// leaves the game on `playing` with the night still standing, so the run
// cannot be walked out of by the key that leaves every other screen.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("What each screen reads"): the `playing` row reads
//   "`pause` opens `paused`; `mute`" and omits `back`, and "An action a row
//   omits does nothing on that screen."
//   specs/controls.md ("Actions and bindings"): "`back` | `Escape` | edge |
//   leaves the screen, as the screen table below states."
//
// THE DRIVE. An isolated `playing` night holding nothing alive, given a
// weapon, a passive, a level, health short of full and kills, none of them a
// fresh run's — the reading has to tell "does nothing" from "abandons the
// night", and a build that routed `back` the way `paused` routes it answers
// the title on the idle run. Then one real `Escape` over one frame.
//
// WHAT THE TICKING FRAME LEAVES ALONE. specs/controls.md reads a frame's edges
// against the screen the frame began on and then runs "the frame's update ...
// on the screen the edges left", so the frame carrying the press ticks the
// night. The clock and the timers move with it and are not read; the slots,
// the level, health and kills are what a tick over an empty night leaves, so
// they are what this reads.
//
// THE TOLERANCE. None: a screen name, a level, health, a kill count, and the
// slots' ids and levels are exact.

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
  type RunSnapshot,
} from "../harness";

/** Figures the night carries, none of them a fresh run's. */
const POSED = { level: 7, hp: 77, kills: 250 };

/** The slots as this point reads them: what each holds, and at what level. */
function loadout(run: RunSnapshot): string[] {
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
  assertEqual(before.screen, "playing", "the screen Escape is pressed on");
  assertEqual(before.run.player.hp, POSED.hp, "the health the press finds");
  const posed = loadout(before.run);

  const after = await tap(h, "Escape");
  captureStill(h, "inert");

  assertEqual(after.screen, "playing", "the screen Escape left the game on");
  assertDeepEqual(loadout(after.run), posed, "the slots after Escape");
  assertEqual(after.run.level, POSED.level, "the level after Escape");
  assertEqual(after.run.player.hp, POSED.hp, "the health after Escape");
  assertEqual(after.run.kills, POSED.kills, "the kills after Escape");
});
