// contact/fallen-at-zero — a tick that leaves hp at or below 0 ends the run at
// the end of that tick: screen fallen, menuIndex 0.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: "A run ends at the
// end of a tick, after every other phase of that tick has been applied", with
// the Fallen row "hp is 0 or below" giving screen fallen. specs/ui.md, fallen
// and dawn: "menuIndex is 0 on arriving." The ending is phase 11 of One tick,
// after the contact of phase 7, so the tick on which a hit takes hp below 0 is
// the tick the run ends on.
//
// THE POSE. An isolated night with enemyContact on: hp posed to 10 through
// setHp, and one hound, whose damage is 20 (specs/enemies.md), posed 10 units
// along +x inside the 30 its radius 18 plus PLAYER_RADIUS sum to, held there
// with enemyMotion off. Its cooldown is 0 at spawn, so its hit lands on the
// first tick and leaves hp at −10, and that tick ends the run. The replay runs
// on for a few frames after the ending so the end screen is what it shows.
//
// THE TOLERANCE. None: the screen and the menu index are discrete, and the tick
// the run ended on is read as the run's tick count, exactly 1.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy whose hit takes hp below 0: damage 20, radius 18. */
const TYPE = "hound";

/** Where the hound is posed: 10 units along +x, inside the overlap. */
const OFFSET = 10;

/** The hp posed: less than the hound's damage, so its hit ends the run. */
const POSED_HP = 10;

/** Frames of the end screen kept in the replay after the ending tick. */
const AFTERMATH_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run fallen at the end of the tick whose hit takes hp below 0", async () => {
  const posed = isolate(h);
  enable(h, "enemyContact");
  h.debug.setHp(POSED_HP);
  spawnEnemyNear(h, TYPE, OFFSET, 0);

  const ended = await captureReplay(h, "fallen", async () => {
    const after = await h.tick(1);
    await h.advance(AFTERMATH_FRAMES);
    return after;
  });

  // The tick did leave hp at or below 0: the condition the ending reads.
  assertLessThanOrEqual(ended.run.player.hp, 0, "hp after the hound's hit");
  assertEqual(ended.screen, "fallen", "screen after the ending tick");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at fallen");
  assertEqual(
    ended.run.tick,
    posed.run.tick + 1,
    "the run ended on the tick of the hit",
  );
});
