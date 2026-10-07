// instrumentation/entity-ids — every entity carries a distinct, stable id, and
// an entity added through the surface is the last entry of its own roster.
//
// THE RULES, from `specs/instrumentation.md`, Identity: "Every rock, bullet, and
// saucer bullet carries an `id`: a number, distinct among the entities live at
// any moment, reported by `snapshot` and taken by every per-entity operation."
// "An entity added through this surface is appended to its roster, so it is the
// last entry and its id is read from there." And of the saucer: "It is fresh on
// every arrival, distinct among every live entity."
//
// WHY THIS ITEM CARRIES SO MUCH. Every per-entity operation in the surface takes
// an id, and every scenario in this suite that poses a body reads that id off
// the last entry of the roster it was appended to. A build whose ids collide
// across rosters, or whose ids are reassigned as the roster changes, makes every
// one of those scenarios address the wrong body — so this item is checked
// against the whole live field at once rather than one roster at a time.
//
// THE ADDS ARE INTERLEAVED, one from each roster in turn. Ids have to be
// distinct among ENTITIES, not within a roster, so a build handing out `1, 2,
// 3` from a counter of its own per roster is exactly the wrong model this item
// exists to catch — and it passes any check that fills one roster at a time and
// looks only inside it. Interleaving also puts the saucer's arrival in the
// middle of the sequence, where its id has live entities on both sides of it.
//
// DISTINCTNESS IS READ AFTER EVERY SINGLE ADD, over every live entity: three
// rosters and the saucer slot.
//
// LASTNESS IS READ WITHOUT ASSUMING LASTNESS, which is why this check drives the
// surface's `addRock`, `addBullet` and `addEnemyBullet` directly instead of
// through the harness's posing helpers. Those helpers read an added entity's id
// off the END of its roster, which is exactly the rule under test here — so a
// check built on them would compare the last entry against the last entry and
// pass on a build that prepends. The entity added is found instead as the id
// that is live now and was not live a moment ago, and THAT id is then required
// to be the final entry of its own roster.
//
// STABILITY IS READ ACROSS REAL FRAMES. The field then runs for half a second of
// game time under the game's own rules — the well pulling the rocks and the
// rounds, the rounds spending their lifetimes — and every id must still be
// there, on an entity of the same kind. Half a second is well inside
// `BULLET_LIFE` (`1.5`) and `SAUCER_BULLET_LIFE` (`1.4`), so nothing expires
// underneath the reading (`specs/weapons.md`, `specs/saucer.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import {
  captureStill,
  createHarness,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";
import {
  BULLET_SPOTS,
  ENEMY_BULLET_SPOTS,
  ROCK_SPOTS,
  SAUCER_SPOT,
  SIZES,
} from "./scene";

/** How long the posed field is left to run before the ids are read again. */
const STABLE_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The id of the last entry of a roster, or `undefined` when it is empty. */
function lastId(roster: readonly { id: number }[]): number | undefined {
  return roster.length === 0 ? undefined : roster[roster.length - 1].id;
}

/** Every id live at this instant, across all three rosters and the saucer. */
function liveIds(snapshot: ShatterSnapshot): number[] {
  return [
    ...snapshot.rocks.map((rock) => rock.id),
    ...snapshot.bullets.map((bullet) => bullet.id),
    ...snapshot.enemyBullets.map((bullet) => bullet.id),
    ...(snapshot.saucer === null ? [] : [snapshot.saucer.id]),
  ];
}

/** Fail unless every id live at this instant is distinct from every other. */
function assertIdsDistinct(snapshot: ShatterSnapshot, after: string): void {
  const ids = liveIds(snapshot);
  if (new Set(ids).size !== ids.length) {
    fail(
      "every entity live at one moment to carry an id distinct from every " +
        `other's (specs/instrumentation.md, Identity) — after ${after}`,
      ids,
    );
  }
}

it("hands each added entity a fresh id, at the end of its own roster, and keeps it", async () => {
  startPlaying(h);

  /** Every id handed out, in the order the entities were added. */
  const handed: { id: number; roster: string }[] = [];

  /**
   * Run one `add`, and answer the id of the entity it added — found as the one
   * that is live now and was not live before, never as the last entry of a
   * roster, since where an added entity lands is the rule being read.
   */
  const add = (
    roster: string,
    run: () => void,
    last: () => number | undefined,
  ): void => {
    const was = new Set(liveIds(h.snapshot()));
    run();
    const fresh = liveIds(h.snapshot()).filter((id) => !was.has(id));
    if (fresh.length !== 1) {
      fail(
        `adding a ${roster} to bring exactly one fresh id onto the field ` +
          "(specs/instrumentation.md, Identity)",
        fresh,
      );
    }
    assertEqual(
      last(),
      fresh[0],
      `the ${roster} just added is appended to its roster, so it is the last ` +
        "entry (specs/instrumentation.md, Identity)",
    );
    handed.push({ id: fresh[0], roster });
    assertIdsDistinct(h.snapshot(), `adding a ${roster}`);
  };

  // Interleaved: one rock, one of the ship's rounds, one of the saucer's, in
  // turn — with the saucer's own arrival in the middle of the sequence.
  for (let index = 0; index < SIZES.length; index += 1) {
    const size = SIZES[index];
    const spot = ROCK_SPOTS[size];
    add(
      "rock",
      () => h.debug.addRock(size, spot.x, spot.y),
      () => lastId(h.snapshot().rocks),
    );

    const at = BULLET_SPOTS[index];
    add(
      "bullet",
      () => h.debug.addBullet(at.x, at.y, 0, 0),
      () => lastId(h.snapshot().bullets),
    );

    const enemyAt = ENEMY_BULLET_SPOTS[index];
    add(
      "saucer bullet",
      () => h.debug.addEnemyBullet(enemyAt.x, enemyAt.y, 0, 0),
      () => lastId(h.snapshot().enemyBullets),
    );

    if (index === 1) {
      add(
        "saucer",
        () => {
          h.debug.addSaucer(SAUCER_SPOT.x, SAUCER_SPOT.y);
          // Its three faculties are its own switches
          // (`specs/instrumentation.md`); held, the saucer neither steers,
          // shoots nor moves, so nothing it decides adds an entity this check
          // did not.
          h.debug.setSaucerMind(false);
          h.debug.setSaucerGun(false);
          h.debug.setSaucerTravel(false);
        },
        () => requireSaucer(h.snapshot()).id,
      );
    }
  }

  const posed = h.snapshot();
  assertLength(posed.rocks, SIZES.length, "every posed rock is on the field");
  assertLength(
    posed.bullets,
    SIZES.length,
    "every posed round of the ship's is in flight",
  );
  assertLength(
    posed.enemyBullets,
    SIZES.length,
    "every posed round of the saucer's is in flight",
  );

  // Half a second of the game's own rules, and every id is still where it was.
  await h.advance(ticksFor(STABLE_SECONDS));

  // The populated field the ids were read off.
  captureStill(h, "roster");

  const later = new Set(liveIds(h.snapshot()));
  for (const entry of handed) {
    if (!later.has(entry.id)) {
      fail(
        `the ${entry.roster} added as id ${entry.id} to keep that id across ` +
          `${STABLE_SECONDS} s of game time (specs/instrumentation.md, Identity)`,
        [...later],
      );
    }
  }
  assertIdsDistinct(h.snapshot(), "half a second of play");
});
