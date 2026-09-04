import { describe, expect, it } from "vitest";
import {
  BASE_WEAPON_IDS,
  LAMP_OIL_ID,
  MAX_WEAPON_LEVEL,
  PASSIVE_IDS,
  type CueName,
} from "../constants";
import { Rng } from "../rng";
import { freshRun, initialState, type Draft } from "../state";
import { xpToNext } from "../stats";
import { NOTHING_HELD, makeTickContext, type TickContext } from "./context";
import {
  acceptOffer,
  applyOffer,
  candidatePool,
  gainXp,
  openChest,
  openLevelUp,
} from "./progression";

function world(): { state: Draft; ctx: TickContext } {
  const state = initialState(1);
  state.run = freshRun();
  state.screen = "playing";
  const ctx = makeTickContext(
    state,
    new Rng(() => state),
    NOTHING_HELD,
    new Set<CueName>(),
  );
  return { state, ctx };
}

describe("experience", () => {
  it("needs XP_BASE + XP_STEP × (level − 1) to leave a level", () => {
    const table = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
    table.forEach((needed, i) => expect(xpToNext(i + 1)).toBe(needed));
    const run = freshRun();
    gainXp(run, 4);
    expect([run.level, run.xp, run.pendingLevelUps]).toEqual([1, 4, 0]);
    gainXp(run, 1);
    expect([run.level, run.xp, run.pendingLevelUps]).toEqual([2, 0, 1]);
    const fresh = freshRun();
    gainXp(fresh, 500);
    expect([fresh.level, fresh.xp, fresh.pendingLevelUps]).toEqual([11, 0, 10]);
    const short = freshRun();
    gainXp(short, 499);
    expect([short.level, short.xp]).toEqual([10, 94]);
  });

  it("carries overflow across several levels from one gain", () => {
    const run = freshRun();
    gainXp(run, 21);
    expect(run.level).toBe(3);
    expect(run.xp).toBe(1);
    expect(run.pendingLevelUps).toBe(2);
  });
});

describe("the candidate pool", () => {
  it("offers every unheld item and Taper's next level on a fresh run", () => {
    const { state } = world();
    expect(candidatePool(state.run)).toEqual([
      ...BASE_WEAPON_IDS,
      ...PASSIVE_IDS,
    ]);
  });

  it("drops a maxed weapon, a maxed passive, and new items when slots are full", () => {
    const { state } = world();
    const { run } = state;
    run.weapons[0].level = MAX_WEAPON_LEVEL;
    run.weapons.push(
      { id: "ember", level: 1, cooldown: 0, cooldownSet: 0 },
      { id: "pin", level: 1, cooldown: 0, cooldownSet: 0 },
      { id: "lantern", level: 1, cooldown: 0, cooldownSet: 0 },
      { id: "halo", level: 1, cooldown: 0, cooldownSet: 0 },
      { id: "flare", level: 1, cooldown: 0, cooldownSet: 0 },
    );
    run.passives.push({ id: "mirror", level: 2 }, { id: "brass", level: 1 });
    const pool = candidatePool(run);
    expect(pool).toEqual([
      "ember",
      "pin",
      "lantern",
      "halo",
      "flare",
      "wick",
      "oil",
      "glass",
      "brass",
      "bellows",
      "tallow",
      "tinder",
      "soot",
      "lure",
    ]);
  });

  it("never offers an evolved weapon or the base it came from", () => {
    const { state } = world();
    state.run.weapons[0] = {
      id: "pyre",
      level: 1,
      cooldown: 0,
      cooldownSet: 0,
    };
    const pool = candidatePool(state.run);
    expect(pool).not.toContain("taper");
    expect(pool).not.toContain("pyre");
    expect(pool).toContain("ember");
  });
});

describe("the level-up overlay", () => {
  it("draws three distinct offers from the pool and sounds level-up", () => {
    const { state, ctx } = world();
    openLevelUp(state, ctx.rng, ctx.cues);
    expect(state.screen).toBe("levelup");
    expect(state.menuIndex).toBe(0);
    expect(state.run.offers).toHaveLength(3);
    expect(new Set(state.run.offers).size).toBe(3);
    for (const id of state.run.offers)
      expect(candidatePool(state.run)).toContain(id);
    expect(ctx.cues.has("level-up")).toBe(true);
  });

  it("presents a valid nextOffers list once, then draws at random again", () => {
    const { state, ctx } = world();
    state.run.nextOffers = ["taper", "lure"];
    openLevelUp(state, ctx.rng, ctx.cues);
    expect(state.run.offers).toEqual(["taper", "lure"]);
    expect(state.run.nextOffers).toBeNull();
    openLevelUp(state, ctx.rng, ctx.cues);
    expect(state.run.offers).toHaveLength(3);
  });

  it("discards a nextOffers list that is not in the pool", () => {
    const { state, ctx } = world();
    state.run.nextOffers = ["taper", LAMP_OIL_ID];
    openLevelUp(state, ctx.rng, ctx.cues);
    expect(state.run.offers).toHaveLength(3);
    expect(state.run.offers).not.toContain(LAMP_OIL_ID);
    expect(state.run.nextOffers).toBeNull();
  });

  it("offers the whole of a small pool, and lamp oil alone over an empty one", () => {
    const { state, ctx } = world();
    const { run } = state;
    run.weapons[0].level = MAX_WEAPON_LEVEL;
    for (const id of ["ember", "pin", "lantern", "halo", "flare"] as const) {
      run.weapons.push({
        id,
        level: MAX_WEAPON_LEVEL,
        cooldown: 0,
        cooldownSet: 0,
      });
    }
    for (const id of ["wick", "oil", "glass", "brass", "mirror"] as const) {
      run.passives.push({ id, level: 5 });
    }
    run.passives.push({ id: "bellows", level: 4 });
    run.passives[3].level = 3;
    run.passives[4].level = 2;
    openLevelUp(state, ctx.rng, ctx.cues);
    expect(state.run.offers).toEqual(["bellows"]);
    run.passives[5].level = 5;
    run.nextOffers = [LAMP_OIL_ID];
    openLevelUp(state, ctx.rng, ctx.cues);
    expect(state.run.offers).toEqual([LAMP_OIL_ID]);
    run.nextOffers = null;
    openLevelUp(state, ctx.rng, ctx.cues);
    expect(state.run.offers).toEqual([LAMP_OIL_ID]);
  });
});

