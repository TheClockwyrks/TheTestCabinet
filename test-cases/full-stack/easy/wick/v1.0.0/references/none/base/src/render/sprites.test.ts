// The renderer over the produced sprites: every file decoded and drawn,
// the lamplighter's sprite at the center and mirrored by facing, the slash
// mirrored to its side, and each effect drawn over its hitbox.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { Assets, producedImages } from "../assets";
import {
  ASSET_PATHS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  WALK_FRAME_TIME,
} from "../constants";
import { ALMANAC } from "../layout";
import { freshRun, initialState, type WickState, type Zone } from "../state";
import { spawnEnemy } from "../sim/enemies";
import { drawZone } from "./effects";
import { render } from "./render";
import { drawLamplighterAt } from "./world";

type Context = CanvasRenderingContext2D;

const assets = new Assets();

beforeAll(async () => {
  for (const image of producedImages()) {
    const decoded = await loadImage(
      new URL(`../../assets/${image.path}`, import.meta.url),
    );
    assets.put(image.path, decoded as unknown as HTMLImageElement);
  }
});

function blank(width = STAGE_W, height = STAGE_H): Context {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d") as unknown as Context;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function frame(state: WickState, withAssets = assets): Context {
  const ctx = blank();
  render(ctx, state, withAssets);
  return ctx;
}

function pixel(ctx: Context, x: number, y: number): number[] {
  return [...ctx.getImageData(x, y, 1, 1).data];
}

/** Whether any pixel in the box differs from the same box of `other`. */
function differs(
  a: Context,
  b: Context,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const da = a.getImageData(x, y, w, h).data;
  const db = b.getImageData(x, y, w, h).data;
  return da.some((v, i) => v !== db[i]);
}

function playingState(): WickState {
  const state = initialState();
  state.run = freshRun();
  state.screen = "playing";
  return state;
}

function zone(partial: Partial<Zone> & Pick<Zone, "weapon" | "kind">): Zone {
  return {
    id: 100,
    x: 0,
    y: 0,
    radius: 0,
    damage: 1,
    ttl: null,
    hits: [],
    bornTick: 0,
    ...partial,
  };
}

