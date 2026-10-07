// contact/dawn-at-36000 — the run ends at dawn on the tick the clock reaches
// DAWN_TIME × TICK_HZ.
//
// THE SPEC LINE. `specs/world.md`, "Fallen and dawn", the Dawn row: condition
// "`tick` equals `DAWN_TIME × TICK_HZ` (`36000`)", screen `dawn`; and
// `specs/enemies.md`, "Dawn": "On the tick the run clock reaches `DAWN_TIME`
// (`600`), tick `36000`, the night is over: the run ends with
// `screen = "dawn"`, whatever is alive and whatever the director had due."
// `specs/ui.md` gives the end screens "`menuIndex` is `0` on arriving".
//
// HOW THE CLOCK GETS THERE. `setTick(35999)`, the largest value the operation
// accepts ("`0` to `DAWN_TIME × TICK_HZ − 1`"), so the next tick's phase 1
// raises `tick` to `36000` and phase 11 reads the condition. The ending tick
// is therefore the first tick driven, and `tick` reads `36000` on the end
// screen; a run that ran on reads more.
//
// "WHATEVER IS ALIVE AND WHATEVER THE DIRECTOR HAD DUE". Both halves of that
// sentence are posed, since the point is that dawn ends the run over them:
// one moth alive at a distance (not overlapping, `enemyMotion` off, so it
// neither hits nor moves), and `spawning` on with `spawnTimer` at `0`, which
// "is due on every tick on which it is `0`" (Timers), so the director has a
// window spawn due on tick `36000` itself and the run still ends. Everything
// else stays off.
//
// THE REPLAY. The ending tick and a few frames after it on the `dawn` screen,
// on which "a frame ticks nothing".
//
// THE TOLERANCE. A screen name, a menu index, and a tick count, exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK, LAST_TICK } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enable,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** Where the live moth stands: far outside any overlap. */
const MOTH_OFFSET = 300;

/** Frames run on the end screen, for the replay to show it. */
const AFTER_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("ends the run at dawn with menuIndex 0 on tick 36000, over a live moth and a due spawn", async () => {
  isolate(h);
  placeEnemyNear(h, "moth", MOTH_OFFSET, 0);
  h.debug.setSpawnTimer(0);
  h.debug.setTick(LAST_TICK);
  enable(h, "spawning");
  assertEqual(h.snapshot().run.tick, LAST_TICK, "the clock posed to 35999");

  const ended = await captureReplay(h, "dawn", async () => {
    const s = await advanceTicks(h, 1);
    await h.advance(AFTER_FRAMES);
    return s;
  });

  assertEqual(
    ended.screen,
    "dawn",
    `the screen at the end of tick ${DAWN_TICK} (specs/world.md, Fallen and dawn)`,
  );
  assertEqual(
    ended.menuIndex,
    0,
    "menuIndex on arriving at dawn (specs/ui.md)",
  );
  assertEqual(
    h.snapshot().run.tick,
    DAWN_TICK,
    "the run ended on tick 36000 and ticked no further (specs/world.md, Fallen and dawn)",
  );
});
