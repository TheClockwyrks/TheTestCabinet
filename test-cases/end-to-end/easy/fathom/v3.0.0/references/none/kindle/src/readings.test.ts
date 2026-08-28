import { describe, expect, it } from "vitest";

import {
  ALERT_TIME,
  GAMEOVER_ITEMS,
  KINDLE_VISION_GAIN,
  KINDLE_VISION_MIN,
  PAUSE_ITEMS,
  SONAR_MARK_TIME,
  TITLE_ITEMS,
  VISION_GAIN,
  VISION_MIN,
} from "./constants";
import { harness } from "./harness.test-support";
import {
  countdownNumber,
  menuItems,
  mazeOnScreen,
  predatorLit,
  roster,
  sonarRange,
  visionRadius,
  windowRadius,
} from "./readings";
import { COUNTDOWN_STEP } from "./theme";

describe("visionRadius", () => {
  it("derives V from the brightness G", () => {
    const h = harness();
    h.state.forager.brightness = 0;
    expect(visionRadius(h.state)).toBe(VISION_MIN);
    h.state.forager.brightness = 1;
    expect(visionRadius(h.state)).toBe(VISION_MIN + VISION_GAIN);
    h.state.forager.brightness = 0.5;
    expect(visionRadius(h.state)).toBe(VISION_MIN + VISION_GAIN / 2);
  });
});

describe("windowRadius", () => {
  it("derives R from the same brightness G", () => {
    const h = harness();
    h.state.forager.brightness = 0;
    expect(windowRadius(h.state)).toBe(KINDLE_VISION_MIN);
    h.state.forager.brightness = 1;
    expect(windowRadius(h.state)).toBe(KINDLE_VISION_MIN + KINDLE_VISION_GAIN);
    h.state.forager.brightness = 0.5;
    expect(windowRadius(h.state)).toBe(
      KINDLE_VISION_MIN + KINDLE_VISION_GAIN / 2,
    );
  });

  it("stands wider than the light pocket at every brightness", () => {
    const h = harness();
    for (const brightness of [0, 0.25, 0.5, 0.75, 1]) {
      h.state.forager.brightness = brightness;
      expect(windowRadius(h.state)).toBeGreaterThan(visionRadius(h.state));
    }
  });
});

describe("sonarRange", () => {
  it("shrinks one tile a depth down to its floor", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(sonarRange)).toEqual([
      9, 8, 7, 6, 5, 5, 5,
    ]);
  });
});

describe("roster", () => {
  it("holds one of each kind at depth one", () => {
    expect(roster(1)).toEqual(["lanternjaw", "gloamfin", "flarefish"]);
  });

  it("adds one predator a depth, cycling the kinds in order", () => {
    expect(roster(2).slice(3)).toEqual(["gloamfin"]);
    expect(roster(3).slice(3)).toEqual(["gloamfin", "lanternjaw"]);
    expect(roster(4).slice(3)).toEqual(["gloamfin", "lanternjaw", "flarefish"]);
  });

  it("caps at two of each kind from depth four on", () => {
    for (const depth of [4, 5, 12]) {
      const kinds = roster(depth);
      expect(kinds).toHaveLength(6);
      for (const kind of ["lanternjaw", "gloamfin", "flarefish"]) {
        expect(kinds.filter((k) => k === kind)).toHaveLength(2);
      }
    }
  });
});

describe("predatorLit", () => {
  it("draws no predator that is in the den", () => {
    const h = harness();
    const p = h.state.predators[0];
    p.alertT = ALERT_TIME;
    expect(predatorLit(h.state, p)).toBe(false);
  });

  it("draws one whose detection alert is firing, wherever it stands", () => {
    const h = harness();
    const p = h.state.predators[1];
    p.state = "wander";
    p.alertT = ALERT_TIME;
    expect(predatorLit(h.state, p)).toBe(true);
  });

  it("draws one a sonar mark is showing", () => {
    const h = harness();
    const p = h.state.predators[1];
    p.state = "wander";
    p.markT = SONAR_MARK_TIME;
    expect(predatorLit(h.state, p)).toBe(true);
  });

  it("leaves a marked Lanternjaw undrawn, being an amber light", () => {
    const h = harness();
    const p = h.state.predators[0];
    p.state = "wander";
    p.markT = SONAR_MARK_TIME;
    expect(predatorLit(h.state, p)).toBe(false);
  });

  it("draws one the forager's light falls on", () => {
    const h = harness();
    const p = h.state.predators[0];
    p.state = "wander";
    h.state.fog.light(p.col, p.row);
    expect(predatorLit(h.state, p)).toBe(true);
  });

  it("leaves a Lanternjaw a sonar crest is washing over undrawn", () => {
    const h = harness();
    const p = h.state.predators[0];
    p.state = "wander";
    // A crest lights the ground, not what stands on it, so an amber-light
    // creature under one is still not drawn (`specs/sensing.md`).
    h.state.fog.lightGround(p.col, p.row);
    expect(predatorLit(h.state, p)).toBe(false);
  });
});

describe("mazeOnScreen", () => {
  it("is drawn over the four screens the maze stands behind", () => {
    expect(
      (["countdown", "playing", "paused", "cleared"] as const).every(
        mazeOnScreen,
      ),
    ).toBe(true);
    expect((["title", "howto", "gameover"] as const).some(mazeOnScreen)).toBe(
      false,
    );
  });
});

describe("menuItems", () => {
  it("gives each menu screen its own items, in order", () => {
    expect(menuItems("title")).toEqual(TITLE_ITEMS);
    expect(menuItems("paused")).toEqual(PAUSE_ITEMS);
    expect(menuItems("gameover")).toEqual(GAMEOVER_ITEMS);
    expect(menuItems("playing")).toEqual([]);
  });
});

describe("countdownNumber", () => {
  it("counts down to one and never below it", () => {
    expect(countdownNumber(COUNTDOWN_STEP * 3)).toBe(3);
    expect(countdownNumber(COUNTDOWN_STEP * 1.5)).toBe(2);
    expect(countdownNumber(0)).toBe(1);
  });
});
