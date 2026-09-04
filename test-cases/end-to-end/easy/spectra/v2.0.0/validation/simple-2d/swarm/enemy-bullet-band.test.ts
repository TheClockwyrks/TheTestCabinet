// swarm/enemy-bullet-band — a diver's bullet carries the diver's band.
//
// specs/swarm.md, "Enemy fire": "An enemy bullet carries the band its firer stores
// at the shot, fixed for the bullet's life. A spectral inversion swaps a drone and
// its bullets alike, so a bullet always reads as the band its firer reads as."
//
// THE DIVER IS POSED ON MAGENTA, which is the distinguishing value: `addDrone` gives
// a drone the cyan band (`specs/instrumentation.md`), and the ship `startPosed`
// parks is on cyan too, so a build that hands its bullets a fixed cyan, or the
// ship's band, or the band a fresh drone happens to hold, reads differently from a
// build that reads the firer's — and each of those wrong models fails here rather
// than passing by coincidence.
//
// A SHARD IS THE FIRER, because a Shard "holds one band for its whole life"
// (`specs/drones.md`): the band it stored when the shot went up is the band it
// stores now, so the reading needs no timing of its own. What a Flux's shot carries
// mid-window is `drones/flux-fires-held-band`'s, what a Prism's carries is
// `drones/prism-fires-two-bands`'s, and how an inversion swaps the pair is the
// `bands` group's.
//
// The bullet is read on its EFFECTIVE band, which is what the item asks for and what
// a reader of the field sees; with no inversion running — `startPosed` leaves none —
// the Shard's stored and effective bands are the same, so the two readings agree and
// the assertion names the one the specification does.
//
// The drone is posed above the fire line with travel and firing on and nothing else,
// and the sweep stops on the first bullet it puts up.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRE_Y, FORM_CENTER_X } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  droneOf,
  enemyBullets,
  poseDrone,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";

/** The stage the dive is posed at: the first, which `startPosed` opens. */
const STAGE = 1;

/** The band the diving Shard holds: the opposite of the one a drone is added on. */
const BAND: Band = "magenta";

/** The whole span a dive may occupy (`specs/swarm.md`), in frames. */
const DIVE_FRAMES = ticksFor(8);

/** Where the dive is posed: eighty units above the fire line. */
const AT = { x: FORM_CENTER_X, y: DIVE_FIRE_Y - 80 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the bullet a diving Shard fires the Shard's own effective band", async () => {
  startPosed(h);
  const id = poseDrone(h, "shard", AT.x, AT.y, {
    band: BAND,
    phase: "diving",
    travel: true,
    fire: true,
  });

  const fired = await h.until((snapshot) => enemyBullets(snapshot).length > 0, {
    maxFrames: DIVE_FRAMES,
    poll: 1,
  });
  captureStill(h, "band");

  assertTrue(
    fired.hit,
    `an enemy bullet from the diving ${BAND} Shard inside the eight seconds a ` +
      `dive may run, at stage ${String(STAGE)} (specs/swarm.md)`,
  );

  const firer = droneOf(fired.snapshot, id);
  const bullet = enemyBullets(fired.snapshot)[0];
  assertEqual(
    bullet.effectiveBand,
    firer.effectiveBand,
    `the effective band of the bullet the diving Shard fired, against the ` +
      `${firer.effectiveBand} band the Shard itself read as at the shot ` +
      `(specs/swarm.md)`,
  );
  assertEqual(
    bullet.effectiveBand,
    BAND,
    `the effective band of that bullet, the Shard having been posed on ` +
      `${BAND} (specs/swarm.md, specs/drones.md)`,
  );
});
