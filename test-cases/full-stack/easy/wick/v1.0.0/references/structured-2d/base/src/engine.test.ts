// Wick under the engine, in process.
//
// Every check here drives a real engine through `src/harness.ts`: the frame
// loop, the fixed tick the game mode resolves inside it, the keyboard the
// player controller reads, the cue bus and the two loops, the camera on the
// lamplighter, the actors the reconciler keeps mirroring the state, and the
// pixels the pipeline's draw components produced. Nothing is reimplemented:
// what runs is the same `GameDefinition` `src/main.ts` binds to the engine in
// a browser.

import { loadImage } from "@napi-rs/canvas";
import { ConstantClock } from "@clockwyrks/structured-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { producedImagePaths, wickAssets } from "./assets";
import {
  ALMANAC_ROWS,
  CUES,
  ENEMY_IDS,
  HURT_FLASH,
  MOVE_SPEED,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TAGS,
  TICK_DT,
  TICK_HZ,
  TITLE_ITEMS,
  WALK_FRAME_TIME,
  WHEEL_ROW,
} from "./constants";
import { createHarness, FRAME_MS, type Harness } from "./harness";
import { COLORS } from "./render/theme";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Start a run from the title exactly as a player does. */
async function lightTheLamp(): Promise<void> {
  await h.step(1);
  h.tap("Enter");
  await h.step(1);
}

/** Decode every produced file into the loaded set the render components read. */
async function loadProducedImages(): Promise<void> {
  for (const path of producedImagePaths()) {
    const image = await loadImage(
      new URL(`../assets/${path}`, import.meta.url),
    );
    wickAssets().set(path, image as unknown as ImageBitmap);
  }
}

/**
 * Whether two frames' pixel bytes are identical, byte for byte.
 *
 * A plain comparison over the arrays themselves, so the check needs nothing
 * from outside the browser lib this project type-checks against.
 */
function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** How many pixels of the frame differ from the stage background. */
function painted(): number {
  const { data } = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== 0x0b || data[i + 1] !== 0x0a || data[i + 2] !== 0x14) {
      count += 1;
    }
  }
  return count;
}

describe("boot", () => {
  it("opens on the title with the idle run and the scenery placed", async () => {
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.menuIndex).toBe(0);
    expect(TITLE_ITEMS[snap.menuIndex]).toBe("LIGHT THE LAMP");
    expect(snap.run.weapons).toEqual([]);
    expect(h.engine.world.byTag(TAGS.lamplighter)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.hud)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.screen)).toHaveLength(1);
    expect(h.engine.world.byTag(TAGS.enemy)).toHaveLength(0);
  });

  it("draws a real picture without a produced asset", async () => {
    await h.step(1);
    expect(COLORS.stage).toBe("#0b0a14");
    expect(painted()).toBeGreaterThan(20000);
  });

  it("holds the state the debug surface reads on the world", async () => {
    await h.step(1);
    expect(h.state).toBe(h.engine.world.state);
    expect(h.state.screen).toBe("title");
  });
});

