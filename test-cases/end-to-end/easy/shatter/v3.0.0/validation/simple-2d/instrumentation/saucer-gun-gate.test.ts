// instrumentation/saucer-gun-gate — `setSaucerGun(false)` shuts the saucer's
// firing, so nothing joins the enemy-bullet roster; with its gun on, several shots
// do.
//
// WHAT THE GATE COVERS. `specs/instrumentation.md`: it "Gates the saucer's firing
// alone: the aimed shot it takes every `SAUCER_FIRE_INTERVAL`. Off, it fires
// nothing; it still steers and still travels." So the reading is the enemy-bullet
// roster and nothing else — where the saucer went and what it decided are the other
// two faculty items'.
//
// THE SAUCER IS HELD STILL AND ITS MIND SHUT, SO THE GUN IS THE ONLY FACULTY
// RUNNING. `specs/instrumentation.md` is explicit that a held saucer "still rerolls
// its weave and still fires", so shutting travel takes nothing away from the gun;
// what it takes away is a crossing that would carry the craft across the field
// while the roster is being counted, and a weave that would change the bearing of
// every shot. The pose is therefore the requirement and nothing else: one saucer,
// standing still, with a gun.
//
// SHOTS ARE COUNTED AS THEY ARRIVE, NOT AT THE END. `specs/saucer.md` gives a
// saucer bullet `SAUCER_BULLET_LIFE` (1.4 seconds) and `specs/collision.md` has the
// core absorb one that reaches it, so of four shots fired over four fire intervals
// at most one is still in flight when the last is taken. A count read at the end of
// the window would therefore report one shot for four. The sweep instead reads the
// roster every tick and counts an id that was not there the tick before, which
// makes it a count of ARRIVALS and immune both to a bullet expiring and to a build
// that reuses the id of a bullet no longer live.
//
// AND THE OFF LEG IS READ EVERY TICK FOR THE SAME REASON: a shot fired and expired
// between two samples is a shot the gate did not stop, and a reading taken only at
// the end would miss it.
//
// THREE OF THE FOUR, NOT FOUR. `specs/saucer.md` fires "every
// `SAUCER_FIRE_INTERVAL` on the field" and `addSaucer` starts the fire clock at one
// full interval, so the fourth shot of four intervals falls on the closing tick of
// the window. Requiring three keeps the item about the GATE — several shots against
// none — and leaves the cadence itself to `saucer/fires-every-1p6s`.

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_FIRE_INTERVAL } from "../constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the saucer stands: the upper left, well clear of the star and the ship. */
const SAUCER_PLACE = { x: 200, y: 160 } as const;

/** How long each leg watches, in ticks: the four fire intervals the item names. */
const INTERVALS = 4;
const SWEEP_FRAMES = ticksFor(INTERVALS * SAUCER_FIRE_INTERVAL);

/**
 * The shots the ON leg must have taken over the window.
 *
 * Three of the four intervals' worth. `specs/saucer.md` fires one shot per
 * `SAUCER_FIRE_INTERVAL` and `addSaucer` opens the fire clock at a full interval,
 * so the fourth shot lands on the window's closing tick; asking for three leaves
 * that boundary to the item that decides the cadence and keeps this one about the
 * difference between several shots and none.
 */
const SHOTS_WANTED = INTERVALS - 1;

let h: Harness;

/** What one window saw: how many shots arrived, and the most ever in flight. */
interface Window {
  arrivals: number;
  mostInFlight: number;
}

/**
 * Stand a saucer still with its mind shut and its gun set, and count the shots
 * that join the enemy-bullet roster over four fire intervals.
 */
async function watchTheGun(gun: boolean): Promise<Window> {
  startPlaying(h);
  poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y);
  h.debug.setSaucerMind(false);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerGun(gun);

  let live = new Set<number>();
  let arrivals = 0;
  let mostInFlight = 0;
  for (let tick = 0; tick < SWEEP_FRAMES; tick += 1) {
    await h.advance(1);
    const now = new Set(h.snapshot().enemyBullets.map((bullet) => bullet.id));
    for (const id of now) if (!live.has(id)) arrivals += 1;
    mostInFlight = Math.max(mostInFlight, now.size);
    live = now;
  }
  return { arrivals, mostInFlight };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires nothing with the gun off, and several shots with it on", async () => {
  // ---- The gun shut -------------------------------------------------------
  const silent = await watchTheGun(false);
  captureStill(h, "silent");
  assertEqual(
    silent.arrivals,
    0,
    `the saucer bullets a saucer with setSaucerGun(false) put up over ` +
      `${INTERVALS} fire intervals`,
  );
  assertEqual(
    silent.mostInFlight,
    0,
    "the most saucer bullets in flight at once with setSaucerGun(false)",
  );

  // ---- And the same window with its gun on --------------------------------
  const firing = await watchTheGun(true);
  assertGreaterThanOrEqual(
    firing.arrivals,
    SHOTS_WANTED,
    `the saucer bullets a saucer with setSaucerGun(true) put up over ` +
      `${INTERVALS} fire intervals (specs/saucer.md: one every ` +
      `SAUCER_FIRE_INTERVAL on the field)`,
  );
});
