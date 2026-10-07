// Spectra — instrumentation/entity-ids: every drone and every bullet added through
// the surface takes an id no other live entity carries and lands at the end of its
// own roster, and every entity keeps its id while the game runs.
//
// `specs/instrumentation.md` makes both rules explicit, under Identity: "Every
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
// carry either of them off the play field (`specs/field.md` removes one that
// does), and the whole drive is well inside `BURST_DURATION` (`0.7` s), after
// which a burst leaves its roster on its own (`specs/assets.md`).
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
  fail,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  requireBullet,
  shootDrone,
  startPosed,
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
 * How far below the popped drone its shot starts, and the frames it is allowed.
 *
 * A Shard's contact reach is `SHARD_HALF` (14) plus `PLAYER_BULLET_HALF` (6), so
 * `60` puts the bullet in flight rather than in contact; at `PLAYER_BULLET_SPEED`
 * (760) it covers that in six frames of the suite's 100 Hz clock, and twenty-five
 * leaves ample slack for whichever frame the build resolves the contact on.
 */
const SHOT_BELOW = 60;
const SHOT_FRAMES = 25;

/**
 * Where the two posed bullets are placed.
 *
 * The player's starts low enough that the third of a second below cannot climb it
 * past `FIELD_TOP` (`64`) — at `PLAYER_BULLET_SPEED` (`760`) that is `228` units —
 * and the enemy's starts high enough that it cannot fall past `FIELD_BOTTOM`
 * (`656`). A bullet that left the field would be removed (`specs/field.md`) and
 * this point would be reporting that rather than an id.
 */
const FRIENDLY_AT = { x: 150, y: 620 } as const;
const ENEMY_AT = { x: 1150, y: 120 } as const;

/** How long the field is driven for while the ids are held, in seconds. */
const DRIVE_SECONDS = 0.3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("gives each added entity a distinct id at the end of its roster, and keeps it", async () => {
  await startPosed(h);

  /**
   * Run one add and read the id off the end of its roster, holding the roster to
   * having grown by exactly one entry whose id is new.
   */
  const appended = async (
    roster: (s: SpectraSnapshot) => readonly { id: number }[],
    add: () => Promise<void>,
    what: string,
  ): Promise<number> => {
    const before = roster(await h.snapshot()).map((entry) => entry.id);
    await add();
    const after = roster(await h.snapshot());
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
    const id = await appended(
      (s) => s.drones,
      () => h.debug.addDrone("shard", at.x, at.y),
      "drone",
    );
    // Held where it was put, with every faculty off: this point is about the id,
    // and a drone that flew off would be reporting another point's mechanic.
    await h.debug.setDroneTravel(id, false);
    await h.debug.setDroneOscillation(id, false);
    await h.debug.setDroneFire(id, false);
    drones.push(id);
  }

  // The burst, which is an outcome rather than an add: a matching shot into a
  // Shard placed for the purpose. Its id is the one that was not live before it.
  const target = await poseDrone(h, "shard", POP_AT.x, POP_AT.y, {
    band: "cyan",
  });
  const had = new Set((await h.snapshot()).bursts.map((burst) => burst.id));
  const shot = await shootDrone(h, target, "cyan", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  const popped = shot.snapshot.bursts.filter((burst) => !had.has(burst.id));
  if (popped.length !== 1) {
    fail(
      `exactly one burst playing after a matching shot destroyed the Shard at ` +
        `(${POP_AT.x}, ${POP_AT.y}) (specs/assets.md) — without one there is ` +
        `no burst id to read`,
      `${popped.length} new bursts`,
    );
  }
  const burst = popped[0].id;

  // The bullets, placed after the shot so each add is read against a roster
  // holding exactly what was placed on it.
  const bullets: number[] = [
    await appended(
      (s) => s.bullets,
      () => h.debug.addPlayerBullet(FRIENDLY_AT.x, FRIENDLY_AT.y, "cyan"),
      "bullet",
    ),
    await appended(
      (s) => s.bullets,
      () => h.debug.addEnemyBullet(ENEMY_AT.x, ENEMY_AT.y, "magenta"),
      "bullet",
    ),
  ];

  await h.advance(1);
  // Before the assertions, so a failure still leaves the picture of the field the
  // ids are being read from.
  await captureStill(h, "roster");

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

  const placed = requireBullet(
    await h.snapshot(),
    bullets[0],
    "the player's bullet whose flight makes the drive below a real one",
  );
  await h.advance(framesFor(DRIVE_SECONDS));
  // A phase change of the drone's own, and one of the wave's, both of which a
  // build recomputing its ids on a transition would answer differently.
  await h.debug.setDronePhase(drones[0], "diving");
  await h.debug.setPhase("ready");
  await h.advance(1);
  await h.debug.setPhase("live");
  const driven = await h.snapshot();

  // The game really ran, so "still carrying its id" is a reading rather than a
  // statement about a field that never moved.
  const flown = requireBullet(
    driven,
    bullets[0],
    "the player's bullet the drive carried",
  );
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
