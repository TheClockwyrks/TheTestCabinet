import { describe, expect, it } from "vitest";

import { FAULTS, SOLVED_ITEMS } from "./constants";
import { createStateOps } from "./debug";
import { Game } from "./game";
import { ImageStore, NO_SPRITES } from "./images";
import { FAULT_BANNERS } from "./panels";
import {
  solvedItemRect,
  SOLVED_PANEL_H,
  SOLVED_PANEL_W,
  SOLVED_PANEL_X,
  SOLVED_PANEL_Y,
} from "./regions";
import { recordLine } from "./screens";

describe("the fault display (specs/ui.md)", () => {
  it("carries a banner for every fault of specs/simulation.md", () => {
    for (const kind of FAULTS) {
      expect(FAULT_BANNERS[kind]).toBeTruthy();
      expect(
        FAULT_BANNERS[kind].toUpperCase().startsWith(bannerHead(kind)),
      ).toBe(true);
    }
    expect(new Set(Object.values(FAULT_BANNERS)).size).toBe(FAULTS.length);
  });
});

/** The word a fault's banner opens with: its own name, spaced and shouted. */
function bannerHead(kind: string): string {
  return kind.replace("-", " ").toUpperCase();
}

describe("a solved row's records (specs/modes/campaign.md)", () => {
  it("labels all three, so none is read as another", () => {
    const line = recordLine({ cost: 40, cycles: 18, area: 9 });
    expect(line).toContain("cost 40");
    expect(line).toContain("cycles 18");
    expect(line).toContain("area 9");
  });
});

describe("the sprites (specs/assets.md)", () => {
  it("answers null for a sprite this build has not decoded", () => {
    expect(NO_SPRITES.get("sprites/motes/sol.png")).toBeNull();
  });

  it("decodes nothing where there is no page, and stays usable", async () => {
    const store = new ImageStore();
    await store.load(["sprites/motes/sol.png"]);
    expect(store.size).toBe(0);
    expect(store.get("sprites/motes/sol.png")).toBeNull();
  });
});

describe("the solved panel (specs/ui.md)", () => {
  it("opens on its first item, whatever menu the player left behind", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.setMenuIndex(1);
    api.openChallenge("extras", 0);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.update(1 / 3);
    expect(game.state.sim?.status).toBe("complete");
    expect(game.state.menuIndex).toBe(0);
  });

  it("offers NEXT CHALLENGE only where the mode has one after this", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.openChallenge("extras", 9);
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.update(1 / 3);
    expect(game.solvedItems()).toEqual(
      SOLVED_ITEMS.filter((item) => item !== "NEXT CHALLENGE"),
    );
  });

  it("lays its items out inside the panel, in the order it draws them", () => {
    let previous = SOLVED_PANEL_Y;
    for (let index = 0; index < SOLVED_ITEMS.length; index += 1) {
      const rect = solvedItemRect(index);
      expect(rect.x).toBeGreaterThan(SOLVED_PANEL_X);
      expect(rect.x + rect.w).toBeLessThan(SOLVED_PANEL_X + SOLVED_PANEL_W);
      expect(rect.y).toBeGreaterThan(previous);
      expect(rect.y + rect.h).toBeLessThan(SOLVED_PANEL_Y + SOLVED_PANEL_H);
      previous = rect.y;
    }
  });

  it("offers no NEXT CHALLENGE for a challenge that belongs to no course", () => {
    const game = new Game();
    const api = createStateOps(game);
    api.loadChallenge({
      name: "Loaded",
      reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
      permitted: ["arm"],
      target: 6,
    });
    api.placeSet(0, 2, 0, 0);
    api.startRun();
    api.setTally(0, 6);
    game.update(1 / 3);
    expect(game.solvedItems()).not.toContain("NEXT CHALLENGE");
  });
});
