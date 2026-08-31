// targets/damaged-ring2-distinct — a ring 2 target that has taken a hit reads
// at a glance.
//
// WHAT THE SPECIFICATION FIXES. specs/rings.md: "A ring 2 target that has
// taken a hit is drawn visibly distinct from an undamaged one, so a player
// reads its state at a glance." No palette or treatment is fixed, so what is
// read is separation alone: somewhere on the target's own annulus arc, the two
// states must differ clearly in colour. DISTINCT_MIN (40) of the 441 the RGB
// cube spans is the case's figure for a difference a player reads at a glance;
// beneath it, two paints are shades of the same thing. The samples cover the
// arc densely (12 angles by 5 radii, inside the annulus with margins), so a
// treatment painted anywhere on the target — a tint, a crack, an inset — is
// seen by some sample.
//
// THE TWO POSES ARE TWIN WORLDS. Each state is posed from a fresh reset — the
// same frozen ring, the same slot, the same single tick before the read — so
// the ONLY difference between the two renders is the target's hit points, and
// any tick-keyed animation sits at the same phase in both.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  isolate,
  openHarness,
  samplePolar,
  type Harness,
  type Rgb,
} from "../harness";
import { arcStartDeg, figures, freezeRing, placeTarget } from "./rig";

const RING = 2;
const SLOT = 0;
/** The case's figure for a colour difference that reads at a glance. */
const DISTINCT_MIN = 40;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Pose a lone ring 2 target at `hp`, render one tick, and sample its arc. */
async function poseAndSample(hp: number, still: string): Promise<Rgb[]> {
  await isolate(h);
  await freezeRing(h, RING, 0);
  await placeTarget(h, RING, SLOT, hp);
  await h.tick(1);
  await captureStill(h, still);

  const fig = figures(RING);
  const startDeg = arcStartDeg(RING, SLOT, 0) + 2;
  const spanDeg = fig.arcDeg - 4;
  const reads: Rgb[] = [];
  for (let ri = 0; ri < 5; ri++) {
    const r = fig.innerRadius + 4 + ri * 4;
    for (let ai = 0; ai < 12; ai++) {
      reads.push(await samplePolar(h, r, startDeg + (spanDeg * ai) / 11));
    }
  }
  return reads;
}

it("draws a hit ring 2 target visibly apart from an undamaged one", async () => {
  const fresh = await poseAndSample(figures(RING).fullHp, "fresh");
  const damaged = await poseAndSample(1, "damaged");

  let widest = 0;
  for (let i = 0; i < fresh.length; i++) {
    const a = fresh[i];
    const b = damaged[i];
    if (a !== undefined && b !== undefined) {
      widest = Math.max(widest, colorDistance(a, b));
    }
  }
  assertGreaterThan(
    widest,
    DISTINCT_MIN,
    "the widest RGB separation between the two states across the target's arc",
  );
});
