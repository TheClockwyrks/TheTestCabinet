// contact/fallen-at-zero — a tick that leaves hp at or below zero ends the
// run fallen at the end of that tick.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn": "A run ends at the end
// of a tick, after every other phase of that tick has been applied, in one of
// two ways", and the Fallen row: condition "`hp` is `0` or below", screen
// `fallen`. "A run that has ended ticks no further." `specs/ui.md` gives the
// end screens "`menuIndex` is `0` on arriving".
//
// HOW HP GETS THERE. Through a real hit rather than a pose at `0`: `hp` posed
// to `15` through `setHp`, which starts a live tick, and a hound overlapping
// the lamplighter whose hit of `20` (`specs/enemies.md`) takes it to `−5` in
// phase 7 of that tick. Phase 11 then reads the condition and ends the run,
// so the FIRST tick driven is the ending tick and `tick` reads `1` on the end
// screen: a run that ended a tick late, or ran on, reads more.
//
// WHAT THE REPLAY SHOWS. The hit's tick and a few frames after it on the end
// screen, on which "a frame ticks nothing" (`specs/instrumentation.md`), so
// `tick` still reads `1` at the end of the capture.
//
// THE POSE. One hound, `enemyMotion` off, `enemyContact` on, nothing else.
// `15` is above the hound's `20` by nothing and below it by five, so the
// reading is not the exact-zero edge, which is `fallen-at-exactly-zero`'s.
//
// THE TOLERANCE. A screen name, a menu index, and a tick count, all exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { ENEMIES } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** The hp posed before the hit: five short of the hound's damage. */
const POSED_HP = 15;

/** The hound's center distance: inside its `18 + 12` overlap bound. */
const OFFSET = 15;

/** Frames run on the end screen, for the replay to show it. */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the run fallen with menuIndex 0 at the end of the tick that takes hp below 0", async () => {
  if (!(POSED_HP < ENEMIES.hound.damage)) {
    throw new Error("the hit must take hp below zero");
  }

  isolate(h);
  h.debug.setHp(POSED_HP);
  placeEnemyNear(h, "hound", OFFSET, 0);
  enable(h, "enemyContact");

  const ended = await captureReplay(h, "fallen", async () => {
    const s = await advanceTicks(h, 1);
    await h.advance(AFTER_FRAMES);
    return s;
  });

  assertLessThanOrEqual(
    ended.run.player.hp,
    0,
    "the hit landed and left hp at or below 0 (specs/world.md, Contact damage)",
  );
  assertEqual(
    ended.screen,
    "fallen",
    "the screen at the end of the tick that left hp at or below 0 (specs/world.md, Fallen and dawn)",
  );
  assertEqual(
    ended.menuIndex,
    0,
    "menuIndex on arriving at fallen (specs/ui.md)",
  );
  assertEqual(
    h.snapshot().run.tick,
    1,
    "the run ended on its first tick and ticked no further (specs/world.md, Fallen and dawn)",
  );
});
