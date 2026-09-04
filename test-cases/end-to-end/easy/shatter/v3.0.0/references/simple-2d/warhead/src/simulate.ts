// Shatter — one frame, and the tick it is made of (`specs/simulation.md`).
//
// The engine hands the game the real elapsed seconds of a frame and imposes no
// timestep of its own. Shatter's own is TICK_HZ, so a frame's delta is
// accumulated in the state and whole ticks are run while the accumulator holds
// one, with the remainder carried into the next frame. A frame worth less than a
// tick therefore advances nothing at all, which is what makes `advance(n)` under
// a constant clock worth exactly `n` ticks.
//
// Press EDGES belong to the frame rather than to the tick: a frame worth three
// ticks acts on its presses once, on the first of them, while the holds apply to
// every tick. Nothing else about a frame is visible to the simulation.
//
// THE ORDER INSIDE A TICK is `specs/simulation.md`'s, and it is a requirement
// rather than an implementation detail, because the positions and speeds the
// game is graded on rest on it: control forces, then the gravity acceleration,
// then velocity, then position, then the wrap, then collision resolution. What
// follows collision — the wave loop, the saucer's cadence, and the two weapons
// leaving the ship — is the game's own bookkeeping, and firing sits at the end so
// a round is first seen at the nose it left rather than a tick's travel beyond.

import { TICK_DT, TRAIL_TICKS } from "./constants";
import { resolveCollisions } from "./collide";
import { spinRate } from "./rocks";
import { gravityAt, wrapX, wrapY } from "./geometry";
import { handleScreens } from "./flow";
import { controlShip, fireGun, integrateShip } from "./ship";
import { ageSaucer, fireSaucer, runSaucerCadence, steerSaucer } from "./saucer";
import { guideTorpedoes, launchTorpedo, rechargeTorpedo } from "./weapons";
import { runWaveLoop } from "./waves";
import type { FrameEvents, Moves, MutTrail, Sim } from "./sim";
import type { FrameInput } from "./input";

/**
 * The most ticks one frame may run.
 *
 * A bound rather than a rule: it keeps a tab that stopped receiving frames from
 * trying to catch up with thousands of ticks at once. No scripted run reaches
 * it, since a validator's constant clock delivers exactly one tick per frame.
 */
const MAX_TICKS_PER_FRAME = 600;

/** The same frame's input with its press edges spent. */
function holdsOnly(input: FrameInput): FrameInput {
  return {
    turn: input.turn,
    thrust: input.thrust,
    fire: input.fire,
    torpedo: false,
    menuUp: false,
    menuDown: false,
    confirm: false,
    back: false,
    pause: false,
    mute: false,
  };
}

/** Give every live bullet a trail, and drop the trails of bullets that are gone. */
function reconcileTrails(sim: Sim): void {
  const live = new Set(sim.bullets.map((bullet) => bullet.id));
  sim.trails = sim.trails.filter((trail) => live.has(trail.id));

  const held = new Set(sim.trails.map((trail) => trail.id));
  for (const bullet of sim.bullets) {
    if (!held.has(bullet.id)) sim.trails.push({ id: bullet.id, points: [] });
  }
}

/**
 * Record a tick of a bullet's travel on its trail.
 *
 * The points are offsets from where the bullet is NOW, so the whole tail moves
 * with its bullet and a wrap carries it along rather than smearing it back
 * across the field.
 */
function extendTrail(trail: MutTrail, mx: number, my: number): void {
  for (const point of trail.points) {
    point.dx -= mx;
    point.dy -= my;
  }
  trail.points.push({ dx: -mx, dy: -my });
  if (trail.points.length > TRAIL_TICKS) {
    trail.points.splice(0, trail.points.length - TRAIL_TICKS);
  }
}

/** Count every timer down by one tick, and remove what has run out. */
function advanceTimers(sim: Sim): void {
  const ship = sim.ship;
  if (ship.invuln > 0) {
    ship.invuln = Math.max(0, ship.invuln - TICK_DT);
    if (ship.invuln < 1e-9) ship.invuln = 0;
  }
  if (ship.fireCooldown > 0) ship.fireCooldown -= 1;

  for (const bullet of sim.bullets) bullet.life -= TICK_DT;
  sim.bullets = sim.bullets.filter((bullet) => bullet.life > 0);

  for (const bullet of sim.enemyBullets) bullet.life -= TICK_DT;
  sim.enemyBullets = sim.enemyBullets.filter((bullet) => bullet.life > 0);

  for (const torpedo of sim.torpedoes) torpedo.life -= TICK_DT;
  sim.torpedoes = sim.torpedoes.filter((torpedo) => torpedo.life > 0);

  for (const rock of sim.rocks) {
    if (rock.flash > 0) rock.flash = Math.max(0, rock.flash - TICK_DT);
    // The drawn rotation is cosmetic: it turns and it changes nothing else, so
    // a rock under no force but the well travels exactly where the well and its
    // own momentum take it.
    rock.spin += spinRate(rock.id) * TICK_DT;
  }

  if (sim.extraLifeFlash > 0) {
    sim.extraLifeFlash = Math.max(0, sim.extraLifeFlash - TICK_DT);
  }

  rechargeTorpedo(sim);
  ageSaucer(sim);
}

