// Shatter — saucer/at-most-one-at-a-time: one visit is on the field at a time.
//
// THE RULE. `specs/saucer.md`: "At most one saucer is on the field at a time", and
// "A saucer already on the field is never joined by a second."
//
// WHAT IS READ, AND WHY IT IS THE ID RATHER THAN A COUNT. `snapshot().saucer` is a
// single slot, so there is no roster whose length could ever exceed one and a count
// would pass vacuously for every build — and a snapshot shape that could report two
// would bake in the requirement this item exists to decide. What the slot does
// carry is an id, which `specs/saucer.md` fixes as "fresh on every arrival ... so
// one visit is distinguishable from the next". So the reading is the SEQUENCE of
// reported ids: a build that starts a second visit over a live one shows one id
// turning straight into another, while a build that waits for the field to clear
// shows a stretch of `null` between every pair.
//
// EVERY TICK, BECAUSE THE GAP IS WHAT IS BEING LOOKED FOR. A stride that stepped
// over the empty ticks between two visits would read a conformant build as
// replacing a live saucer, so the sampling has to be exhaustive. Two minutes of
// game time holds three arrivals at the cadence `specs/saucer.md` fixes — the first
// at `18` s, then a `12`-second visit and a `25`-to-`35`-second gap for each after
// it — which is why the span is two minutes and why fewer than two visits is a
// scenario this check never reached rather than a verdict it can give.
//
// THE SWEEP RUNS INSIDE THE PAGE, for the reason `cadence.ts` sets out beside
// `traceSaucerVisits`: fourteen thousand single-tick samples read one number each,
// and a round trip for every one of them makes this item's verdict a fact about how
// loaded the host was. The loop there calls the build's own `advance(1)` and the
// build's own `snapshot()`, in that order, and returns only the moments the id
// changed.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { openSaucerGame, traceSaucerVisits } from "./cadence";

/** The two minutes of game time the sequence is read over. */
const SPAN_TICKS = ticksFor(120);

/**
 * How many visits the span must hold for the reading to have been taken at all.
 *
 * Derived from the cadence, not from a run: the first arrival is due at `18` s and
 * the second no later than `18 + 12 + 35` = `65` s, so a conformant build shows at
 * least two inside two minutes. A build that shows fewer has failed
 * `first-arrives-at-18s` or `subsequent-gap`; here it means the sequence this item
 * reads was never produced.
 */
const VISITS_NEEDED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never turns one live saucer straight into another", async () => {
  await openSaucerGame(h);

  const changes = await traceSaucerVisits(h, SPAN_TICKS);
  await captureStill(h, "visit");

  const visits = changes.filter((change) => change.id !== null);
  assertGreaterThanOrEqual(
    visits.length,
    VISITS_NEEDED,
    "the arrivals two minutes of game time holds at the cadence specs/saucer.md fixes",
  );

  for (let at = 1; at < changes.length; at += 1) {
    const before = changes[at - 1];
    const after = changes[at];
    if (before.id !== null && after.id !== null) {
      fail(
        "a tick reporting no saucer between one visit and the next (specs/saucer.md)",
        `visit ${before.id} became visit ${after.id} at tick ${after.tick} with no empty tick between them`,
      );
    }
  }
});
