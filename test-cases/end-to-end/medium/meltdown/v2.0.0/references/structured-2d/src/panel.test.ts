// The build panel: where it put each control, and what operating one does.

import { describe, expect, it } from "vitest";
import {
  MIN_TOUCH_TARGET,
  PANEL_W,
  PANEL_X,
  STAGE_H,
  TOWER_DEFS,
  TOWER_TYPES,
  tileCX,
  tileCY,
} from "./constants";
import { controlsMeetTouchTarget, panelControls } from "./layout";
import { meltdownState } from "./game";
import { createHarness, poseTower, startRun, type Harness } from "./harness";

/** Press and release the centre of a control rectangle. */
async function tapControl(
  harness: Harness,
  rect: { x: number; y: number; w: number; h: number },
): Promise<void> {
  await harness.press(rect.x + rect.w / 2, rect.y + rect.h / 2);
}

describe("where the controls are", () => {
  it("lists one shop entry per type, in the shop order", async () => {
    const harness = await createHarness();
    startRun(harness);
    const shop = harness.debug.snapshot().controls.shop;
    expect(shop.map((entry) => entry.type)).toEqual([...TOWER_TYPES]);
    harness.dispose();
  });

  it("keeps every control inside the panel's strip", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setSelected(id);
    const controls = harness.debug.snapshot().controls;
    const rects = [
      ...controls.shop,
      controls.rotate,
      controls.cancel,
      controls.upgrade,
      controls.sell,
      controls.send,
      controls.speed,
      controls.pause,
      controls.mute,
    ];
    for (const rect of rects) {
      expect(rect).not.toBeNull();
      if (rect === null) continue;
      expect(rect.x).toBeGreaterThanOrEqual(PANEL_X);
      expect(rect.x + rect.w).toBeLessThanOrEqual(PANEL_X + PANEL_W);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.h).toBeLessThanOrEqual(STAGE_H);
    }
    harness.dispose();
  });

  it("makes every control at least the minimum touch target", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("lance");
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setSelected(id);
    const state = meltdownState(harness.engine.world);
    expect(controlsMeetTouchTarget(state)).toBe(true);
    const controls = panelControls(state);
    expect(controls.send.w).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(controls.send.h).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    harness.dispose();
  });

  it("draws rotate and cancel only while a preview is held", async () => {
    const harness = await createHarness();
    startRun(harness);
    let controls = harness.debug.snapshot().controls;
    expect(controls.rotate).toBeNull();
    expect(controls.cancel).toBeNull();
    harness.debug.setArmed("arc");
    controls = harness.debug.snapshot().controls;
    expect(controls.rotate).not.toBeNull();
    expect(controls.cancel).not.toBeNull();
    harness.dispose();
  });

  it("draws upgrade and sell only while a tower is selected", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    let controls = harness.debug.snapshot().controls;
    expect(controls.upgrade).toBeNull();
    expect(controls.sell).toBeNull();
    harness.debug.setSelected(id);
    controls = harness.debug.snapshot().controls;
    expect(controls.upgrade).not.toBeNull();
    expect(controls.sell).not.toBeNull();
    harness.dispose();
  });

  it("shares no rectangle between two controls", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    const id = poseTower(harness, "arc", 30, 20, 0);
    harness.debug.setSelected(id);
    const controls = harness.debug.snapshot().controls;
    const keys = ["rotate", "cancel", "upgrade", "sell", "send", "speed", "pause", "mute"] as const;
    const rects = [
      ...controls.shop.map((entry) => ({ x: entry.x, y: entry.y, w: entry.w, h: entry.h })),
      ...keys.map((key) => controls[key]),
    ].filter((rect): rect is { x: number; y: number; w: number; h: number } => rect !== null);
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps).toBe(false);
      }
    }
    harness.dispose();
  });
});

