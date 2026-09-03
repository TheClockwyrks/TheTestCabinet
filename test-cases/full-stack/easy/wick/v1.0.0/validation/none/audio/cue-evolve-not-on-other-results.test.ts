// audio/cue-evolve-not-on-other-results — a chest that levels an item, and one
// that heals, play no evolve cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio") binds the cue to one
// event and no other: "`evolve` | `CUES.evolve` | A weapon evolves", and the
// paragraph under the table says a cue is played "on the tick its event happens".
// specs/evolutions.md ("Opening a chest") gives a chest three results and puts
// the cue on the first alone: rule 1 evolves and "the `evolve` cue plays"; rule 2
// levels one held item; rule 3 heals. So a chest whose result is `level` or
// `heal` plays no `evolve`, and the count read on each of those ticks is zero.
//
// WHY THE TWO LOADOUTS ARE WHAT THEY ARE. Rule 1 needs a base weapon at
// `MAX_WEAPON_LEVEL` (`8`) whose recipe passive is held, so neither loadout below
// holds one:
//   - The LEVEL leg holds Taper at level `1` and no passive. Rule 1 finds nothing
//     at its top level; rule 2 finds "one held item below its max level" and
//     levels it.
//   - The HEAL leg holds nothing at all. Rule 1 finds nothing; rule 2 finds no
//     held item below its max; rule 3 heals.
// Each result is asserted off `chestResult` before the silence is read, so a
// chest that did something else entirely reports that rather than a missing
// deviation.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, so nothing can hit, drop, or collect
// beside the chest, and `weaponFire` off means the Taper of the first leg fires
// nothing. Each chest is posed on the lamplighter's center, at distance `0`,
// inside `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS` (`12`), so the next
// tick collects it. Between the legs the overlay is closed through
// `setScreen("playing")`, which specs/instrumentation.md defines from `chest` as
// "Closes the overlay exactly as `confirm` does", and the leveled Taper is taken
// out of the loadout so the second chest reaches rule 3.
//
// THE TOLERANCE. None: a count of cues on one tick is a whole number, and the
// specification fixes it at zero on both ticks.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  openChest,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertSilent, openNight } from "./cues";

/** Frames recorded on each open overlay, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("plays no evolve cue on a chest that levels or one that heals", async () => {
  await openNight(h);
  const slot = await holdWeapon(h, "taper", 1);

  const cues = await watchNamedCues(h);
  const chests = await captureReplay(h, "silent", async () => {
    const leveled = await openChest(h);
    const leveledFrame = h.frame();
    await h.step(TRAIL_FRAMES);

    await h.debug.setScreen("playing");
    await h.debug.removeWeapon(slot);
    const healed = await openChest(h);
    const healedFrame = h.frame();
    await h.step(TRAIL_FRAMES);

    return { leveled, leveledFrame, healed, healedFrame };
  });

  assertEqual(
    chests.leveled.screen,
    "chest",
    "the screen the first chest opened",
  );
  assertEqual(
    chests.leveled.run.chestResult?.kind,
    "level",
    "the result a chest gave a loadout holding one item below its max",
  );
  assertSilent(
    cues,
    chests.leveledFrame,
    "evolve",
    "the evolve cues on the tick a chest leveled an item",
  );

  assertEqual(
    chests.healed.screen,
    "chest",
    "the screen the second chest opened",
  );
  assertEqual(
    chests.healed.run.chestResult?.kind,
    "heal",
    "the result a chest gave an empty loadout",
  );
  assertSilent(
    cues,
    chests.healedFrame,
    "evolve",
    "the evolve cues on the tick a chest healed",
  );
});
