import { describe, expect, it } from "vitest";
import {
  BAND_LABELS,
  CHALLENGE_BANNER,
  FIELD_BOTTOM,
  FIELD_TOP,
  FLUX_SIZE,
  GAME_OVER_ITEMS,
  HUD_BOTTOM_TOP,
  HUD_STAGE_LABEL,
  HUD_TOP_H,
  PAUSE_ITEMS,
  PERFECT_TEXT,
  PRISM_SIZE,
  READY_HOLD,
  READY_TEXT,
  RESONANCE_MAX,
  SHARD_SIZE,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  STARFIELD_MIN,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  fluxHold,
} from "./constants";
import {
  createHarness,
  lastDroneId,
  startPosed,
  type Harness,
} from "./harness";
import { art, resetArt, setArt } from "./sprites";

type Rgb = [number, number, number];

function patch(h: Harness, cx: number, cy: number, w: number, hh: number): Rgb {
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = Math.round(cy - hh / 2); y <= Math.round(cy + hh / 2); y += 1) {
    for (let x = Math.round(cx - w / 2); x <= Math.round(cx + w / 2); x += 1) {
      const [r, g, b] = h.pixel(x, y);
      red += r;
      green += g;
      blue += b;
      count += 1;
    }
  }
  return [red / count, green / count, blue / count];
}

