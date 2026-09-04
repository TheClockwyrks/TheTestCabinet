// assets/collision-radius-reads-no-image — the collision radius is the figure the
// case fixes, not something a decoded file gave it.
//
// THE RULE, from "Scale" in `specs/assets.md`: "The simulation reads no image: a
// mote's collision radius is `MOTE_COLLIDE_R` and a hex's targeting radius is
// `HEX_HIT_R`, whatever a file decoded to." The sentence sits under the paragraph
// that fixes every sprite's canvas — "Every sprite is authored at the canvas its
// table row states and drawn at that size in logical units, centered on the thing
// it depicts" — and is the guard on it: a mote's `44 x 44` sprite is what the
// mote LOOKS like, and nothing the simulation measures comes off it. This point
// is the collision half; `assets/targeting-reads-no-image` is the targeting half.
//
// WHAT THE COLLISION RADIUS IS. "`COLLISION_SAMPLES` is `8`. Within the motion
// step, every mote's position is evaluated at the sample fractions `t = k / 8`
// for `k` from `1` to `8`, in order. If at any sample the distance between the
// centers of two motes is strictly less than `2 * MOTE_COLLIDE_R` (`38`), the run
// faults as `collision` at that sample" (`specs/simulation.md`, Collision).
//
// HOW THE FIGURE IS PUT ON TRIAL. With the mote sprite withheld the build has no
// decoded image for the motes at all, so a build that took its radius from a
// file's width, from half of it, or from anything else it measured has no such
// number to take — and the configuration below comes within `38` without ever
// coming within a hex of touching, so a radius that fell to zero, to a default,
// or to the sprite's absent size does not fault where the specification says it
// must.
//
// THE CONFIGURATION IS THE SPECIFICATION'S OWN WORKED EXAMPLE A, posed by
// `collision/examples.ts` so the geometry a check leans on is the geometry
// `specs/simulation.md` wrote down: "An arm at `(0, 0)`, length 1, carries a mote
// from `(1, 0)` toward `(0, 1)` with `rotate-cw`. A mote rests on `(1, 1)`."
// First sample within `38`: `36.10` at `t = 3/8`; nearest sampled approach:
// `35.14` at `t = 4/8`; outcome, "Faults". Both motes are `dust`, so `dust` is
// the sprite withheld.
//
// A FILE THE BUILD NEVER REQUESTS CANNOT BE WITHHELD. A bundler is free to inline
// a small produced PNG into the bundle as a `data:` URI; that is still the
// committed file and is still conformant, and such a build makes no request to
// refuse. What this check then observes is a game whose sprite arrived, which is
// the honest outcome rather than a gap.
//
// THE VERDICT. The run faults as `collision`, at the fraction the FIRST sample
// within `38` names — "a `collision` leaves the fraction at that sample's `k /
// 8`" — and names the two motes that met. `sim.fraction` is read through
// `assertNear` at `FRACTION_TOLERANCE`, because the specification carries it as a
// running sum of the frames' own delta times.
//
// THE EVIDENCE is the frames of the faulting cycle, drawn with no mote sprite.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNear,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  FRACTION_TOLERANCE,
  MOTE_SPRITE_PATHS,
  sampleFraction,
} from "../constants";
import { exampleA } from "../collision/examples";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";
import { withoutFile } from "./degraded";
import { assetFile } from "./files";

/** The mote sprite this check withholds: the type example A's two motes are. */
const WITHHELD = assetFile(MOTE_SPRITE_PATHS.dust);

/** The first sample within 38, which is where example A freezes. */
const FIRST_WITHIN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ withoutAssets: withoutFile(WITHHELD) });
});

afterEach(async () => {
  await h.dispose();
});

it("faults as collision at t = 3/8 with no mote sprite decoded", async () => {
  assertNull(
    h.surfaceFault,
    `the game still initializes with ${WITHHELD} unavailable, so its debug surface can be driven`,
  );

  const posed = await exampleA(h);

  await captureReplay(h, "collision", () => advanceCycles(h, 1));

  const sim = (await h.snapshot()).sim;
  assertNotNull(sim, "the run is still live after the cycle that faulted it");
  assertEqual(
    sim?.status,
    "faulted",
    "example A comes within 38 at t = 3/8, so the cycle faults rather than completing",
  );
  assertEqual(
    sim?.fault?.kind,
    "collision",
    "two mote centers strictly closer than 2 * MOTE_COLLIDE_R (38) fault as collision, whatever a file decoded to",
  );
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(FIRST_WITHIN),
    FRACTION_TOLERANCE,
    "a collision leaves the fraction at that sample's k / 8, and 36.10 at t = 3/8 is the first sample within 38",
  );
  assertDeepEqual(
    sim?.fault?.motes,
    [...posed.carried, ...posed.resting].sort((a, b) => a - b),
    "the pair named is the carried mote and the mote it swept past, so the radius measured the two this check posed",
  );
});
