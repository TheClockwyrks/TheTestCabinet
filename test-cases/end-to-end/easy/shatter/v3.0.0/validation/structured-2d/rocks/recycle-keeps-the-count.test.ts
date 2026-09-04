// rocks/recycle-keeps-the-count — the star takes a rock without emptying the field.
//
// `specs/rocks.md`, Star recycling: "Recycling scores nothing and leaves the field's
// rock count unchanged." `specs/progression.md` says why it has to: "Destroying
// rocks is the only way a wave clears, since the star recycles rather than removes."
// A build whose core REMOVES the rock it takes has a field that empties itself, a
// wave that clears without a shot fired, and — with `setWaveSpawning` on — a game
// that runs itself; and the player is charged nothing for it either way. That is
// this item's `broken` cap.
//
// THE FIELD HOLDS EXACTLY ONE ROCK, which is the sharpest form the count can take:
// one before the star takes it, one after it gives it back. `startPlaying` clears
// every rock, round and saucer and shuts the wave loop and the saucer's arrival off,
// so nothing can arrive to make the count up and nothing else can leave it.
//
// THE TWO READINGS BRACKET THE RE-PLACEMENT ITSELF, the tick before and the tick
// after, rather than being taken a second apart: `specs/rocks.md` has the rock
// "taken from the core and IMMEDIATELY re-placed", so a build that removes the rock
// on one tick and spawns a replacement half a second later is caught here — over a
// wider window it would read one rock at each end and pass.
//
// THE RECYCLE IS FOUND AS A DISCONTINUITY (`scenario.ts`), so a build that never
// recycles at all — sending its rock straight through the core and out the far
// side — fails the drive rather than passing this vacuously with a count that never
// changed because nothing ever happened.
//
// WHAT THIS DOES NOT DECIDE. That recycling scores nothing, which is
// `scoring/recycling-scores-nothing`'s; that the rock reappears at an edge, which is
// `rocks/recycle-re-enters-from-off-screen`'s; and that a field emptied by other
// means does not clear a wave, which is
// `waves/an-empty-field-does-not-clear-by-itself`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { dropOntoTheStar, slingIntoTheStar } from "./scenario";

/** The rocks on the field: the one this check poses, before and after. */
const ROCKS = 1;

/** The seed the run is put on, so the star's draws are reproducible. */
const SEED = 1;

/** Ticks of the recycled rock coming in, run after the readings are taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the rock count across the tick the star takes a rock on", async () => {
  resetTo(h, SEED);
  startPlaying(h);
  dropOntoTheStar(h, "medium");

  const recycle = await slingIntoTheStar(h);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "recycle");

  assertLength(
    recycle.before.rocks,
    ROCKS,
    "rocks on the field on the tick before the star took one — the field this " +
      "check poses holds exactly one (specs/instrumentation.md)",
  );
  assertLength(
    recycle.at.rocks,
    ROCKS,
    "rocks on the field on the tick the star took one and re-placed it: " +
      "recycling leaves the field's rock count unchanged (specs/rocks.md)",
  );
});
