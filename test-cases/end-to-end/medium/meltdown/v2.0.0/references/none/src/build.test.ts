import { describe, expect, it } from "vitest";
import { COLS, ROWS, tileCX, tileCY, tileLeft, tileTop } from "./constants";
import {
  NO_CUES,
  addTower,
  arm,
  clearTowers,
  heldIsValid,
  movePreview,
  movePreviewTo,
  place,
  previewTile,
  previewValid,
  removeTower,
  rotatePreview,
  sell,
  setPreviewRotation,
  upgrade,
  wouldStaySolvable,
} from "./build";
import { footprintTiles } from "./grid";
import { addUnit } from "./sim";
import { createState, type MeltdownState } from "./state";

/** A live, quiet floor with money on hand. */
function scene(money = 1000): MeltdownState {
  const state = createState();
  state.screen = "playing";
  state.phase = "building";
  state.waveSpawning = false;
  state.money = money;
  return state;
}

describe("the preview", () => {
  it("takes the block nearest the pointer", () => {
    // With the pointer at a tile's centre, a 2x2 footprint's ideal top-left
    // falls half a tile off the grid, and `round` takes a half upward, so the
    // block lands with the pointer's tile at its top-left (specs/building.md).
    expect(previewTile(tileCX(10), tileCY(10), 2)).toEqual({
      col: 10,
      row: 10,
    });
    // At the tile's own corner it lands squarely, straddling the corner.
    expect(previewTile(tileLeft(10), tileTop(10), 2)).toEqual({
      col: 9,
      row: 9,
    });
    // An odd footprint centres on the pointer's tile at every rotation.
    expect(previewTile(tileCX(10), tileCY(10), 3)).toEqual({
      col: 9,
      row: 9,
    });
  });

  it("clamps so the whole footprint stays on the grid at every size", () => {
    expect(previewTile(-500, -500, 4)).toEqual({ col: 0, row: 0 });
    expect(previewTile(5000, 5000, 4)).toEqual({
      col: COLS - 4,
      row: ROWS - 4,
    });
    expect(previewTile(5000, 5000, 2)).toEqual({
      col: COLS - 2,
      row: ROWS - 2,
    });
  });

  it("arms a type at rotation zero and rotates only what is held", () => {
    const state = scene();
    arm(state, "arc");
    expect(state.build?.type).toBe("arc");
    expect(state.build?.rotation).toBe(0);
    rotatePreview(state);
    expect(state.build?.rotation).toBe(1);
    arm(state, "lance");
    expect(state.build?.rotation).toBe(0);
    setPreviewRotation(state, 3);
    expect(state.build?.rotation).toBe(3);
    arm(state, null);
    expect(state.build).toBeNull();
    rotatePreview(state);
    expect(state.build).toBeNull();
  });

  it("follows the pointer over the floor, clamped", () => {
    const state = scene();
    arm(state, "bloom");
    movePreviewTo(state, tileCX(30), tileCY(20));
    expect(state.build).toMatchObject({ col: 29, row: 19 });
    // The pointer's own path clamps: a pointer at the far corner still leaves
    // the whole footprint on the grid (specs/building.md).
    movePreviewTo(state, tileCX(COLS - 1), tileCY(ROWS - 1));
    expect(state.build).toMatchObject({ col: COLS - 3, row: ROWS - 3 });
  });

  it("moves the preview to the anchor named, on the grid or off it", () => {
    const state = scene();
    arm(state, "bloom");
    // `movePreview` is the surface's own pose and clamps nothing: the anchor it
    // is given is the anchor it sets, and `previewValid` is what answers for a
    // footprint hanging off the far edge (specs/instrumentation.md).
    movePreview(state, COLS - 1, ROWS - 1);
    expect(state.build).toMatchObject({ col: COLS - 1, row: ROWS - 1 });
    expect(previewValid(state, "bloom", COLS - 1, ROWS - 1)).toBe(false);
  });
});

