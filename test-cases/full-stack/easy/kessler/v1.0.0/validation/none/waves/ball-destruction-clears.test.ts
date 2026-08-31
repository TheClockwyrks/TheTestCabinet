// waves/ball-destruction-clears — a hit from a ball that destroys a target and
// leaves zero live targets IS the clearing event, and the game is on the
// waveclear screen on that very tick.
//
// specs/rings.md: "Clearing a wave is an event: a hit from a ball destroys a
// target and leaves zero live targets across all three rings. At that instant
// ... the `waveclear` interstitial begins." specs/screens.md adds that "the
// clearing event, fixed in `specs/rings.md`, sets it to `waveclear`". The
// sweep samples every tick, so the first snapshot holding zero targets is the
// destruction tick itself, and the screen it reports decides the item.
//
// THE WORLD IS ONE TARGET AND ONE BALL. isolate() empties the field and holds
// both driver switches off; waveAdvance is turned back on because the clearing
// event IS this requirement, and podSpawn stays off so no shed pod arrives on
// top of the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { armStrike, STRIKE_BUDGET_TICKS, totalTargets } from "./rig";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("is on waveclear the tick the last target falls to a ball", async () => {
  await isolate(h);
  await h.debug.setWaveAdvance(true);
  await armStrike(h, 6);
  const posed = await h.snapshot();
  assertEqual(totalTargets(posed), 1, "the posed field holds one target");
  assertEqual(posed.screen, "playing", "the posed screen");

  const swept = await captureReplay(h, "clearing", () =>
    h.until((s) => totalTargets(s) === 0, { maxTicks: STRIKE_BUDGET_TICKS }),
  );

  assertTrue(swept.hit, "the strike destroyed the posed target");
  assertEqual(
    swept.snapshot.screen,
    "waveclear",
    "the screen on the tick the field emptied",
  );
});
