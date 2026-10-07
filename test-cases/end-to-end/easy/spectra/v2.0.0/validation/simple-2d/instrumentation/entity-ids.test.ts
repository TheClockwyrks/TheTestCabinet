// instrumentation/entity-ids — every drone and every bullet added through the
// surface takes an id no other live entity carries and lands at the end of its own
// roster, and every entity keeps its id while the game runs.
//
// specs/instrumentation.md makes both rules explicit, under Identity: "Every
// drone, every bullet, and every drone-burst carries an `id`: a number, distinct
// among the entities live at any moment, reported by `snapshot` and taken by every
// per-entity operation", and "An entity added through this surface is appended to
// its roster, so it is the last entry and its id is read from there." The other
// half of the first rule follows: "An id is never reused while the entity holding
// it is alive, and an entity keeps its id for its whole life, across every frame
// and every phase change."
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
// burst — "A burst is an outcome of a drone being destroyed" — so `./bursts.ts`
// earns one with a matching shot, and it is held to the two rules that DO apply to
// it: distinct from every other live entity's id, and kept while it plays.
//
// AND THE IDS ARE READ AGAIN AFTER THE GAME HAS RUN, AND AGAIN ACROSS A PHASE
// CHANGE. An id that is merely a roster position changes when the roster is
// walked; one that is reassigned each frame changes with the frame; one recomputed
// on a transition changes when the wave enters its `ready` phase or a drone leaves
// its formation for a dive. All three are driven here, and every entity is found
// still carrying the id it was given.
//
// THE FIELD IS POSED SO NOTHING LEAVES IT. Each added drone has all three
// faculties turned off, the bullets are placed where the third of a second below
// cannot carry either of them off the play field (specs/field.md removes one that
// does), and the whole drive is well inside `BURST_DURATION` (`0.7` s), after
// which a burst leaves its roster on its own (specs/assets.md).
//
// WHAT THIS DOES NOT DECIDE. How ids are assigned — nothing here requires them to
// count up, or to be small — nor that `reset` returns the counter to the first id,
// which `instrumentation/reset-restores-title` covers from the other side.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThan,
  assertTrue,
} from "../assert";
import {
  bulletOf,
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
  type SpectraSnapshot,
} from "../harness";
import { poseBursts } from "./bursts";

/** Where the two drones stand: the upper field, clear of both HUD strips. */
const STANDING: readonly { x: number; y: number }[] = [
  { x: 300, y: 200 },
  { x: 500, y: 240 },
];

/**
 * Where the two posed bullets are placed, in logical units.
 *
 * The player's starts low enough that the third of a second below cannot climb it
 * past `FIELD_TOP` (`64`) — at `PLAYER_BULLET_SPEED` (`760`) that is `228` units —
 * and the enemy's starts high enough that it cannot fall past `FIELD_BOTTOM`
 * (`656`). A bullet that left the field would be removed (specs/field.md) and this
 * point would be reporting that rather than an id.
 */
const FRIENDLY_AT = { x: 150, y: 620 } as const;
const ENEMY_AT = { x: 1150, y: 120 } as const;

/** How long the field is driven while the ids are held, in seconds. */
const DRIVE_SECONDS = 0.3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives each added entity a distinct id at the end of its roster, and keeps it", async () => {
  startPosed(h);

  // The burst first, which can only be an outcome: a matching shot into a Shard
  // placed for the purpose. It leaves the drone and player-bullet rosters empty
  // behind it, so every add below is read against a roster holding exactly what
  // this point put on it.
  const [burst] = await poseBursts(h, 1);
  assertTrue(
    burst !== undefined,
    "a drone-burst left playing by a matching shot, which is the only way one " +
      "reaches the roster (specs/instrumentation.md, The bursts)",
  );

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
      `the ${what} roster after the add, against the ${String(before.length)} ` +
        "it held before it",
    );
    const last = after[after.length - 1];
    assertEqual(
      before.includes(last.id),
      false,
      `whether the id at the END of the ${what} roster (${String(last.id)}) ` +
        "was already carried by an entry that stood there before the add — an " +
        "added entity is APPENDED, so the last entry is the new one " +
        "(specs/instrumentation.md, Identity)",
    );
    return last.id;
  };

  const drones = STANDING.map((at) => {
    const id = appended(
      (s) => s.drones,
      () => {
        h.debug.addDrone("shard", at.x, at.y);
      },
      "drone",
    );
    // Held where it was put, with every faculty off: this point is about the id,
    // and a drone that flew away would be reporting another point's mechanic.
    h.debug.setDroneTravel(id, false);
    h.debug.setDroneOscillation(id, false);
    h.debug.setDroneFire(id, false);
    return id;
  });

  const bullets = [
    appended(
      (s) => s.bullets,
      () => {
        h.debug.addPlayerBullet(FRIENDLY_AT.x, FRIENDLY_AT.y, "cyan");
      },
      "bullet",
    ),
    appended(
      (s) => s.bullets,
      () => {
        h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta");
      },
      "bullet",
    ),
  ];

  await h.advance(1);
  // Before the assertions, so a failure still leaves the picture of the field the
  // ids are being read from.
  captureStill(h, "roster");

  // Distinct among the entities live at this moment, across all three rosters.
  const all = [...drones, ...bullets, burst as number];
  all.forEach((id, index) => {
    assertEqual(
      all.indexOf(id),
      index,
      `the position of id ${String(id)} among the ${String(all.length)} ids ` +
        `the ${String(drones.length)} drones, ${String(bullets.length)} ` +
        `bullets and the burst were given ([${all.join(", ")}]) — an id is ` +
        "distinct among the entities live at any moment " +
        "(specs/instrumentation.md, Identity)",
    );
  });

  const placed = bulletOf(h.snapshot(), bullets[0]);
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
  const flown = bulletOf(driven, bullets[0]);
  assertLessThan(
    flown.y,
    placed.y,
    `the player's bullet's centre y after ${String(DRIVE_SECONDS)} s of game ` +
      `time, from the ${String(placed.y)} it was placed at — it travels ` +
      "straight up at PLAYER_BULLET_SPEED (specs/ship.md), so the field moved " +
      "under these ids",
  );

  for (const id of drones) {
    assertTrue(
      driven.drones.some((drone) => drone.id === id),
      `whether a drone still carries the id ${String(id)} it was given, after ` +
        `${String(DRIVE_SECONDS)} s of game time and two phase changes`,
    );
  }
  for (const id of bullets) {
    assertTrue(
      driven.bullets.some((bullet) => bullet.id === id),
      `whether a bullet still carries the id ${String(id)} it was given, ` +
        `after ${String(DRIVE_SECONDS)} s of game time and two phase changes`,
    );
  }
  assertTrue(
    driven.bursts.some((live) => live.id === burst),
    `whether the burst still carries the id ${String(burst)} it was given, ` +
      `after ${String(DRIVE_SECONDS)} s of game time and two phase changes — ` +
      "well inside the BURST_DURATION (0.7 s) it plays for (specs/assets.md)",
  );
});
