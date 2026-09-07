// saucer/at-most-one-at-a-time — one visit is on the field at a time.
//
// THE RULE. `specs/saucer.md`: "At most one saucer is on the field at a time",
// and "A saucer already on the field is never joined by a second."
//
// WHAT IS READ, AND WHY IT IS THE ID RATHER THAN A COUNT. `snapshot().saucer` is
// a single slot, so there is no roster whose length could ever exceed one and a
// count would pass vacuously for every build — and a snapshot shape that could
// report two would bake in the requirement this item exists to decide. What the
// slot does carry is an id, which `specs/saucer.md` fixes as "fresh on every
// arrival ... so one visit is distinguishable from the next". So the reading is
// the SEQUENCE of reported ids: a build that starts a second visit over a live
// one shows one id turning straight into another, while a build that waits for
// the field to clear shows a stretch of `null` between every pair.
//
// EVERY TICK, BECAUSE THE GAP IS WHAT IS BEING LOOKED FOR. A stride that stepped
// over the empty ticks between two visits would read a conformant build as
// replacing a live saucer, so the sampling has to be exhaustive.
//
// THE FIRST DUE IS POSED SHORT, AND THE REST IS THE GAME'S OWN. `setSaucerDue`
// sets the figure the gap draw decides (`specs/instrumentation.md`), so the first
// visit is brought on a quarter of a second in rather than at `18` s; what the
// item reads is what happens ONCE a visit is up, and the cadence after that
// visit — its `12`-second stay and the `25`-to-`35`-second gap the game draws
// when it leaves — is untouched. Fifty seconds of game time therefore holds two
// arrivals on any conformant build, which is why the span is fifty seconds and
// why fewer than two visits is a scenario this check never reached rather than a
// verdict it can give.
//
// THE SWEEP IS ITS OWN LOOP RATHER THAN `harness.until`, because what it is
// after is not the first sample a predicate holds on: it is every moment across
// six thousand ticks at which the reported id changed. The loop calls the same
// `advance(1)` and the same `snapshot()` the harness's own sweep calls, in the
// same order, and keeps only those moments.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { SHORT_DUE, openSaucerGame } from "./cadence";

/** The fifty seconds of game time the sequence is read over. */
const SPAN_TICKS = ticksFor(50);

/**
 * How many visits the span must hold for the reading to have been taken at all.
 *
 * Derived from the cadence, not from a run: the first arrival is due at the
 * posed `SHORT_DUE` and the second no later than `0.25 + 12 + 35` = `47.25` s,
 * so a conformant build shows at least two inside fifty seconds. A build that
 * shows fewer has failed `subsequent-gap` or ignored the posed due; here it
 * means the sequence this item reads was never produced.
 */
const VISITS_NEEDED = 2;

/** One moment the reported saucer id changed, and what it changed to. */
interface Change {
  tick: number;
  id: number | null;
}

/**
 * Sample the reported `saucer.id` on EVERY tick of `ticks`, and answer the
 * moments it changed. The state the sweep starts from is the first entry.
 */
async function traceVisits(h: Harness, ticks: number): Promise<Change[]> {
  const read = (): number | null => h.snapshot().saucer?.id ?? null;
  const changes: Change[] = [];
  let held = read();
  changes.push({ tick: 0, id: held });
  // The sweep is undrawn: what it reads is one id per tick, and drawing the
  // six thousand pictures it would otherwise leave behind is most of what the
  // check would cost. The ticks and the samples are unchanged.
  await h.quiet(async () => {
    for (let tick = 1; tick <= ticks; tick += 1) {
      await h.advance(1);
      const id = read();
      if (id !== held) {
        changes.push({ tick, id });
        held = id;
      }
    }
  });
  return changes;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never turns one live saucer straight into another", async () => {
  openSaucerGame(h);
  h.debug.setSaucerDue(SHORT_DUE);

  const changes = await traceVisits(h, SPAN_TICKS);
  // One drawn tick after the sweep, so the still is the field the trace ended on
  // rather than an older frame; the reading the verdict rests on is already in
  // `changes`.
  await h.advance(1);
  captureStill(h, "visit");

  const visits = changes.filter((change) => change.id !== null);
  assertGreaterThanOrEqual(
    visits.length,
    VISITS_NEEDED,
    "the arrivals fifty seconds of game time holds at the cadence " +
      "specs/saucer.md fixes, the first due posed short",
  );

  for (let at = 1; at < changes.length; at += 1) {
    const before = changes[at - 1];
    const after = changes[at];
    if (before.id !== null && after.id !== null) {
      fail(
        "a tick reporting no saucer between one visit and the next " +
          "(specs/saucer.md)",
        `visit ${before.id} became visit ${after.id} at tick ${after.tick} ` +
          "with no empty tick between them",
      );
    }
  }
});
