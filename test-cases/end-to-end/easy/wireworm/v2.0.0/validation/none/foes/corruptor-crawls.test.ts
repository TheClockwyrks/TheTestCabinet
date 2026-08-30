// foes/corruptor-crawls — a corruptor crawls at its own speed.
//
// `specs/foes.md`: "A corruptor crawls horizontally at CORRUPTOR_SPEED in the
// direction it entered from", the velocity "integrated against the delta time of
// each update".
//
// THE READING IS A DISTANCE, TAKEN AS A MAGNITUDE. `addFoe` gives a corruptor
// "its velocity at that kind's own resting velocity"
// (`specs/instrumentation.md`) and the specification fixes the SPEED rather than
// which way a corruptor faces, so a build whose corruptors enter from the other
// side is crawling exactly as specified and must pass. The distance covered over
// a stated span is what both builds agree on.
//
// THE MIND IS HELD OFF. Slamming a node is a faculty of the mind
// (`specs/instrumentation.md`) and foes/corruptor-slams is the point that
// decides it; the crawl is the travel, which is the one faculty this requirement
// exercises. The corruptor is posed near the middle of the board, so the whole
// `130`-unit span stays clear of both side edges — the ones it would leave
// through — whichever way it entered from.

import { afterEach, beforeEach, it } from "vitest";
import { CORRUPTOR_SPEED } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseFoe,
  requireFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The span the crawl is measured over, as the review item states it. */
const SPAN_SECONDS = 1;

/** Whole frames of the suite's clock covering that span: 100, exactly. */
const SPAN_FRAMES = framesFor(SPAN_SECONDS);

/** What `specs/foes.md` fixes the corruptor covers over that span. */
const EXPECTED_CRAWL = CORRUPTOR_SPEED * SPAN_SECONDS;

/** The review item's margin: 5% of the specified distance. */
const TOLERANCE = 0.05 * EXPECTED_CRAWL;

/**
 * Where the corruptor is posed: mid-board, on one of the rows a corruptor enters
 * on, and far enough from both side edges that the span is a crawl rather than
 * an exit whichever way it entered from.
 */
const START_C = 20;
const START_R = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("crawls the corruptor's own distance across the board", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "corruptor", START_C, START_R, { mind: false });

  const before = requireFoe(
    await h.snapshot(),
    id,
    "the corruptor posed to crawl",
  );
  const after = await captureReplay(h, "crawl", async () => {
    await h.advance(SPAN_FRAMES);
    return requireFoe(
      await h.snapshot(),
      id,
      "the corruptor that was crawling",
    );
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
