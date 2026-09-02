// instrumentation/reset-restores-title — after a run has been posed with a
// score, lives, a wave, rocks, bullets and a saucer, `reset()` restores every
// declared field to the title value the specification lists, and leaves `muted`
// alone.
//
// THE RULE, quoted from `specs/instrumentation.md`: "`reset` restores `screen`
// to `"title"`, `menuIndex` to `0`, `score` to `0`, `lives` to `START_LIVES`
// (`3`), `wave` to `0`, and `waveBanner` to `0`. It empties the rock, bullet,
// and saucer-bullet rosters and removes the saucer. It places the ship at the
// safe point `(SAFE_X, SAFE_Y)` = `(640, 560)` at rest facing `FACE_UP`, with
// `invuln` `0`, `fireCooldown` `0`, and its contact gate on. It turns the two
// world gates `waveSpawning` and `saucerSpawning` back on, returns the saucer's
// arrival clock to the start of a game's cadence, and sets `simTime` to `0`."
// And: "`muted` is left exactly as it stands; muting is the runtime's."
//
// EVERYTHING IS DIRTIED FIRST, AND DIRTIED AWAY FROM THE TITLE VALUE. A field
// posed to the value `reset` would restore says nothing, so every one below is
// posed somewhere else: the screen is `gameover`, the highlight is off the first
// entry, all three gates are OFF, and the ship is somewhere other than the safe
// point, moving, facing something other than `FACE_UP`, inside its grace and
// with its gun gated. A second of game time runs first, so `simTime` has
// something to be restored FROM.
//
// MUTE IS REACHED THE WAY A PLAYER REACHES IT — through the `mute` action
// (`specs/controls.md`) — because there is no `setMuted` on the surface under
// any engine. It is the one field the reset must leave standing.
//
// THE READING IS TAKEN AT THE CALL, with no frame between: a pose acts on the
// live game the moment it is made, so `simTime` is read as the `0` the reset put
// there rather than as the `0` plus whatever a landing frame added.
//
// The saucer's arrival clock is the one restored field the snapshot does not
// report (`specs/state.md` keeps `saucerClock` and `saucerDue` off the shape),
// so it is not read here; what a game's cadence does from its start is
// `saucer/first-arrives-at-18s`.

import { afterEach, beforeEach, it } from "vitest";
import { FACE_UP, SAFE_X, SAFE_Y, START_LIVES } from "../constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  tapAction,
  ticksFor,
  torpedoesOf,
  type Harness,
} from "../harness";
import { posePopulatedField } from "./scene";

/** The seconds of game time run before the reset, so `simTime` is non-zero. */
const DIRTY_SECONDS = 1;

/** The values every declared field is posed to, none of them a title value. */
const DIRTY = {
  screen: "gameover",
  menuIndex: 1,
  score: 4321,
  lives: 1,
  wave: 9,
  waveBanner: 0.9,
  shipX: 100,
  shipY: 100,
  shipVx: 50,
  shipVy: -50,
  shipAngle: 2,
  invuln: 2,
  fireCooldown: 11,
} as const;

/**
 * How closely a restored figure must equal the value the specification names,
 * in decimal places. A restored field is assigned rather than computed, so six
 * places is a double's own precision and nothing looser.
 */
const RESTORED_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("restores every declared field to its title value and leaves muted alone", async () => {
  // A field carrying one of everything, run for a second so time accumulates.
  posePopulatedField(h);
  await h.advance(ticksFor(DIRTY_SECONDS));

  // Muting, through the action a player uses. The runtime owns the bit.
  await tapAction(h, "mute");
  const muted = h.snapshot().muted;
  assertEqual(muted, true, "the mute action mutes before the reset");

  // Every other declared field, posed away from the value reset restores.
  h.debug.setScreen(DIRTY.screen);
  h.debug.setMenuIndex(DIRTY.menuIndex);
  h.debug.setScore(DIRTY.score);
  h.debug.setLives(DIRTY.lives);
  h.debug.setWave(DIRTY.wave);
  h.debug.setWaveBanner(DIRTY.waveBanner);
  h.debug.setShipPosition(DIRTY.shipX, DIRTY.shipY);
  h.debug.setShipVelocity(DIRTY.shipVx, DIRTY.shipVy);
  h.debug.setShipAngle(DIRTY.shipAngle);
  h.debug.setShipInvuln(DIRTY.invuln);
  h.debug.setFireCooldown(DIRTY.fireCooldown);
  h.debug.setShipCollision(false);
  h.debug.setWaveSpawning(false);
  h.debug.setSaucerSpawning(false);

  const before = h.snapshot();
  assertGreaterThan(before.simTime, 0, "simTime accumulated before the reset");
  assertGreaterThan(before.rocks.length, 0, "rocks stood before the reset");
  assertGreaterThan(before.bullets.length, 0, "bullets stood before the reset");
  assertGreaterThan(
    before.enemyBullets.length,
    0,
    "saucer bullets stood before the reset",
  );

  // The reset under test, read with nothing advanced since.
  h.debug.reset();
  const after = h.snapshot();

  // The screen and the run.
  assertEqual(after.screen, "title", "screen restored to title");
  assertEqual(after.menuIndex, 0, "menuIndex restored to 0");
  assertEqual(after.score, 0, "score restored to 0");
  assertEqual(after.lives, START_LIVES, "lives restored to START_LIVES");
  assertEqual(after.wave, 0, "wave restored to 0");
  assertEqual(after.waveBanner, 0, "waveBanner restored to 0");

  // The field: every roster emptied and the saucer removed.
  assertLength(after.rocks, 0, "the rock roster emptied");
  assertLength(after.bullets, 0, "the bullet roster emptied");
  assertLength(after.enemyBullets, 0, "the saucer-bullet roster emptied");
  assertNull(after.saucer, "the saucer removed");

  // The ship, at the safe point at rest facing FACE_UP, with its grace and its
  // gun gate clear and its contact test back on.
  assertEqual(after.ship.x, SAFE_X, "the ship placed at SAFE_X");
  assertEqual(after.ship.y, SAFE_Y, "the ship placed at SAFE_Y");
  assertEqual(after.ship.vx, 0, "the ship at rest: vx");
  assertEqual(after.ship.vy, 0, "the ship at rest: vy");
  assertCloseTo(
    after.ship.angle,
    FACE_UP,
    RESTORED_DIGITS,
    "the ship facing FACE_UP",
  );
  assertEqual(after.ship.invuln, 0, "invuln restored to 0");
  assertEqual(after.ship.fireCooldown, 0, "fireCooldown restored to 0");
  assertEqual(after.ship.collision, true, "the ship's contact gate back on");

  // The two world gates, back on.
  assertEqual(after.waveSpawning, true, "waveSpawning back on");
  assertEqual(after.saucerSpawning, true, "saucerSpawning back on");

  // The clock, back to zero.
  assertEqual(after.simTime, 0, "simTime restored to 0");

  // Muting is the runtime's, and reset leaves it exactly as it stands.
  assertEqual(after.muted, muted, "reset leaves muted untouched");

  // The variant's two restored fields, required of a surface that carries the
  // torpedo operations: "It empties the torpedo roster and sets torpedoCharge
  // to 1" (specs/instrumentation.md, under `warhead`).
  if (typeof h.debug.addTorpedo === "function") {
    assertLength(torpedoesOf(after), 0, "the torpedo roster emptied");
    assertEqual(after.torpedoCharge, 1, "torpedoCharge restored to 1");
  }

  // The title screen the reset restored.
  await h.advance(1);
  captureStill(h, "reset");
});
