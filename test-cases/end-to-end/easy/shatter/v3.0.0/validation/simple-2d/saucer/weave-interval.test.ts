// saucer/weave-interval — the weave rerolls about once a second.
//
// THE RULE. `specs/saucer.md`: "Every `SAUCER_WEAVE_INTERVAL` (`1.0` second),
// starting one full interval after it enters, it sets its vertical velocity ..."
// So what this item reads is the GAP between one change of the vertical velocity
// and the next, against one second.
//
// BETWEEN CHANGES, NOT FROM THE POSE. `specs/instrumentation.md` puts
// `addSaucer`'s weave clock at a full `SAUCER_WEAVE_INTERVAL`, so a conformant
// build's first reroll comes a second after the pose — but whether the clock
// counts a full interval down or is due the moment it lands is the kind of
// tick-boundary question a build may answer either way, and reading the gaps
// between rerolls is free of it entirely. Four rerolls give three gaps, and each
// of the three has to hold.
//
// TRAVEL IS OFF AND THE GUN IS OFF, for the reasons `weaves-vertically` states:
// the requirement is a decision, and it is read as a velocity on a craft that has
// not moved. `(240, 620)` is `443` units from the star, so the mind's other
// decision — the steering that keeps it clear of the core — never runs.
//
// WHY TWENTY PERCENT. `0.2` seconds on a reading of one, and the item's own
// figure. The sampling is every tick, so the sweep contributes a hundredth of
// that; what the rest leaves room for is a build that carries its weave clock as
// a per-tick remainder and lands a reroll a frame either side of the second.
// Every wrong interval this specification's neighbourhood contains reads outside
// it: half a second reads `0.5`, two seconds reads `2.0`, and a build that
// rerolls every tick reads a gap of one tick.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_WEAVE_INTERVAL } from "../constants";
import { assertBetween, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  secondsFor,
  startPlaying,
  theSaucer,
  ticksFor,
  type Harness,
} from "../harness";
import { poseVisit } from "./visit";

/** Where the saucer stands: far from the star, so only the weave decides. */
const STAND = { x: 240, y: 620 };

/** How many rerolls are caught. Four of them give the three gaps the item reads. */
const REROLLS_WATCHED = 4;

/** How long the sweep runs before a build that never rerolls is called on it. */
const WATCH_TICKS = ticksFor((REROLLS_WATCHED + 1.5) * SAUCER_WEAVE_INTERVAL);

/** Twenty percent of `SAUCER_WEAVE_INTERVAL`: `0.2` seconds. See the header. */
const INTERVAL_TOLERANCE = SAUCER_WEAVE_INTERVAL * 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves SAUCER_WEAVE_INTERVAL between one weave reroll and the next", async () => {
  startPlaying(h);
  poseVisit(h, STAND.x, STAND.y, {
    vx: 0,
    vy: 0,
    mind: true,
    gun: false,
    travel: false,
  });

  const rerolls: number[] = [];
  let held = theSaucer(h.snapshot(), "weave-interval").vy;
  for (let tick = 1; tick <= WATCH_TICKS; tick += 1) {
    await h.advance(1);
    const { vy } = theSaucer(h.snapshot(), "weave-interval");
    if (vy !== held) {
      rerolls.push(tick);
      held = vy;
    }
    if (rerolls.length === REROLLS_WATCHED) break;
  }
  captureStill(h, "weave");

  assertGreaterThanOrEqual(
    rerolls.length,
    REROLLS_WATCHED,
    `the weave rerolls seen in ${secondsFor(WATCH_TICKS)} seconds of game ` +
      "time (specs/saucer.md)",
  );

  for (let at = 1; at < rerolls.length; at += 1) {
    assertBetween(
      secondsFor(rerolls[at] - rerolls[at - 1]),
      SAUCER_WEAVE_INTERVAL - INTERVAL_TOLERANCE,
      SAUCER_WEAVE_INTERVAL + INTERVAL_TOLERANCE,
      "the seconds between two rerolls of the saucer's vertical velocity " +
        "(specs/saucer.md)",
    );
  }
});