function apart(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Every drawn element of one posed field, sampled over its own footprint. */
async function palette(): Promise<{
  h: Harness;
  field: Rgb;
  shardCyan: Rgb;
  shardMagenta: Rgb;
  fluxHeld: Rgb;
  fluxShimmer: Rgb;
  prism: Rgb;
  prismCore: Rgb;
  bulletCyan: Rgb;
  bulletMagenta: Rgb;
  shipCyan: Rgb;
}> {
  const h = await createHarness();
  startPosed(h.debug);
  const put = (
    kind: "shard" | "flux" | "prism",
    x: number,
    band: "cyan" | "magenta",
    pose: (id: number) => void = () => {},
  ): void => {
    h.debug.addDrone(kind, x, 220);
    const id = lastDroneId(h.debug);
    h.debug.setDroneBand(id, band);
    h.debug.setDroneTravel(id, false);
    h.debug.setDroneOscillation(id, false);
    h.debug.setDroneFire(id, false);
    pose(id);
  };
  put("shard", 160, "cyan");
  put("shard", 300, "magenta");
  put("flux", 440, "cyan");
  put("flux", 580, "cyan", (id) =>
    h.debug.setDroneBandClock(id, fluxHold(1) + 0.1),
  );
  put("prism", 760, "cyan");
  put("prism", 920, "magenta", (id) => h.debug.setDroneShell(id, false));
  h.debug.addPlayerBullet(1080, 400, "cyan");
  h.debug.addEnemyBullet(1160, 400, "magenta");
  await h.advance(1);
  const snap = h.debug.snapshot();
  const mine = snap.bullets.find((bullet) => bullet.friendly);
  const theirs = snap.bullets.find((bullet) => !bullet.friendly);

  return {
    h,
    field: patch(h, 200, 520, 24, 24),
    shardCyan: patch(h, 160, 220, SHARD_SIZE, SHARD_SIZE),
    shardMagenta: patch(h, 300, 220, SHARD_SIZE, SHARD_SIZE),
    fluxHeld: patch(h, 440, 220, FLUX_SIZE, FLUX_SIZE),
    fluxShimmer: patch(h, 580, 220, FLUX_SIZE, FLUX_SIZE),
    prism: patch(h, 760, 220, PRISM_SIZE, PRISM_SIZE),
    prismCore: patch(h, 920, 220, PRISM_SIZE, PRISM_SIZE),
    bulletCyan: patch(h, mine?.x ?? 0, mine?.y ?? 0, 16, 16),
    bulletMagenta: patch(h, theirs?.x ?? 0, theirs?.y ?? 0, 16, 16),
    shipCyan: patch(h, snap.ship.x, SHIP_Y, SHIP_W, SHIP_H),
  };
}

describe("what a player reads at a glance", () => {
  it("tells the two bands apart, and each from the field", async () => {
    const p = await palette();
    expect(apart(p.shardCyan, p.shardMagenta)).toBeGreaterThan(60);
    expect(apart(p.shardCyan, p.field)).toBeGreaterThan(40);
    expect(apart(p.shardMagenta, p.field)).toBeGreaterThan(40);
    p.h.dispose();
  });

  it("paints its code-drawn bullets from the same palette as its art", async () => {
    const p = await palette();
    expect(apart(p.bulletCyan, p.bulletMagenta)).toBeGreaterThan(60);
    expect(apart(p.bulletCyan, p.shardCyan)).toBeLessThan(
      apart(p.bulletCyan, p.shardMagenta),
    );
    expect(apart(p.bulletMagenta, p.shardMagenta)).toBeLessThan(
      apart(p.bulletMagenta, p.shardCyan),
    );
    p.h.dispose();
  });

  it("tells the three drones apart, and the ship from a drone of its band", async () => {
    const p = await palette();
    expect(apart(p.shardCyan, p.fluxHeld)).toBeGreaterThan(40);
    expect(apart(p.shardCyan, p.prism)).toBeGreaterThan(40);
    expect(apart(p.fluxHeld, p.prism)).toBeGreaterThan(40);
    expect(apart(p.shipCyan, p.shardCyan)).toBeGreaterThan(40);
    expect(apart(p.shipCyan, p.field)).toBeGreaterThan(40);
    p.h.dispose();
  });

  it("tells a shimmering Flux from one holding a band", async () => {
    const p = await palette();
    expect(apart(p.fluxHeld, p.fluxShimmer)).toBeGreaterThan(25);
    p.h.dispose();
  });

  it("draws a broken Prism as a smaller region than an intact one", async () => {
    const p = await palette();
    const lit = (cx: number): number => {
      let count = 0;
      for (let y = 220 - PRISM_SIZE / 2; y <= 220 + PRISM_SIZE / 2; y += 1) {
        for (let x = cx - PRISM_SIZE / 2; x <= cx + PRISM_SIZE / 2; x += 1) {
          if (apart(p.h.pixel(x, y) as Rgb, p.field) > 30) count += 1;
        }
      }
      return count;
    };
    expect(lit(920)).toBeLessThan(lit(760) * 0.7);
    p.h.dispose();
  });

  it("reads the ship's band on the ship itself", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    await h.advance(1);
    const cyan = patch(h, 640, SHIP_Y, SHIP_W, SHIP_H);
    h.debug.setShipBand("magenta");
    await h.advance(1);
    const magenta = patch(h, 640, SHIP_Y, SHIP_W, SHIP_H);
    expect(apart(cyan, magenta)).toBeGreaterThan(40);
    h.dispose();
  });

  it("shows a charge on the drone that carries it", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    for (let charge = 0; charge <= 2; charge += 1) {
      h.debug.addDrone("shard", 200 + charge * 200, 220);
      const id = lastDroneId(h.debug);
      h.debug.setDroneTravel(id, false);
      h.debug.setDroneCharge(id, charge);
    }
    await h.advance(1);
    const box = SHARD_SIZE * 1.3;
    const none = patch(h, 200, 220, box, box);
    const one = patch(h, 400, 220, box, box);
    const two = patch(h, 600, 220, box, box);
    expect(apart(none, one)).toBeGreaterThan(25);
    expect(apart(one, two)).toBeGreaterThan(25);
    h.dispose();
  });

  it("marks the whole field while an inversion runs", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    await h.advance(1);
    const before = [
      patch(h, 200, 200, 40, 40),
      patch(h, 640, 360, 40, 40),
      patch(h, 1000, 560, 40, 40),
    ];
    h.debug.setInversion(4);
    await h.advance(1);
    const after = [
      patch(h, 200, 200, 40, 40),
      patch(h, 640, 360, 40, 40),
      patch(h, 1000, 560, 40, 40),
    ];
    before.forEach((sample, index) => {
      expect(apart(sample, after[index])).toBeGreaterThan(20);
    });
    h.dispose();
  });

  it("keeps a starfield behind the field, dimmer than either band", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    await h.advance(1);
    const field: Rgb = [11, 16, 32];
    let marks = 0;
    for (let y = FIELD_TOP + 4; y < FIELD_BOTTOM - 4; y += 2) {
      for (let x = 4; x < 1276; x += 2) {
        const sample = h.pixel(x, y) as Rgb;
        if (apart(sample, field) > 12) marks += 1;
      }
    }
    expect(marks).toBeGreaterThan(STARFIELD_MIN);
    h.dispose();
  });

  it("keeps the play out of the HUD strips", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    await h.advance(1);
    const strips = (): string => {
      const rows: number[] = [];
      for (let x = 4; x < 1276; x += 4) {
        for (const y of [6, 20, 34, 48, 662, 676, 704, 716]) {
          rows.push(...h.pixel(x, y));
        }
      }
      return rows.join(",");
    };
    const empty = strips();
    // A whole formation of the largest drones, on the row nearest the top strip.
    for (let col = 0; col < 9; col += 1) {
      h.debug.addDrone("prism", 384 + col * 64, 140);
      const id = lastDroneId(h.debug);
      h.debug.setDroneTravel(id, false);
    }
    h.debug.setShipX(640);
    await h.advance(1);
    expect(strips()).toBe(empty);
    expect(HUD_TOP_H).toBe(64);
    expect(HUD_BOTTOM_TOP).toBe(656);
    h.dispose();
  });
});

