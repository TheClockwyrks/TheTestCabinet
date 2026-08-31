// Meltdown — trip/tripped-stops-firing: a tripped tower is offline.
//
// `specs/heat.md` gives a tripped emitter's first consequence: it "fires nothing
// and acquires no target for the whole of its cooldown". `specs/combat.md` says
// the same from the other side: "A tripped emitter reports `firing` false for
// the whole of its cooldown." So the requirement is not that it eventually stops
// — it is that across every frame of the five seconds it never fires, never
// holds a target, removes no hp and takes no kill.
//
// THE TOWER IS POSED ALREADY TRIPPED (`poseTrippedTower`), which is what keeps
// this item about being offline rather than about reaching the trip. Reaching it
// on the real path would make the check fail for a build whose targeting, range
// or fire clock is broken, and each of those is somebody else's item. The
// faculty gates are LEFT ON: a tower posed this way has `firingEnabled` true
// (`specs/instrumentation.md`), so the only thing standing between it and a shot
// is the trip. A check that also switched the guns off would be grading the
// gate.
//
// THE MARK IS ONE SHOT FROM DEATH. Its hp is `1`, and `specs/combat.md` scales
// an Arc's shot to `6 * 3.5` at the plateau it is tripped from, so ANY shot the
// build resolves takes the mark to `0` and posts a kill. That is what makes
// "deals no damage and takes no kill" a reading rather than a hope: a build that
// fires once while tripped cannot hide it in the rounding. The mark's motion is
// off, so it stands in range for the whole cooldown and the tower has something
// to fire at on every frame of it.
//
// THE SWEEP STOPS SHORT OF THE RETURN. It watches the cooldown at 60 samples a
// second and stops two frames before `TRIP_TIME`, because the tower coming back
// online at the end and firing again is exactly what `specs/heat.md` requires of
// it — that boundary is `trip/returns-cold`'s item, and reading it here would
// turn a conformant return into a failure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseTarget,
  poseTrippedTower,
  requireTower,
  requireUnit,
  seconds,
  startRun,
  type Harness,
} from "../harness";
import { MARK_OFFSET, MARK_TYPE, TRIP_SITE, readTower } from "./bench";

/** The emitter posed tripped, and the cooldown it is posed with. */
const TOWER = "arc";
const POSED_HEAT = TRIP_HEAT;
const POSED_TIMER = TRIP_TIME;

/**
 * The mark's hp: one point, so any shot at all kills it.
 *
 * The smallest hp a unit can carry and still be alive, and far below the `21` an
 * Arc's shot removes at the plateau (`specs/combat.md`), so a single shot the
 * build resolves shows up in all three readings at once — hp, `damageDealt` and
 * `kills`.
 */
const MARK_HP = 1;

/**
 * How often the cooldown is sampled, in frames of the default clock.
 *
 * Sixty samples a second. Measurement geometry, not a tolerance: it says how
 * finely the five seconds are watched, never how far a build may miss by. The
 * two tallies read at the end catch a shot that fell between two samples, so
 * what the sampling rate really decides is how precisely a failure names WHEN
 * the tower came back to life.
 */
const POLL = framesFor(1 / 60);

/**
 * How far short of the return the sweep stops, in frames.
 *
 * Two frames of the default clock, `0.0167` of a second. `specs/heat.md` puts
 * the tower back online when the cooldown reaches `0`, so the last frame or two
 * of a five-second window is where a conformant build legitimately fires again.
 * Geometry, not a tolerance.
 */
const RETURN_GUARD = 2;

/** The frames watched: the whole cooldown but for that guard. */
const WATCHED_FRAMES = framesFor(TRIP_TIME) - RETURN_GUARD;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A tripped tower is offline", async () => {
  await startRun(h);
  const id = await poseTrippedTower(h, TOWER, TRIP_SITE.col, TRIP_SITE.row, {
    heat: POSED_HEAT,
    timer: POSED_TIMER,
  });
  const mark = await poseTarget(
    h,
    MARK_TYPE,
    TRIP_SITE.col + MARK_OFFSET,
    TRIP_SITE.row,
    MARK_HP,
  );

  const swept = await h.until(
    (snapshot) => {
      const gun = requireTower(snapshot, id, "the tripped emitter");
      return gun.firing || gun.targeting !== null;
    },
    { poll: POLL, maxFrames: WATCHED_FRAMES },
  );
  await captureStill(h, "offline");
  const gun = requireTower(swept.snapshot, id, "the tripped emitter");
  const at = seconds(swept.frames).toFixed(3);

  assertEqual(
    gun.firing,
    false,
    `a tripped ${TOWER} to report firing false for the whole of its ` +
      `${TRIP_TIME}s cooldown: at ${at}s in it had cooldown ` +
      `${gun.tripTimer.toFixed(3)} left`,
  );
  assertNull(
    gun.targeting,
    `a tripped ${TOWER} to acquire no target for the whole of its ` +
      `${TRIP_TIME}s cooldown: at ${at}s in it held one`,
  );

  const struck = requireUnit(await h.snapshot(), mark, "the mark in range");
  const closed = await readTower(h, id, "the tripped emitter");

  assertEqual(
    struck.hp,
    MARK_HP,
    `the hp of a mark standing in range of a tripped ${TOWER} for ${at}s`,
  );
  assertEqual(
    closed.damageDealt,
    0,
    `the hp a tripped ${TOWER} removed over ${at}s with a mark in range`,
  );
  assertEqual(
    closed.kills,
    0,
    `the kills a tripped ${TOWER} took over ${at}s with a ${MARK_HP}hp mark ` +
      `in range`,
  );
});