describe("the keyboard path", () => {
  it("starts a fresh run on Enter and moves the highlight with wrap-around", async () => {
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    h.tap("KeyS");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(2);
    h.tap("KeyS");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(0);
    h.tap("KeyW");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(2);
    expect(h.cues.filter((cue) => cue === CUES.menuMove)).toHaveLength(4);
    h.tap("KeyW");
    await h.step(1);
    h.tap("KeyW");
    await h.step(1);
    h.tap("Space");
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("playing");
    expect(h.cues).toContain(CUES.menuConfirm);
    // The controller answers the edge before the mode ticks, so the frame
    // that confirmed also ran the run's first tick, on which Taper fired.
    expect(snap.run.tick).toBe(1);
    expect(snap.run.weapons).toHaveLength(1);
    expect(snap.run.weapons[0]).toMatchObject({ id: "taper", level: 1 });
    expect(snap.run.weapons[0].cooldown).toBeGreaterThan(0);
    expect(snap.run.zones.filter((zone) => zone.kind === "slash")).toHaveLength(
      1,
    );
  });

  it("opens the how-to from the menu and returns on Escape", async () => {
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("howto");
    h.tap("Escape");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("title");
  });

  it("moves the lamplighter at MOVE_SPEED while a key is held, and faces it", async () => {
    await lightTheLamp();
    h.debug.setWeaponFire(false);
    h.press("ArrowRight");
    await h.step(30);
    h.release("ArrowRight");
    await h.step(1);
    let snap = h.debug.snapshot();
    // 30 held ticks, then the release frame's tick reads the key up.
    expect(snap.run.player.x).toBeCloseTo(30 * MOVE_SPEED * TICK_DT, 9);
    expect(snap.run.player.facing).toBe("right");
    h.press("KeyA");
    h.press("KeyW");
    await h.step(10);
    h.release("KeyA");
    h.release("KeyW");
    snap = h.debug.snapshot();
    const step = MOVE_SPEED * TICK_DT * Math.SQRT1_2;
    expect(snap.run.player.x).toBeCloseTo(90 - 10 * step, 9);
    expect(snap.run.player.y).toBeCloseTo(-10 * step, 9);
    expect(snap.run.player.facing).toBe("left");
  });

  it("a repeat keydown arms no edge", async () => {
    await h.step(1);
    h.tap("ArrowDown", true);
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(0);
  });

  it("toggles mute on KeyM from any screen and mirrors it into the state", async () => {
    await h.step(1);
    h.tap("KeyM");
    await h.step(1);
    expect(h.debug.snapshot().muted).toBe(true);
    expect(h.engine.world.audio.muted()).toBe(true);
    await lightTheLamp();
    h.tap("KeyM");
    await h.step(1);
    expect(h.debug.snapshot().muted).toBe(false);
  });
});

describe("pausing", () => {
  it("freezes the simulation on KeyP, and both keys resume it intact", async () => {
    await lightTheLamp();
    await h.step(30);
    h.tap("KeyP");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("paused");
    const frozen = h.debug.snapshot();
    await h.step(30);
    const later = h.debug.snapshot();
    expect(later.run).toEqual(frozen.run);
    expect(later.accumulator).toBe(0);
    h.tap("KeyP");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("playing");
    // The resume frame itself carries one tick, so play carries on from
    // exactly the frozen state.
    expect(h.debug.snapshot().run.tick).toBe(frozen.run.tick + 1);
    h.tap("Escape");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("paused");
    h.tap("Escape");
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("playing");
  });

  it("abandons the night on MAIN MENU", async () => {
    await lightTheLamp();
    await h.step(30);
    h.tap("Escape");
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    h.tap("Enter");
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("title");
    expect(snap.run.tick).toBe(0);
    expect(snap.run.weapons).toEqual([]);
    expect(h.cues).toContain(CUES.menuConfirm);
  });
});

