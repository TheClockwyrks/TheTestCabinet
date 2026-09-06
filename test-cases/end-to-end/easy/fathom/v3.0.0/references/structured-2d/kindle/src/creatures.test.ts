import { describe, expect, it } from "vitest";

import {
  BRIGHT_HALFLIFE,
  BRIGHT_HOLD,
  BRIGHT_PER_EAT,
  DEN_ORDER,
  DEN_RELEASE_GAP,
  DRIFTER_SPEED,
  FORAGER_SPEED,
  GRID_COLS,
  GRID_ROWS,
  ROSTER_CAP,
  ROSTER_CAP_DEPTH,
  TICK_DT,
  TILE,
} from "./constants";
import type { PredatorKind } from "./constants";
import {
  Drifter,
  Forager,
  buildRoster,
  denSlots,
  predatorRoster,
  wanderIntent,
} from "./creatures";
import { anchor, stampLayout } from "./fixtures";
import { visionRadius } from "./fog";
import { tileCenterX, tileCenterY } from "./grid";
import { TRENCH, TRENCH_START } from "./layout";
import { Maze } from "./maze";
import { advanceBody, bodyCell } from "./movement";
import { Rng } from "./rng";

function tally(roster: readonly PredatorKind[]): Record<PredatorKind, number> {
  const counts: Record<PredatorKind, number> = {
    lanternjaw: 0,
    gloamfin: 0,
    flarefish: 0,
  };
  for (const kind of roster) counts[kind] += 1;
  return counts;
}

describe("the forager's brightness", () => {
  it("swims at one speed and opens dark", () => {
    const forager = new Forager();
    expect(forager.speed).toBe(FORAGER_SPEED);
    expect(forager.brightness).toBe(0);
    expect(forager.visionRadius).toBe(visionRadius(0));
  });

  it("rises by one helping per plankton and clamps at one", () => {
    const forager = new Forager();
    forager.graze();
    expect(forager.brightness).toBeCloseTo(BRIGHT_PER_EAT, 10);
    for (let bite = 0; bite < 10; bite++) forager.graze();
    expect(forager.brightness).toBe(1);
  });

  it("holds steady for the whole hold, then halves on its half-life", () => {
    const forager = new Forager();
    forager.brightness = 1;
    forager.hold = BRIGHT_HOLD;
    const ticks = Math.round(BRIGHT_HOLD / TICK_DT);
    for (let tick = 0; tick < ticks; tick++) forager.advanceLight(TICK_DT);
    expect(forager.brightness).toBe(1);
    const decay = Math.round(BRIGHT_HALFLIFE / TICK_DT);
    for (let tick = 0; tick < decay; tick++) forager.advanceLight(TICK_DT);
    expect(forager.brightness).toBeCloseTo(0.5, 3);
  });

  it("arms the hold in full every time it eats", () => {
    const forager = new Forager();
    forager.graze();
    for (let tick = 0; tick < 60; tick++) forager.advanceLight(TICK_DT);
    expect(forager.hold).toBeLessThan(BRIGHT_HOLD);
    forager.graze();
    expect(forager.hold).toBe(BRIGHT_HOLD);
  });
});

describe("the roster a depth holds", () => {
  it("holds one of each kind at depth one, in release order", () => {
    expect(predatorRoster(1)).toEqual([...DEN_ORDER]);
  });

  it("adds one more predator per depth beyond the first", () => {
    expect(predatorRoster(2)).toHaveLength(4);
    expect(predatorRoster(3)).toHaveLength(5);
    expect(tally(predatorRoster(2)).gloamfin).toBe(2);
    expect(tally(predatorRoster(3)).lanternjaw).toBe(2);
  });

  it("caps at two of each kind from the capping depth on", () => {
    for (const depth of [ROSTER_CAP_DEPTH, 5, 12]) {
      const counts = tally(predatorRoster(depth));
      expect(counts.lanternjaw).toBe(ROSTER_CAP);
      expect(counts.gloamfin).toBe(ROSTER_CAP);
      expect(counts.flarefish).toBe(ROSTER_CAP);
    }
  });

  it("gives each slot a release time one gap after the one before it", () => {
    const roster = buildRoster(4);
    expect(roster.map((predator) => predator.releaseAt)).toEqual([
      0,
      DEN_RELEASE_GAP,
      DEN_RELEASE_GAP * 2,
      DEN_RELEASE_GAP * 3,
      DEN_RELEASE_GAP * 4,
      DEN_RELEASE_GAP * 5,
    ]);
    expect(roster.every((predator) => predator.state === "den")).toBe(true);
    expect(roster.every((predator) => !predator.released)).toBe(true);
  });
});

