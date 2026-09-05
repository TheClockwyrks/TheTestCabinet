// Spectra — bursts/from-provided-system: the provided system is what plays.
//
// `specs/assets.md` seeds `drone-burst.json` — "a particle system: a description
// of emitters, forces, and per-particle curves on a `BURST_FIELD` (`128`) square
// field" — and says of it: "It is played, not hand-coded and not replaced. The
// runtime that plays it, `@clockwyrks/particle-runtime`, is already a
// dependency of the project. Play it with the package's pure
// `ParticleSimulator`". `specs/instrumentation.md` then reports, per live burst,
// `particles`: "the live particles the burst's own simulation holds at the call".
//
// THE READING IS THAT COUNT, HELD AGAINST THE SEEDED FILE'S OWN EMITTERS. The
// system under `assets/` is read off the workspace, its emitters' own burst
// counts are added up, and the build's reported population is held against that
// total. A build that really plays the seeded system holds the same population;
// a build that hand-coded a puff of a dozen sparks, or one that replaced the
// file with a system of its own, holds a different one — and the distance is
// enormous either way, because the seeded system's four emitters burst
// `5 + 120 + 55 + 55` particles at time zero.
//
// WHY A TENTH OF A SECOND, AND WHY THE SEED DOES NOT MATTER THERE. Every emitter
// of the seeded system fires its whole burst at `atMs` `0`, so a tenth of a
// second in the whole population has been emitted whatever seed the game drew
// for this burst out of its own generator (`specs/assets.md`) — the seed decides
// where the particles went, not how many there are. The check does not know that
// seed and does not need it. It asserts BOTH of those properties of the file
// before it uses them, so a re-authored `drone-burst.json` makes this check
// complain rather than quietly measure the wrong thing.
//
// WHY THE AGE IS THE FRAMES THIS SUITE DROVE. `firedPop` stops on the frame the
// burst appeared, so the burst is at most one frame old when the drive begins
// and the age read at is `READ_AGE` to `READ_AGE` plus a frame. Nothing here
// reads the build's own `elapsed`; that field is `instrumentation/snapshot-shape`'s
// business.
//
// WHAT THIS DOES NOT DECIDE. Whether the burst is painted at all is
// `bursts/drawn`, and what it is scaled to is `bursts/scaled-to-drone`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertGreaterThan,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
  seconds,
  seededBurstSystem,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { burstOf } from "./reading";
import { firedPop } from "./scene";

/** The age the burst is read at, in seconds: the tenth of a second above. */
const READ_AGE = 0.1;

/**
 * The oldest the burst can be when it is read, in milliseconds.
 *
 * `firedPop` leaves it at most one frame old, and the drive covers `READ_AGE`,
 * so this is the whole of the uncertainty in the age — and it is what the
 * precondition below measures the file's own particle lifetimes against.
 */
const LATEST_MS = (READ_AGE + seconds(1)) * 1000;

/**
 * How far the build's live count may stand from the seeded system's own, as a
 * fraction.
 *
 * A fifth. The two populations are the same emitters' own burst counts, so in
 * principle they agree exactly; what the tolerance covers is the sub-frame slack
 * in the age above, whatever particles the file's own lifetimes let expire
 * inside it (the precondition below holds that under half of this), and a
 * build's freedom to hold the simulation's own `maxParticles` bound differently.
 * It is nowhere near wide enough to admit an effect that was hand-coded or
 * replaced: the seeded system emits `235`, and this admits `188` to `282`.
 */
const COUNT_TOLERANCE = 0.2;

/** Where the drone is posed: the clear stretch of field this group pops on. */
const POP_AT = { x: 1000, y: 460 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the live population the seeded system's own emitters give", async () => {
  startPosed(h);
  poseDrone(h, "shard", POP_AT.x, POP_AT.y, { band: "cyan" });

  const pop = await firedPop(h, POP_AT.x, POP_AT.y, "cyan");
  await h.advance(ticksFor(READ_AGE));

  // The seeded system a tenth of a second into its play.
  captureStill(h, "system");

  const burst = burstOf(
    h.snapshot(),
    pop.id,
    `the burst still playing ${READ_AGE}s after the pop`,
  );

  // What `assets/drone-burst.json` itself says it emits, and the two properties
  // of the file that make that total the population at this age.
  const system = seededBurstSystem();
  const fired = system.emitters.filter(
    (emitter) => emitter.emission.atMs <= READ_AGE * 1000,
  );
  assertLength(
    fired,
    system.emitters.length,
    `precondition: every emitter of assets/drone-burst.json has fired by ` +
      `${READ_AGE}s, so the whole population is on the field`,
  );
  const expected = fired.reduce(
    (total, emitter) => total + emitter.emission.count,
    0,
  );
  assertGreaterThan(
    expected,
    0,
    "precondition: the seeded system emits particles at all",
  );

  // Whatever the file's own lifetimes let expire by the oldest age this reads
  // at, as a share of that population: the slack the tolerance has to cover on
  // top of everything else, and it must stay well under it.
  const perishable = system.emitters
    .filter(
      (emitter) => emitter.lifetimeMs - emitter.lifetimeSpread < LATEST_MS,
    )
    .reduce((total, emitter) => total + emitter.emission.count, 0);
  assertLessThanOrEqual(
    perishable / expected,
    COUNT_TOLERANCE / 2,
    `precondition: at most half the tolerance of assets/drone-burst.json's ` +
      `${expected} particles can have expired by ${LATEST_MS.toFixed(1)}ms, ` +
      `the oldest this reading is taken at`,
  );

  assertBetween(
    burst.particles,
    expected * (1 - COUNT_TOLERANCE),
    expected * (1 + COUNT_TOLERANCE),
    `the live particles the burst's own simulation holds ${READ_AGE}s in, ` +
      `against the ${expected} assets/drone-burst.json's own emitters burst ` +
      `(specs/assets.md: the seeded system is played, not hand-coded and not ` +
      `replaced)`,
  );
});
