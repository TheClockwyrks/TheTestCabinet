// instrumentation/travel-faculty — with travel off the body holds its position.
//
// `specs/instrumentation.md` states the gate and both halves of what it does:
// "With travel off, the miner's body holds the position it stands at, however
// long the scenario runs and whatever is held on the keyboard: gravity, walking,
// thrust, knockback, and collision displacement all move it nowhere, and its
// velocity stays where it was posed. Everything else about it carries on. It
// still reads as grounded from the cells beneath its box, so it still starts and
// holds a cut; the drill still spends fuel; life support still burns."
//
// WHY IT IS A DELIVERABLE RATHER THAN A CONVENIENCE. A validator poses a world
// holding only what its requirement is about, and in this game most requirements
// are about something happening to a miner that would otherwise fall out of the
// scene the moment a frame runs — a cut in an open shaft, a fuel drain measured
// over a minute, a hazard's damage. A build that gated the whole miner instead
// could not express any of them, which is why the specification makes travel and
// the drill two gates rather than one switch.
//
// SO BOTH HALVES ARE READ, in one posed scene. First the holding: the miner is
// stood on a coreshell cell with open mine on every side, walk and thrust are
// held together for half a second, and the position and velocity are read back
// unmoved — a miner whose travel was running would have left the cell in the
// first few frames. Then the carrying on: the down key is held and the same
// gated miner cuts the cell it stands on, spending exactly the fuel
// `specs/character.md` prices those hits at, and its position is read unmoved
// again afterwards.
//
// THE FUEL IS READ AGAINST THE SPECIFICATION'S OWN ARITHMETIC: each hit spends
// `DRILL_HIT_FUEL`, the drill's tier-1 damage is `1` per hit so the hits landed
// are the health the cell lost, and life support runs at `LIFE_SUPPORT_BURN` for
// every second the miner is below the ground line.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_HEALTH,
  DRILL_DAMAGE_TIERS,
  DRILL_HIT_FUEL,
  LIFE_SUPPORT_BURN,
} from "../../src/constants";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinMiner,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 8;
/** A row well inside the coreshell, whose cells take sixteen hits to break. */
const ROW = 440;

/** Half a second held, in each of the two phases. */
const HELD_FRAMES = TICK_HZ / 2;
const HELD_SECONDS = HELD_FRAMES / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the miner still under gravity, walking and thrust, and cuts anyway", async () => {
  openScene(h);
  h.debug.setTile(COL, ROW, "rock");
  standOn(h, COL, ROW);
  pinMiner(h);

  const posed = h.snapshot();
  assertEqual(posed.miner.travel, false, "the travel faculty");
  assertEqual(posed.miner.x, minerXOn(COL), "the posed x");
  assertEqual(posed.miner.y, minerYOn(ROW), "the posed y");

  const cut = await captureReplay(h, "held", async () => {
    // Gravity, a walk and thrust, all at once, on a miner with open mine on
    // every side but the cell it stands on.
    h.hold(ACTION_KEY.right);
    h.hold(ACTION_KEY.up);
    await h.advance(HELD_FRAMES);
    h.releaseAll();
    const held = h.snapshot();

    // And the same gated miner, cutting.
    const before = h.snapshot().miner.fuel;
    h.hold(ACTION_KEY.down);
    await h.advance(HELD_FRAMES);
    h.releaseAll();
    return {
      held,
      before,
      after: h.snapshot(),
      tile: h.tileAt(COL, ROW),
    };
  });

  // Nothing moved it, and its velocity is where it was posed.
  assertEqual(
    cut.held.miner.x,
    minerXOn(COL),
    "the x after gravity and a walk",
  );
  assertEqual(
    cut.held.miner.y,
    minerYOn(ROW),
    "the y after gravity and thrust",
  );
  assertEqual(cut.held.miner.vx, 0, "the vx of a gated miner");
  assertEqual(cut.held.miner.vy, 0, "the vy of a gated miner");
  assertEqual(cut.after.miner.x, minerXOn(COL), "the x after the cut");
  assertEqual(cut.after.miner.y, minerYOn(ROW), "the y after the cut");

  // Everything else carried on: it reads as grounded on the cell beneath it, the
  // cut it holds took health off that cell ...
  assertEqual(cut.after.miner.grounded, true, "a gated miner's footing");
  assertGreaterThan(
    BAND_HEALTH.coreshell - (cut.tile.health ?? 0),
    0,
    "the health the held cut took off the cell",
  );

  // ... and the drill spent the fuel the specification prices those hits at, on
  // top of the life support a miner below the ground line burns.
  const landed =
    (BAND_HEALTH.coreshell - (cut.tile.health ?? 0)) / DRILL_DAMAGE_TIERS[0];
  assertCloseTo(
    cut.before - cut.after.miner.fuel,
    landed * DRILL_HIT_FUEL + LIFE_SUPPORT_BURN * HELD_SECONDS,
    3,
    `the fuel ${landed} drill hits and half a second of life support cost`,
  );
});