describe("valid and invalid", () => {
  it("refuses a footprint off the grid", () => {
    const state = scene();
    expect(previewValid(state, "arc", -1, 4)).toBe(false);
    expect(previewValid(state, "lance", COLS - 3, 4)).toBe(false);
  });

  it("refuses a footprint over a tile another tower covers", () => {
    const state = scene();
    addTower(state, "arc", 10, 10, 0);
    expect(previewValid(state, "arc", 10, 10)).toBe(false);
    expect(previewValid(state, "arc", 9, 9)).toBe(false);
    expect(previewValid(state, "arc", 12, 10)).toBe(true);
  });

  it("refuses a footprint over the tile a unit stands on", () => {
    const state = scene();
    const unit = addUnit(state, "mote", "left");
    unit.x = tileCX(10);
    unit.y = tileCY(10);
    expect(previewValid(state, "arc", 10, 10)).toBe(false);
    expect(previewValid(state, "arc", 12, 12)).toBe(true);
  });

  it("refuses a footprint the money cannot cover", () => {
    const state = scene(14);
    expect(previewValid(state, "arc", 10, 10)).toBe(false);
    state.money = 15;
    expect(previewValid(state, "arc", 10, 10)).toBe(true);
  });

  it("refuses a footprint with a tile outside a mode's build zone", () => {
    const state = scene();
    state.mode = "bottleneck";
    expect(previewValid(state, "arc", 13, 8)).toBe(true);
    expect(previewValid(state, "arc", 12, 8)).toBe(false);
    expect(previewValid(state, "arc", 36, 27)).toBe(false);
    expect(previewValid(state, "arc", 35, 26)).toBe(true);
  });

  it("refuses a placement that would seal a vent from its exhaust", () => {
    const state = scene();
    // A wall down column 10, leaving one gap at the bottom that the candidate
    // would close. Every other placement on the floor is unaffected.
    for (let row = 0; row < ROWS - 2; row += 2) {
      addTower(state, "arc", 10, row, 0);
    }
    expect(state.floor.routeLength("left")).toBeLessThan(Infinity);
    expect(previewValid(state, "arc", 10, ROWS - 2)).toBe(false);
    expect(previewValid(state, "arc", 20, 20)).toBe(true);
  });

  it("refuses a placement that would strand a unit already on the floor", () => {
    const state = scene();
    const unit = addUnit(state, "mote", "left");
    unit.x = tileCX(1);
    unit.y = tileCY(17);
    const pocket = new Set([
      ...footprintTiles(2, 16, 2),
      ...footprintTiles(0, 14, 2),
      ...footprintTiles(2, 14, 2),
      ...footprintTiles(0, 18, 2),
      ...footprintTiles(2, 18, 2),
    ]);
    expect(wouldStaySolvable(state, pocket)).toBe(false);
  });

  it("allows a footprint over part of an opening", () => {
    const state = scene();
    expect(previewValid(state, "arc", 0, 16)).toBe(true);
  });
});

describe("placing", () => {
  it("deducts the cost, blocks the tiles and re-paths", () => {
    const state = scene(100);
    arm(state, "arc");
    movePreview(state, 10, 10);
    const before = state.floor.routeLength("left");
    const tower = place(state, NO_CUES);
    expect(tower).not.toBeNull();
    expect(state.money).toBe(85);
    expect(state.towers).toHaveLength(1);
    expect(state.floor.isOpen(10, 10)).toBe(false);
    expect(state.floor.routeLength("left")).toBeGreaterThanOrEqual(before);
    expect(tower).toMatchObject({
      level: 1,
      heat: 0,
      tripped: false,
      kills: 0,
      damageDealt: 0,
      spent: 15,
    });
  });

  it("keeps the placement armed until the next copy is unaffordable", () => {
    const state = scene(30);
    arm(state, "arc");
    movePreview(state, 10, 10);
    place(state, NO_CUES);
    expect(state.build).not.toBeNull();
    movePreview(state, 14, 10);
    place(state, NO_CUES);
    expect(state.money).toBe(0);
    expect(state.build).toBeNull();
  });

  it("builds nothing and spends nothing on an invalid footprint", () => {
    const state = scene(100);
    addTower(state, "arc", 10, 10, 0);
    arm(state, "arc");
    movePreview(state, 10, 10);
    expect(heldIsValid(state)).toBe(false);
    expect(place(state, NO_CUES)).toBeNull();
    expect(state.money).toBe(100);
    expect(state.towers).toHaveLength(1);
  });

  it("is fresh out of a build phase and not fresh out of a wave", () => {
    const state = scene(100);
    arm(state, "arc");
    movePreview(state, 10, 10);
    expect(place(state, NO_CUES)?.fresh).toBe(true);
    state.phase = "wave";
    movePreview(state, 14, 10);
    expect(place(state, NO_CUES)?.fresh).toBe(false);
  });

  it("fixes the rotation at the moment it commits", () => {
    const state = scene(100);
    arm(state, "arc");
    movePreview(state, 10, 10);
    setPreviewRotation(state, 1);
    const tower = place(state, NO_CUES);
    setPreviewRotation(state, 3);
    expect(tower?.rotation).toBe(1);
  });
});

