// Spectra — bursts/from-provided-system: the provided system is what plays.
//
// `specs/assets.md` seeds `drone-burst.json` — "a particle system: a description
// of emitters, forces, and per-particle curves on a `BURST_FIELD` (`128`) square
// field" — and says of it: "It is played, not hand-coded and not replaced. The
// runtime that plays it, `@clockwyrks/particle-runtime`, is already a
// dependency of the project. Play it with the package's pure
// `ParticleSimulator`". `specs/instrumentation.md` then reports, per live burst,
// "`particles`: live particles the simulation holds".
//
// THE READING IS THE COUNT, AGAINST THE SEEDED SYSTEM'S OWN. This suite runs the
// package's pure simulator over the very file under `assets/` for the same span
// the build's burst has been playing for, and holds the build's reported count
// against it. A build that really plays the seeded system holds the same
// population; a build that hand-coded a puff of a dozen sparks, or one that
// replaced the file with a system of its own, holds a different one — and the
// distance is enormous either way, because the seeded system's four emitters
// burst `5 + 120 + 55 + 55` particles at time zero.
//
// WHY A TENTH OF A SECOND, AND WHY THE SCATTER DOES NOT MATTER THERE. Every
// emitter of the seeded system fires its whole burst at `atMs` `0`, and the
// shortest lifetime any of them draws is the flash's `120 ms` with a `20 ms`
// spread. A tenth of a second in, therefore, every particle the system will ever
// hold has been emitted and none has yet reached the floor of that spread, so the
// population is the sum of the four bursts however the build's burst scattered
// (`specs/assets.md`). The check does not know the scatter and does not need it,
// and the simulator it runs beside the build is started on a fixed value of the
// suite's own for the same reason: the count it reads is the same at any.
//
// WHY THE AGE IS THE FRAMES THIS SUITE DROVE. `advance` runs whole frames of
// game time (`specs/instrumentation.md`), so the burst's age is the time those
// frames covered — plus whatever part of the frame the kill itself fell in,
// which is under one frame of `10 ms` and is far inside the tolerance below.
// Nothing here reads the build's own `elapsed`; that field is
// `instrumentation/snapshot-shape`'s business.
//
// WHAT THIS DOES NOT DECIDE. Whether the burst is painted at all is
// `bursts/drawn`, and what it is scaled to is `bursts/scaled-to-drone`.

import { afterEach, beforeEach, it } from "vitest";
import { ParticleSimulator } from "@clockwyrks/particle-runtime";
import { assertBetween, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  seededBurstSystem,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";
import { requireBurst } from "./reading";

/** The age the burst is read at, in seconds: the tenth of a second above. */
const READ_AGE = 0.1;

/**
 * The value the suite's own simulator of the system is started on.
 *
 * Any whole number: at `READ_AGE` the population it reads is the same at every
 * value, as the note above says, so this is the runtime's required argument and
 * nothing the check compares.
 */
const REFERENCE_SCATTER = 1;

/**
 * How far the build's live count may stand from the seeded system's own, as a
 * fraction.
 *
 * A fifth. The two populations are counted over the same span of the same
 * authored system, so in principle they agree exactly; what the tolerance covers
 * is the sub-frame slack in the age (under `10 ms` of the `100 ms` read at, and
 * a flash particle at the very floor of its lifetime spread is the only thing
 * that can die inside it) and a build's freedom to hold the simulation's own
 * `maxParticles` bound differently. It is nowhere near wide enough to admit an
 * effect that was hand-coded or replaced: the seeded system holds `235` at this
 * age, and this admits `188` to `282`.
 */
const COUNT_TOLERANCE = 0.2;

/** Where the drone is posed, and how far below it the shot starts. */
const POP_AT = { x: 1000, y: 460 } as const;
const SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the live population the seeded system's own emitters give", async () => {
  await startPosed(h);
  const target = await poseDrone(h, "shard", POP_AT.x, POP_AT.y, {
    band: "cyan",
  });

  await shootDrone(h, target, "cyan", { below: SHOT_BELOW });
  const popped = await h.snapshot();
  assertLength(
    popped.bursts,
    1,
    "precondition: the matching shot left one burst playing",
  );
  const id = popped.bursts[0].id;

  await h.advance(framesFor(READ_AGE));

  // The seeded system a tenth of a second into its play.
  await captureStill(h, "system");

  const burst = requireBurst(
    await h.snapshot(),
    id,
    `the burst still playing ${READ_AGE}s after the pop`,
  );

  // The same span of the same authored file, run through the package's own pure
  // simulator: what `assets/drone-burst.json` holds at this age.
  const reference = new ParticleSimulator(seededBurstSystem(), {
    seed: REFERENCE_SCATTER,
  });
  reference.step(READ_AGE * 1000);
  const expected = reference.liveCount;
  assertGreaterThan(
    expected,
    0,
    "precondition: the seeded system holds particles at this age",
  );

  assertBetween(
    burst.particles,
    expected * (1 - COUNT_TOLERANCE),
    expected * (1 + COUNT_TOLERANCE),
    `the live particles the burst's own simulation holds ${READ_AGE}s in, ` +
      `against the ${expected} that assets/drone-burst.json's four emitters ` +
      `hold at the same age (specs/assets.md: the seeded system is played, not ` +
      `hand-coded and not replaced)`,
  );
});
