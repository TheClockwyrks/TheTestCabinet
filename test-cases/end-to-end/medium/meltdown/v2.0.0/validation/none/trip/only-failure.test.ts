// Meltdown — trip/only-failure: the trip is the only failure.
//
// `specs/heat.md` closes the trip with the claim the whole defense rests on:
// "The trip is an emitter's only failure. A tower is never destroyed, never
// damaged by the surge, and never runs out of ammunition." A tower is therefore
// the one thing on this floor that cannot be taken off it, and the only reason
// it is ever offline is a cooldown it gave itself.
//
// FOUR READINGS, ONE MINUTE, ONE TOWER UNDER FORTY UNITS. The claim has four
// halves and each of them has an observable:
//
//   - NEVER DESTROYED. The floor still holds exactly one tower at the end, and
//     it is the one that was posed. A build that removes a tower under pressure
//     loses it from the roster.
//   - ITS ONLY OFFLINE PERIODS ARE TRIP COOLDOWNS. `specs/combat.md` reports
//     `firing` on "a frame in which it has a target and is online", and there is
//     a mark inside this Arc's range on every frame of the minute — so a sample
//     that finds `firing` false must find `tripped` true. This is the reading
//     the item turns on, and it is why the marks stand still: a unit that walked
//     out of range would make `firing` false for a reason that is not a failure
//     at all.
//
// THE ONE FRAME THAT IS NEITHER, AND WHY IT IS NOT AN OUTAGE. `specs/heat.md`
// puts a tripped emitter back in service "when the cooldown reaches `0`", and
// nothing fixes where in a frame that happens. A build that resolves its heat
// after its combat therefore reports, on that single frame, a tower that combat
// found tripped — `firing` false — and that the heat pass has since returned —
// `tripped` false; a build that resolves them the other way round reports
// `firing` true on the same frame. Both are conformant, so a sample landing on
// one of those handovers is confirmed a couple of frames later rather than
// graded, and only an outage that survives the confirmation is a failure.
//   - NEVER RUNS OUT OF AMMUNITION. `damageDealt` is still rising in the LAST
//     ten seconds of the minute. A magazine would show as a tower that fired
//     early and then stopped while its target stood there.
//   - NEVER DAMAGED. The per-shot `damage` the tower reports at the end is still
//     exactly `baseDamage(level) * heatMultiplier(heat, redline)`
//     (`specs/combat.md`), read against its own heat in the same snapshot. A
//     build that wore the tower down under a wave would report a figure below
//     its roster line.
//
// THE ARC IS LEFT WHOLLY TO ITSELF: both faculties on, no gate touched, nothing
// posed on it after the floor is laid out. Over the minute its own heat model
// carries it to the trip and back again several times over — one shot adds
// `10.3` and its four radiator and four plain edge-tiles shed at most `18.8` a
// second, so a gun firing twice a second gains ground — and every one of those
// cooldowns is a legal offline period this check must accept rather than
// mistake for a failure.
//
// THE FORTY MARKS STAND STILL AND CANNOT DIE. `specs/waves.md` fields one type
// per wave, so they are forty Motes; their motion is off so none of them leaks a
// life or leaves the tower without a target, and their hp is far past the
// thousand or so an Arc removes in a minute, so none of them dies and no death,
// bounty or wave clear lands in the middle of the reading. What is under test is
// the tower, not the surge.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { heatMultiplier, type Tile } from "../constants";
import { freeSite } from "../fixtures";
import {
  captureStill,
  createDriveHarness,
  driveFrames,
  driveSeconds,
  poseTarget,
  poseTower,
  requireTower,
  startRun,
  type Harness,
  type MeltdownSnapshot,
  type UntilResult,
} from "../harness";
import { MARK_HP, MARK_TYPE, figuresOf } from "./bench";

/** The tower held under the wave, at the level `addTower` starts it at. */
const TOWER = "arc";
const LEVEL = 1;

/** Where it stands: a quiet anchor with clear floor around it on every side. */
const SITE: Tile = freeSite(4);

/** The 2x2 footprint `specs/towers.md` gives the Arc. */
const SIZE = 2;

/** The wave held against it, as the item states it. */
const UNITS = 40;

/**
 * How far from the footprint the marks are spread, in tiles.
 *
 * Every tile within three of the footprint's anchor block, which puts the
 * furthest of them under five tiles from the footprint centre range is measured
 * from — comfortably inside the Arc's `6.0` (`specs/towers.md`), so the tower
 * has a target on every frame. Geometry, not a tolerance: no reading here is
 * about range, so none of them may sit near one.
 */
const SPREAD = 3;

/** The whole reading, in seconds of game time, and the tail read on its own. */
const MINUTE = 60;
const TAIL = 10;

/**
 * How often the minute is sampled, in frames of the long-drive clock
 * (`harness.ts`, The long-drive clock).
 *
 * Four samples a second. Measurement geometry: `specs/heat.md` gives the
 * cooldown five seconds, so an offline period this misses is twenty times
 * shorter than the shortest legal one.
 */
const POLL = driveFrames(1 / 4);

