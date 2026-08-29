// flarefish/flare-lock — a burning bloom locks onto a forager anywhere inside
// `FLARE_RADIUS`, through rock, and ends the moment it does; a forager just past
// that radius is not locked onto.
//
// `specs/predators/flarefish.md`: "On any step of the bloom where the distance
// between the two centers is at most `FLARE_RADIUS`, and neither the forager nor
// the line between them lies in ink and the Flarefish stands in none, the
// Flarefish takes a fix on the forager's current tile, fires the detection alert,
// and chases from that moment. The bloom ends at once when it locks on. The lock
// holds across the whole bloom rather than at its opening instant."
//
// ROCK IS THE POINT. The two corridors this poses are parallel with four rows of
// solid rock between them and no way from one to the other, so the ordinary
// light-sense — which `specs/predators/flarefish.md` gives a line-of-sight
// condition — cannot possibly hold, and neither can a chase reach the forager. A
// fix taken across that rock is the bloom's and nothing else's.
//
// BOTH DIRECTIONS, ON THE SAME BOARD AND THE SAME BLOOM MECHANISM. The negative
// leg stands the forager past the radius during one bloom and the positive leg
// stands it inside the radius during the next, so a build with no distance test
// fails the first and a build that never locks fails the second.
//
// THE NEGATIVE LEG IS JUDGED STEP BY STEP RATHER THAN OVER A GUESSED WINDOW. The
// disc moves with the Flarefish and the Flarefish is patrolling, so the separation
// changes underneath any fixed window. Each step is therefore read on its own: the
// leg counts only the steps on which the bloom was burning AND the pair stood past
// `FLARE_RADIUS`, and asks that no fix was taken on any of them. A build whose
// hunter drifts into range simply ends the leg early with fewer steps behind it,
// and the check says so rather than reporting a lock it invited.
//
// THE FORAGER WAITS IN A THIRD, SEALED POCKET between the legs, seven tiles below
// the patrol — past `FLARE_RADIUS` from every tile of it — so the bloom the leg is
// about is the first one that can reach it, rather than one that locked on while
// the scenario was still waiting.
//
// WHAT THIS DOES NOT DECIDE. What the bloom LIGHTS, which is
// `flarefish/flare-reveals`'s; and the cadence the blooms arrive on, which is
// `flarefish/flare-cadence`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { FLARE_RADIUS, TILE } from "../constants";
import { poseMaze, predatorIndex } from "../fixtures";
import {
  captureReplay,
  createHarness,
  ticks,
  type FathomSnapshot,
  type Harness,
} from "../harness";
import {
  denAllExcept,
  parkForager,
  requirePosedGround,
  requireSceneHeld,
  sceneGuard,
  startPlaying,
} from "../scene";
import {
  BLOOM_MAX,
  CHARGE_MAX,
  FIRST_FLARE_MAX,
  FLARE_POLL,
  NEXT_FLARE_MAX,
} from "./room";
import type { TileRef } from "../maze";

/**
 * The board: two parallel corridors with a solid band of rock between them and no
 * way from one to the other, and a third sealed pocket well below both.
 *
 * `F` is the corridor the forager is posed into during a bloom, `P` the corridor
 * the Flarefish patrols, and `W` the pocket the forager waits in between the legs.
 * A posed fixture is exempt from `specs/maze.md`'s connectedness
 * (`specs/instrumentation.md`), which is what lets three rooms with no route
 * between them stand as the whole maze.
 */
const ART = [
  "F" + ".".repeat(13),
  "",
  "",
  "",
  "",
  "P" + ".".repeat(13),
  "",
  "",
  "",
  "",
  "",
  "",
  "W..",
] as const;

/**
 * How far the forager's corridor sits above the patrol, in tiles.
 *
 * Five tiles is `160` units, inside `FLARE_RADIUS` (`192`) with four rows of solid
 * rock between — the whole shape of the claim in one number.
 */
const ROWS_APART = 5;

/**
 * How far along its corridor the forager stands for the negative leg, in tiles.
 *
 * Five tiles across the five it stands above the patrol is `sqrt(50)` tiles,
 * `226` units: past `FLARE_RADIUS` with a tile and a bit to spare, so the leg is
 * about a forager JUST outside the disc rather than one across the board from it.
 */
const OFFSET_TILES = 5;

/**
 * How many steps of a burning bloom the negative leg must see the pair stand past
 * the radius for, before it will say anything.
 *
 * The lock is evaluated on every step of the bloom, so each step is a fresh
 * chance for a build with no distance test. Six is a twentieth of a second of
 * them; the leg takes up to {@link NEGATIVE_TICKS} looking for them.
 */
