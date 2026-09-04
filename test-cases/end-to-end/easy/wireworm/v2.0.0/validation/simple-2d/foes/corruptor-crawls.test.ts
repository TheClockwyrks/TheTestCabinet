// foes/corruptor-crawls — a corruptor crawls at its own speed.
//
// specs/foes.md: "A corruptor crawls horizontally at CORRUPTOR_SPEED in the
// direction it entered from", the velocity "integrated against the delta time of
// each update".
//
// The reading is the DISTANCE the center covered over a stated span, taken as a
// magnitude: `addFoe` gives a corruptor "its velocity at that kind's own resting
// velocity" (specs/instrumentation.md) and the specification fixes the speed
// rather than the direction, so a build that enters its corruptors from the
// other side is crawling exactly as specified.
//
// The corruptor's mind is held off. Slamming a node is a faculty of the mind
// (specs/instrumentation.md) and the requirement foes/corruptor-slams decides;
// the crawl is the travel, which is the one faculty this item exercises. It is
// posed near the middle of the board, so the whole span stays clear of the side
// edges it would leave through.

import { afterEach, beforeEach, it } from "vitest";
import { CORRUPTOR_SPEED } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  foeOf,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseFoePoint, tileCenter } from "./harness";

/** The span the crawl is measured over, as the review item states it. */
const SPAN_SECONDS = 1;

/** Whole frames of the suite's clock covering that span: 120, exactly. */
const SPAN_FRAMES = ticksFor(SPAN_SECONDS);

/** What specs/foes.md fixes the corruptor covers over that span. */
const EXPECTED_CRAWL = CORRUPTOR_SPEED * SPAN_SECONDS;

/** The review item's margin: 5% of the specified distance. */
const TOLERANCE = 0.05 * EXPECTED_CRAWL;

/**
 * Where the corruptor is posed: mid-board, on one of the rows a corruptor
 * enters on, and far enough from both side edges that the span is a crawl
 * rather than an exit whichever way it entered from.
 */
const START = tileCenter(20, 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("crawls the corruptor's own distance across the board", async () => {
  startPlaying(h);
  const id = poseFoePoint(h, "corruptor", START.x, START.y);
  h.debug.setFoeMind(id, false);

  const before = foeOf(h.snapshot(), id);
  const after = await captureReplay(h, "crawl", async () => {
    await h.advance(SPAN_FRAMES);
    return foeOf(h.snapshot(), id);
  });

  const crawled = Math.abs(after.x - before.x);
  assertLessThanOrEqual(
    Math.abs(crawled - EXPECTED_CRAWL),
    TOLERANCE,
    `the center covers ${EXPECTED_CRAWL} units over ${SPAN_SECONDS} s ` +
      `(CORRUPTOR_SPEED ${CORRUPTOR_SPEED}); the distance crawled was ` +
      `${crawled}, off by`,
  );
});