describe("the produced sprites in the frame", () => {
  it("decodes every produced image", () => {
    expect(assets.imageCount).toBe(producedImages().length);
    expect(assets.image(ASSET_PATHS.lamplighterIdle)).not.toBeNull();
  });

  it("draws the lamplighter's sprite at the stage center, not the stand-in", () => {
    const state = playingState();
    const withSprites = frame(state);
    const standIn = frame(state, new Assets());
    expect(
      differs(withSprites, standIn, STAGE_CX - 12, STAGE_CY - 16, 24, 32),
    ).toBe(true);
    expect(pixel(withSprites, STAGE_CX, STAGE_CY)[3]).toBe(255);
  });

  it("mirrors the lamplighter's sprite across the center by facing", () => {
    const run = freshRun();
    const right = blank(64, 64);
    drawLamplighterAt(right, run, assets, 32, 32);
    run.player.facing = "left";
    const left = blank(64, 64);
    drawLamplighterAt(left, run, assets, 32, 32);
    expect(pixel(right, 32, 32)[3]).toBe(255);
    for (let y = 16; y < 48; y += 1) {
      for (let x = 20; x < 44; x += 1) {
        expect(pixel(left, 63 - x, y)).toEqual(pixel(right, x, y));
      }
    }
  });

  it("advances the walk sheet with the moved ticks and holds the idle sprite at rest", () => {
    const state = playingState();
    const idle = frame(state);
    state.run.moving = true;
    state.run.movedTicks = 0;
    const walk0 = frame(state);
    state.run.movedTicks = 6;
    const walk1 = frame(state);
    const box = [STAGE_CX - 12, STAGE_CY - 16, 24, 32] as const;
    expect(differs(idle, walk0, ...box)).toBe(true);
    expect(differs(walk0, walk1, ...box)).toBe(true);
  });

  it("draws a slash sprite on the side of the lamplighter it extends to", () => {
    const run = freshRun();
    const slash = zone({
      weapon: "taper",
      kind: "slash",
      x: 60,
      width: 120,
      height: 40,
    });
    const rightSide = blank(160, 60);
    drawZone(rightSide, run, assets, slash, 80, 30);
    slash.x = -60;
    const leftSide = blank(160, 60);
    drawZone(leftSide, run, assets, slash, 80, 30);
    expect(differs(rightSide, leftSide, 20, 10, 120, 40)).toBe(true);
    for (let y = 10; y < 50; y += 1) {
      for (let x = 20; x < 140; x += 1) {
        expect(pixel(leftSide, 159 - x, y)).toEqual(pixel(rightSide, x, y));
      }
    }
  });

  it("draws every enemy, effect, gem, and pickup sprite without throwing", () => {
    const state = playingState();
    const { run } = state;
    const types = [
      "moth",
      "bat",
      "rat",
      "gnat",
      "beetle",
      "wisp",
      "spider",
      "crow",
      "shade",
      "hound",
      "mothwing",
      "owl",
      "dark",
    ] as const;
    types.forEach((type, i) => spawnEnemy(run, type, -300 + i * 50, -200));
    run.enemies[0].age = 0.15;
    run.enemies[1].heading.x = -1;
    run.gems.push(
      { id: 20, tier: "small", x: -100, y: 100, attracted: false, bornTick: 0 },
      { id: 21, tier: "medium", x: -80, y: 100, attracted: false, bornTick: 0 },
      { id: 22, tier: "large", x: -60, y: 100, attracted: false, bornTick: 0 },
    );
    run.pickups.push(
      { id: 23, kind: "chest", x: 0, y: 150 },
      { id: 24, kind: "bread", x: 40, y: 150 },
      { id: 25, kind: "draft", x: 80, y: 150 },
    );
    run.puffs.push({ x: 120, y: 150, bornTick: 0 });
    const projectiles = [
      "ember",
      "beacon",
      "pin",
      "hail",
      "shard",
      "sconce",
    ] as const;
    projectiles.forEach((weapon, i) => {
      run.projectiles.push({
        id: 30 + i,
        weapon,
        x: -200 + i * 40,
        y: 200,
        vx: i % 2 === 0 ? 100 : -100,
        vy: i === 2 ? 0 : 50,
        ax: 0,
        ay: 0,
        radius: 8,
        damage: 1,
        ttl: 1,
        pierce: 0,
        hits: [],
        bornTick: 0,
      });
    });
    run.zones.push(
      zone({ weapon: "halo", kind: "aura", radius: 80 }),
      zone({ weapon: "corona", kind: "aura", radius: 150, x: 300, y: 300 }),
      zone({
        weapon: "oil-splash",
        kind: "puddle",
        radius: 50,
        x: -300,
        y: 200,
        pulse: 0.1,
      }),
      zone({
        weapon: "blaze",
        kind: "puddle",
        radius: 70,
        x: -400,
        y: 200,
        pulse: 0.2,
      }),
      zone({
        weapon: "lantern",
        kind: "lantern",
        radius: 14,
        x: 90,
        y: 0,
        angle: 0,
        orbit: 90,
      }),
      zone({
        weapon: "chandelier",
        kind: "lantern",
        radius: 20,
        x: -90,
        y: 0,
        angle: 180,
        orbit: 90,
      }),
      zone({
        weapon: "spark",
        kind: "strike",
        radius: 40,
        x: 200,
        y: -100,
        ttl: 0.2,
      }),
      zone({ weapon: "flare", kind: "burst", radius: 640, ttl: 0.4 }),
      zone({
        weapon: "pyre",
        kind: "slash",
        x: 100,
        width: 200,
        height: 60,
        ttl: 0.1,
      }),
    );
    run.weapons.push(
      { id: "halo", level: 2, cooldown: 0.5, cooldownSet: 1 },
      { id: "corona", level: 1, cooldown: 0.5, cooldownSet: 0.5 },
    );
    run.passives.push({ id: "wick", level: 3 });
    run.tick = 6;
    const ctx = frame(state);
    // The aura sits on the ground under the lamplighter; its ring lies at
    // radius 80 and the pulse glow fills within it, so a pixel just inside
    // the ring is warmer than the bare ground far outside it.
    const inside = pixel(ctx, STAGE_CX + 70, STAGE_CY);
    const outside = pixel(ctx, STAGE_CX + 300, STAGE_CY - 300);
    expect(inside).not.toEqual(outside);
    for (const screen of [
      "levelup",
      "chest",
      "paused",
      "fallen",
      "dawn",
      "title",
      "howto",
    ] as const) {
      state.screen = screen;
      if (screen === "levelup") run.offers = ["ember", "brass", "lamp-oil"];
      if (screen === "chest")
        run.chestResult = { kind: "evolve", weapon: "chandelier" };
      expect(() => frame(state)).not.toThrow();
    }
  });

  it("draws the almanac's produced picture and walks its enemy sheet", () => {
    const state = initialState();
    state.screen = "almanac";
    const pane = [
      ALMANAC.paneX,
      ALMANAC.paneY,
      ALMANAC.paneWidth,
      ALMANAC.paneHeight,
    ] as const;
    // The tools tab draws Taper's produced icon and effect, not the stand-ins.
    expect(differs(frame(state), frame(state, new Assets()), ...pane)).toBe(
      true,
    );
    // The enemies tab's walk sheet advances on `simTime`, which every frame
    // raises whatever the screen, so the almanac animates while nothing ticks.
    state.almanacTab = 2;
    const early = frame(state);
    state.simTime = WALK_FRAME_TIME;
    expect(differs(early, frame(state), ...pane)).toBe(true);
    // One entry of each picture the four tabs draw: a tool whose effect is a
    // sheet, a trinket, an enemy, a gem, and a pickup.
    for (const [tab, index] of [
      [0, 6],
      [1, 0],
      [2, 12],
      [3, 2],
      [3, 4],
    ] as const) {
      state.almanacTab = tab;
      state.menuIndex = index;
      state.almanacScroll = 0;
      expect(() => frame(state)).not.toThrow();
    }
  });

  it("draws every icon in the HUD's slots", () => {
    const state = playingState();
    const empty = frame(state);
    state.run.weapons.push({
      id: "spark",
      level: 4,
      cooldown: 0,
      cooldownSet: 2,
    });
    state.run.passives.push({ id: "lure", level: 1 });
    const filled = frame(state);
    // The second weapon slot and the first passive slot changed; the held
    // items fill their slots from the first.
    const slotsY = STAGE_H - 24 - 44;
    const passivesX = STAGE_W - 24 - 6 * 52 + 8;
    expect(differs(empty, filled, 24 + 52, slotsY, 44, 44)).toBe(true);
    expect(differs(empty, filled, passivesX, slotsY, 44, 44)).toBe(true);
    expect(differs(empty, filled, passivesX + 52, slotsY, 44, 44)).toBe(false);
  });
});
