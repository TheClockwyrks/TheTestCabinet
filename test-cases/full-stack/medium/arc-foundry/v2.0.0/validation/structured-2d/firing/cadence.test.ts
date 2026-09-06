// firing/cadence — a structure fires at its stated rate.
//
// specs/components.md fixes the cadence: "A structure fires at its fire rate, in
// shots per second, whenever it has a valid target in range", and `BASE_STATS`
// gives the Capacitor `1.6` shots a second at every tier. The snapshot reports the
// same figure as `fireRate`, so the cadence is measured against the figure the
// build itself declares as well as against the table.
//
// WHAT IS READ IS THE GAP BETWEEN LAUNCHES, NOT A COUNT OVER A SPAN. A count of
// shots across `n` seconds carries a band of one shot however carefully it is
// taken, because the span can begin or end in the middle of a shot, and one shot
// in `n` seconds is a band of `1 / n` on the rate: separating the Capacitor's
// `1.6` from the `1.3` and the `1.1` `BASE_STATS` gives the Choke and the
// Rectifier that way costs tens of seconds of simulation. The gap between two
// launches is the same quantity read directly and costs four shots: the yard is
// sampled every frame, the frame a projectile identity first appears on is the
// frame its shot was launched on, and the mean gap over the launches watched is
// one over the fire rate.
//
// THE BAND IS ONE FRAME, WHICH IS THE WHOLE OF WHAT A BUILD MAY NOT CONTROL.
// specs/instrumentation.md advances the simulation "from the elapsed time it is
// handed and from nothing else", so a structure fires on the frame its cadence
// comes due and no build can place a launch closer to the rate than the frame it
// was handed. A build that carries the remainder from one shot to the next holds
// the WHOLE span inside one frame of where the rate puts it, and a build that
// starts the next cooldown at the launch stretches EACH gap by up to one frame,
// so one frame of this harness's clock covers both and is honest about neither
// more nor less. At the frame below that is a band of about a fortieth of a
// second on a gap of `0.625`, which passes `1.6` a second and fails every other
// rate in `BASE_STATS` as well as a build off by a twentieth either way.
//
// The target is one Overload Dynamo, which "cannot be killed" (specs/enemies.md),
// held where it stands. That is what makes the gaps a measurement of the cadence
// and of nothing else: no kill can interrupt them, no bounty lands in the middle
// of one, and the geometry never changes.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  openYard,
  parkUnit,
  standComponent,
  structureById,
  TICK_HZ,
} from "../harness";
import {
  componentFireRate,
  PROJECTILE_HIT_R,
  PROJECTILE_SPEED,
} from "../constants";

const ANCHOR = { col: 10, row: 10 };

/** Inside the Scrap Capacitor's `100`, and a flight of about a tenth of a second. */
const TARGET_RANGE = 60;

/** The Capacitor's cadence, flat across the quality ladder. */
const FIRE_RATE = componentFireRate("capacitor");

/** Consecutive launches watched, which is three gaps to take the mean of. */
const LAUNCHES = 4;

/**
 * The frame the launches are watched at, in Hz.
 *
 * TWO BOUNDS SET IT, AND BOTH ARE COMPUTED FROM FIGURES THE SPECS STATE.
 *
 * A shot must land where the game says it lands. `specs/components.md` flies a
 * projectile straight at the point it was aimed at, at `PROJECTILE_SPEED`, and
 * lands it "when the projectile comes within `PROJECTILE_HIT_R` of that
 * position": the target here is held still, so the aim point does not move and
 * the flight closes on it monotonically. A step shorter than the full width of
 * that window — `2 * PROJECTILE_HIT_R` — therefore cannot carry a shot from
 * outside the window to outside it in one frame, which makes
 * `PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)` the floor on the rate.
 *
 * And the frame IS the band this check asserts to, so a shorter frame is a
 * tighter reading of the cadence.
 *
 * `specs/instrumentation.md` fixes no frame size otherwise — an interval of
 * simulation time reaches the same state however it was divided into frames, which
 * `instrumentation/frame-division-movement` and
 * `instrumentation/frame-division-projectile` are the two items that decide — so
 * the launches are watched at half the project's own frame, which clears the floor
 * with room to spare and holds the band under a fortieth of a second.
 */
const COUNT_HZ = Math.max(
  TICK_HZ / 2,
  Math.ceil(PROJECTILE_SPEED / (2 * PROJECTILE_HIT_R)),
);

/** One frame of that clock, in seconds. This is the band. */
const FRAME_SECONDS = 1 / COUNT_HZ;

/** The gap one over the stated rate puts between two launches, in seconds. */
const GAP_SECONDS = 1 / FIRE_RATE;

/**
 * How far the sweep may run before it gives up, in frames.
 *
 * Twice the simulation the watched launches take at the stated rate. It is a
 * failure cap and not a span: a build firing at the rate reaches the fourth
 * launch in half of it, and one that never reaches four launches has already
 * failed the requirement.
 */
const CAP_FRAMES = Math.ceil(2 * LAUNCHES * GAP_SECONDS * COUNT_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: COUNT_HZ });
});

afterEach(() => {
  h.dispose();
});

it("puts one over its fire rate between consecutive launches", async () => {
  openYard(h, { wave: 1 });
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);
  const structure = structureById(h.snapshot(), id);
  parkUnit(h, "overload", {
    x: structure.cx + TARGET_RANGE,
    y: structure.cy,
  });

  assertEqual(
    structure.fireRate,
    FIRE_RATE,
    "the Capacitor's reported cadence (specs/components.md)",
  );

  const launches = await captureReplay(h, "cadence", async () => {
    const seen = new Set<number>();
    const at: number[] = [];
    let frame = 0;
    // `until` hands the predicate the state after every `poll` frames, which
    // watches the yard across a drive at one crossing per frame rather than two.
    // The first reading is taken before anything is driven, so `frame` counts
    // frames advanced and a launch is stamped with the frame it appeared on.
    await h.until(
      (s) => {
        let launched = false;
        for (const projectile of s.projectiles) {
          if (seen.has(projectile.id)) continue;
          seen.add(projectile.id);
          launched = true;
        }
        if (launched) at.push(frame);
        frame += 1;
        return at.length >= LAUNCHES;
      },
      { maxFrames: CAP_FRAMES, poll: 1 },
    );
    return at;
  });

  assertLength(
    launches,
    LAUNCHES,
    `launches from one Capacitor with a target in range, over the ` +
      `${CAP_FRAMES} frames that hold twice the simulation ${LAUNCHES} shots ` +
      `at ${FIRE_RATE} a second take`,
  );

  const gap =
    (launches[LAUNCHES - 1] - launches[0]) / (LAUNCHES - 1) / COUNT_HZ;
  assertBetween(
    gap,
    GAP_SECONDS - FRAME_SECONDS,
    GAP_SECONDS + FRAME_SECONDS,
    `the mean simulation time between consecutive launches, against the ` +
      `${GAP_SECONDS}s one over ${FIRE_RATE} a second puts between two shots, ` +
      `within the one frame a cadence is placed inside`,
  );
});