describe("what each screen draws", () => {
  /** Every string one posed frame handed `fillText`, in order. */
  async function drawn(pose: (h: Harness) => void): Promise<string[]> {
    const h = await createHarness();
    startPosed(h.debug);
    pose(h);
    h.texts.length = 0;
    await h.advance(1);
    const said = [...h.texts];
    h.dispose();
    return said;
  }

  it("names the game and its menu on the title", async () => {
    const said = await drawn((h) => h.debug.reset());
    expect(said).toContain(TITLE_TEXT);
    expect(said).toContain(TAGLINE_TEXT);
    for (const item of TITLE_ITEMS) {
      expect(said.some((line) => line.includes(item))).toBe(true);
    }
  });

  it("names the keys and both bands on the how-to screen", async () => {
    const said = await drawn((h) => h.debug.setScreen("howto"));
    const all = said.join(" ");
    for (const token of [
      "ARROWS",
      "AD",
      "SPACE",
      BAND_LABELS.cyan,
      BAND_LABELS.magenta,
    ]) {
      expect(new RegExp(`\\b${token}\\b`).test(all)).toBe(true);
    }
  });

  it("names the stage on its intro, and a challenge stage as one", async () => {
    const plain = await drawn((h) => {
      h.debug.setStage(4);
      h.debug.setScreen("stageIntro");
      h.debug.setPhaseTimer(2);
    });
    expect(plain.some((line) => line.includes(HUD_STAGE_LABEL))).toBe(true);
    expect(plain.some((line) => line.includes("4"))).toBe(true);
    expect(plain).not.toContain(CHALLENGE_BANNER);

    const challenge = await drawn((h) => {
      h.debug.setStage(3);
      h.debug.setScreen("stageIntro");
      h.debug.setPhaseTimer(2);
    });
    expect(challenge).toContain(CHALLENGE_BANNER);
  });

  it("lists the pause menu and the game-over menu", async () => {
    const paused = await drawn((h) => h.debug.setScreen("paused"));
    for (const item of PAUSE_ITEMS) {
      expect(paused.some((line) => line.includes(item))).toBe(true);
    }
    const over = await drawn((h) => {
      h.debug.setScreen("gameOver");
      h.debug.setScore(7654);
      h.debug.setStage(5);
    });
    for (const item of GAME_OVER_ITEMS) {
      expect(over.some((line) => line.includes(item))).toBe(true);
    }
    expect(over.some((line) => line.includes("7654"))).toBe(true);
    expect(over.some((line) => line.includes("5"))).toBe(true);
  });

  it("reports a challenge stage's result, perfect or counted", async () => {
    const perfect = await drawn((h) => {
      h.debug.setStage(3);
      h.debug.setScreen("stageCleared");
      h.debug.setPhaseTimer(2);
      h.state.challengeHits = 40;
    });
    expect(perfect).toContain(PERFECT_TEXT);

    const missed = await drawn((h) => {
      h.debug.setStage(3);
      h.debug.setScreen("stageCleared");
      h.debug.setPhaseTimer(2);
      h.state.challengeHits = 37;
    });
    expect(missed.some((line) => line.includes("37"))).toBe(true);
  });

  it("announces the ready beat over the field", async () => {
    const said = await drawn((h) => {
      h.debug.setPhase("ready");
      h.debug.setPhaseTimer(READY_HOLD);
    });
    expect(said).toContain(READY_TEXT);
  });

  it("reports the run on the HUD", async () => {
    const said = await drawn((h) => {
      h.debug.setScore(1234);
      h.debug.setStage(8);
    });
    expect(said).toContain("1234");
    expect(said.some((line) => line.includes(`${HUD_STAGE_LABEL} 8`))).toBe(
      true,
    );
  });

  it("shows the mute indicator only while muted", async () => {
    const quiet = await drawn(() => {});
    expect(quiet.some((line) => line.includes("MUTED"))).toBe(false);
    const h = await createHarness();
    startPosed(h.debug);
    await h.tap("KeyM");
    h.texts.length = 0;
    await h.advance(1);
    expect(h.texts.some((line) => line.includes("MUTED"))).toBe(true);
    h.dispose();
  });

  it("draws a full meter differently from one a point below", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    h.debug.setResonance(RESONANCE_MAX - 1);
    await h.advance(1);
    const nearly = patch(h, 510, 688, 420, 20);
    h.debug.setResonance(RESONANCE_MAX);
    await h.advance(1);
    const full = patch(h, 510, 688, 420, 20);
    expect(apart(nearly, full)).toBeGreaterThan(20);
    h.dispose();
  });

  it("follows a flip with the polarity indicator", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    await h.advance(1);
    const cyan = patch(h, 1150, 688, 130, 40);
    await h.tap("KeyF");
    const magenta = patch(h, 1150, 688, 130, 40);
    expect(apart(cyan, magenta)).toBeGreaterThan(10);
    h.dispose();
  });
});

