// Wick — passives/tallow-gain-raises-hp: gaining a Tallow level raises `hp` by
// `15` on the tick `maxHp` rises.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Max health"): "Each
// time Tallow rises by one level, whether it is gained at level `1` or leveled
// from any level below its max, and through whichever path grants it, the
// lamplighter's current `hp` rises by `TALLOW_HP_PER_LEVEL` on the same tick
// that `maxHp` does", with `TALLOW_HP_PER_LEVEL` (`15`) and
// "`maxHp = BASE_MAX_HP + TALLOW_HP_PER_LEVEL × tallow`", `BASE_MAX_HP`
// (`100`). `specs/progression.md` ("Choosing") says the same of the overlay:
// "Gaining a Tallow level raises `hp` by `TALLOW_HP_PER_LEVEL` (`15`) at the
// same time as `maxHp`". So from a full `100 / 100`, accepting Tallow reads
// `115 / 115`, and accepting it again reads `130 / 130`.
//
// THE POSE. An isolated night with no passive held and `hp` at the `100` the
// run began with. The offer is reached through the real path: `setNextOffers`
// queues Tallow, which "is accepted when every id is a candidate of the pool at
// the moment the overlay opens" — with a passive slot free and Tallow not held
// it is one — `setPendingLevelUps(1)` and one tick open the overlay, and
// `choose(0)` accepts "exactly as moving the highlight there and pressing
// `confirm` would". The same three steps run again for the second level. Every
// faculty stays held, so nothing else touches `hp`.
//
// TOLERANCE. `FLOAT_TOL` on each reading, a whole number the formulas give
// exactly. A build that raised `maxHp` alone leaves `hp` at `100`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, TALLOW_HP_PER_LEVEL, maxHpOf } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  player,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Accept one Tallow offer through the overlay, and read what it left. */
async function acceptTallow(h: Harness): Promise<WickSnapshot> {
  await h.debug.setNextOffers(["tallow"]);
  const overlay = await openLevelUp(h);
  assertEqual(
    overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertEqual(
    overlay.run.offers?.[0],
    "tallow",
    "the offer the overlay listed",
  );
  await h.debug.choose(0);
  return h.snapshot();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hp 115 and maxHp 115 on accepting Tallow, and 130 and 130 on a second level", async () => {
  await isolate(h);

  const first = await acceptTallow(h);
  assertEqual(first.run.passives?.[0]?.level, 1, "the Tallow level held");
  assertNear(
    first.run.maxHp,
    maxHpOf({ tallow: 1 }),
    FLOAT_TOL,
    "maxHp on accepting the first Tallow level",
  );
  assertNear(
    player(first).hp,
    maxHpOf({ tallow: 1 }),
    FLOAT_TOL,
    "hp on accepting the first Tallow level, raised by 15 from 100",
  );

  const second = await acceptTallow(h);
  await captureStill(h, "raised");
  assertEqual(second.run.passives?.[0]?.level, 2, "the Tallow level held");
  assertNear(
    second.run.maxHp,
    maxHpOf({ tallow: 2 }),
    FLOAT_TOL,
    "maxHp on accepting the second Tallow level",
  );
  assertNear(
    player(second).hp,
    maxHpOf({ tallow: 1 }) + TALLOW_HP_PER_LEVEL,
    FLOAT_TOL,
    "hp on accepting the second Tallow level, raised by 15 from 115",
  );
});
