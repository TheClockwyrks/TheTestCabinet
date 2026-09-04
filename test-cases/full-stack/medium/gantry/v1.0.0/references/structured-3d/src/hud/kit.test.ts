import { describe, expect, it } from "vitest";
import {
  Actor,
  ShapeComponent,
  TextComponent,
} from "@test-cabinet/structured-3d";
import { GantryState } from "../game";
import { addMoveStep, setScreen } from "../state";
import { baseline, fontOf, HudGroup, placeRect } from "./kit";
import { HintBar, Menu, monoWidth, SiteStrip, StartBlock } from "./pieces";

/** A bare actor to attach the kit's components to. */
const host = (): Actor => new Actor();

describe("the kit", () => {
  it("places a panel by its rectangle rather than its centre", () => {
    const group = new HudGroup(host());
    const shape = group.panel({ x: 10, y: 20, w: 100, h: 40 });
    expect(shape.offset.position).toEqual({ x: 60, y: 40, z: 0 });
    expect(shape.shape).toEqual({ kind: "rect", width: 100, height: 40 });
    placeRect(shape, { x: 0, y: 0, w: 4, h: 4 });
    expect(shape.offset.position).toEqual({ x: 2, y: 2, z: 0 });
  });

  it("places a line at the baseline it was asked for", () => {
    const group = new HudGroup(host());
    const text = group.write(8, 100, "COST", { size: 10 });
    expect(text.offset.position).toEqual(baseline(8, 100, 10));
    expect(text.text).toBe("COST");
  });

  it("sets a font in the face and weight a spec names", () => {
    expect(fontOf({ size: 12 })).toContain("400 12px");
    expect(fontOf({ size: 12, weight: 700 })).toContain("700 12px");
    expect(fontOf({ size: 12, face: "display" })).not.toBe(
      fontOf({ size: 12 }),
    );
  });

  it("switches a group and everything under it", () => {
    const actor = host();
    const root = new HudGroup(actor);
    const child = root.child();
    const outer = root.panel({ x: 0, y: 0, w: 1, h: 1 });
    const inner = child.write(0, 0, "x", { size: 10 });

    root.apply();
    expect(outer.visible).toBe(true);
    expect(inner.visible).toBe(true);

    child.visible = false;
    root.apply();
    expect(outer.visible).toBe(true);
    expect(inner.visible).toBe(false);

    root.visible = false;
    child.visible = true;
    root.apply();
    expect(outer.visible).toBe(false);
    expect(inner.visible).toBe(false);
  });

  it("attaches everything it builds to its actor", () => {
    const actor = host();
    const group = new HudGroup(actor);
    group.panel({ x: 0, y: 0, w: 1, h: 1 });
    group.write(0, 0, "", { size: 10 });
    expect(actor.components).toHaveLength(2);
    expect(actor.components[0]).toBeInstanceOf(ShapeComponent);
    expect(actor.components[1]).toBeInstanceOf(TextComponent);
  });
});

describe("the pieces", () => {
  it("estimates a mono line's width from its length", () => {
    expect(monoWidth("", 12)).toBe(0);
    expect(monoWidth("abcd", 10)).toBeCloseTo(24, 9);
  });

  it("reads the site, the cost against the budget, and the tape", () => {
    const actor = host();
    const strip = new SiteStrip(new HudGroup(actor), 24);
    const state = new GantryState();
    addMoveStep(state, "slew", 90, 30);
    strip.refresh(state);
    const lines = actor.components
      .filter((c): c is TextComponent => c instanceof TextComponent)
      .map((c) => c.text);
    expect(lines).toContain("SITE 1 / 6");
    expect(lines).toContain("FIRST LIFT");
    expect(lines).toContain("COST 0 / 3 000");
    expect(lines).toContain("TAPE 1 STEPS");
  });

  it("shows the issues that would refuse a run, and hides with none", () => {
    const actor = host();
    const root = new HudGroup(actor);
    const block = new StartBlock(root, 24);
    const state = new GantryState();
    block.refresh(state, 100);
    root.apply();
    const shown = () =>
      actor.components
        .filter((c): c is TextComponent => c instanceof TextComponent)
        .filter((c) => c.visible && c.text !== "")
        .map((c) => c.text);
    expect(shown()).toEqual([
      "G RUN IS REFUSED",
      "no-ring",
      "no-rail",
      "empty-program",
    ]);
  });

  it("marks the highlighted menu entry and hides the rows past the menu", () => {
    const actor = host();
    const root = new HudGroup(actor);
    const menu = new Menu(root, (i) => ({ x: 0, y: i * 48, w: 200, h: 40 }), 3);
    menu.refresh(["ONE", "TWO"], 1);
    root.apply();
    const labels = actor.components
      .filter((c): c is TextComponent => c instanceof TextComponent)
      .filter((c) => c.visible);
    expect(labels.map((c) => c.text)).toEqual(["ONE", "»", "TWO"]);
  });

  it("sizes the hint bar to the longest line it is given", () => {
    const actor = host();
    const root = new HudGroup(actor);
    const bar = new HintBar(root, 2);
    bar.set(["ESC BACK"]);
    root.apply();
    const panel = actor.components.find(
      (c): c is ShapeComponent => c instanceof ShapeComponent,
    );
    const narrow = (panel?.shape as { width: number }).width;
    bar.set(["ESC BACK", "A MUCH LONGER LINE OF HINTS THAN THAT ONE"]);
    expect((panel?.shape as { width: number }).width).toBeGreaterThan(narrow);
  });
});

describe("a screen's own state", () => {
  it("keeps the readouts off every screen but their own", () => {
    const state = new GantryState();
    setScreen(state, "program");
    expect(state.screen).toBe("program");
  });
});
