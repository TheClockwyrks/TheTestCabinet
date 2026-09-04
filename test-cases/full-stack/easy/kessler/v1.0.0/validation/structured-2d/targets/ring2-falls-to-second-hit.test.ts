// targets/ring2-falls-to-second-hit — the second hit brings a ring 2 target to
// zero and removes it.
//
// specs/rings.md: "Each hit removes one hit point, and a target whose hit points
// reach zero is destroyed", over the `2` hit points its table gives a ring 2
// target. This point is the destruction; that the FIRST hit leaves it live is
// `ring2-survives-first-hit`.
//
// THE SECOND CROSSING IS A FRESH CROSSING. specs/rings.md makes a contact an
// event — "a contact repeats only after a fresh crossing" — so the first ball is
// removed and a second posed, rather than trusting one ball to hit twice. The
// target is posed at one hit point, which is the state its first hit leaves it
// in, so the reading is about the second hit alone.
//
// THE WORLD IS ONE FROZEN RING'S LONE TARGET AND ONE BALL, per isolate(), with
// both driver switches off, so the destruction sheds no pod and fires no
// clearing on top of the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue, assertUndefined } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import {
  PROBE_SPEED,
  arcCenterDeg,
  ballAt,
  figures,
  freezeRing,
  placeTarget,
  targetAt,
} from "./rig";

const RING = 2;
const SLOT = 5;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a one-hit-point ring 2 target on the next hit", async () => {
  isolate(h);
  await freezeRing(h, RING, 0);
  const fig = figures(RING);
  await placeTarget(h, RING, SLOT, 1);

  const theta = arcCenterDeg(RING, SLOT, 0);
  const felled = await captureReplay(h, "second-hit", async () => {
    await ballAt(h, fig.contactOuter + 5, theta, -PROBE_SPEED, 0);
    const gone = await h.until((s) => targetAt(s, RING, SLOT) === undefined, {
      maxTicks: 8,
    });
    await h.tick(8); // let the destruction read on the replay
    return gone;
  });

  assertTrue(felled.hit, "the hit brings the target to zero within the sweep");
  assertUndefined(
    targetAt(felled.snapshot, RING, SLOT),
    "the destroyed target removed from its slot",
  );
});
