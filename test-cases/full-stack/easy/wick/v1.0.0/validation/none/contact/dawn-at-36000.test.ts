// contact/dawn-at-36000 — dawn ends the run on tick 36000.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Fallen and dawn"):
// "`DAWN_TIME` (`600`) seconds is the length of the night", and the row "Dawn |
// `tick` equals `DAWN_TIME x TICK_HZ` (`36000`). | `dawn`". specs/enemies.md
// ("Dawn") adds what the tick ignores: "the run ends with `screen = "dawn"`,
// whatever is alive and whatever the director had due." The end screen arrives
// with "`menuIndex` is `0` on arriving" (specs/ui.md — "`fallen` and `dawn`").
//
// THE DRIVE. An isolated night with the clock posed to 35999 through `setTick`,
// the greatest value it accepts, so the next tick is 36000. To honor "whatever
// is alive and whatever the director had due", one moth stands 300 units away
// (held there, `enemyMotion` off) and `spawning` is on with `spawnTimer` posed
// to 0, so a window spawn is due on the ending tick itself. Nothing hurts the
// lamplighter: `enemyContact` is off and the moth is far outside contact. The
// tick is run and the screen read off its snapshot; the replay runs on for a
// second so the end screen is seen.
//
// THE TOLERANCE. None: a tick count, a screen name, and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK, MAX_POSED_TICK, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";

/** Where the moth stands: far outside its radius 10 plus `PLAYER_RADIUS` 12. */
const MOTH_OFFSET = 300;

/** Frames run on the end screen after the ending tick, for the replay. */
const TRAIL_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run on dawn with menuIndex 0 on the tick after 35999", async () => {
  await isolate(h, { on: ["spawning"] });
  await h.debug.setTick(MAX_POSED_TICK);
  await h.debug.setSpawnTimer(0);
  await placeEnemyNear(h, "moth", MOTH_OFFSET, 0);

  const ended = await captureReplay(h, "dawn", async () => {
    const after = await h.step(1);
    await h.step(TRAIL_FRAMES);
    return after;
  });

  assertEqual(ended.run.tick, DAWN_TICK, "the run clock on the ending tick");
  assertEqual(ended.screen, "dawn", "the screen tick 36000 left");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at dawn");
});
