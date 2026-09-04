// Wireworm — instrumentation/entity-ids: every worm, foe and bolt carries a
// distinct id, is appended to its roster, and keeps that id as the game runs.
//
// specs/instrumentation.md "Identity": every worm, every foe and every bolt
// carries an `id`, a number distinct among the entities live at any moment,
// reported by `snapshot` and taken by every per-entity operation — and two rules
// make one findable without an assignment scheme, the first of which is that an
// entity added through the surface is appended to its roster, so it is the last
// entry.
//
// THE THREE HALVES ARE ONE REQUIREMENT. An id is only useful if all three hold at
// once: two entities sharing a number make `setWormStepping(id, ...)` ambiguous,
// an entity that is not appended cannot be found at all, and an id that is
// reassigned between frames turns every reading taken after a step into a reading
// of some other entity. So the point poses one of each kind, reads the ids as
// they are added, runs the board, and reads them again.
//
// WHY THE IDS MUST BE READ ACROSS A RUNNING BOARD rather than off a frozen one:
// the failure this rule exists to prevent is a build that addresses an entity by
// its POSITION in the roster, which is stable until something moves. The worms
// here therefore step for real while the check runs.
//
// THE BOARD IS POSED SO NOTHING CAN BE REMOVED. The two worms wind along clear
// rows of their own; the three foes are gated still so none of them descends off
// the board; and the two bolts climb empty columns and are read again well before
// either reaches the top of the board, which specs/cursor.md removes a bolt at.
// An entity that vanished would fail this point for the wrong reason.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_Y,
  BOLT_SPEED,
  tileCY,
  wormStepInterval,
} from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseBolt,
  poseFoe,
  poseWorm,
  sameTile,
  seconds,
  startPlaying,
  ticksFor,
  wormOf,
  foeOf,
  boltOf,
  type FoeKind,
  type Harness,
} from "../harness";

/** The two worms posed, each on a clear row of its own, three segments long. */
const WORM_ROWS = [4, 10] as const;
const WORM_C = 5;
const WORM_LENGTH = 3;

/** One foe of each kind, each on its own tile, all of them held still. */
const FOE_KINDS: readonly FoeKind[] = ["glitch", "dropper", "corruptor"];
const FOE_C = 20;
const FOE_ROWS = [6, 8, 12] as const;

/** The two bolts posed, in columns nothing else stands in. */
const BOLT_COLS = [35, 37] as const;
const BOLT_R = 19;

/**
 * How long the board is run before the ids are read again.
 *
 * Three of level 1's `0.14` s step intervals plus a margin, so both worms have
 * plainly stepped. specs/cursor.md climbs a bolt at `BOLT_SPEED` (`900` units per
 * second) and removes it once its center passes `BOARD_Y` (`80`), which from the
 * band's row 19 takes `(688 - 80) / 900` = `0.68` s — so `0.45` s leaves both
 * bolts still in flight with room to spare.
 */
const RUN_TICKS = ticksFor(wormStepInterval(1) * 3 + 0.03);
const BOLT_FLIGHT_S = (tileCY(BOLT_R) - BOARD_Y) / BOLT_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every added entity a distinct id, appends it, and keeps it across steps", async () => {
  startPlaying(h);

  // The sweep must finish while both bolts are still on the board, or an id
  // would go missing for a reason that is not this point's.
  assertGreaterThan(
    BOLT_FLIGHT_S,
    seconds(RUN_TICKS),
    "the scenario must read the bolts back before either leaves the board " +
      "(specs/cursor.md)",
  );

  const wormIds = WORM_ROWS.map((row, index) => {
    const id = poseWorm(h, WORM_C, row, WORM_LENGTH);
    // Each worm added is the LAST entry of the roster it was appended to.
    const roster = h.snapshot().worms;
    assertLength(roster, index + 1, "the worm roster after the add");
    assertEqual(
      roster[roster.length - 1]?.id,
      id,
      "addWorm appends the worm to the roster (specs/instrumentation.md)",
    );
    return id;
  });

  const foeIds = FOE_KINDS.map((kind, index) => {
    const id = poseFoe(h, kind, FOE_C, FOE_ROWS[index]);
    // Held still, so no foe descends off the board while the sweep runs.
    h.debug.setFoeMind(id, false);
    h.debug.setFoeTravel(id, false);
    const roster = h.snapshot().foes;
    assertLength(roster, index + 1, "the foe roster after the add");
    assertEqual(
      roster[roster.length - 1]?.id,
      id,
      "addFoe appends the foe to the roster (specs/instrumentation.md)",
    );
    return id;
  });

  const boltIds = BOLT_COLS.map((col, index) => {
    const id = poseBolt(h, col, BOLT_R);
    const roster = h.snapshot().bolts;
    assertLength(roster, index + 1, "the bolt roster after the add");
    assertEqual(
      roster[roster.length - 1]?.id,
      id,
      "addBolt appends the bolt to the roster (specs/instrumentation.md)",
    );
    return id;
  });

  // Every id, across all three rosters, is distinct: an id is unique among the
  // entities live at any moment, not merely within one roster.
  const everyId = [...wormIds, ...foeIds, ...boltIds];
  assertLength(
    [...new Set(everyId)],
    everyId.length,
    "every live entity's id is distinct from every other's " +
      "(specs/instrumentation.md)",
  );

  const posedHeads = wormIds.map((id) => headOf(wormOf(h.snapshot(), id)));

  await h.advance(RUN_TICKS);
  // The entities whose ids are read, on the board that has just been run.
  captureStill(h, "roster");

  const ran = h.snapshot();

  // Each worm is still addressable by the id it was given, and it is the worm it
  // was: it has stepped, so the reading is of a board that moved under it.
  wormIds.forEach((id, index) => {
    const worm = wormOf(ran, id);
    assertLength(
      worm.segments,
      WORM_LENGTH,
      `worm ${String(id)} keeps its segments`,
    );
    assertEqual(
      sameTile(headOf(worm), posedHeads[index]),
      false,
      `worm ${String(id)} kept its id across the steps it took ` +
        "(specs/instrumentation.md)",
    );
  });

  for (const id of foeIds) {
    assertEqual(
      foeOf(ran, id).id,
      id,
      `the foe added with id ${String(id)} keeps it`,
    );
  }

  for (const id of boltIds) {
    assertNotNull(
      boltOf(ran, id),
      `the bolt added with id ${String(id)} keeps it while it is in flight`,
    );
  }
});
