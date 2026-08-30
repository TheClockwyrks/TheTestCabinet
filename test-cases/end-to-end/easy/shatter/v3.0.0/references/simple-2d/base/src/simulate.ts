// Shatter — one tick, from the top (`specs/simulation.md`).
//
// The order below is the order `specs/simulation.md` fixes, and it is the whole
// of what the simulation is:
//
//   1. Control forces — the ship's facing and thrust, and the saucer's mind.
//   2. The gravity acceleration from the star, for every ballistic body.
//   3. Velocity — the accelerations of 1 and 2 over `TICK_DT`, then the ship's
//      drag and speed cap.
//   4. Position — each body by its velocity over `TICK_DT`.
//   5. The wrap.
//   6. Collision resolution.
//
// The clocks, the two guns and the two spawners run after that, so a round
// fired on a tick leaves with exactly its muzzle velocity and is first moved on
// the tick after — which is what a caller reading the snapshot the instant a
// shot went sees.
//
// Nothing here reads the renderer or the wall clock, so an interval of game
// time reaches the same state however it was divided into frames.

import { TICK_DT } from "./constants";
import { fireGun } from "./bullets";
import { resolveCollisions } from "./collision";
import { wrapX, wrapY } from "./field";
import { goTo, menuItems, startRun } from "./flow";
import { gravityAt } from "./gravity";
import { spinRocks } from "./rocks";
import {
  keepSaucerClearOfCore,
  runSaucerCadence,
  saucerGun,
  saucerLife,
  saucerMind,
} from "./saucer";
import { applyShipVelocity, shipControl } from "./ship";
import { countDown, type Sim, type TickEvents } from "./sim";
import { runWaveLoop } from "./waves";
import type { FrameInput } from "./input";

/** Step 2 and the ballistic half of step 3. */
function applyGravity(sim: Sim): void {
  for (const body of [...sim.bullets, ...sim.enemyBullets, ...sim.rocks]) {
    const [ax, ay] = gravityAt(body.x, body.y);
    body.vx += ax * TICK_DT;
    body.vy += ay * TICK_DT;
  }
}

/** Steps 4 and 5: every body by its velocity, then back onto the field. */
function advancePositions(sim: Sim): void {
  const bodies = [sim.ship, ...sim.bullets, ...sim.enemyBullets, ...sim.rocks];
  for (const body of bodies) {
    body.x = wrapX(body.x + body.vx * TICK_DT);
    body.y = wrapY(body.y + body.vy * TICK_DT);
  }

  // The saucer's locomotion is a faculty of its own, so a held saucer keeps
  // its velocity and its centre both.
  const saucer = sim.saucer;
  if (saucer !== null && saucer.travel) {
    saucer.x = wrapX(saucer.x + saucer.vx * TICK_DT);
    saucer.y = wrapY(saucer.y + saucer.vy * TICK_DT);
  }
}

/** Every clock the game keeps, counted down by the tick it runs in. */
function runClocks(sim: Sim): void {
  if (sim.ship.fireCooldown > 0) sim.ship.fireCooldown -= 1;

  sim.bullets = sim.bullets.filter((bullet) => {
    bullet.life = countDown(bullet.life, TICK_DT);
    return bullet.life > 0;
  });
  sim.enemyBullets = sim.enemyBullets.filter((bullet) => {
    bullet.life = countDown(bullet.life, TICK_DT);
    return bullet.life > 0;
  });

  sim.extraLifeNotice = countDown(sim.extraLifeNotice, TICK_DT);
  spinRocks(sim, TICK_DT);
}

/** Move the highlight, and take the entry `confirm` lands on. */
function stepMenu(sim: Sim, input: FrameInput): void {
  const items = menuItems(sim.screen);
  if (items !== null && items.length > 0) {
    if (input.menuUp) {
      sim.menuIndex = (sim.menuIndex - 1 + items.length) % items.length;
    }
    if (input.menuDown) {
      sim.menuIndex = (sim.menuIndex + 1) % items.length;
    }
    if (input.confirm) {
      confirmMenuItem(sim);
      return;
    }
  }
  if (input.back || input.pause) leaveScreen(sim);
}

/** Take the highlighted entry of whatever menu the current screen shows. */
function confirmMenuItem(sim: Sim): void {
  switch (sim.screen) {
    case "title":
      if (sim.menuIndex === 0) startRun(sim);
      else goTo(sim, "howto");
      return;
    case "paused":
      if (sim.menuIndex === 0) resume(sim);
      else if (sim.menuIndex === 1) startRun(sim);
      else goTo(sim, "title");
      return;
    case "gameover":
      if (sim.menuIndex === 0) startRun(sim);
      else goTo(sim, "title");
      return;
    default:
      return;
  }
}

/** Return to the field exactly as it stood when it was paused. */
function resume(sim: Sim): void {
  sim.screen = "playing";
  sim.menuIndex = 0;
}

/** What leaving a screen does on each screen that answers to it. */
function leaveScreen(sim: Sim): void {
  switch (sim.screen) {
    case "howto":
    case "gameover":
      goTo(sim, "title");
      return;
    case "paused":
      resume(sim);
      return;
    default:
      return;
  }
}

/** One tick of live play, in the order `specs/simulation.md` fixes. */
function stepPlaying(sim: Sim, input: FrameInput, ev: TickEvents): void {
  if (input.pause || input.back) {
    goTo(sim, "paused");
    return;
  }

  // The respawn grace is counted down before anything can touch the ship, so
  // lethal contact resumes on the tick it reaches zero rather than the one
  // after, and a grace opened by a loss this tick is not spent on that tick.
  sim.ship.invuln = countDown(sim.ship.invuln, TICK_DT);

  const thrust = shipControl(sim, input);
  saucerMind(sim);

  applyGravity(sim);
  applyShipVelocity(sim, thrust);

  advancePositions(sim);
  keepSaucerClearOfCore(sim);

  resolveCollisions(sim, ev);

  runClocks(sim);
  fireGun(sim, input, ev);
  saucerGun(sim);
  saucerLife(sim);
  runSaucerCadence(sim, ev);
  runWaveLoop(sim, ev);
}

/**
 * One whole tick of the game, whatever screen it is on.
 *
 * `simTime` advances on every tick, on every screen: it counts the ticks the
 * game ran rather than the play it ran, which is why a paused game's reading
 * keeps rising while nothing on the field moves.
 */
export function stepTick(sim: Sim, input: FrameInput, ev: TickEvents): void {
  sim.simTime += TICK_DT;

  switch (sim.screen) {
    case "playing":
      stepPlaying(sim, input, ev);
      return;
    case "paused":
    case "title":
    case "howto":
    case "gameover":
      stepMenu(sim, input);
      return;
  }
}