describe("the shop", () => {
  it("arms a type on a tap, and marks it hovered", async () => {
    const harness = await createHarness();
    startRun(harness);
    const entry = harness.debug.snapshot().controls.shop[4];
    await tapControl(harness, entry);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.build?.type).toBe(entry.type);
    expect(snapshot.hoverShop).toBe(entry.type);
    harness.dispose();
  });

  it("arms each of the eight types on its own key", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("playing");
    harness.debug.setMoney(20000);
    for (const [index, type] of TOWER_TYPES.entries()) {
      harness.tap(`Digit${index + 1}`);
      await harness.engine.advance(1);
      expect(harness.debug.snapshot().build?.type).toBe(type);
    }
    harness.dispose();
  });

  it("marks a hover on a move and clears it moving off, arming nothing", async () => {
    const harness = await createHarness();
    startRun(harness);
    const entry = harness.debug.snapshot().controls.shop[2];
    harness.debug.pointerMove(entry.x + 4, entry.y + 4);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.hoverShop).toBe(entry.type);
    expect(snapshot.build).toBeNull();
    expect(snapshot.selected).toBeNull();

    harness.debug.pointerMove(tileCX(10), tileCY(10));
    snapshot = harness.debug.snapshot();
    expect(snapshot.hoverShop).toBeNull();
    harness.dispose();
  });
});

describe("the placement controls", () => {
  it("turns the held preview on the rotate control and on the key", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    const rotate = harness.debug.snapshot().controls.rotate;
    expect(rotate).not.toBeNull();
    if (rotate !== null) await tapControl(harness, rotate);
    expect(harness.debug.snapshot().build?.rotation).toBe(1);
    harness.debug.setScreen("playing");
    harness.tap("KeyR");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().build?.rotation).toBe(2);
    harness.dispose();
  });

  it("changes nothing on rotate with nothing held", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("playing");
    harness.tap("KeyR");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().build).toBeNull();
    harness.dispose();
  });

  it("clears the held preview on the cancel control", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    const cancel = harness.debug.snapshot().controls.cancel;
    expect(cancel).not.toBeNull();
    if (cancel !== null) await tapControl(harness, cancel);
    expect(harness.debug.snapshot().build).toBeNull();
    harness.dispose();
  });
});

describe("a press on the floor", () => {
  it("places the held preview on a valid footprint", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    harness.cues.length = 0;
    await harness.press(tileCX(20), tileCY(12));
    const snapshot = harness.debug.snapshot();
    expect(snapshot.towers).toHaveLength(1);
    expect(snapshot.money).toBe(snapshot.startMoney - TOWER_DEFS.arc.cost);
    expect(harness.cues.map((c) => c.cue)).toContain("place");
    harness.dispose();
  });

  it("builds and spends nothing, and plays no cue, on an invalid footprint", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setArmed("arc");
    const money = harness.debug.snapshot().money;
    harness.cues.length = 0;
    await harness.press(tileCX(20) + 9, tileCY(12) + 9);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.towers).toHaveLength(1);
    expect(snapshot.money).toBe(money);
    expect(harness.cues.map((c) => c.cue)).not.toContain("place");
    harness.dispose();
  });

  it("selects the tower pressed with nothing armed, and deselects off it", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "bloom", 20, 12, 0);
    await harness.press(tileCX(21), tileCY(13));
    expect(harness.debug.snapshot().selected).toBe(id);
    await harness.press(tileCX(40), tileCY(30));
    expect(harness.debug.snapshot().selected).toBeNull();
    harness.dispose();
  });
});

describe("the inspector's actions", () => {
  it("upgrades on the control and on the key", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setSelected(id);
    harness.debug.setMoney(1000);
    const upgrade = harness.debug.snapshot().controls.upgrade;
    expect(upgrade).not.toBeNull();
    if (upgrade !== null) await tapControl(harness, upgrade);
    expect(harness.debug.snapshot().towers[0].level).toBe(2);

    harness.debug.setScreen("playing");
    harness.tap("KeyU");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().towers[0].level).toBe(3);
    harness.dispose();
  });

  it("sells on the control, paying the refund and clearing the selection", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setSelected(id);
    harness.debug.setMoney(0);
    const sell = harness.debug.snapshot().controls.sell;
    harness.cues.length = 0;
    expect(sell).not.toBeNull();
    if (sell !== null) await tapControl(harness, sell);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.towers).toHaveLength(0);
    expect(snapshot.money).toBe(TOWER_DEFS.arc.cost);
    expect(snapshot.selected).toBeNull();
    expect(harness.cues.map((c) => c.cue)).toContain("sell");
    harness.dispose();
  });

  it("sells on the key as well", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setSelected(id);
    harness.debug.setScreen("playing");
    harness.tap("KeyS");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().towers).toHaveLength(0);
    harness.dispose();
  });
});