describe("what the build hands the canvas", () => {
  it("draws each entity from its own seeded sprite, at its own footprint", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    const put = (kind: "shard" | "flux" | "prism", x: number): void => {
      h.debug.addDrone(kind, x, 300);
      h.debug.setDroneTravel(lastDroneId(h.debug), false);
    };
    put("shard", 200);
    put("flux", 400);
    put("prism", 600);
    h.blits.length = 0;
    await h.advance(1);

    const at = (x: number) =>
      h.blits.filter((blit) => Math.abs(blit.x + blit.width / 2 - x) < 2);
    const boxes = (x: number) => at(x).map((blit) => blit.width);
    expect(boxes(200)).toContain(SHARD_SIZE);
    expect(boxes(400)).toContain(FLUX_SIZE);
    expect(boxes(600)).toContain(PRISM_SIZE);
    expect(at(640).map((blit) => blit.width)).toContain(SHIP_W);
    // One source, whichever band it is drawn in: the seeded silhouette.
    const sources = new Set(h.blits.map((blit) => blit.source));
    expect(sources.size).toBe(4);
    h.dispose();
  });

  it("draws one band's Shard from the same source as the other's", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    for (const [x, band] of [
      [200, "cyan"],
      [400, "magenta"],
    ] as const) {
      h.debug.addDrone("shard", x, 300);
      const id = lastDroneId(h.debug);
      h.debug.setDroneBand(id, band);
      h.debug.setDroneTravel(id, false);
    }
    h.blits.length = 0;
    await h.advance(1);
    const shards = h.blits.filter((blit) => blit.width === SHARD_SIZE);
    expect(shards).toHaveLength(2);
    expect(shards[0].source).toBe(shards[1].source);
    h.dispose();
  });

  it("draws no seeded frame at a bullet, which is code-drawn", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    h.debug.addPlayerBullet(300, 400, "cyan");
    h.debug.addEnemyBullet(900, 400, "magenta");
    h.blits.length = 0;
    await h.advance(1);
    for (const blit of h.blits) {
      expect(Math.abs(blit.x + blit.width / 2 - 300)).toBeGreaterThan(20);
      expect(Math.abs(blit.x + blit.width / 2 - 900)).toBeGreaterThan(20);
    }
    const bullet = h.pixel(300, 400 - 6);
    expect(apart(bullet as Rgb, [11, 16, 32])).toBeGreaterThan(40);
    h.dispose();
  });

  it("falls back to shapes in code where a sprite did not arrive", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    const held = art();
    resetArt();
    try {
      for (const [kind, x] of [
        ["shard", 200],
        ["flux", 400],
        ["prism", 600],
      ] as const) {
        h.debug.addDrone(kind, x, 300);
        h.debug.setDroneTravel(lastDroneId(h.debug), false);
      }
      h.blits.length = 0;
      await h.advance(1);
      expect(h.blits).toHaveLength(0);
      const field: Rgb = [11, 16, 32];
      expect(apart(patch(h, 200, 300, 8, 8), field)).toBeGreaterThan(40);
      expect(apart(patch(h, 400, 300, 8, 8), field)).toBeGreaterThan(40);
      expect(apart(patch(h, 600, 300, 8, 8), field)).toBeGreaterThan(40);
      expect(apart(patch(h, 640, SHIP_Y, 8, 8), field)).toBeGreaterThan(40);
    } finally {
      setArt(held);
      h.dispose();
    }
  });
});

