// pods/no-shed-consumes-one — a draw that sheds nothing consumes exactly one
// value, so the next destruction reads the stream's next value.
//
// specs/pods.md: "at u1 >= 0.25 it sheds nothing and the draw ends there", and
// the stream hands each draw "the stream's next value". Under mulberry32(128)
// the stream opens 0.443, 0.020, 0.820: destruction one takes 0.443 and sheds
// nothing, so destruction two must take 0.020 (shedding) and its kind must
// come from 0.820 (narrow). A build that consumed two values on the empty draw
// reads 0.820 as its next u1 and sheds nothing; one that consumed none reads
// 0.443 again and sheds nothing — either misalignment fails the readings.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DRAW, staged by the shared draw
// helper on a frozen ring 1 with the deflector parked away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { POD_DROP_CHANCE, mulberry32, podKindFor } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { AWAY_ANGLE, destroyPosedTarget } from "./draw";

/** mulberry32(128): u = 0.443 (no shed), 0.020 (shed), 0.820 (the kind). */
const SEED = 128;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the seeded stream aligned across an empty draw", async () => {
  const next = mulberry32(SEED);
  const u1 = next();
  const u2 = next();
  const u3 = next();
  // The scenario's own premises, from the specification's generator.
  assertTrue(u1 >= POD_DROP_CHANCE, "the first draw sheds nothing");
  assertTrue(u2 < POD_DROP_CHANCE, "the second draw sheds");
  assertTrue(u3 >= POD_DROP_CHANCE, "a two-value empty draw would misalign");

  await isolate(h, SEED);
  await h.debug.setPodSpawn(true);
  await h.debug.setPaddleAngle(AWAY_ANGLE);

  const first = await destroyPosedTarget(h, 1, 0);
  assertLength(first.pods, 0, "the first destruction sheds nothing");

  const second = await captureReplay(h, "aligned-draw", () =>
    destroyPosedTarget(h, 1, 1),
  );
  assertLength(second.pods, 1, "the second destruction sheds from u2 = 0.020");
  assertEqual(
    second.pods[0].kind,
    podKindFor(u3),
    "the shed kind comes from the stream's third value",
  );
});
