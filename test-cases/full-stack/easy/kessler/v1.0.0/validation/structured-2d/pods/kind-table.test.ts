// pods/kind-table — a shed pod's kind follows the kind table's probabilities.
//
// specs/pods.md: "A shed pod's kind is drawn with the probabilities below":
// widen 0.25, multiball 0.20, shield 0.20, pierce 0.15, narrow 0.20. The odds
// are the requirement, so the check samples through specs/instrumentation.md's
// `drawPod`, which "performs one pod draw exactly as a destruction performs
// it", and reads each kind's count among the shedding draws against the
// binomial band of pods/sample.ts around its share.
//
// EVERY KIND IS READ AGAINST ITS OWN BAND, so a build that swapped two rows,
// flattened the table to even odds, or left a kind out fails by the kind it got
// wrong. The shedding draws are the sample, so the bands follow the count the
// run actually shed rather than a figure assumed for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import { POD_KIND_CHANCES, POD_KINDS } from "../constants";
import {
  captureStill,
  drawPods,
  isolate,
  openHarness,
  type Harness,
} from "../harness";
import { binomialBand, KIND_DRAWS } from "./sample";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws each kind on its share of the shedding draws", async () => {
  isolate(h);
  const outcomes = await drawPods(h, KIND_DRAWS);
  await h.tick(1);
  captureStill(h, "sampled");

  const shed = outcomes.filter((outcome) => outcome !== null);
  assertGreaterThan(shed.length, 0, "draws that shed a pod");
  for (const kind of POD_KINDS) {
    const count = shed.filter((outcome) => outcome === kind).length;
    const band = binomialBand(shed.length, POD_KIND_CHANCES[kind]);
    assertBetween(
      count,
      band.low,
      band.high,
      `${kind} pods among ${shed.length} shed at probability ${POD_KIND_CHANCES[kind]}`,
    );
  }
});