describe("the pointer path", () => {
  /** The center of the rectangle `menuRects` reports for item `index`. */
  function center(index: number): [number, number] {
    const rect = h.debug.menuRects()[index];
    return [rect.x + rect.width / 2, rect.y + rect.height / 2];
  }

  /** A point inside that rectangle, clear of the centered label. */
  function inside(index: number): [number, number] {
    const rect = h.debug.menuRects()[index];
    return [rect.x + 8, rect.y + rect.height / 2];
  }

  it("draws the highlighted item inside the rectangle it is clicked in", async () => {
    await h.step(1);
    h.hover(...center(1));
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    // COLORS.highlight fills the highlighted item's rectangle, and only it.
    expect(h.pixel(...inside(1))).toEqual([0xff, 0xcf, 0x5c]);
    expect(h.pixel(...inside(0))).not.toEqual([0xff, 0xcf, 0x5c]);
    expect(h.pixel(...inside(2))).not.toEqual([0xff, 0xcf, 0x5c]);
  });

  it("moves the title highlight on hover, sounding menu-move once", async () => {
    await h.step(1);
    h.hover(...center(1));
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(1);
    expect(h.cues.filter((cue) => cue === CUES.menuMove)).toHaveLength(1);
    await h.step(3);
    expect(h.cues.filter((cue) => cue === CUES.menuMove)).toHaveLength(1);
  });

  it("leaves the highlight alone outside every rectangle", async () => {
    await h.step(1);
    h.hover(STAGE_W - 4, 4);
    await h.step(1);
    expect(h.debug.snapshot().menuIndex).toBe(0);
    expect(h.cues).not.toContain(CUES.menuMove);
  });

  it("moves the highlight and takes the item on a click", async () => {
    await h.step(1);
    h.click(...center(2));
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("howto");
    expect(h.cues).toContain(CUES.menuConfirm);
    expect(h.cues).toContain(CUES.menuMove);
  });

  it("takes nothing on a click outside every rectangle", async () => {
    await h.step(1);
    h.click(STAGE_W - 4, STAGE_H - 4);
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("title");
    expect(h.debug.snapshot().menuIndex).toBe(0);
    expect(h.cues).toEqual([]);
  });

  it("selects a tab on a click and scrolls the list on the wheel", async () => {
    h.debug.setScreen("almanac");
    await h.step(1);
    const tab = h.debug.tabRects()[2];
    h.click(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await h.step(1);
    let snap = h.debug.snapshot();
    expect(snap.almanacTab).toBe(2);
    expect(snap.menuIndex).toBe(0);
    expect(snap.almanacScroll).toBe(0);
    h.click(...center(2));
    await h.step(1);
    snap = h.debug.snapshot();
    expect(snap.screen).toBe("almanac");
    expect(snap.menuIndex).toBe(2);
    h.scroll(WHEEL_ROW);
    await h.step(1);
    snap = h.debug.snapshot();
    expect(snap.almanacScroll).toBe(1);
    expect(snap.menuIndex).toBe(2);
    h.scroll(WHEEL_ROW * 50);
    await h.step(1);
    expect(h.debug.snapshot().almanacScroll).toBe(
      ENEMY_IDS.length - ALMANAC_ROWS,
    );
  });
});

describe("the almanac", () => {
  /** Show the tab at `index`, one press edge per frame. */
  async function toTab(index: number): Promise<void> {
    for (let i = 0; i < index; i += 1) {
      h.tap("ArrowRight");
      await h.step(1);
    }
  }

  it("browses the night with the idle run, ticking nothing", async () => {
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("almanac");
    expect(snap.run.tick).toBe(0);
    expect(snap.run.weapons).toEqual([]);
    expect(h.loops).toEqual([]);
    await h.step(30);
    expect(h.debug.snapshot().run.tick).toBe(0);
  });

  it("draws a different picture as the tab changes", async () => {
    h.debug.setScreen("almanac");
    await h.step(1);
    const tools = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data.slice();
    await toTab(2);
    expect(h.debug.snapshot().almanacTab).toBe(2);
    const enemies = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    expect(sameBytes(enemies, tools)).toBe(false);
  });

  it("walks the enemy picture from simTime, which no tick advances", async () => {
    await loadProducedImages();
    h.debug.setScreen("almanac");
    await h.step(1);
    await toTab(2);
    const before = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data.slice();
    await h.step(Math.round(WALK_FRAME_TIME * TICK_HZ));
    const after = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    expect(h.debug.snapshot().run.tick).toBe(0);
    expect(sameBytes(after, before)).toBe(false);
  });
});

describe("the hurt flash", () => {
  it("arms on a contact hit, counts down, and casts over the view", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    h.debug.setEnemyMotion(false);
    h.debug.setWeaponFire(false);
    const clear = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data.slice();
    h.debug.spawnEnemy("moth", 0, 0);
    await h.step(1);
    expect(h.debug.snapshot().run.hurtFlash).toBe(HURT_FLASH);
    const cast = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    expect(sameBytes(cast, clear)).toBe(false);
    await h.step(1);
    expect(h.debug.snapshot().run.hurtFlash).toBeCloseTo(
      HURT_FLASH - TICK_DT,
      9,
    );
    await h.step(Math.round(HURT_FLASH * TICK_HZ) - 1);
    expect(h.debug.snapshot().run.hurtFlash).toBe(0);
    h.debug.setScreen("title");
    h.debug.setScreen("playing");
    expect(h.debug.snapshot().run.hurtFlash).toBe(0);
  });
});

