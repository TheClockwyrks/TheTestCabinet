// hazards/gas-detonates — a gas pocket goes off under the drill.
//
// `specs/hazards.md` opens with the rule: "A gas pocket is a minable cell filled
// with volatile gas. It takes drill hits exactly as its band's rock does,
// spending the same time and fuel, but when its health reaches `0` it detonates
// instead of clearing cleanly. The cell becomes an open tunnel either way."
//
// So one pocket and one plain rock cell of the same band are cut through in
// turn, and the two are held against each other. The rock cell is what makes
// "instead of clearing cleanly" a reading rather than a hope: the same cut on
// the same band costs no hull at all, so the hull the pocket costs is the
// detonation and nothing else.
//
// Travel is gated because the blast's shove is `hazards/gas-knockback`; here the
// miner stays where it was put so the blast is read at a fixed distance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  openScene,
  pinMiner,
  type Harness,
} from "../harness";
import {
  armHull,
  bandRow,
  cutUnderfoot,
  FAST_DRILL_TIER,
  HAZARD_COL,
} from "./scene";

/** The pocket's column, and the plain rock cell it is held against. */
const GAS_COL = HAZARD_COL;
const ROCK_COL = HAZARD_COL + 4;

/** The tier that survives every rockbed detonation with room to read the loss. */
const HULL_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("detonates on the hit that breaks it and still leaves an open tunnel", async () => {
  openScene(h);
  pinMiner(h);
  h.debug.setTier("drill", FAST_DRILL_TIER);
  armHull(h, HULL_TIER);
  const row = bandRow(h.snapshot(), "rockbed");

  const blast = await captureReplay(h, "blast", async () => {
    const gas = await cutUnderfoot(h, GAS_COL, row, "gas");
    armHull(h, HULL_TIER);
    const rock = await cutUnderfoot(h, ROCK_COL, row, "rock");
    return { gas, rock };
  });

  // The pocket broke, and what it left behind is open tunnel.
  assertEqual(blast.gas.cut.broke, true, "specs/hazards.md");
  assertEqual(blast.gas.cut.tile.kind, "tunnel", "specs/hazards.md");
  // It took the same hits as its band's rock, which is what the same number of
  // frames at the same drill tier says.
  assertEqual(
    blast.gas.cut.frames,
    blast.rock.cut.frames,
    "specs/hazards.md, the same hits as the band's rock",
  );
  // And it cost hull where the rock cost none, so it detonated rather than
  // clearing quietly.
  assertGreaterThan(blast.gas.loss, 0, "specs/hazards.md");
  assertEqual(blast.rock.loss, 0, "specs/hazards.md, plain rock costs nothing");
  // The rock cell it was held against really did break, so the frame counts
  // above are two completed cuts rather than one cut and one stall.
  assertEqual(blast.rock.cut.broke, true, "specs/character.md");
  assertEqual(blast.gas.cut.frames > 0, true, "specs/character.md");
});
