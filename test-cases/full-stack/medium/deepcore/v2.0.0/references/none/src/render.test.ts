// The renderer draws every screen, panel, and overlay without throwing
// (specs/ui.md, specs/overview.md).
//
// It runs against a real 2D context from @napi-rs/canvas rather than a browser, so what
// is checked is that every drawing path is reachable and that the clickable regions the
// controller routes clicks through come back for each of them. Nothing about the palette
// or the layout is asserted: those belong to the build.

import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { MINER_STATES, ORE_IDS, STAGE_H, STAGE_W, TILE } from "./constants";
import { Game } from "./game";
import { Bursts } from "./particles";
import { render } from "./render";
import type { View } from "./render";
import type { Assets } from "./assets";
import { emptyGame, setOreTile, setTile, standOn } from "./test-support";
import type { MinerState, Ore, Panel, Screen } from "./types";

/** An asset set with nothing produced in it, so every fallback drawing runs. */
function bareAssets(): Assets {
  const miner = {} as Record<MinerState, never[]>;
  for (const state of MINER_STATES) miner[state] = [];
  return {
    miner,
    tile: () => undefined,
    tileVariants: () => [],
    stone: () => [],
    crack: [],
    ore: () => undefined,
    material: () => undefined,
    lava: [],
    surface: () => undefined,
    rocket: [],
    icon: () => undefined,
    fx: {},
    audioUrls: {} as Assets["audioUrls"],
  } as Assets;
}

function context(): CanvasRenderingContext2D {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  return canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
}

const VIEW: View = { time: 3.5, muted: false, pointer: { x: 640, y: 360 } };

const SCREENS: Screen[] = [
  "title",
  "mode-select",
  "size-select",
  "how-to-play",
  "in-mine",
  "paused",
  "victory",
  "game-over",
];

const PANELS: Panel[] = [
  "fuel-depot",
  "ore-market",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
  "inventory",
];

describe("the renderer", () => {
  it("draws every screen and hands back what can be clicked", () => {
    const ctx = context();
    const bursts = new Bursts({});
    const assets = bareAssets();
    for (const screen of SCREENS) {
      const game = new Game();
      game.newExpedition("standard", "quick");
      game.summary = game.makeSummary(
        screen === "game-over" ? "hull-destroyed" : null,
      );
      game.screen = screen;
      const clickables = render(ctx, game, assets, bursts, VIEW);
      expect(Array.isArray(clickables)).toBe(true);
      if (screen !== "in-mine") expect(clickables.length).toBeGreaterThan(0);
    }
  });

  it("draws every building panel", () => {
    const ctx = context();
    const bursts = new Bursts({});
    const assets = bareAssets();
    for (const panel of PANELS) {
      const game = emptyGame();
      game.credits = 12000;
      game.cargo.ferron = 3;
      game.cargo.aurite = 1;
      game.satchel.resonite = 1;
      game.items.dynamite = 2;
      game.installed = new Set(["hull-frame", "fuel-cells"]);
      game.panel = panel;
      expect(render(ctx, game, assets, bursts, VIEW).length).toBeGreaterThan(0);
    }
  });

  it("draws the mine with every kind of cell, a haul, and a live Core Sample", () => {
    const game = emptyGame();
    const row = 200;
    standOn(game, 16, row + 1);
    setTile(game, 14, row, "rock");
    setTile(game, 15, row, "gas");
    setTile(game, 17, row, "stone");
    setTile(game, 18, row, "lava");
    setOreTile(game, 19, row, "argenite");
    setTile(game, 20, row, "rock");
    game.grid[row]![20]!.kind = "material";
    game.grid[row]![20]!.material = "cryenite";
    game.grid[row]![14]!.health = 1; // a partly cut cell, so the crack overlay draws
    game.tiers.scanner = 3;
    game.nodes.push({ material: "cryenite", col: 20, row, collected: false });
    game.satchel.coreSample = true;
    game.coreTimer = 8;
    game.groundItems.push({ kind: "core-sample", col: 21, row: row + 1 });
    game.raiseNotice("gas");
    game.notice = { hazard: "gas", shown: true, t: 4 };
    game.note("CARGO FULL — ORE LOST");
    game.addShake(8, 0.3);
    for (const ore of ORE_IDS as Ore[]) game.cargo[ore] = 2;
    game.update(0.02);
    expect(
      render(context(), game, bareAssets(), new Bursts({}), VIEW).length,
    ).toBeGreaterThan(0);
  });

  it("draws the miner in every animation state and both facings", () => {
    const ctx = context();
    const bursts = new Bursts({});
    const assets = bareAssets();
    for (const state of MINER_STATES) {
      for (const facing of ["east", "west"] as const) {
        const game = emptyGame();
        setTile(game, 5, 200, "rock");
        standOn(game, 5, 200);
        game.miner.state = state;
        game.miner.facing = facing;
        if (state === "drill-down" || state === "drill-side") {
          game.miner.drilling = {
            col: 5,
            row: 200,
            dir: state === "drill-down" ? "down" : "right",
            hitTimer: 0.1,
          };
        }
        expect(() => render(ctx, game, assets, bursts, VIEW)).not.toThrow();
      }
    }
  });

  it("draws the camp, the rocket at each assembly stage, and the launch", () => {
    const ctx = context();
    const bursts = new Bursts({});
    const assets = bareAssets();
    for (let installed = 0; installed <= 5; installed++) {
      const game = emptyGame();
      game.miner.x = 3 * TILE;
      game.miner.y = 8;
      game.installed = new Set(
        (
          [
            "hull-frame",
            "fuel-cells",
            "guidance",
            "thruster",
            "ignition",
          ] as const
        ).slice(0, installed),
      );
      game.recenterCamera();
      expect(() => render(ctx, game, assets, bursts, VIEW)).not.toThrow();
    }
    const game = emptyGame();
    game.installed = new Set([
      "hull-frame",
      "fuel-cells",
      "guidance",
      "thruster",
      "ignition",
    ]);
    game.startLaunch();
    game.update(1);
    expect(() => render(ctx, game, assets, bursts, VIEW)).not.toThrow();
  });
});
