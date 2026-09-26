// saucer/subsequent-gap — later saucers arrive 25 to 35 seconds after the one
// before them left.
//
// THE RULE. `specs/saucer.md`'s cadence table fixes each later arrival at
// "`SAUCER_GAP_MIN` to `SAUCER_GAP_MAX` (`25` to `35` seconds), drawn uniformly,
// AFTER THE PREVIOUS SAUCER LEAVES". So the interval this item reads runs from
// the first tick reporting no saucer after a visit to the tick the next visit is
// first reported on — never from one arrival to the next, which would fold the
// twelve seconds of `SAUCER_LIFETIME` into a figure that does not include them.
//
// THREE GAMES, BECAUSE THE GAP IS A DRAW. One game reads one sample of a uniform
// draw over a ten-second range; three read three, and every one of them has to
// lie inside the range. The range itself is the assertion, not the spread across
// the three: how widely a build's draws scatter inside a legal range is not
// something `specs/saucer.md` fixes. Nothing is posed for the gap —
// `setSaucerDue` is how a check that wants a particular due gets one, and this
// check wants the build's own draw. What IS posed is the FIRST due of each game,
// so the visit the gap follows is up a quarter of a second in rather than at
// `18` s: the first delay is `first-arrives-at-18s`'s item, and the draw this
// item reads is the one the game makes when that visit leaves.
//
// WHY FOUR TENTHS OF A SECOND. The sweep samples every `STRIDE` ticks, so the
// tick it reports a departure on and the tick it reports the next arrival on are
// each up to one stride late; a fifth of a second each way is the whole of it,
// and the bound carries two strides at each end. It is 1.6 percent of the
// narrower bound and nothing conformant needs it — what it buys is that the
// sampling stride, which is this check's own choice, cannot decide a verdict.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_GAP_MAX, SAUCER_GAP_MIN, TICK_HZ } from "../constants";
import { assertBetween, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  secondsFor,
  ticksFor,
  type Harness,
} from "../harness";
import { SHORT_DUE, nextArrival, openSaucerGame } from "./cadence";

/** How many games the draw is read from. */
const GAMES = 3;

/** How often the sweep samples: every fifth of a second. */
const STRIDE = TICK_HZ / 5;

/** Two strides at each end of the measured interval: 0.4 s. See the header. */
const GAP_TOLERANCE = 2 * secondsFor(STRIDE);

/** How long a wait for a departure runs before the scenario is unreachable. */
const DEPARTURE_CEILING = ticksFor(30);

/** A moment of the field after the arrival that ended the gap, for the still. */
const SETTLE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("waits SAUCER_GAP_MIN to SAUCER_GAP_MAX after a saucer leaves", async () => {
  for (let game = 1; game <= GAMES; game += 1) {
    openSaucerGame(h);
    h.debug.setSaucerDue(SHORT_DUE);

    const first = await nextArrival(h, null, { stride: STRIDE });

    const left = await h.until(
      (snapshot) =>
        snapshot.saucer === null || snapshot.saucer.id !== first.saucer.id,
      { poll: STRIDE, maxFrames: DEPARTURE_CEILING },
    );
    assertTrue(
      left.hit,
      `game ${game}: the first saucer leaving the field within 30 s of game ` +
        "time (specs/saucer.md)",
    );

    const next = await nextArrival(h, first.saucer.id, { stride: STRIDE });
    if (game === 1) {
      await h.advance(SETTLE_TICKS);
      captureStill(h, "gap");
    }

    assertBetween(
      secondsFor(next.ticks),
      SAUCER_GAP_MIN - GAP_TOLERANCE,
      SAUCER_GAP_MAX + GAP_TOLERANCE,
      `game ${game}: the seconds between the first saucer leaving and the ` +
        "next arriving (specs/saucer.md)",
    );
  }
});