describe("accepting", () => {
  it("puts a new item in the first free slot at level 1 with its timer at 0", () => {
    const { ctx, state } = world();
    state.run.weapons[0].cooldown = 1;
    applyOffer(ctx, "ember");
    applyOffer(ctx, "lure");
    expect(state.run.weapons[1]).toMatchObject({
      id: "ember",
      level: 1,
      cooldown: 0,
    });
    expect(state.run.passives[0]).toEqual({ id: "lure", level: 1 });
    expect(state.run.weapons[0].cooldown).toBe(1);
  });

  it("levels a held item, keeping a weapon's timer", () => {
    const { ctx, state } = world();
    state.run.weapons[0].cooldown = 0.7;
    applyOffer(ctx, "taper");
    expect(state.run.weapons[0]).toMatchObject({
      id: "taper",
      level: 2,
      cooldown: 0.7,
    });
  });

  it("adds Tallow's health with its level, and lamp oil heals capped", () => {
    const { ctx, state } = world();
    state.run.player.hp = 100;
    applyOffer(ctx, "tallow");
    expect(state.run.player.hp).toBe(115);
    applyOffer(ctx, "tallow");
    expect(state.run.player.hp).toBe(130);
    state.run.player.hp = 120;
    applyOffer(ctx, LAMP_OIL_ID);
    expect(state.run.player.hp).toBe(130);
    expect(state.run.passives).toEqual([{ id: "tallow", level: 2 }]);
  });

  it("opens the next queued overlay with a fresh pool, else returns to playing", () => {
    const { ctx, state } = world();
    state.run.pendingLevelUps = 2;
    openLevelUp(state, ctx.rng, ctx.cues);
    ctx.cues.clear();
    const first = state.run.offers[0];
    acceptOffer(ctx, 0);
    expect(ctx.cues.has("choose")).toBe(true);
    expect(ctx.cues.has("level-up")).toBe(true);
    expect(state.screen).toBe("levelup");
    expect(state.run.pendingLevelUps).toBe(1);
    expect(state.menuIndex).toBe(0);
    if (first !== "taper") {
      expect(candidatePool(state.run)).toContain(first);
    }
    acceptOffer(ctx, 0);
    expect(state.screen).toBe("playing");
    expect(state.run.pendingLevelUps).toBe(0);
    expect(state.run.offers).toEqual([]);
  });
});

describe("a chest", () => {
  it("evolves the first eligible weapon in slot order", () => {
    const { ctx, state } = world();
    state.run.weapons[0].level = MAX_WEAPON_LEVEL;
    state.run.weapons.push({
      id: "ember",
      level: 8,
      cooldown: 0.3,
      cooldownSet: 1,
    });
    state.run.passives.push({ id: "oil", level: 1 }, { id: "wick", level: 2 });
    expect(openChest(ctx)).toEqual({ kind: "evolve", weapon: "pyre" });
    expect(state.run.weapons[0]).toMatchObject({
      id: "pyre",
      level: 1,
      cooldown: 0,
    });
    expect(state.run.weapons[1].id).toBe("ember");
    expect(ctx.cues.has("evolve")).toBe(true);
    expect(openChest(ctx)).toEqual({ kind: "evolve", weapon: "beacon" });
    expect(state.run.weapons[1]).toMatchObject({ id: "beacon", cooldown: 0 });
  });

  it("needs level 8 and the recipe passive", () => {
    const { ctx, state } = world();
    state.run.weapons[0].level = 7;
    state.run.passives.push({ id: "wick", level: 1 });
    expect(openChest(ctx).kind).toBe("level");
    state.run.weapons[0].level = MAX_WEAPON_LEVEL;
    state.run.passives[0] = { id: "oil", level: 1 };
    expect(openChest(ctx).kind).toBe("level");
    expect(state.run.weapons[0].id).toBe("taper");
  });

  it("levels one item below its max, else heals", () => {
    const { ctx, state } = world();
    state.run.weapons[0].level = 3;
    const result = openChest(ctx);
    expect(result).toEqual({ kind: "level", item: "taper", level: 4 });
    state.run.weapons[0].level = MAX_WEAPON_LEVEL;
    state.run.passives.push({ id: "brass", level: 3 });
    state.run.player.hp = 80;
    expect(openChest(ctx)).toEqual({ kind: "heal" });
    expect(state.run.player.hp).toBe(100);
  });
});