describe("where the den parks its predators", () => {
  it("fills the trench's own chamber", () => {
    const trench = new Maze(TRENCH, TRENCH_START);
    for (const slot of denSlots(trench)) {
      expect(trench.isDen(slot.tx, slot.ty)).toBe(true);
    }
  });

  it("falls back to whatever den tiles a posed fixture carries", () => {
    const board = stampLayout([".g.", "ddd", "..."]);
    const maze = new Maze(board.rows);
    const slots = denSlots(maze);
    expect(slots).toHaveLength(3);
    for (const slot of slots) expect(maze.isDen(slot.tx, slot.ty)).toBe(true);
  });

  it("holds them out of play on a fixture with no den at all", () => {
    const board = stampLayout(["......"]);
    const maze = new Maze(board.rows);
    expect(denSlots(maze)).toEqual([maze.start]);
  });
});

describe("the wander a creature with no fix travels", () => {
  it("prefers a direction other than an immediate reverse", () => {
    const board = stampLayout(["...", ".S.", "..."]);
    const maze = new Maze(board.rows);
    const drifter = new Drifter(anchor(board, "S"));
    drifter.heading = "right";
    const rng = new Rng();
    for (let draw = 0; draw < 200; draw++) {
      expect(wanderIntent(drifter, maze, rng, maze.openToForager)).not.toBe(
        "left",
      );
    }
  });

  it("turns back where the tile offers no other open direction", () => {
    const board = stampLayout(["S.."]);
    const maze = new Maze(board.rows);
    const drifter = new Drifter(anchor(board, "S"));
    drifter.heading = "left";
    expect(wanderIntent(drifter, maze, new Rng(), maze.openToForager)).toBe(
      "right",
    );
  });

  it("stands still on a tile with no open neighbor", () => {
    const board = stampLayout(["S"]);
    const maze = new Maze(board.rows);
    const drifter = new Drifter(anchor(board, "S"));
    expect(
      wanderIntent(drifter, maze, new Rng(), maze.openToForager),
    ).toBeNull();
  });

  it("takes the wrap tunnel like the forager", () => {
    const rows = new Array<string>(GRID_ROWS).fill("#".repeat(GRID_COLS));
    rows[7] = ".".repeat(GRID_COLS);
    const maze = new Maze(rows, { tx: 0, ty: 7 });
    const drifter = new Drifter({ tx: 0, ty: 7 });
    expect(drifter.speed).toBe(DRIFTER_SPEED);
    const ticks = Math.round(TILE / DRIFTER_SPEED / TICK_DT);
    for (let tick = 0; tick < ticks; tick++) {
      advanceBody(drifter, TICK_DT, maze, () => "left", maze.openToForager);
    }
    expect(bodyCell(drifter)).toEqual({ tx: GRID_COLS - 1, ty: 7 });
  });
});

describe("returning a predator to the den", () => {
  it("clears its fix, its flags and its timers", () => {
    const [predator] = buildRoster(1);
    predator.state = "chase";
    predator.released = true;
    predator.fix = { tx: 4, ty: 4 };
    predator.alert = 1;
    predator.mark = 1;
    predator.flaring = true;
    predator.returnToDen({ tx: 17, ty: 8 });
    expect(predator.state).toBe("den");
    expect(predator.released).toBe(false);
    expect(predator.fix).toBeNull();
    expect(predator.alert).toBe(0);
    expect(predator.mark).toBe(0);
    expect(predator.flaring).toBe(false);
    expect(predator.x).toBe(tileCenterX(17));
    expect(predator.y).toBe(tileCenterY(8));
  });
});