/** The position step and the wrap, recording what each body's travel came to. */
function moveEverything(sim: Sim): Moves {
  const byId = new Map<number, { mx: number; my: number }>();

  const ship = sim.ship;
  const shipMove = { mx: ship.vx * TICK_DT, my: ship.vy * TICK_DT };
  ship.x = wrapX(ship.x + shipMove.mx);
  ship.y = wrapY(ship.y + shipMove.my);

  for (const bullet of sim.bullets) {
    const mx = bullet.vx * TICK_DT;
    const my = bullet.vy * TICK_DT;
    bullet.x = wrapX(bullet.x + mx);
    bullet.y = wrapY(bullet.y + my);
    byId.set(bullet.id, { mx, my });

    const trail = sim.trails.find((entry) => entry.id === bullet.id);
    if (trail !== undefined) extendTrail(trail, mx, my);
  }

  for (const roster of [sim.enemyBullets, sim.rocks, sim.torpedoes]) {
    for (const body of roster) {
      const mx = body.vx * TICK_DT;
      const my = body.vy * TICK_DT;
      body.x = wrapX(body.x + mx);
      body.y = wrapY(body.y + my);
      byId.set(body.id, { mx, my });
    }
  }

  let saucerMove = { mx: 0, my: 0 };
  const saucer = sim.saucer;
  if (saucer !== null && saucer.travel) {
    saucerMove = { mx: saucer.vx * TICK_DT, my: saucer.vy * TICK_DT };
    saucer.x = wrapX(saucer.x + saucerMove.mx);
    saucer.y = wrapY(saucer.y + saucerMove.my);
  }

  return { ship: shipMove, saucer: saucerMove, byId };
}

/** One whole simulation tick, in the order `specs/simulation.md` fixes. */
export function tick(sim: Sim, input: FrameInput, events: FrameEvents): void {
  // Accumulated simulation time counts the ticks the game ran, whatever the
  // screen, so a paused game's clock goes on rising while its play does not.
  sim.simTime += TICK_DT;

  reconcileTrails(sim);
  handleScreens(sim, input);
  if (sim.screen === "paused") {
    events.thrusting = false;
    return;
  }

  const playing = sim.screen === "playing";

  // 1. Control forces.
  let ax = 0;
  let ay = 0;
  if (playing) {
    [ax, ay] = controlShip(sim, input);
  } else {
    sim.ship.thrusting = false;
  }
  events.thrusting = sim.ship.thrusting;
  steerSaucer(sim);
  guideTorpedoes(sim);

  advanceTimers(sim);

  // 2 and 3. The well's acceleration, then the velocity step. The ship, the
  // saucer and the torpedo are powered craft the well never touches.
  integrateShip(sim, ax, ay);
  for (const roster of [sim.bullets, sim.enemyBullets, sim.rocks]) {
    for (const body of roster) {
      const [gx, gy] = gravityAt(body.x, body.y);
      body.vx += gx * TICK_DT;
      body.vy += gy * TICK_DT;
    }
  }

  // 4 and 5. Position, and the wrap.
  const moves = moveEverything(sim);

  // 6. Collision resolution.
  resolveCollisions(sim, moves, events);

  // The tick's remaining bookkeeping.
  if (playing) runWaveLoop(sim, events);
  if (playing) runSaucerCadence(sim, events);
  fireSaucer(sim);
  if (playing) {
    fireGun(sim, input, events);
    launchTorpedo(sim, input);
  }
}

/** Advance the game by one frame's worth of real elapsed seconds. */
export function stepFrame(
  sim: Sim,
  input: FrameInput,
  dt: number,
  events: FrameEvents,
): void {
  if (!Number.isFinite(dt) || dt <= 0) return;

  sim.tickClock += dt;

  let frameInput = input;
  let ran = 0;
  while (sim.tickClock >= TICK_DT && ran < MAX_TICKS_PER_FRAME) {
    sim.tickClock -= TICK_DT;
    tick(sim, frameInput, events);
    frameInput = holdsOnly(frameInput);
    ran += 1;
  }

  if (ran === MAX_TICKS_PER_FRAME) sim.tickClock = 0;
}
