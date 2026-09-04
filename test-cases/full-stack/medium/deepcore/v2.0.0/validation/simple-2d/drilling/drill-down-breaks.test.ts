// drilling/drill-down-breaks — a held down cut takes the cell below to tunnel.
//
// specs/character.md: the miner drills the tile it is moving into, a cut starts
// while it rests on a solid cell, each hit removes the drill tier's damage from
// that cell's health, and the cell breaks when its health reaches `0`. Rock
// yields nothing and every broken cell becomes an open tunnel.
//
// The scene is an empty mine with one rock cell put back under the miner, so
// nothing else can be cut, banked or detonated by accident. The miner's body is
// held still: this point is the drill's, and how the miner sinks through the
// cell as the cut runs is the sibling check's. A pinned miner still reads as
// grounded from the cell beneath its box and still starts and holds a cut, which
// is what `specs/instrumentation.md` fixes that faculty gate to leave running.

import { afterEach, beforeEach, it } from "vitest";
import { BAND_HEALTH } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  driveCut,
  openScene,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("breaks the cell below to open tunnel while down is held", async () => {
  openScene(h);
  h.debug.setTile(COL, ROW, "rock");
  standOn(h, COL, ROW);
  pinMiner(h);

  const opening = h.tileAt(COL, ROW);
  assertEqual(opening.kind, "rock", "specs/instrumentation.md");
  assertEqual(opening.health, BAND_HEALTH.topsoil, "specs/world.md");

  const cut = await captureReplay(h, "cut", () =>
    driveCut(h, "down", { col: COL, row: ROW }),
  );

  assertEqual(cut.broke, true, "specs/character.md");
  assertEqual(cut.tile.kind, "tunnel", "specs/character.md");
  assertGreaterThan(cut.frames, 0, "specs/character.md");
});
