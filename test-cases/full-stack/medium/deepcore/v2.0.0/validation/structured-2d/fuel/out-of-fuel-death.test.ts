// fuel/out-of-fuel-death — running dry underground ends the expedition.
//
// specs/character.md: fuel reaching `0` while the miner is below the surface
// ground line strands it — the jetpack is dead and there is no way up — and that
// is a death. specs/expedition.md has a Game Over screen summarize the expedition,
// with how the miner died among what it reports, and
// specs/instrumentation.md names that reading `summary.deathCause`.
//
// The tank is posed just short of empty on a miner standing on a posed floor well
// below the ground line, with nothing held and the drill gated, and the
// life-support trickle alone empties it. So the death is the game's own
// continuous check rather than a posed screen: nothing here sets `screen`.

import { afterEach, beforeEach, it } from "vitest";
import { LIFE_SUPPORT_BURN, SURFACE_Y } from "../constants";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import {
  captureReplay,
  createHarness,
  layFloor,
  minerFeet,
  openScene,
  pinDrill,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** What is left in the tank: half a second of life support. */
const LEFT = LIFE_SUPPORT_BURN / 2;

/** Frames the sweep may spend: ten times what the trickle needs. */
const MAX_FRAMES = 10 * TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the expedition at Game Over when the tank empties underground", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW);
  pinDrill(h);
  h.debug.setFuel(LEFT);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "in-mine", "specs/ui.md");
  assertEqual(before.summary, null, "specs/instrumentation.md");
  assertGreaterThan(minerFeet(before.miner), SURFACE_Y, "specs/world.md");

  const dead = await captureReplay(h, "strand", () =>
    h.until((s) => s.screen === "game-over", { maxFrames: MAX_FRAMES }),
  );

  assertEqual(dead.hit, true, "specs/character.md");
  assertEqual(dead.snapshot.screen, "game-over", "specs/expedition.md");
  assertEqual(dead.snapshot.miner.fuel, 0, "specs/character.md");
  assertNotNull(dead.snapshot.summary, "specs/expedition.md");
  assertEqual(
    dead.snapshot.summary?.deathCause,
    "fuel-out",
    "specs/instrumentation.md",
  );
});
