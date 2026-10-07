// drones/flux-defers-shot — a Flux that crosses the fire line shimmering takes its
// shot the moment it settles.
//
// specs/drones.md, What that means in play: "It fires nothing while it shimmers: a
// Flux that is shimmering when it crosses the fire line takes its shot as soon as
// it settles on a band, if it is still diving." The sentence is written out because
// the general rules do not produce it: specs/swarm.md buys a diver its shot in the
// frame it crosses `DIVE_FIRE_Y`, and the shimmer forbids that shot — so what
// happens to a shot that was owed and refused is a rule of its own. A build that
// simply DROPS the shot is a perfectly consistent reading of the two general rules,
// and it is the model this point exists to catch.
//
// THE ONLY POINT THAT DRIVES THE SCENARIO THE SENTENCE DESCRIBES. Its two
// neighbours deliberately never reach it: `drones/flux-silent-in-shimmer` pins the
// drone mid-shimmer with `setDroneOscillation(id, false)` for its whole dive, so
// the settle never comes, and `drones/flux-fires-held-band` freezes the clock in
// the HELD part, so the crossing is never made in shimmer. Here the OSCILLATION
// GATE IS LEFT ON, so the window really elapses under the drone and the settle
// really happens.
//
// THE POSE. One Flux alone, thirty units above `DIVE_FIRE_Y` (360), in phase
// `diving` with travel and fire on, its band clock a quarter of `FLUX_SHIMMER`
// (0.4) into the shimmer. That leaves three tenths of a second of shimmer to run
// and puts the crossing inside it: a dive travels at `DIVE_SPEED` (300) units per
// second along its path (specs/swarm.md), so thirty units of descent is a tenth of
// a second at the fastest and well inside the shimmer on any conformant path. Both
// halves of the sentence's precondition are then ASSERTED off the sweep rather than
// assumed — that the centre really crossed the fire line while `shimmer` was true,
// and that the shimmer really ended with the drone still `diving`.
//
// THE READING. The dive is swept a frame at a time, keeping each frame's `shimmer`,
// `phase`, centre and the enemy bullets on the field, so three things can be said
// at once: the dive left exactly one bullet, that bullet was NOT on the field
// during any shimmering frame — which is what makes it the DEFERRED shot rather
// than the shot at the crossing — and it appeared within a couple of frames of the
// settle rather than at some later moment of the build's choosing.
//
// WHAT THIS DOES NOT DECIDE. That a shimmering Flux is silent when it never settles
// is `drones/flux-silent-in-shimmer`'s; the count over an ordinary dive is
// `drones/flux-fires-one`'s; the band the bullet carries is
// `drones/flux-fires-held-band`'s; where the dive goes and how fast is `swarm`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  DIVE_FIRE_Y,
  FLUX_SHIMMER,
  FORM_CENTER_X,
  fluxHold,
} from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  enemyBullets,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at: where the shimmer starts is per stage. */
const STAGE = 1;

/** How far into the shimmer the band clock is posed, as a fraction of it. */
const SHIMMER_ENTERED = 0.25;

/**
 * The band clock the diving Flux is posed at: a quarter of the way into the
 * shimmer.
 *
 * Inside the shimmer under any reading of its opening boundary, and with three
 * quarters of `FLUX_SHIMMER` still to run — 0.3 s — which is the room the crossing
 * below has to happen in.
 */
const POSED_CLOCK = fluxHold(STAGE) + FLUX_SHIMMER * SHIMMER_ENTERED;

/** Seconds of shimmer left to run when the sweep starts. */
const SHIMMER_LEFT = FLUX_SHIMMER * (1 - SHIMMER_ENTERED);

/**
 * Where the diving Flux starts.
 *
 * Thirty units above `DIVE_FIRE_Y` (360) on the ship's lane. A dive travels at
 * `DIVE_SPEED` (300) units per second along its path, so the crossing is a tenth of
 * a second away at the fastest and comfortably inside the `SHIMMER_LEFT` (0.3 s)
 * the drone has to run — which is what makes the crossing happen IN the shimmer,
 * the precondition the rule under test is about. It is well below `FIELD_TOP` (64),
 * so nothing about the entrance is in play.
 */
const AT = { x: FORM_CENTER_X, y: DIVE_FIRE_Y - 30 } as const;

/** The shots specs/drones.md gives a Flux over a dive. */
const SHOTS = 1;

/**
 * Frames between the settle and the deferred shot that still count as "as soon as".
 *
 * Two of the harness's 100 Hz clock. A build that resolves the settle and the shot
 * inside one frame shows both on the same sample; one that resolves the settle at
 * the end of a frame and fires at the start of the next shows the shot one sample
 * later. Two frames covers both orders and nothing else: it is 0.02 s against the
 * `SHIMMER_LEFT` (0.3 s) a build that waited out another window would take.
 */
