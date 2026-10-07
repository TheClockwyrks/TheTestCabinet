// Wick — sconce/rehit-interval: a sconce re-hits every `SCONCE_REHIT`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "its re-hit
// interval is `SCONCE_REHIT` (`0.5`) per sconce per enemy"; ("Persistent
// effects"): "A touching effect (each Lantern lantern, each Shard, and each
// Sconce) damages an enemy on any tick the two overlap, at most once per
// re-hit interval per effect per enemy"; ("Projectiles and pierce"): "A
// projectile with infinite pierce hits a given enemy at most once per its
// weapon's re-hit interval, timed per projectile and per enemy from the tick
// of the previous hit." `specs/world.md` ("Timers") makes an interval of `0.5`
// seconds `round(0.5 × 60)` = `30` ticks, and phase 6 counts every re-hit
// entry down before the hits. Row 1 of `SCONCE_LEVELS` carries damage `12`,
// and a hound has `120` hp (`specs/enemies.md`). So a sconce on a hound hits
// on tick 1, leaving `108`, on tick 31, leaving `96`, and on tick 61, leaving
// `84`, and on no tick between.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is the schedule of one
// sconce's hits on one enemy, so the night holds one hound and one sconce
// posed on its center with infinite pierce, and every faculty is held:
// `effectMotion` so the sconce stays on the hound rather than flying off it,
// `enemyMotion` so the hound stays under it, and the rest so nothing else
// lands a hit. "`ttl` and every re-hit entry still count, and hits still
// resolve" under the held switches (`specs/instrumentation.md`), which is
// exactly the schedule read here. The posed sconce is given the launch speed
// so that its acceleration has a direction to take ("a zero velocity is
// invalid for `sconce`", `specs/instrumentation.md`), and with `effectMotion`
// held that velocity moves it nowhere. Its ttl is row 1's `2.5` seconds, `150`
// ticks, so it outlives the `61` stepped. Every tick's hp is read, so a build
// that re-hits early or late fails on the tick it does.
//
// TOLERANCE. `FLOAT_TOL` on the hound's hp on every tick: every figure is a
// whole number and the alternatives are `12` away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  ENEMIES,
  FLOAT_TOL,
  SCONCE_REHIT,
  dueTicks,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";
import { LAUNCH_LINE, SCONCE, placeSconce } from "./stage";

/** Where the hound stands, clear of the lamplighter. */
const HOUND = { x: 200, y: 0 };

/** A sconce's level-1 damage, `12`: the row a posed sconce reads with Sconce unheld. */
const SCONCE_DAMAGE = weaponRow(SCONCE, 1).damage;

/** Ticks from one hit to the next: `round(0.5 × 60)` = `30`. */
const REHIT_TICKS = dueTicks(SCONCE_REHIT);

/** The ticks stepped: the first hit and two re-hits, `61`. */
const TICKS = 2 * REHIT_TICKS + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets a sconce on a hound hit on tick 1 and again on ticks 31 and 61, every 30 ticks", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", HOUND.x, HOUND.y);
  await placeSconce(h, HOUND, LAUNCH_LINE);

  const ticks = await captureReplay(h, "rehit", () => h.stepWatching(TICKS));
  assertEqual(ticks.length, TICKS, "ticks stepped");

  for (const [index, snapshot] of ticks.entries()) {
    const tick = index + 1;
    const hits = 1 + Math.floor((tick - 1) / REHIT_TICKS);
    assertNear(
      mustEnemy(snapshot, hound.id).hp,
      ENEMIES.hound.hp - hits * SCONCE_DAMAGE,
      FLOAT_TOL,
      `the hound's hp on tick ${tick}, after ${hits} hit(s)`,
    );
  }
});
