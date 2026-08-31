// visibility/pods-told-apart-in-flight — no two pod kinds render as the same
// pod.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md`: "The five pod kinds are
// told apart from each other at 24 pixels, in flight, without reading a
// label", and its art bar again: "The five pod sprites are pairwise
// distinguishable while falling." So each of the ten pairs is compared as a
// FALLING POD ON THE FIELD at the sprite's own 24-pixel size — not as files —
// against the category's figure for clearly apart (`DISTINCT_MIN`, see
// `visibility/distinct.ts`).
//
// THE WORLD THIS POSES. An isolated `playing` field, then each kind in turn:
// one pod spawned at the SAME spot over open field, rendered for one tick of
// its fall, and read over a 5 x 5 grid covering its 24-pixel canvas. The same
// spot on purpose: every kind renders over the same background and under
// whatever orientation the build gives a pod there, so corresponding grid
// points correspond and any difference between two reads is the pods' own.
//
// THE COMPARISON. For each pair of kinds, the widest distance between
// corresponding grid points. Two kinds a player tells apart differ somewhere
// on their 24 pixels — by color or by shape, either moves paint a grid point
// sees — and one sprite shipped five times differs nowhere.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { POD_KINDS } from "../constants";
import type { Rgb } from "../harness";
import {
  captureStill,
  isolate,
  openHarness,
  samplePoints,
  spawnPodPolar,
  type Harness,
} from "../harness";
import {
  DISTINCT_MIN,
  gridAround,
  maxCorresponding,
  POD_OFFSETS,
} from "./distinct";

/** Where every kind is posed: open field between the track and ring 1. */
const POD_R = 250;
const POD_THETA = 90;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("renders the five pod kinds pairwise apart in flight", async () => {
  await isolate(h);

  const reads = new Map<string, Rgb[]>();
  for (const kind of POD_KINDS) {
    await h.debug.clearPods();
    await spawnPodPolar(h, kind, POD_R, POD_THETA);
    const after = await h.tick(1);
    await captureStill(h, `pod-${kind}`);

    const pod = after.pods[0];
    reads.set(
      kind,
      await samplePoints(h, gridAround({ x: pod.x, y: pod.y }, POD_OFFSETS)),
    );
  }

  for (let a = 0; a < POD_KINDS.length; a += 1) {
    for (let b = a + 1; b < POD_KINDS.length; b += 1) {
      const first = reads.get(POD_KINDS[a]);
      const second = reads.get(POD_KINDS[b]);
      if (first === undefined || second === undefined) continue;
      assertGreaterThan(
        maxCorresponding(first, second),
        DISTINCT_MIN,
        `the widest RGB distance between the falling ${POD_KINDS[a]} pod ` +
          `and the falling ${POD_KINDS[b]} pod at the same spot`,
      );
    }
  }
});