const SETTLE_SLACK = 2;

/**
 * Frames the dive is swept for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." The sweep stops the
 * moment the drone leaves phase `diving`, and only a diving drone fires, so this
 * cap only bounds a build whose dives never end.
 */
const DIVE_FRAMES = framesFor(8);

/** What one frame of the sweep saw. */
interface Frame {
  shimmer: boolean;
  phase: string;
  y: number;
  /** Enemy bullet ids on the field on this frame. */
  bullets: number[];
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("holds a shimmering Flux's shot back and takes it the moment it settles", async () => {
  await startPosed(harness, { stage: STAGE });
  const flux = await poseDrone(harness, "flux", AT.x, AT.y, {
    bandClock: POSED_CLOCK,
    // LEFT ON, so the band window really elapses under the drone and the settle the
    // rule turns on really happens.
    oscillation: true,
    phase: "diving",
    travel: true,
    fire: true,
  });

  const posed = await harness.snapshot();
  assertEqual(
    droneById(posed, flux)?.shimmer,
    true,
    `precondition: the Flux is shimmering before the dive begins, posed ` +
      `${String(SHIMMER_ENTERED * 100)}% into FLUX_SHIMMER (${FLUX_SHIMMER}) ` +
      `past fluxHold(${STAGE}) (${fluxHold(STAGE)}) (specs/drones.md)`,
  );

  // The sweep: one sample per frame, kept whole, so the settle and the shot can be
  // placed against one another afterwards.
  const frames: Frame[] = [];
  await harness.until(
    (snapshot) => {
      const drone = droneById(snapshot, flux);
      frames.push({
        shimmer: drone?.shimmer ?? false,
        phase: drone?.phase ?? "gone",
        y: drone?.y ?? Number.NEGATIVE_INFINITY,
        bullets: enemyBullets(snapshot).map((bullet) => bullet.id),
      });
      return drone === undefined || drone.phase !== "diving";
    },
    { maxFrames: DIVE_FRAMES, poll: 1 },
  );
  await captureStill(harness, "deferred");

  // ---- The two halves of the sentence's precondition, read off the sweep ------

  assertTrue(
    frames.some((frame) => frame.shimmer && frame.y >= DIVE_FIRE_Y),
    `precondition: the Flux's centre crossed DIVE_FIRE_Y (${DIVE_FIRE_Y}) while ` +
      `it was still shimmering, which is the situation the rule is about — it ` +
      `was posed 30 units above the line with ${SHIMMER_LEFT.toFixed(2)}s of ` +
      `shimmer left, and a dive travels at DIVE_SPEED (300) units per second ` +
      `(specs/swarm.md, graded at swarm/dive-speed)`,
  );
  const settled = frames.findIndex((frame) => !frame.shimmer);
  assertGreaterThanOrEqual(
    settled,
    0,
    `precondition: the Flux's shimmer ended during the dive, within the ` +
      `${SHIMMER_LEFT.toFixed(2)}s of FLUX_SHIMMER (${FLUX_SHIMMER}) it was ` +
      `posed with left to run (specs/drones.md, graded at ` +
      `drones/flux-shimmer-duration)`,
  );
  assertEqual(
    frames[settled]?.phase,
    "diving",
    `precondition: the Flux was still diving on the frame it settled, which is ` +
      `the condition the rule attaches to the deferred shot (specs/drones.md)`,
  );

  // ---- And the shot itself ---------------------------------------------------

  const seen = new Map<number, number>();
  frames.forEach((frame, index) => {
    for (const id of frame.bullets) if (!seen.has(id)) seen.set(id, index);
  });
  assertLength(
    [...seen.keys()],
    SHOTS,
    `the enemy bullets a Flux that crossed the fire line shimmering left over ` +
      `its whole dive: the one shot it was owed, taken late rather than dropped ` +
      `(specs/drones.md)`,
  );

  const fired = [...seen.values()][0] ?? -1;
  assertGreaterThanOrEqual(
    fired,
    settled,
    `the frame of the dive the deferred shot appeared on, against frame ` +
      `${String(settled)} where the shimmer ended — a bullet on the field ` +
      `BEFORE the settle is the shot taken at the crossing, which a shimmering ` +
      `Flux may not take (specs/drones.md)`,
  );
  assertLessThanOrEqual(
    fired - settled,
    SETTLE_SLACK,
    `the frames between the Flux settling on a band and its deferred shot ` +
      `appearing — the shot is taken AS SOON AS it settles, so within ` +
      `${String(SETTLE_SLACK)} frames of this 100 Hz clock (specs/drones.md)`,
  );
});