/**
 * How long a sample that found neither is given before it is called an outage,
 * in frames of the long-drive clock.
 *
 * Two frames, a fifteenth of a second. See the head: one frame of neither is the
 * handover a build is free to resolve on either side of, and two frames is the
 * shortest window that tells that apart from a tower that has actually stopped.
 * It is seventy-five times shorter than the cooldown this reading is really
 * watching for, so nothing a trip does can hide inside it. Geometry, not a
 * tolerance.
 */
const HANDOVER = 2;

/**
 * How close the closing per-shot damage must come to the roster line, as decimal
 * places.
 *
 * Three places is `0.0005` hp. Both the `damage` and the `heat` it is checked
 * against come out of the SAME snapshot, computed at the same call
 * (`specs/instrumentation.md`), so there is nothing for a conformant build to
 * drift by; what the bound excludes is a tower that has been worn down at all.
 */
const DAMAGE_DIGITS = 3;

/** The Arc's roster figures at level I (`specs/towers.md`). */
const FIGURES = figuresOf(TOWER, LEVEL);

/** Every frame the tower is offline for a reason that is not a trip. */
function offlineWithoutATrip(id: number) {
  return (snapshot: MeltdownSnapshot): boolean => {
    const gun = requireTower(snapshot, id, "the tower under the wave");
    return !gun.firing && !gun.tripped;
  };
}

/**
 * Watch the tower for `frames` frames, `since` seconds into the minute, and
 * fail on the first outage that is not a trip cooldown.
 *
 * The sweep runs at {@link POLL} and stops the moment it finds the tower
 * reporting neither. That sample is then given {@link HANDOVER} frames and read
 * again: a build resolving its return between its combat pass and its heat pass
 * shows one frame of neither and is firing on the next, and only a tower still
 * offline after the confirmation is an outage. The watch then goes on from
 * wherever it stopped, so an accepted handover costs the reading nothing.
 */
async function watch(
  h: Harness,
  id: number,
  frames: number,
  since: number,
): Promise<void> {
  let spent = 0;
  while (spent < frames) {
    const swept: UntilResult = await h.until(offlineWithoutATrip(id), {
      poll: POLL,
      maxFrames: frames - spent,
    });
    spent += swept.frames;
    if (!swept.hit) return;
    await h.advance(HANDOVER);
    spent += HANDOVER;
    const gun = requireTower(
      await h.snapshot(),
      id,
      "the tower under the wave",
    );
    assertTrue(
      gun.firing || gun.tripped,
      `a tower under ${UNITS} units to be either firing or serving a trip ` +
        `cooldown, ${(since + driveSeconds(spent)).toFixed(2)}s into the minute: ` +
        `it reported firing false with tripped false and ` +
        `${gun.tripTimer.toFixed(3)}s of cooldown`,
    );
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createDriveHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The trip is the only failure", async () => {
  await startRun(h);
  await h.debug.setPhase("wave");
  const id = await poseTower(h, TOWER, SITE.col, SITE.row);

  // The forty marks, on every tile within `SPREAD` of the footprint that the
  // footprint does not itself occupy.
  let posed = 0;
  for (let row = SITE.row - SPREAD; posed < UNITS; row += 1) {
    for (
      let col = SITE.col - SPREAD;
      col <= SITE.col + SIZE + SPREAD - 1;
      col += 1
    ) {
      if (posed >= UNITS) break;
      const onFootprint =
        col >= SITE.col &&
        col < SITE.col + SIZE &&
        row >= SITE.row &&
        row < SITE.row + SIZE;
      if (onFootprint) continue;
      await poseTarget(h, MARK_TYPE, col, row, MARK_HP);
      posed += 1;
    }
  }

  // One frame to bring the floor to life before the watch opens. `firing`
  // reports what a RESOLVED frame found (`specs/combat.md`), and at the moment
  // the marks are posed no frame has run, so the tower has not yet been given
  // the chance to acquire one. Geometry, not a tolerance.
  await h.advance(1);

  await watch(h, id, driveFrames(MINUTE - TAIL), 0);
  const midway = requireTower(
    await h.snapshot(),
    id,
    `the tower ${MINUTE - TAIL}s into the minute`,
  );

  await watch(h, id, driveFrames(TAIL), MINUTE - TAIL);
  await captureStill(h, "intact");
  const closing = await h.snapshot();
  const gun = requireTower(closing, id, `the tower after ${MINUTE}s`);

  assertLength(
    closing.towers,
    1,
    `the towers still standing after ${MINUTE}s under ${UNITS} units: a ` +
      `tower is never destroyed`,
  );
  assertEqual(
    gun.type,
    TOWER,
    `the surviving tower to be the ${TOWER} that was posed`,
  );
  assertGreaterThan(
    gun.damageDealt,
    midway.damageDealt,
    `the hp the ${TOWER} removed in the last ${TAIL}s of the minute, against ` +
      `the ${midway.damageDealt.toFixed(1)} it had removed by then: it never ` +
      `runs out of ammunition`,
  );
  assertCloseTo(
    gun.damage,
    FIGURES.baseDamage * heatMultiplier(gun.heat, FIGURES.redline),
    DAMAGE_DIGITS,
    `the per-shot damage a level-${LEVEL} ${TOWER} still deals after ` +
      `${MINUTE}s under ${UNITS} units, at its own heat of ` +
      `${gun.heat.toFixed(3)}: it is never damaged by the surge`,
  );
});