describe("upgrading", () => {
  it("takes one level and charges exactly its cost", () => {
    const state = scene(100);
    const tower = addTower(state, "arc", 10, 10, 0);
    expect(upgrade(state, tower.id)).toBe(true);
    expect(tower.level).toBe(2);
    expect(state.money).toBe(85);
    expect(tower.spent).toBe(30);
  });

  it("changes nothing when it cannot be afforded", () => {
    const state = scene(5);
    const tower = addTower(state, "arc", 10, 10, 0);
    expect(upgrade(state, tower.id)).toBe(false);
    expect(tower.level).toBe(1);
    expect(state.money).toBe(5);
  });

  it("changes nothing at the ceiling", () => {
    const state = scene(1000);
    const tower = addTower(state, "arc", 10, 10, 0);
    tower.level = 3;
    expect(upgrade(state, tower.id)).toBe(false);
    expect(state.money).toBe(1000);
  });

  it("leaves a tower that has faced a wave un-fresh", () => {
    const state = scene(1000);
    const tower = addTower(state, "arc", 10, 10, 0);
    tower.fresh = false;
    upgrade(state, tower.id);
    expect(tower.fresh).toBe(false);
  });
});

describe("selling", () => {
  it("pays the refund, reopens the footprint and re-paths", () => {
    const state = scene(0);
    const tower = addTower(state, "bloom", 10, 10, 0);
    tower.fresh = false;
    expect(sell(state, tower.id, NO_CUES)).toBe(true);
    expect(state.money).toBe(105);
    expect(state.towers).toHaveLength(0);
    expect(state.floor.isOpen(10, 10)).toBe(true);
  });

  it("clears the selection only when the tower sold was selected", () => {
    const state = scene(0);
    const a = addTower(state, "arc", 10, 10, 0);
    const b = addTower(state, "arc", 14, 10, 0);
    state.selected = a.id;
    sell(state, b.id, NO_CUES);
    expect(state.selected).toBe(a.id);
    sell(state, a.id, NO_CUES);
    expect(state.selected).toBeNull();
  });

  it("refuses an id nothing answers to", () => {
    const state = scene(0);
    expect(sell(state, 42, NO_CUES)).toBe(false);
  });
});

describe("the atoms", () => {
  it("adds a tower at no cost, appended, with no placement check", () => {
    const state = scene(50);
    const first = addTower(state, "lance", 0, 0, 2);
    const second = addTower(state, "arc", 0, 0, 0);
    expect(state.money).toBe(50);
    expect(state.towers[state.towers.length - 1]).toBe(second);
    expect(first.rotation).toBe(2);
    expect(first.spent).toBe(150);
    expect(first.fresh).toBe(true);
    expect(first.firingEnabled).toBe(true);
    expect(first.thermalEnabled).toBe(true);
  });

  it("removes a tower with no refund and reopens its tiles", () => {
    const state = scene(50);
    const tower = addTower(state, "arc", 10, 10, 0);
    removeTower(state, tower.id);
    expect(state.money).toBe(50);
    expect(state.towers).toHaveLength(0);
    expect(state.floor.isOpen(10, 10)).toBe(true);
  });

  it("clears every tower at once, with no refund", () => {
    const state = scene(50);
    addTower(state, "arc", 10, 10, 0);
    addTower(state, "arc", 14, 10, 0);
    clearTowers(state);
    expect(state.towers).toHaveLength(0);
    expect(state.money).toBe(50);
    expect(state.floor.routeLength("left")).toBeCloseTo(49, 10);
  });
});