describe("cues on the tick bus", () => {
  it("plays hit and kill once per tick as the shapes land", async () => {
    await lightTheLamp();
    h.debug.clearEnemies();
    h.debug.setSpawning(false);
    h.debug.setEnemyMotion(false);
    h.debug.setWeaponFire(false);
    h.debug.spawnEnemy("moth", 30, 0);
    h.debug.spawnEnemy("moth", 30, 6);
    h.debug.spawnProjectile("hail", 30, 3, 0, 0, 5);
    await h.step(1);
    expect(h.cues.filter((cue) => cue === CUES.hit)).toHaveLength(1);
    expect(h.cues.filter((cue) => cue === CUES.kill)).toHaveLength(1);
    expect(h.debug.snapshot().run.kills).toBe(2);
  });

  it("plays hurt on contact and fallen when the light goes out, stopping the music", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    h.debug.setEnemyMotion(false);
    h.debug.setHp(1);
    h.debug.spawnEnemy("moth", 0, 0);
    await h.step(1);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("fallen");
    expect(h.cues).toContain(CUES.hurt);
    expect(h.cues).toContain(CUES.fallen);
    expect(h.stops).toContain(CUES.music);
  });

  it("plays level-up when the overlay opens and choose on the accept", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    h.debug.setPendingLevelUps(1);
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("levelup");
    expect(h.cues).toContain(CUES.levelUp);
    h.tap("Enter");
    await h.step(1);
    expect(h.cues).toContain(CUES.choose);
    expect(h.debug.snapshot().screen).toBe("playing");
  });

  it("plays chest on the tick a chest is collected, and gem and pickup on theirs", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    h.debug.spawnGem("small", 0, 0);
    h.debug.spawnPickup("bread", 0, 0);
    await h.step(1);
    expect(h.cues).toContain(CUES.gem);
    expect(h.cues).toContain(CUES.pickup);
    h.debug.spawnPickup("chest", 0, 0);
    await h.step(1);
    expect(h.debug.snapshot().screen).toBe("chest");
    expect(h.cues).toContain(CUES.chest);
  });
});

describe("the loops", () => {
  it("loops the music from the frame a run starts to the frame it ends", async () => {
    await h.step(1);
    expect(h.loops).toEqual([]);
    await lightTheLamp();
    expect(h.loops).toEqual([CUES.music]);
    h.tap("KeyP");
    await h.step(1);
    h.tap("ArrowDown");
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    expect(h.stops).toEqual([CUES.music]);
  });

  it("loops the hum exactly while Halo is held on playing", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    h.debug.setWeapon(1, "halo", 1);
    await h.step(1);
    expect(h.loops).toContain(CUES.hum);
    expect(h.engine.world.audio.looping(CUES.hum)).toBe(true);
    h.tap("KeyP");
    await h.step(1);
    expect(h.stops).toContain(CUES.hum);
    expect(h.engine.world.audio.looping(CUES.music)).toBe(true);
    h.tap("KeyP");
    await h.step(1);
    expect(h.loops.filter((cue) => cue === CUES.hum)).toHaveLength(2);
    h.debug.removeWeapon(1);
    await h.step(1);
    expect(h.engine.world.audio.looping(CUES.hum)).toBe(false);
  });
});

describe("the actor population", () => {
  it("mirrors enemies, projectiles, zones, gems, and pickups after poses and play", async () => {
    h.debug.setSpawning(false);
    h.debug.setWeaponFire(false);
    await lightTheLamp();
    h.debug.spawnEnemy("bat", 200, 0);
    h.debug.spawnEnemy("owl", -300, 0);
    h.debug.spawnProjectile("ember", 500, 0, 0, 0, 0);
    h.debug.spawnPuddle("blaze", 400, 400);
    h.debug.spawnGem("large", 300, 300);
    h.debug.spawnPickup("draft", 300, -300);
    const world = h.engine.world;
    expect(world.byTag(TAGS.enemy)).toHaveLength(2);
    expect(world.byTag(TAGS.projectile)).toHaveLength(1);
    expect(world.byTag(TAGS.zone)).toHaveLength(1);
    expect(world.byTag(TAGS.gem)).toHaveLength(1);
    expect(world.byTag(TAGS.pickup)).toHaveLength(1);
    await h.step(1);
    const [bat] = world.byTag(TAGS.enemy);
    const record = h.debug.snapshot().run.enemies[0];
    expect(bat.transform.x).toBeCloseTo(record.x, 9);
    h.debug.clearEnemies();
    h.debug.clearZones();
    await h.step(1);
    expect(world.byTag(TAGS.enemy)).toHaveLength(0);
    expect(world.byTag(TAGS.zone)).toHaveLength(0);
    expect(world.byTag(TAGS.lamplighter)).toHaveLength(1);
  });
});