describe("the wave controls", () => {
  it("sends on the send control", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("opening");
    const send = harness.debug.snapshot().controls.send;
    await tapControl(harness, send);
    expect(harness.debug.snapshot().phase).toBe("wave");
    harness.dispose();
  });

  it("pauses on the pause control and resumes on it", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("playing");
    const pause = harness.debug.snapshot().controls.pause;
    await tapControl(harness, pause);
    expect(harness.debug.snapshot().screen).toBe("paused");
    harness.dispose();
  });

  it("toggles the mute bit on the mute control, from any screen", async () => {
    const harness = await createHarness();
    startRun(harness);
    const mute = harness.debug.snapshot().controls.mute;
    await tapControl(harness, mute);
    expect(harness.debug.snapshot().muted).toBe(true);
    await tapControl(harness, mute);
    expect(harness.debug.snapshot().muted).toBe(false);
    harness.dispose();
  });

  it("toggles the mute bit on the mute key, on the title screen too", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("title");
    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().muted).toBe(true);
    harness.tap("KeyM");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().muted).toBe(false);
    harness.dispose();
  });

  it("sounds no cue while muted, and leaves the game fully playable", async () => {
    const harness = await createHarness();
    startRun(harness);
    const mute = harness.debug.snapshot().controls.mute;
    await tapControl(harness, mute);
    harness.cues.length = 0;
    harness.debug.setArmed("arc");
    await harness.press(tileCX(20), tileCY(12));
    // The cue still names its frame; the bus that plays it is silent, which the
    // engine reports as a gain of zero.
    expect(harness.debug.snapshot().towers).toHaveLength(1);
    expect(harness.cues.map((c) => c.cue)).toContain("place");
    for (const played of harness.cues) expect(played.gain).toBe(0);

    await tapControl(harness, mute);
    harness.cues.length = 0;
    harness.debug.setArmed("arc");
    await harness.press(tileCX(26), tileCY(12));
    expect(harness.cues.some((c) => c.cue === "place" && c.gain > 0)).toBe(true);
    harness.dispose();
  });
});

describe("what back does", () => {
  it("cancels a held placement first, leaving the screen where it is", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setSelected(id);
    harness.debug.setArmed("flak");
    harness.debug.setScreen("playing");
    harness.tap("Escape");
    await harness.engine.advance(1);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.build).toBeNull();
    expect(snapshot.selected).toBe(id);
    expect(snapshot.screen).toBe("playing");
    harness.dispose();
  });

  it("deselects next, leaving the screen where it is", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setSelected(id);
    harness.debug.setScreen("playing");
    harness.tap("Escape");
    await harness.engine.advance(1);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.selected).toBeNull();
    expect(snapshot.screen).toBe("playing");
    harness.dispose();
  });

  it("opens the pause screen last", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("playing");
    harness.tap("Escape");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().screen).toBe("paused");
    harness.dispose();
  });
});

describe("every action fires once per press", () => {
  it("fires once however long the key is held", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("playing");
    harness.keyDown("KeyF");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().speed).toBe(2);
    for (let i = 0; i < 5; i += 1) {
      harness.keyDown("KeyF", true);
      await harness.engine.advance(1);
    }
    expect(harness.debug.snapshot().speed).toBe(2);
    harness.keyUp("KeyF");
    harness.keyDown("KeyF");
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().speed).toBe(1);
    harness.dispose();
  });
});
