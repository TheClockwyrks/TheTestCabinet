// instrumentation/entity-ids — every rock, bullet and saucer bullet the surface
// adds takes an id distinct from every other LIVE entity's, lands last in its own
// roster, and keeps that id as the game runs.
//
// THE THREE RULES ARE WHAT MAKE AN ID FINDABLE AT ALL. `specs/instrumentation.md`
// hands out no assignment scheme — a caller cannot predict the number an entity
// will get — so it fixes two rules instead: an entity added through the surface is
// "appended to its roster, so it is the last entry and its id is read from there",
// and an id is "distinct among the entities live at any moment". Every per-entity
// operation in the surface, and every scenario in this project that poses a body
// and then reads it back, rests on both.
//
// THE DISTINCTNESS IS TESTED ACROSS THE ROSTERS, NOT WITHIN THEM. The wrong model
// this is hunting is a build that numbers each roster from one of its own, which
// gives a rock and a bullet the same id while each roster looks perfectly sensible
// on its own. So the bodies are added INTERLEAVED — a rock, a bullet, a saucer
// bullet, and round again — and every id is held against every other live one,
// including the saucer's, which `specs/instrumentation.md` also requires to be
// distinct among every live entity.
//
// AND NOTHING IS TRUSTED TO `poseRock`. The harness's posing helpers read an added
// entity off the END of its roster, which is the rule under test, so this uses the
// bare surface operations and works out what was added by DIFFERENCE: whatever id
// is on the roster now and was not a moment ago. A build that prepends is then
// caught by the check that the new entry is last, rather than quietly handing this
// check somebody else's id.
//
// The bodies are placed at rest, spread, and far from the star, so the half second
// they are then carried takes none of them off its roster: no round lands, no rock
// reaches the core, and `specs/weapons.md` gives both kinds of shot a life far
// longer than the span.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
} from "../harness";

/** The rosters an entity can be added to, by the name the snapshot reports them at. */
type Roster = "rocks" | "bullets" | "enemyBullets";

/** Where the saucer hangs, so its own arrival id joins the distinctness check. */
const SAUCER_PLACE = { x: 640, y: 100 } as const;

/**
 * What is added, in the order it is added.
 *
 * Interleaved across the three rosters on purpose: a build that hands out numbers
 * per roster gives the first rock and the first bullet the same id, and only a
 * check that holds the three against one another sees it.
 */
const SCHEDULE = [
  { roster: "rocks", x: 200, y: 160 },
  { roster: "bullets", x: 200, y: 620 },
  { roster: "enemyBullets", x: 400, y: 690 },
  { roster: "rocks", x: 1080, y: 160 },
  { roster: "bullets", x: 1080, y: 620 },
  { roster: "enemyBullets", x: 880, y: 690 },
] as const;

/** The game time the field is carried for, to see that every id survives it. */
const HOLD_TICKS = ticksFor(0.5);

let h: Harness;

/** The ids on one roster, in roster order. */
function idsOn(snapshot: ShatterSnapshot, roster: Roster): number[] {
  return (snapshot[roster] as { id: number }[]).map((entity) => entity.id);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hands every entity a distinct id, appended last, and keeps it", async () => {
  await startPlaying(h);
  const saucer = await poseSaucer(h, SAUCER_PLACE.x, SAUCER_PLACE.y, {
    vx: 0,
    vy: 0,
    mind: false,
    gun: false,
    travel: false,
  });

  /** Every id live on the field, whatever roster it is on. */
  const live = new Set<number>([saucer]);
  /** What was added, so each can be found again after the field has run. */
  const added: { roster: Roster; id: number }[] = [];

  for (const entry of SCHEDULE) {
    const before = idsOn(await h.snapshot(), entry.roster);
    if (entry.roster === "rocks") {
      await h.debug.addRock("small", entry.x, entry.y);
    } else if (entry.roster === "bullets") {
      await h.debug.addBullet(entry.x, entry.y, 0, 0);
    } else {
      await h.debug.addEnemyBullet(entry.x, entry.y, 0, 0);
    }
    const after = idsOn(await h.snapshot(), entry.roster);

    const fresh = after.filter((id) => !before.includes(id));
    assertLength(fresh, 1, `exactly one entity joined ${entry.roster}`);
    const id = fresh[0];
    assertEqual(
      after[after.length - 1],
      id,
      `the entity added to ${entry.roster} is the last entry of it`,
    );
    assertTrue(
      !live.has(id),
      `the id ${id} added to ${entry.roster} is distinct from every live id`,
    );
    live.add(id);
    added.push({ roster: entry.roster, id });
  }

  await captureStill(h, "roster");

  // And an id belongs to its entity rather than to its slot: half a second of the
  // game's own stepping leaves every one of them where it was on the roster it was
  // on, under the number it was given.
  await h.advance(HOLD_TICKS);
  const ran = await h.snapshot();
  for (const entity of added) {
    assertContains(
      idsOn(ran, entity.roster),
      entity.id,
      `the ${entity.roster} entry ${entity.id} kept its id across the run`,
    );
  }
  assertEqual(
    requireSaucer(ran, "the saucer that was up throughout").id,
    saucer,
    "the saucer kept its arrival id",
  );
});
