// The single-slot expedition save (specs/gameplay.md, specs/modes.md).
//
// The slot lives in the browser's storage, so these run against a stand-in that
// behaves like it, plus one that is not there at all, because the game has to run
// correctly without it.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_TIMER, MINER_H, MINER_W, SURFACE_Y, TILE } from "./constants";
import { canSave, loadExpedition, newExpedition, trySave } from "./flow";
import { hasSave, clearSave } from "./save";
import { writeTile } from "./state";
import {
  bareState,
  createHarness,
  holding,
  inDraft,
  installStorage,
  openScene,
  posedAt,
  removeStorage,
  runFrames,
  standOn,
  type Harness,
} from "./test-support";
import { colCenterX, makeTile } from "./world";

/** A state at the camp, with a slot to write into. */
function saveable(): ReturnType<typeof bareState> {
  installStorage();
  clearSave();
  return inDraft(bareState(), (d) => {
    posedAt(d, 4 * TILE, SURFACE_Y - MINER_H);
    d.hasSave = false;
  });
}

afterEach(() => {
  installStorage();
});

describe("the Save Pad", () => {
  it("writes the slot at the camp and restores it exactly", () => {
    const saved = inDraft(saveable(), (d) => {
      d.credits = 4200;
      d.tiers.drill = 3;
      d.cargo.argenite = 4;
      d.satchel.resonite = 1;
      d.items.dynamite = 2;
      d.installed = ["hull-frame"];
      d.miner.fuel = 61;
      d.miner.hull = 42;
      expect(trySave(d)).toBe(true);
    });
    expect(hasSave()).toBe(true);
    expect(saved.hasSave).toBe(true);

    const restored = inDraft(bareState(), (d) => {
      expect(loadExpedition(d)).toBe(true);
    });
    expect(restored.credits).toBe(4200);
    expect(restored.tiers.drill).toBe(3);
    expect(restored.cargo.argenite).toBe(4);
    expect(restored.satchel.resonite).toBe(1);
    expect(restored.items.dynamite).toBe(2);
    expect(restored.installed).toEqual(["hull-frame"]);
    expect(restored.miner.fuel).toBe(61);
    expect(restored.miner.hull).toBe(42);
    expect(restored.screen).toBe("in-mine");
    // A restore places the miner back on the surface.
    expect(restored.miner.y + MINER_H).toBe(SURFACE_Y);
    // A live Core Sample is never persisted.
    expect(restored.satchel.coreSample).toBe(false);
    expect(restored.coreTimer).toBeNull();
  });

  it("refuses to save away from the camp", () => {
    inDraft(saveable(), (d) => {
      d.grid = writeTile(d.grid, 5, 200, makeTile("rock", "rockbed"));
      posedAt(d, colCenterX(5, MINER_W), 200 * TILE - MINER_H);
      expect(trySave(d)).toBe(false);
    });
    expect(hasSave()).toBe(false);
  });

  it("refuses to save while a Core Sample's timer runs, carried or dropped", () => {
    inDraft(saveable(), (d) => {
      d.satchel.coreSample = true;
      d.coreTimer = CORE_TIMER;
      expect(canSave(d)).toBe(false);
      expect(trySave(d)).toBe(false);
    });
    inDraft(saveable(), (d) => {
      d.groundItems.push({ kind: "core-sample", col: 4, row: 10 });
      d.coreTimer = CORE_TIMER;
      expect(canSave(d)).toBe(false);
    });
    expect(hasSave()).toBe(false);
  });

  it("is overwritten by the next save, and abandoned by a new expedition", () => {
    inDraft(saveable(), (d) => {
      d.credits = 100;
      trySave(d);
      d.credits = 900;
      trySave(d);
    });
    const restored = inDraft(bareState(), (d) => {
      loadExpedition(d);
    });
    expect(restored.credits).toBe(900);
    inDraft(restored, (d) => newExpedition(d, "standard", "quick"));
    expect(hasSave()).toBe(false);
  });
});

describe("what a death costs", () => {
  /** Kill the miner outright and let the death play out. */
  function die(mode: "standard" | "hardcore"): void {
    const posed = inDraft(saveable(), (d) => {
      d.credits = 500;
      trySave(d);
      d.mode = mode;
      d.grid = writeTile(d.grid, 5, 200, makeTile("rock", "rockbed"));
      posedAt(d, colCenterX(5, MINER_W), 200 * TILE - MINER_H);
      d.miner.hull = 0;
    });
    const run = runFrames(holding(posed, {}), 2, 60);
    expect(run.state.screen).toBe("game-over");
  }

  it("keeps the save in Standard, so the expedition can be restored", () => {
    die("standard");
    expect(hasSave()).toBe(true);
  });

  it("deletes the save in Hardcore", () => {
    die("hardcore");
    expect(hasSave()).toBe(false);
  });
});

describe("a victory", () => {
  let h: Harness;

  beforeEach(async () => {
    installStorage();
    h = await createHarness();
    openScene(h);
  });

  afterEach(() => {
    h.dispose();
  });

  it("consumes the save", async () => {
    standOn(h, 4, 1);
    h.pose((debug, state) => debug.save(state));
    expect(hasSave()).toBe(true);
    h.pose((debug, state) => debug.setRocketInstalled(state, 5));
    h.pose((debug, state) => debug.launch(state));
    await h.seconds(4);
    expect(h.debug.snapshot(h.state).screen).toBe("victory");
    expect(hasSave()).toBe(false);
  });
});

describe("with storage that refuses", () => {
  /** A slot that throws on every call, as a browser blocking site data does. */
  function refusingStorage(): void {
    const refuse = (): never => {
      throw new Error("site data is blocked");
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        get length(): number {
          return refuse();
        },
        clear: refuse,
        getItem: refuse,
        key: refuse,
        removeItem: refuse,
        setItem: refuse,
      },
      configurable: true,
      writable: true,
    });
  }

  it("runs correctly, reporting no save and saving nothing", () => {
    refusingStorage();
    expect(hasSave()).toBe(false);
    expect(() => clearSave()).not.toThrow();
    const posed = inDraft(bareState(), (d) => {
      posedAt(d, 4 * TILE, SURFACE_Y - MINER_H);
    });
    inDraft(posed, (d) => {
      expect(trySave(d)).toBe(false);
      expect(loadExpedition(d)).toBe(false);
    });
    const run = runFrames(holding(posed, {}), 1, 30);
    expect(run.state.screen).toBe("in-mine");
    expect(run.state.hasSave).toBe(false);
  });
});

describe("with no storage at all", () => {
  it("runs correctly, simply without saving", () => {
    removeStorage();
    const posed = inDraft(bareState(), (d) => {
      posedAt(d, 4 * TILE, SURFACE_Y - MINER_H);
    });
    expect(hasSave()).toBe(false);
    inDraft(posed, (d) => {
      expect(trySave(d)).toBe(false);
      expect(loadExpedition(d)).toBe(false);
    });
    expect(() => clearSave()).not.toThrow();
    const run = runFrames(holding(posed, {}), 1, 30);
    expect(run.state.screen).toBe("in-mine");
  });
});
