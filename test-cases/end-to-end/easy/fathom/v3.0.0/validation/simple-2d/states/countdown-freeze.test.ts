// states/countdown-freeze — nothing but the light advances during the countdown.
//
// specs/ui.md fixes what advances on `"countdown"`: "The countdown's own
// remaining time, and the light the forager casts on the maze around it. The
// forager, the predators, the drifters, the cooldowns, the sonar wavefronts and
// the ink clouds all hold still."
//
// THE FREEZE IS MADE A REAL READING, not a trivially true one. A dive that has
// only just opened carries two ready cooldowns, no drifter, no wavefront and no
// cloud, so comparing those as they stand would compare nothing against nothing.
// So the board is arranged first with one of each thing that sentence names,
// every one of them put there through an operation specs/instrumentation.md gives
// or through the game's own controls:
//
//   * a hunter loose across the board, with its mind running, which patrols;
//   * a bonus drifter along the forager's own corridor, with its wander running;
//   * a sonar wavefront in flight, whose `front` a running simulation advances;
//   * an ink cloud standing, whose `remaining` a running simulation runs down;
//   * two cooldowns plainly mid-run, spent by the two abilities that made those;
//   * a movement key held for the whole countdown, which travels the forager.
//
// On a build that keeps simulating, every one of those moves inside the hold; on
// a conforming one none of them does.
//
// AND THE LIGHT REALLY DOES GO ON REVEALING, which is the other half of the
// sentence and the half a build that simply stopped ticking would fail. The fog
// is put back to unrevealed after the countdown is posed, and the tile the
// forager stands on is read again a moment later: a build whose light kept
// working has revealed it, and a build that froze the whole screen has not.
//
// THE READING IS TAKEN FROM THE LAST COUNTDOWN TICK, never from the first tick of
// live play: on the tick play resumes the game is entitled to move everything at
// once, and that tick is `"playing"`'s business rather than this point's.
//
// THE CLIP BRACKETS THE FIRST STRETCH OF THE HOLD rather than all of it. What a
// reviewer needs to see is a board that does not move while the countdown runs,
// and a second of it says that as well as three do; the rest of the watch runs
// outside the recorder, so the recording stays well inside the frames a written
// one holds.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan } from "../assert";
import { BINDINGS, HOLD_MAX, TICK_HZ } from "../constants";
import { poseApart, spawnDrifter, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { visibilityAt } from "../maze";
import { ticks } from "../harness";
import { MOVE_KEY, watchScreen } from "./screens";

/** The key specs/movement.md binds `a` to, which emits the sonar pulse. */
const SONAR_KEY = BINDINGS.a[0];

/** The key specs/movement.md binds `b` to, which releases the ink cloud. */
const INK_KEY = BINDINGS.b[0];

/** How far the hunter's own ring stands from the forager's corridor, in tiles. */
const APART_TILES = 12;

/** How many tiles of corridor that ring holds. */
const RING_TILES = 4;

/**
 * How much corridor the forager's own room holds, in tiles.
 *
 * Long enough for a wavefront cast in it to have somewhere to travel, and for the
 * held movement key to carry a still-simulating forager several tiles down it.
 */
const ROOM_TILES = 12;

/** How far along that room the drifter is spawned, in tiles from the forager. */
const DRIFTER_OFFSET = 4;

/**
 * The ceiling on the watch, in ticks.
 *
 * specs/ui.md gives the countdown at most `HOLD_MAX` (`3 s`), so a build whose
 * countdown never gives way fails on the bound rather than running until the
 * suite times out.
 */
const MAX_HOLD_TICKS = ticks(HOLD_MAX) + 2;

/** Ticks between putting the fog back and reading the light's work, at 120 Hz. */
const RELIGHT_TICKS = 12;

/** How much of the hold the clip brackets, in ticks: one second of it. */
const CLIP_TICKS = TICK_HZ;

/** Where each body stood, as one comparable string. */
function places(bodies: readonly { x: number; y: number }[]): string {
  return bodies.map((one) => `${String(one.x)},${String(one.y)}`).join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds every body, cooldown, wavefront and cloud still under the countdown", async () => {
  await startPlaying(h);
  // The forager's corridor and, across solid rock, a ring for one hunter to
  // patrol. The pose empties the board, so the only creatures on it are the two
  // this check watches hold still.
  const rooms = await poseApart(h, APART_TILES, {
    ring: RING_TILES,
    near: ROOM_TILES,
  });
  await spawnPredator(h, "gloamfin", rooms.far, { state: "wander" });
  await spawnDrifter(h, {
    tx: rooms.near.tx + DRIFTER_OFFSET,
    ty: rooms.near.ty,
  });

  // A wavefront and a cloud, made by the game's own abilities so both are in
  // flight exactly as play leaves them, and two cooldowns plainly mid-run.
  await h.tap(SONAR_KEY);
  await h.tap(INK_KEY);
  const armed = h.snapshot();
  assertGreaterThan(
    armed.pulses.length,
    0,
    "a wavefront in flight before the countdown, so the freeze is read of one",
  );
  assertGreaterThan(
    armed.inkClouds.length,
    0,
    "an ink cloud standing before the countdown, so the freeze is read of one",
  );

  h.debug.setScreen("countdown");
  const before = h.snapshot();
  assertEqual(before.screen, "countdown", "the screen the freeze is read on");

  const relit = await captureReplay(h, "held", async () => {
    // The fog goes back to unrevealed under the countdown, so what the light
    // does from there is the light's own work rather than what play left behind.
    h.debug.clearFog();
    await h.advance(RELIGHT_TICKS);
    const lit = h.snapshot();
    // A movement key held through the clip: on a build that keeps simulating the
    // forager travels, on a conforming one it cannot.
    h.hold(MOVE_KEY);
    await h.advance(CLIP_TICKS);
    h.release(MOVE_KEY);
    return lit;
  });

  const watch = await watchScreen(h, "countdown", MAX_HOLD_TICKS, MOVE_KEY);
  assertEqual(
    watch.hit,
    true,
    `the countdown gives way inside ${String(HOLD_MAX)} s (specs/ui.md)`,
  );
  const after = watch.last;

  // The ticks really ran, so nothing below is vacuous.
  assertGreaterThan(
    after.simTime - before.simTime,
    0,
    "simulated seconds accumulated while the countdown ran, which every tick " +
      "adds to whatever the screen (specs/state.md)",
  );

  assertEqual(
    places([after.forager]),
    places([before.forager]),
    "where the forager stood across the countdown with a movement key held, " +
      "which holds it still (specs/ui.md)",
  );
  assertEqual(
    places(after.predators),
    places(before.predators),
    "where the predators stood across the countdown (specs/ui.md)",
  );
  assertEqual(
    places(after.drifters),
    places(before.drifters),
    "where the drifters stood across the countdown (specs/ui.md)",
  );
  assertEqual(
    after.sonar.cooldown,
    before.sonar.cooldown,
    "the sonar cooldown across the countdown (specs/ui.md)",
  );
  assertEqual(
    after.ink.cooldown,
    before.ink.cooldown,
    "the ink cooldown across the countdown (specs/ui.md)",
  );
  assertEqual(
    after.pulses.map((pulse) => pulse.front).join(" "),
    before.pulses.map((pulse) => pulse.front).join(" "),
    "how far each wavefront had traveled across the countdown (specs/ui.md)",
  );
  assertEqual(
    after.inkClouds.map((cloud) => cloud.remaining).join(" "),
    before.inkClouds.map((cloud) => cloud.remaining).join(" "),
    "the life left in each ink cloud across the countdown (specs/ui.md)",
  );

  // And the one thing that does advance.
  assertEqual(
    visibilityAt(relit, { tx: relit.forager.tx, ty: relit.forager.ty }),
    "l",
    "the visibility of the tile the forager stands on, a moment after the fog " +
      "was put back under the countdown — the light the forager casts on the " +
      "maze around it is what goes on advancing there (specs/ui.md)",
  );
});
