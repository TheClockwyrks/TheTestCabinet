// audio/absorb — the cue an absorbed bullet plays.
//
// `specs/ui.md` fixes `CUES.absorb` (`"absorb"`) as the cue played when "the hull
// absorbs an enemy bullet of its own band", and governs all nine with one
// sentence: "Each is played on the frame its event happens and at most once on
// that frame."
//
// So the measurement is: pose an empty, quiet, live wave, drop ONE enemy bullet of
// the ship's OWN band onto the hull, step one frame at a time, and read what the
// bus announced on the frame the bullet was absorbed against what it announced
// over the fall. The fall is the half a build cannot fake — a build that blips
// every frame sounds on the absorb's frame too, and fails on the quiet that should
// have come first.
//
// THE ABSORB IS REAL, NOT POSED. Nothing here removes the bullet or writes the
// meter: the bullet is placed above the hull carrying the band `specs/bands.md`
// says the shield takes, and the build's own contact and band rules decide the
// rest. `setShipContact(true)` puts back the one world gate `startPosed` shuts,
// because this is one of the items whose requirement that gate is.
//
// WHY THE EVENT IS "GONE AND UNHARMED". `specs/bands.md` gives an enemy bullet two
// outcomes at the hull, and BOTH take it off the roster: a same-band bullet is
// absorbed with the ship unharmed, an opposite-band one costs a life. So the event
// this check waits for is the bullet leaving the roster with the run's lives still
// whole, which is the absorb and not the hit. The budget stops the sweep before
// the bullet could have fallen past the ship to `FIELD_BOTTOM`, so a bullet culled
// off the field cannot be mistaken for one absorbed.
//
// WHAT THIS DOES NOT DECIDE. That a same-band bullet is absorbed, or what it
// fills, which are `bands/shield-absorbs`'s and `resonance/absorb-fills`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  ENEMY_BULLET_SPEED,
  START_LIVES,
  bulletSpeedScale,
} from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  poseEnemyBulletAbove,
  quietFrames,
  watchForEvent,
} from "./cues";

/**
 * How far above the ship's centre the bullet starts, in logical units.
 *
 * Far enough that the fall is a real window of quiet — at the stage-1 enemy bullet
 * speed of `ENEMY_BULLET_SPEED` (`320`) times `bulletSpeedScale(1)` (`1`) it is
 * better than a third of a second — and short enough that the budget below expires
 * well before the bullet could reach `FIELD_BOTTOM` (`656`), fifty-six units past
 * the ship's lane at `SHIP_Y` (`600`).
 */
const ABOVE_SHIP = 120;

/** The speed the bullet falls at on stage 1 (specs/stages.md, specs/drones.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to reach the hull.
 *
 * The time to fall the whole `ABOVE_SHIP` at `FALL_SPEED` — geometry, not a
 * tolerance — plus two frames for the frame the bullet is placed on. Contact lands
 * sooner than that, since the hull's and the bullet's half-extents meet before
 * their centres do, which is exactly why this budget cannot run long enough for a
 * bullet that passed straight through to be culled off the field.
 */
const FALL_FRAMES = ticksFor(ABOVE_SHIP / FALL_SPEED) + 2;

/** Frames run after the reading, purely so the still shows the hull it landed on. */
const TAIL_FRAMES = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.absorb on the frame the hull absorbs a same-band bullet, and not before", async () => {
  // An empty, quiet, live wave: no drone, no other bullet and no burst, so the
  // only thing that can happen in this window is the absorb.
  startPosed(h);
  // The one world gate this item's requirement IS: without it the hull runs no
  // contact test and there is no absorb to hear.
  h.debug.setShipContact(true);

  const band = h.snapshot().ship.band;
  const id = poseEnemyBulletAbove(h, band, ABOVE_SHIP);

  const watch = await watchForEvent(
    h,
    (s) => findBullet(s, id) === null && s.lives === START_LIVES,
    FALL_FRAMES,
  );
  // Held on past the reading, so the still shows the hull the bullet came to
  // rather than the frame it vanished on. Nothing after this line can reach an
  // assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "absorb");

  assertEqual(
    watch.hit,
    true,
    `the ${band} bullet dropped ${String(ABOVE_SHIP)} units above the hull was ` +
      `absorbed — off the roster with all ${String(START_LIVES)} lives intact — ` +
      `inside the ${String(FALL_FRAMES)} frames its fall takes (specs/bands.md)`,
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.absorb),
    0,
    `times CUES.absorb played over the ${String(quietFrames(watch))} frames the ` +
      "bullet fell, on a field where nothing else is happening — a cue is played " +
      "on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.absorb),
    1,
    "times CUES.absorb played on the frame the hull absorbed the bullet, which " +
      "is its own frame and at most once on it (specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.absorb),
    0,
    "the gain the bus announced the absorb cue at, nothing here having muted " +
      "it — each of the nine is a distinct short sound a player hears " +
      "(specs/ui.md)",
  );
});
