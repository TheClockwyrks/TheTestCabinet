// foes/corruptor-holds-row — a corruptor never descends.
//
// specs/foes.md: "Its center y never changes: it holds the row it entered on for
// the whole crossing and never descends."
//
// So the reading is the vertical displacement over a long stretch of crawling,
// and the specification fixes it at nothing. The span is three seconds — long
// enough that a build descending at even the slowest of the three foes' rates
// would have moved the height of several tiles — and the corruptor crawls
// throughout, because the rule is about a corruptor that is CROSSING rather than
// one that is standing still.
//
// Its mind is held off. Slamming a node is a faculty of the mind
// (specs/instrumentation.md) and takes no part in where the corruptor is; the
// crawl this rule is written about is the travel. It is posed mid-board, so
// three seconds of crawling at CORRUPTOR_SPEED stays clear of both side edges
// whichever way it entered from.

import { afterEach, beforeEach, it } from "vitest";
import { CORRUPTOR_SPEED } from "../../src/constants";
import { assertLessThanOrEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  foeOf,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldFoe, poseFoePoint, tileCenter } from "./harness";

/** The span the row is held over, as the review item states it. */
const SPAN_SECONDS = 3;
const SPAN_FRAMES = ticksFor(SPAN_SECONDS);

/**
 * How far the center may drift vertically: nothing. specs/foes.md fixes the
 * center y as never changing, so the only slack allowed is the noise of adding
 * a zero-valued term to a float many times over.
 */
const DRIFT_TOLERANCE = 1e-6;

/**
 * Where the corruptor is posed: mid-board, on one of the rows a corruptor
 * enters on. Three seconds at CORRUPTOR_SPEED carries it 390 units, which
 * leaves it on the board from here whichever way it entered from.
 */
const START = tileCenter(20, 3);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the corruptor's row for the whole of a crossing", async () => {
  startPlaying(h);
  const id = poseFoePoint(h, "corruptor", START.x, START.y);
  h.debug.setFoeMind(id, false);

  const before = foeOf(h.snapshot(), id);
  await h.advance(SPAN_FRAMES);
  const after = heldFoe(h.snapshot(), id);
  captureStill(h, "row");

  assertNotNull(
    after,
    `the corruptor is still on the board after ${SPAN_SECONDS} s of crawling ` +
      `at CORRUPTOR_SPEED ${CORRUPTOR_SPEED} from mid-board`,
  );
  assertLessThanOrEqual(
    Math.abs((after?.y ?? Number.NaN) - before.y),
    DRIFT_TOLERANCE,
    `the center y never changes over ${SPAN_SECONDS} s of crawling; the ` +
      `distance it descended`,
  );
});
