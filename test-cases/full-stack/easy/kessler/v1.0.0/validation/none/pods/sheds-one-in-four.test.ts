// pods/sheds-one-in-four — a destruction sheds a pod with probability 0.25.
//
// specs/pods.md: each destruction "sheds one pod with probability `0.25` and
// sheds nothing otherwise", and specs/instrumentation.md's `drawPod` "performs
// one pod draw exactly as a destruction performs it" and returns the kind it
// would shed, or `null`. The odds are the requirement, so the check samples:
// a run of draws through `drawPod`, the shed count read against the binomial
// band of pods/sample.ts around one in four.
//
// THE WORLD IS THE ISOLATED FIELD, and the draws touch nothing on it: no pod
// is added, no destruction is staged. A build whose draw sheds at the wrong
// odds lands outside the band; a build whose `drawPod` returns anything but a
// kind name or `null` fails on the shape of its answer.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertTrue } from "../assert";
import { POD_DROP_CHANCE, POD_KINDS } from "../constants";
import {
  captureStill,
  drawPods,
  isolate,
  openHarness,
  type Harness,
} from "../harness";
import { binomialBand, SHED_DRAWS } from "./sample";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sheds a pod on about one draw in four", async () => {
  await isolate(h);
  const outcomes = await drawPods(h, SHED_DRAWS);
  await h.tick(1);
  await captureStill(h, "sampled");

  for (const outcome of outcomes) {
    assertTrue(
      outcome === null || (POD_KINDS as readonly string[]).includes(outcome),
      `each draw's outcome is a kind name or null (got ${String(outcome)})`,
    );
  }
  const shed = outcomes.filter((outcome) => outcome !== null).length;
  const band = binomialBand(SHED_DRAWS, POD_DROP_CHANCE);
  assertBetween(
    shed,
    band.low,
    band.high,
    `pods shed over ${SHED_DRAWS} draws at probability ${POD_DROP_CHANCE}`,
  );
});