describe("the camera", () => {
  it("follows the lamplighter at zoom 1, so world points land where the formula puts them", async () => {
    await lightTheLamp();
    h.debug.setPlayerPosition(500, -250);
    await h.step(1);
    const camera = h.engine.world.camera.snapshot();
    expect(camera.zoom).toBe(1);
    expect(camera.x).toBeCloseTo(500, 9);
    expect(camera.y).toBeCloseTo(-250, 9);
    const at = h.engine.world.camera.worldToLogical({ x: 620, y: -200 });
    expect(at.x).toBeCloseTo(620 - 500 + STAGE_CX, 9);
    expect(at.y).toBeCloseTo(-200 + 250 + STAGE_CY, 9);
    const [pawn] = h.engine.world.byTag(TAGS.lamplighter);
    expect(pawn.transform.x).toBe(500);
    expect(h.engine.world.camera.target).toBe(pawn);
  });

  it("keeps the HUD actor at the camera target's position", async () => {
    await lightTheLamp();
    h.debug.setPlayerPosition(-80, 40);
    await h.step(1);
    const [hud] = h.engine.world.byTag(TAGS.hud);
    expect(hud.transform.x).toBe(-80);
    expect(hud.transform.y).toBe(40);
  });
});

describe("the picture", () => {
  it("draws the lamplighter at the stage center from the code fallback", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    await h.step(1);
    const [r, g, b] = h.pixel(STAGE_CX, STAGE_CY);
    // COLORS.lamplighter is a warm cream.
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(160);
    expect(b).toBeLessThan(160);
  });

  it("draws every produced sprite once the files decode", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    h.debug.setWeaponFire(false);
    await loadProducedImages();
    h.debug.spawnEnemy("dark", 200, 0);
    h.debug.setEnemyMotion(false);
    h.debug.spawnGem("large", 0, 200);
    h.debug.spawnPickup("chest", -200, 0);
    await h.step(1);
    const before = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    // The Dark's sprite sits over the ground at its world position.
    const [r, g, b] = h.pixel(STAGE_CX + 200, STAGE_CY);
    expect(r + g + b).toBeGreaterThan(0);
    h.debug.setFacing("left");
    await h.step(1);
    const after = h.ctx.getImageData(0, 0, STAGE_W, STAGE_H).data;
    // Mirroring the lamplighter changes the pixels about the stage center.
    let changed = 0;
    for (let y = STAGE_CY - 16; y < STAGE_CY + 16; y += 1) {
      for (let x = STAGE_CX - 12; x < STAGE_CX + 12; x += 1) {
        const i = (y * STAGE_W + x) * 4;
        if (before[i] !== after[i] || before[i + 1] !== after[i + 1]) {
          changed += 1;
        }
      }
    }
    expect(changed).toBeGreaterThan(20);
  });
});

describe("the fixed timestep", () => {
  it("resolves sixty ticks a second whatever the frame cadence", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    const opening = h.debug.snapshot().run.tick;
    h.engine.setClock(new ConstantClock(1000 / 30));
    await h.step(30);
    expect(h.debug.snapshot().run.tick).toBe(opening + 60);
    h.engine.setClock(new ConstantClock(1000 / 120));
    await h.step(120);
    expect(h.debug.snapshot().run.tick).toBe(opening + 120);
    h.engine.setClock(new ConstantClock(FRAME_MS));
  });

  it("carries the remainder of a partial frame and discards it off playing", async () => {
    await lightTheLamp();
    h.debug.setSpawning(false);
    const opening = h.debug.snapshot();
    h.engine.setClock(new ConstantClock(25));
    await h.step(1);
    let snap = h.debug.snapshot();
    expect(snap.run.tick).toBe(opening.run.tick + 1);
    expect(snap.accumulator).toBeCloseTo(0.025 - TICK_DT, 9);
    expect(snap.simTime).toBeCloseTo(opening.simTime + 0.025, 9);
    h.debug.setPendingLevelUps(1);
    await h.step(1);
    snap = h.debug.snapshot();
    expect(snap.screen).toBe("levelup");
    expect(snap.accumulator).toBe(0);
    h.engine.setClock(new ConstantClock(FRAME_MS));
  });
});

describe("a night through the engine", () => {
  it("plays a stretch of the night from the title with the director running", async () => {
    h.debug.reset();
    await h.step(1);
    h.tap("Enter");
    await h.step(1);
    h.press("ArrowRight");
    await h.step(240);
    h.release("ArrowRight");
    await h.step(60);
    const snap = h.debug.snapshot();
    expect(snap.screen).toBe("playing");
    expect(snap.run.tick).toBe(301);
    expect(snap.run.enemies.length).toBeGreaterThan(0);
    expect(snap.run.player.x).toBeGreaterThan(0);
  });
});
