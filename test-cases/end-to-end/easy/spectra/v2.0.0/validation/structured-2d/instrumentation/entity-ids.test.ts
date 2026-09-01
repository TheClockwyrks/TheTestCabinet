// instrumentation/entity-ids — every drone and every bullet added through the
// surface takes an id no other live entity carries and lands at the end of its own
// roster, and every entity keeps its id while the game runs.
//
// specs/instrumentation.md makes both rules explicit, under Identity: "Every
// drone, every bullet, and every drone-burst carries an `id`: a number, distinct
// among the entities live at any moment, reported by `snapshot` and taken by every
// per-entity operation", and "An entity added through this surface is appended to
// its roster, so it is the last entry and its id is read from there." The second
// rule is followed by the first's other half: "An id is never reused while the
// entity holding it is alive, and an entity keeps its id for its whole life,
// across every frame and every phase change."
//
// WITHOUT BOTH, NO PER-ENTITY OPERATION IS ADDRESSABLE. `addDrone`,
// `addPlayerBullet` and `addEnemyBullet` hand nothing back, so the append rule is
// the only way a caller learns what it just created — and every scenario in this
// suite that gates one drone's travel while a second flies, or drives one bullet
// while others hang, rests on the id read from the roster's end being that
// entity's and no other's. A build that reuses ids across the drone and bullet
// rosters, or that inserts an added entity at the front, silently mis-aims those
// scenarios.
//
// SO EACH ADD IS READ TWICE. The roster is read before the add and after it: it
// must have grown by exactly one, and the entry now at the end must carry an id
// none of the entries before it carried. Then every id collected — across the
// drones, the bullets and the burst — is held to being distinct from every other,
// because the specification's word is "distinct among the entities live at any
// moment" rather than distinct within a roster.
//
// THE BURST IS THE ONE THAT CANNOT BE APPENDED. There is no operation that adds a
// burst — "A burst is an outcome of a drone being destroyed" — so its id is read
// as the one carrying an id that was not live before the kill, and it is held to
// the two rules that DO apply to it: distinct from every other live entity's, and
// kept while it plays.
//
// AND THE IDS ARE READ AGAIN AFTER THE GAME HAS RUN, AND AGAIN ACROSS A PHASE
// CHANGE. An id that is merely a roster position changes when the roster is
// walked; one that is reassigned each frame changes with the frame; one recomputed
// on a transition changes when the wave enters its `ready` phase or a drone leaves
// its formation for a dive. All three are driven here, and every entity is found
// still carrying the id it was given.
//
// THE FIELD IS POSED SO NOTHING LEAVES IT. The drones hold their places with every
// faculty off, the bullets are placed where the third of a second below cannot
// carry either of them off the play field (specs/field.md removes one that does),
// and the whole drive is well inside `BURST_DURATION` (`0.7` s), after which a
// burst leaves its roster on its own (specs/assets.md).
//
// WHAT THIS DOES NOT DECIDE. How ids are assigned — nothing here requires them to
// count up, or to be small — nor that `reset` returns the counter to the first id,
// which `instrumentation.reset-restores-title` covers from the other side.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  SHARD_HALF,
} from "../../src/constants";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertTrue,
  fail,
} from "../assert";
import {
  bulletById,
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  posePlayerBullet,
  startPosed,
  ticksFor,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** Where the two drones that outlive the kill stand, and where the popped one does. */
const STANDING: readonly { x: number; y: number }[] = [
  { x: 300, y: 200 },
  { x: 500, y: 240 },
];
const POP_AT = { x: 1000, y: 460 } as const;

/**
 * How far below the popped drone its shot starts, in logical units, and the
 * frames it is allowed.
 *
 * A Shard's contact reach is `SHARD_HALF` (`14`) plus `PLAYER_BULLET_HALF` (`6`),
 * so three times that puts the bullet in flight rather than already in contact;
 * the climb to the edge of the reach at `PLAYER_BULLET_SPEED` (`760`) is six
 * frames of the suite's 100 Hz clock, and four times that leaves ample slack for
 * whichever sub-step a build resolves the contact on.
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;
const SHOT_BELOW = 3 * TOUCHING;
const SHOT_FRAMES = 4 * ticksFor((SHOT_BELOW - TOUCHING) / PLAYER_BULLET_SPEED);

/** How long the field is driven for while the ids are held, in seconds. */
const DRIVE_SECONDS = 0.3;

/**
 * Where the two posed bullets are placed.
 *
 * The player's starts low enough that `DRIVE_SECONDS` cannot climb it past
 * `FIELD_TOP` (`64`) — at `PLAYER_BULLET_SPEED` (`760`) that is `228` units — and
 * the enemy's starts high enough that the same span cannot carry it past
 * `FIELD_BOTTOM` (`656`) at `ENEMY_BULLET_SPEED` (`320`), which is `96`. A bullet
 * that left the field would be removed (specs/field.md) and this point would be
 * reporting that rather than an id.
 */
const FRIENDLY_AT = {
  x: 150,
  y: FIELD_TOP + 2 * DRIVE_SECONDS * PLAYER_BULLET_SPEED,
} as const;
const ENEMY_AT = {
  x: 1150,
  y: FIELD_BOTTOM - 2 * DRIVE_SECONDS * ENEMY_BULLET_SPEED,
} as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives each added entity a distinct id at the end of its roster, and keeps it", async () => {
  startPosed(h);

  /**
   * Run one add and read the id off the end of its roster, holding the roster to
   * having grown by exactly one entry whose id is new.
   */
  const appended = (
    roster: (s: SpectraSnapshot) => readonly { id: number }[],
    add: () => void,
    what: string,
  ): number => {
    const before = roster(h.snapshot()).map((entry) => entry.id);
    add();
    const after = roster(h.snapshot());
    assertLength(
      after,
      before.length + 1,
      `the ${what} roster after the add, against the ${before.length} it held ` +
        `before it`,
    );
    const last = after[after.length - 1];
    assertEqual(
      before.includes(last.id),
      false,
      `whether the id at the END of the ${what} roster (${last.id}) was ` +
        `already carried by an entry that stood there before the add — an ` +
        `added entity is APPENDED, so the last entry is the new one ` +
        `(specs/instrumentation.md, Identity)`,
    );
    return last.id;
  };

  const drones: number[] = [];
  for (const at of STANDING) {
    const id = appended(
      (s) => s.drones,
      () => h.debug.addDrone("shard", at.x, at.y),
      "drone",
    );
    // Held where it was put, with every faculty off: this point is about the id,
    // and a drone that flew off would be reporting another point's mechanic.
    h.debug.setDroneTravel(id, false);
    h.debug.setDroneOscillation(id, false);
    h.debug.setDroneFire(id, false);
    drones.push(id);
  }

  // The burst, which is an outcome rather than an add: a matching shot into a
  // Shard placed for the purpose. Its id is the one that was not live before it.
  const target = poseDrone(h, "shard", POP_AT.x, POP_AT.y, { band: "cyan" });
  const had = new Set(h.snapshot().bursts.map((burst) => burst.id));
  posePlayerBullet(h, POP_AT.x, POP_AT.y + SHOT_BELOW, "cyan");
  const shot = await h.until((s) => droneById(s, target) === undefined, {
    maxFrames: SHOT_FRAMES,
  });
  const popped = shot.snapshot.bursts.filter((burst) => !had.has(burst.id));
  if (!shot.hit || popped.length !== 1) {
    fail(
      `exactly one burst playing after a matching shot destroyed the Shard at ` +
        `(${POP_AT.x}, ${POP_AT.y}) (specs/bands.md, specs/assets.md) — ` +
        `without one there is no burst id to read`,
      `${popped.length} new bursts after ${SHOT_FRAMES} frames`,
    );
  }
  const burst = popped[0].id;

  // The bullets, placed after the shot so each add is read against a roster
  // holding exactly what was placed on it.
  const bullets: number[] = [
    appended(
      (s) => s.bullets,
      () => h.debug.addPlayerBullet(FRIENDLY_AT.x, FRIENDLY_AT.y, "cyan"),
      "bullet",
    ),
    appended(
      (s) => s.bullets,
      () => h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta"),
      "bullet",
    ),
  ];

  await h.advance(1);
  // Before the assertions, so a failure still leaves the picture of the field the
  // ids are being read from.
  captureStill(h, "roster");

  // Distinct among the entities live at this moment, across all three rosters.
  const all = [...drones, ...bullets, burst];
  all.forEach((id, index) => {
    assertEqual(
      all.indexOf(id),
      index,
      `the position of id ${id} among the ${all.length} ids the ` +
        `${drones.length} drones, ${bullets.length} bullets and the burst ` +
        `were given ([${all.join(", ")}]) — an id is distinct among the ` +
        `entities live at any moment (specs/instrumentation.md, Identity)`,
    );
  });

  const placed = bulletById(h.snapshot(), bullets[0]);
  if (placed === undefined) {
    fail(
      "the player's bullet whose flight makes the drive below a real one, on " +
        "the roster it was just appended to",
      `no bullet carrying id ${bullets[0]}`,
    );
  }

  await h.advance(ticksFor(DRIVE_SECONDS));
  // A phase change of the drone's own, and one of the wave's, both of which a
  // build recomputing its ids on a transition would answer differently.
  h.debug.setDronePhase(drones[0], "diving");
  h.debug.setPhase("ready");
  await h.advance(1);
  h.debug.setPhase("live");
  const driven = h.snapshot();

  // The game really ran, so "still carrying its id" is a reading rather than a
  // statement about a field that never moved.
  const flown = bulletById(driven, bullets[0]);
  if (flown === undefined) {
    fail(
      `the player's bullet carrying id ${bullets[0]} after ${DRIVE_SECONDS} s ` +
        `of game time — it was placed where the climb cannot carry it past ` +
        `FIELD_TOP (${FIELD_TOP}) (specs/field.md)`,
      "no bullet carrying that id",
    );
  }
  assertLessThan(
    flown.y,
    placed.y,
    `the player's bullet's centre y after ${DRIVE_SECONDS} s of game time, ` +
      `from the ${placed.y} it was placed at — it travels straight up at ` +
      `PLAYER_BULLET_SPEED (specs/ship.md), so the field moved under these ids`,
  );

  for (const id of drones) {
    assertTrue(
      driven.drones.some((drone) => drone.id === id),
      `whether a drone still carries the id ${id} it was given, after ` +
        `${DRIVE_SECONDS} s of game time and two phase changes`,
    );
  }
  for (const id of bullets) {
    assertTrue(
      driven.bullets.some((bullet) => bullet.id === id),
      `whether a bullet still carries the id ${id} it was given, after ` +
        `${DRIVE_SECONDS} s of game time and two phase changes`,
    );
  }
  assertTrue(
    driven.bursts.some((live) => live.id === burst),
    `whether the burst still carries the id ${burst} it was given, after ` +
      `${DRIVE_SECONDS} s of game time and two phase changes — well inside ` +
      `the BURST_DURATION (0.7 s) it plays for (specs/assets.md)`,
  );
});