describe("what a player reads at one pixel", () => {
  /**
   * The same relationships as above, read at each entity's own centre rather than
   * averaged over its footprint — the two ways a reader can sample a drawing, and
   * both have to say the same thing.
   */
  interface Centres {
    h: Harness;
    field: Rgb;
    shardCyan: Rgb;
    shardMagenta: Rgb;
    fluxHeld: Rgb;
    fluxShimmer: Rgb;
    prism: Rgb;
    bulletCyan: Rgb;
    bulletMagenta: Rgb;
  }

  async function centres(): Promise<Centres> {
    const h = await createHarness();
    startPosed(h.debug);
    const put = (
      kind: "shard" | "flux" | "prism",
      x: number,
      band: "cyan" | "magenta",
      pose: (id: number) => void = () => {},
    ): void => {
      h.debug.addDrone(kind, x, 300);
      const id = lastDroneId(h.debug);
      h.debug.setDroneBand(id, band);
      h.debug.setDroneTravel(id, false);
      h.debug.setDroneOscillation(id, false);
      pose(id);
    };
    put("shard", 200, "cyan");
    put("shard", 300, "magenta");
    put("flux", 400, "cyan");
    put("flux", 500, "cyan", (id) =>
      h.debug.setDroneBandClock(id, fluxHold(1) + 0.1),
    );
    put("prism", 640, "cyan");
    h.debug.addPlayerBullet(900, 400, "cyan");
    h.debug.addEnemyBullet(1000, 400, "magenta");
    await h.advance(1);
    const snap = h.debug.snapshot();
    const mine = snap.bullets.find((bullet) => bullet.friendly);
    const theirs = snap.bullets.find((bullet) => !bullet.friendly);
    const at = (x: number, y: number): Rgb =>
      h.pixel(Math.round(x), Math.round(y)) as Rgb;
    return {
      h,
      field: at(200, 560),
      shardCyan: at(200, 300),
      shardMagenta: at(300, 300),
      fluxHeld: at(400, 300),
      fluxShimmer: at(500, 300),
      prism: at(640, 300),
      bulletCyan: at(mine?.x ?? 0, mine?.y ?? 0),
      bulletMagenta: at(theirs?.x ?? 0, theirs?.y ?? 0),
    };
  }

  it("says the same thing at a centre as over a footprint", async () => {
    const p = await centres();
    expect(apart(p.shardCyan, p.shardMagenta)).toBeGreaterThan(60);
    expect(apart(p.shardCyan, p.field)).toBeGreaterThan(40);
    expect(apart(p.shardMagenta, p.field)).toBeGreaterThan(40);
    expect(apart(p.fluxHeld, p.fluxShimmer)).toBeGreaterThan(25);
    expect(apart(p.shardCyan, p.fluxHeld)).toBeGreaterThan(40);
    expect(apart(p.shardCyan, p.prism)).toBeGreaterThan(40);
    expect(apart(p.fluxHeld, p.prism)).toBeGreaterThan(40);
    expect(apart(p.bulletCyan, p.bulletMagenta)).toBeGreaterThan(60);
    expect(apart(p.bulletCyan, p.shardCyan)).toBeLessThan(
      apart(p.bulletCyan, p.shardMagenta),
    );
    p.h.dispose();
  });

  it("reads the ship's band at the ship's own centre", async () => {
    const h = await createHarness();
    startPosed(h.debug);
    h.debug.addDrone("shard", 300, 300);
    h.debug.setDroneTravel(lastDroneId(h.debug), false);
    await h.advance(1);
    const cyan = h.pixel(640, SHIP_Y) as Rgb;
    const shard = h.pixel(300, 300) as Rgb;
    h.debug.setShipBand("magenta");
    await h.advance(1);
    const magenta = h.pixel(640, SHIP_Y) as Rgb;
    expect(apart(cyan, magenta)).toBeGreaterThan(40);
    expect(apart(cyan, shard)).toBeGreaterThan(40);
    h.dispose();
  });
});
