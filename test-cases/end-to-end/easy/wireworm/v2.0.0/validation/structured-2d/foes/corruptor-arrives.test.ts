// foes/corruptor-arrives — a corruptor arrives once the level gate opens.
//
// `specs/foes.md`: "From that level on, the corruptor's clock is drawn uniformly
// between CORRUPTOR_MIN_INTERVAL (14.0 s) and CORRUPTOR_MAX_INTERVAL (22.0 s),
// so a corruptor enters after such an interval", and, under The spawner clocks,
// "When a clock reaches `0` its kind's entry or check happens".
//
// THE CLOCK IS POSED RATHER THAN WAITED ON. The requirement here is that the
// level's own spawning brings a corruptor in when its clock runs out, so the
// clock is posed through `setSpawnTimer("corruptor", 1.5)` and the entry it
// decides is read; the interval the level draws for itself is
// `foes/corruptor-interval`'s point. Posed well inside the range's shadow, a
// build that ignores the pose and draws its own brings no corruptor in before
// 14 s, and the reading at 1.6 s names it.
//
// THE READING IS TAKEN TWICE, EITHER SIDE OF THE POSED MOMENT. At 1.4 s the
// roster holds no corruptor, so a build that fires a posed clock at once fails
// there; at 1.6 s it holds one, so a build whose clock never runs, or whose
// level-5 gate never opens, fails there. A tenth of a second either way is room for a build that fires on the
// update the clock crosses zero rather than the one it lands on.
//
// Nothing else is posed: `startPlaying` leaves the board empty and quiet, and
// foe spawning is turned back on because the entry the clock decides is this
// point's requirement. The glitch and dropper spawners run alongside it at this
// level — that is what `foeSpawning` gates — so the roster is read for a
// CORRUPTOR alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  CORRUPTOR_FROM_LEVEL,
  CORRUPTOR_MAX_INTERVAL,
  CORRUPTOR_MIN_INTERVAL,
} from "../constants";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { foesOfKind } from "./harness";

/** The level watched: the one corruptors begin at. */
const LEVEL = CORRUPTOR_FROM_LEVEL;

/** The seconds posed on the corruptor's clock. */
const POSED_SECONDS = 1.5;

/** The two moments the roster is read at, either side of the posed one. */
const BEFORE_SECONDS = 1.4;
const AFTER_SECONDS = 1.6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings a corruptor in when the level's posed clock runs out", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setLevel(LEVEL);
  h.debug.setFoeSpawning(true);
  h.debug.setSpawnTimer("corruptor", POSED_SECONDS);

  await h.advance(ticksFor(BEFORE_SECONDS));
  const early = h.snapshot();

  await h.advance(ticksFor(AFTER_SECONDS - BEFORE_SECONDS));
  const late = h.snapshot();
  // Before the assertions, so a failing entry still leaves the picture of the
  // board the clock was read on.
  captureStill(h, "arrival");

  assertLength(
    foesOfKind(early, "corruptor"),
    0,
    `corruptors on the level-${LEVEL} board ${BEFORE_SECONDS} s after a clock ` +
      `posed at ${POSED_SECONDS} s — the clock runs down against each ` +
      `update's delta and the entry lands when it reaches 0 (specs/foes.md)`,
  );
  assertGreaterThan(
    foesOfKind(late, "corruptor").length,
    0,
    `corruptors on the level-${LEVEL} board ${AFTER_SECONDS} s after a clock ` +
      `posed at ${POSED_SECONDS} s — a clock drawn afresh instead would run ` +
      `CORRUPTOR_MIN_INTERVAL (${CORRUPTOR_MIN_INTERVAL} s) to ` +
      `CORRUPTOR_MAX_INTERVAL (${CORRUPTOR_MAX_INTERVAL} s), and a clock that ` +
      `never runs brings nothing`,
  );
});
