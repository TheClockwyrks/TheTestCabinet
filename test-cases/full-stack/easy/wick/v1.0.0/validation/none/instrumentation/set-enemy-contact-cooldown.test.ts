// Wick — instrumentation/set-enemy-contact-cooldown:
// `setEnemyContactCooldown(id, 0.5)` on an overlapping moth reads back
// `contactCooldown` 0.5, and with `enemyContact` on the moth's next hit lands
// on the 30th tick after the call.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setEnemyContactCooldown(id, seconds)`): "Sets enemy `id`'s
// `contactCooldown` to `seconds`, at least `0`." specs/world.md — "Timers": a
// timer set to 0.5 s "is due `round(s × TICK_HZ)` ticks after the tick it was
// set on", 30; "Contact damage": "An overlapping enemy whose `contactCooldown`
// is due lands a hit: `hp` falls".
//
// WHY THE WORLD IS POSED AS IT IS. One moth 5 units from the lamplighter, well
// inside the overlap distance, with `enemyMotion` held so it stays there and
// `enemyContact` alone on, so the only thing that can lower `hp` is its hit;
// the frames are stepped one at a time so the tick of the hit is read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { BASE_MAX_HP, dueTicks } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_SECONDS = 0.5;
const DUE_TICK = dueTicks(POSED_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses an enemy's contact cooldown, and its hit lands when it is due", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", 5, 0);
  await h.debug.setEnemyContactCooldown(moth.id, POSED_SECONDS);
  assertEqual(
    mustEnemy(await h.snapshot(), moth.id).contactCooldown,
    POSED_SECONDS,
    "the contact cooldown after the pose",
  );
  await h.debug.setEnemyContact(true);

  const seen = await captureReplay(h, "cooled", () => h.stepWatching(DUE_TICK + 1));

  for (let frame = 1; frame < DUE_TICK; frame += 1) {
    assertEqual(
      seen[frame - 1]!.run.player.hp,
      BASE_MAX_HP,
      `hp on tick ${frame}, before the cooldown is due`,
    );
  }
  assertLessThan(
    seen[DUE_TICK - 1]!.run.player.hp,
    BASE_MAX_HP,
    `hp on tick ${DUE_TICK}, when the cooldown is due`,
  );
});