const NEGATIVE_MIN_STEPS = 6;

/** How long the negative leg watches, in ticks. */
const NEGATIVE_TICKS = 24;

/**
 * How long the positive leg gives the bloom to lock on, in ticks.
 *
 * A fifth of a second, of a `FLARE_BLOOM` (`1 s`) burn. The lock is evaluated on
 * every step of the bloom, so a conforming build takes it on the next one.
 */
const LOCK_TICKS = 24;

/** Ticks of the chase it opens held after the reading, for the clip. */
const TAIL_TICKS = 60;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("locks onto a forager inside FLARE_RADIUS through rock and ends the bloom, and locks onto none just beyond it", async () => {
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const lane = board.mark("F");
  const patrol = board.mark("P");
  const pocket = board.mark("W");
  await parkForager(h, pocket);
  await h.debug.clearPlankton();
  await h.debug.setBrightness(0);

  const opening = await h.snapshot();
  const index = predatorIndex(opening, "flarefish");
  if (index === null) {
    h.unmet(
      "the roster carries no Flarefish, so there is no bloom to lock with — " +
        "what the roster holds is the progression checks' verdict, not this one's",
    );
  }
  const quiet = await denAllExcept(h, [index]);
  await h.debug.setPredatorTile(index, patrol.tx, patrol.ty);
  await h.debug.setPredatorDir(index, "right");
  await h.debug.setPredatorState(index, "wander");
  // The forager is moved between the legs, so the guard watches everything about
  // the scene except where it stands.
  const guard = await sceneGuard(h, quiet, { foragerParked: false });

  const blooming = (snap: FathomSnapshot): boolean =>
    snap.predators[index].flaring === true;
  const apart = (snap: FathomSnapshot): number => {
    const fish = snap.predators[index];
    return Math.hypot(fish.x - snap.forager.x, fish.y - snap.forager.y);
  };
  /** A tile of the forager's corridor `across` tiles from the Flarefish's column. */
  const lanePlace = (fishColumn: number, across: number): TileRef => {
    const right = fishColumn + across;
    const tx =
      right <= patrol.tx + ART[0].length - 1 ? right : fishColumn - across;
    return { tx, ty: lane.ty };
  };

  // --- The negative leg: a bloom with the forager just past the radius. -------
  const firstBloom = await h.until(
    (snap) => blooming(snap) || snap.predators[index].state !== "wander",
    { maxTicks: ticks(FIRST_FLARE_MAX), poll: FLARE_POLL },
  );
  // The lane is what stands between the pair, so a Flarefish that is no longer on
  // it has broken the fixture rather than the radius rule.
  requirePosedGround(
    h,
    firstBloom.snapshot,
    guard,
    index,
    "the corridor it was posed to patrol",
  );
  // A fix taken while the forager waits in its pocket is itself the negative
  // leg's verdict, and a harsher one than the leg below: the pocket sits seven
  // tiles under the patrol, past FLARE_RADIUS, behind six rows of solid rock and
  // with no ink anywhere, so nothing the specification gives this hunter reaches
  // it. Read here rather than stood down on, because a bloom that ignores its own
  // radius takes that fix on the FIRST flare and leaves no later one to watch.
  assertEqual(
    firstBloom.snapshot.predators[index].state,
    "wander",
    `the Flarefish's state while the forager stood ` +
      `${apart(firstBloom.snapshot).toFixed(0)} units away in a sealed pocket, ` +
      `past the FLARE_RADIUS (${FLARE_RADIUS}) its bloom locks inside of`,
  );
  if (!firstBloom.hit) {
    h.unmet(
      `the Flarefish did not bloom within ${FIRST_FLARE_MAX} s of patrolling a ` +
        `sealed corridor, so there was no bloom to stand outside of — whether ` +
        `it flares on its interval is flarefish/flare-cadence's verdict, not ` +
        `this one's`,
    );
  }
  const outside = lanePlace(
    firstBloom.snapshot.predators[index].tx,
    OFFSET_TILES,
  );
  await h.debug.setForagerTile(outside.tx, outside.ty);

  const steps: { away: number; state: string }[] = [];
  for (let step = 0; step < NEGATIVE_TICKS; step += 1) {
    await h.advance(1);
    const snap = await h.snapshot();
    if (!blooming(snap) || apart(snap) <= FLARE_RADIUS) break;
    steps.push({ away: apart(snap), state: snap.predators[index].state });
  }
  const fixedOutside = steps.filter((step) => step.state !== "wander");

  // Back to the sealed pocket, so the wait for the next bloom cannot be a lock.
  await parkForager(h, pocket);
  await h.debug.setPredatorState(index, "wander");

  // --- The positive leg: the next bloom, with the forager inside the radius. --
  const quietAgain = await h.until((snap) => !blooming(snap), {
    maxTicks: ticks(BLOOM_MAX),
    poll: FLARE_POLL,
  });
  const secondBloom = await h.until(
    (snap) => blooming(snap) || snap.predators[index].state !== "wander",
    { maxTicks: ticks(NEXT_FLARE_MAX + CHARGE_MAX), poll: FLARE_POLL },
  );
  assertEqual(
    secondBloom.snapshot.predators[index].state,
    "wander",
    `the Flarefish's state while the forager waited out the next flare ` +
      `${apart(secondBloom.snapshot).toFixed(0)} units away in its sealed ` +
      `pocket, past the FLARE_RADIUS (${FLARE_RADIUS}) its bloom locks inside of`,
  );
  if (!quietAgain.hit || !secondBloom.hit) {
    h.unmet(
      `a second bloom did not arrive within ${NEXT_FLARE_MAX + CHARGE_MAX} s ` +
        `of the first one ending, so there was no burning bloom to stand inside ` +
        `of — whether it flares on its interval is flarefish/flare-cadence's ` +
        `verdict, not this one's`,
    );
  }

  const locked = await captureReplay(h, "lock", async () => {
    const inside = lanePlace(secondBloom.snapshot.predators[index].tx, 0);
    await h.debug.setForagerTile(inside.tx, inside.ty);
    const posed = await h.snapshot();
    const fix = await h.until(
      (snap) => snap.predators[index].state === "chase",
      { maxTicks: LOCK_TICKS, poll: 1 },
    );
    // A beat past the fix before the flags are read: a build may take the fix on
    // one step and drop the bloom and raise the alert on its next, and
    // specs/predators/flarefish.md fixes the order of neither against the other.
    await h.advance(1);
    const after = await h.snapshot();
    await h.advance(TAIL_TICKS);
    return { inside, posed, fix, after };
  });

  requireSceneHeld(h, await h.snapshot(), guard);

  // The board really is what the claim needs: two corridors, five tiles and a
  // band of solid rock apart.
  assertEqual(
    locked.posed.forager.ty,
    patrol.ty - ROWS_APART,
    "the row the forager was posed on, above the Flarefish's own",
  );
  assertLessThan(
    apart(locked.posed),
    FLARE_RADIUS,
    `the units between the two centers with the forager posed directly above ` +
      `the Flarefish, against the FLARE_RADIUS (${FLARE_RADIUS}) the bloom ` +
      `locks inside of`,
  );

  // The negative leg.
  assertGreaterThanOrEqual(
    steps.length,
    NEGATIVE_MIN_STEPS,
    `steps of a burning bloom on which the pair stood past FLARE_RADIUS — the ` +
      `forager was posed ${OFFSET_TILES} tiles along and ${ROWS_APART} tiles ` +
      `above the Flarefish, ${(Math.hypot(OFFSET_TILES, ROWS_APART) * TILE).toFixed(0)} ` +
      `units apart`,
  );
  assertEqual(
    fixedOutside.length,
    0,
    `steps on which the Flarefish took a fix while its bloom burned and the ` +
      `forager stood past FLARE_RADIUS, of ${steps.length}` +
      (fixedOutside.length > 0
        ? ` — the first was ${fixedOutside[0].away.toFixed(0)} units off, ` +
          `reported "${fixedOutside[0].state}"`
        : ""),
  );

  // The positive leg.
  assertEqual(
    locked.posed.predators[index].flaring,
    true,
    "the bloom is still burning when the forager is posed inside its disc",
  );
  assertEqual(
    locked.fix.hit,
    true,
    `the bloom locked on within ${LOCK_TICKS} ticks of a forager standing ` +
      `${apart(locked.posed).toFixed(0)} units off with four rows of solid ` +
      `rock between, which specs/predators/flarefish.md has it reach through`,
  );
  assertEqual(
    locked.after.predators[index].state,
    "chase",
    "the Flarefish's state a step after the lock",
  );
  assertEqual(
    locked.after.predators[index].alert,
    true,
    "the detection alert the lock fires, a step after it",
  );
  assertEqual(
    locked.after.predators[index].flaring,
    false,
    "the bloom a step after the lock, which specs/predators/flarefish.md ends " +
      "at once when it locks on",
  );
});
