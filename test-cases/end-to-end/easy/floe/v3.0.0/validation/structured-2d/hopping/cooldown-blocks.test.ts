// hopping/cooldown-blocks — a press inside the cooldown moves nothing.
//
// specs/hopping.md (The cadence): "`HOP_COOLDOWN` is `0.12` s ... A press while
// the cooldown is running is ignored, and the critter does not hop." An accepted
// hop sets the cooldown to `HOP_COOLDOWN`, so a second press taken half a
// cooldown later is squarely inside it and must leave the critter on the tile
// the first hop reached.
//
// The two presses are separate: each is one frame with the direction held and
// the key up on either side of it (specs/controls.md reads the movement actions
// as held on the playing screen), so the second is a fresh request rather than
// the tail of the first — the auto-repeat of a HELD direction is a different
// rule and a different item. The strait is empty and quiet, so the only thing
// that can move the critter between the two readings is a hop.
//
// This is the negative half of the cadence. Its positive half —
// hopping/cooldown-releases — takes the same second press at the cooldown
// instead of inside it, so a build that ignores the cooldown entirely and one
// that never lets it lapse grade differently.

import { afterEach, beforeEach, it } from "vitest";
import { HOP_COOLDOWN } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  createHarness,
  critterTile,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the second press lands: half of `HOP_COOLDOWN`, well inside it. */
const SECOND_PRESS_AT = HOP_COOLDOWN / 2;

/**
 * Frames of rest between the two press frames. The press itself is a frame, so
 * one fewer than the whole ticks `SECOND_PRESS_AT` covers puts that frame
 * `0.058` s after the frame the first hop was taken on.
 */
const REST_FRAMES = ticksFor(SECOND_PRESS_AT) - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the critter where the first hop landed for a press inside the cooldown", async () => {
  startCrossing(h);

  const seen = await captureReplay(h, "hop", async () => {
    const first = await hop(h, "up");
    const landed = critterTile(h.snapshot());
    await h.advance(REST_FRAMES);
    const second = await hop(h, "up");
    return { first, landed, second, at: critterTile(h.snapshot()) };
  });

  assertTrue(
    seen.first,
    "the first hop up, from the near shore, to be accepted",
  );
  assertEqual(
    seen.second,
    false,
    "the second press, inside the cooldown, to move nothing",
  );
  assertEqual(seen.at.row, seen.landed.row, "the row after the second press");
  assertEqual(
    seen.at.col,
    seen.landed.col,
    "the column after the second press",
  );
});
