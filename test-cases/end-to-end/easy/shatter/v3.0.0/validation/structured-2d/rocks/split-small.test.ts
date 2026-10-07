// rocks/split-small — a destroyed Small leaves nothing behind.
//
// `specs/rocks.md` ends the ladder at the bottom rung: destroying a `small` leaves
// "Nothing". The sentence after it is why the rung matters to the rest of the game:
// "since a `large` and a `medium` each leave two behind, the number of rocks on the
// field falls only when a `small` is destroyed" — so a build that hands a destroyed
// Small two more Smalls has a field that can never be emptied and a wave that can
// never clear, and `waves/clears-on-last-rock` is unreachable on it.
//
// THE ROCK IS SHOT DOWN, NEVER TAKEN OFF THE FIELD. `specs/instrumentation.md` is
// explicit that `clearRocks()` "destroys nothing and scores nothing" and that
// `removeRock(id)` is a removal, so neither produces the event this item is about.
// A real round is placed on the rock's doorstep and the build's own collision and
// split code resolves it. Under both variants a Small takes one hit — `base` has no
// armor at all, and `specs/rocks.md` gives a `warhead` Small `ROCK_HEALTH.small`
// (1) — but the drive still fires until the rock is gone rather than assuming it,
// so the item reads the same way on either build.
//
// BOTH DIRECTIONS ARE ASSERTED: the Small is gone, AND the field it left is empty.
// A build that removes the parent and spawns a fragment of some size fails the
// second even though it passes the first.
//
// THE FIELD HOLDS NOTHING ELSE, so an empty field means exactly this rock's
// destruction: `startPlaying` clears every rock, round and saucer and shuts the
// wave loop off, and with `setWaveSpawning(false)` an emptied field stays empty
// rather than filling with the next wave on top of the reading.
//
// WHAT THIS DOES NOT DECIDE. That destroying the last rock TURNS THE WAVE OVER,
// which is `waves/clears-on-last-rock`'s — the wave loop is off here — and what the
// kill scored, which is `scoring/small-scores-100`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { ROCK_GROUND, destroyByGun } from "./scenario";

/** Ticks run after the reading, so the still shows the field the Small left behind. */
const AFTERMATH_TICKS = ticksFor(0.35);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the field empty when the only Small on it is shot down", async () => {
  startPlaying(h);
  const parentId = poseRock(h, "small", ROCK_GROUND.x, ROCK_GROUND.y);

  const before = h.snapshot();
  const kill = await destroyByGun(h, parentId);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "split");

  assertLength(
    before.rocks,
    1,
    "the Small this check poses, before the shooting starts " +
      "(specs/instrumentation.md: addRock appends one rock of the size named)",
  );
  assertEqual(
    kill.at.rocks.some((rock) => rock.id === parentId),
    false,
    "the Small gone from the field on the tick it was destroyed " +
      "(specs/collision.md)",
  );
  assertLength(
    kill.at.rocks,
    before.rocks.length - 1,
    "rocks on the field on the tick the Small broke: one fewer than before, " +
      "and no fragment of any size in its place (specs/rocks.md)",
  );
});
