// The escape rocket, and the only way to win (specs/rocket.md).

import { describe, expect, it } from "vitest";
import { ROCKET_COMPONENTS, ROCKET_TOTAL_CREDITS } from "./constants";
import { allInstalled, canFabricate, fabricate, nextComponent } from "./rocket";
import { bareState, inDraft } from "./test-support";

/** The component at a step of the checklist. */
const step = (at: number): (typeof ROCKET_COMPONENTS)[number] =>
  ROCKET_COMPONENTS[at];

describe("the checklist", () => {
  it("names the next uninstalled component, in the order it builds", () => {
    expect(nextComponent([])?.id).toBe(step(0).id);
    expect(nextComponent([step(0).id])?.id).toBe(step(1).id);
    expect(
      nextComponent(ROCKET_COMPONENTS.map((component) => component.id)),
    ).toBeNull();
  });

  it("is complete only with all five in", () => {
    expect(allInstalled([])).toBe(false);
    expect(allInstalled(ROCKET_COMPONENTS.slice(0, 4).map((c) => c.id))).toBe(
      false,
    );
    expect(allInstalled(ROCKET_COMPONENTS.map((c) => c.id))).toBe(true);
  });

  it("costs ROCKET_TOTAL_CREDITS across the five", () => {
    expect(ROCKET_COMPONENTS.reduce((sum, c) => sum + c.credits, 0)).toBe(
      ROCKET_TOTAL_CREDITS,
    );
  });
});

describe("fabricating", () => {
  it("refuses without the Credits, and changes nothing", () => {
    const after = inDraft(bareState(), (d) => {
      d.credits = step(0).credits - 1;
      expect(fabricate(d)).toBe(false);
    });
    expect(after.installed).toEqual([]);
    expect(after.credits).toBe(step(0).credits - 1);
  });

  it("refuses without the material a component consumes", () => {
    // The third component is the first that needs one.
    const guidance = ROCKET_COMPONENTS.findIndex(
      (component) => component.material === "resonite",
    );
    const posed = inDraft(bareState(), (d) => {
      d.installed = ROCKET_COMPONENTS.slice(0, guidance).map((c) => c.id);
      d.credits = 100000;
    });
    expect(canFabricate(posed)).toBe(false);
    const after = inDraft(posed, (d) => {
      expect(fabricate(d)).toBe(false);
    });
    expect(after.installed).toHaveLength(guidance);

    const supplied = inDraft(posed, (d) => {
      d.satchel.resonite = 1;
      expect(fabricate(d)).toBe(true);
    });
    expect(supplied.installed).toHaveLength(guidance + 1);
    expect(supplied.satchel.resonite).toBe(0);
  });

  it("consumes the Core Sample for the Ignition Core and stops its timer", () => {
    const posed = inDraft(bareState(), (d) => {
      d.installed = ROCKET_COMPONENTS.slice(0, 4).map((c) => c.id);
      d.credits = 100000;
      d.satchel.coreSample = true;
      d.coreTimer = 30;
    });
    expect(canFabricate(posed)).toBe(true);
    const after = inDraft(posed, (d) => {
      expect(fabricate(d)).toBe(true);
    });
    expect(after.satchel.coreSample).toBe(false);
    expect(after.coreTimer).toBeNull();
    expect(allInstalled(after.installed)).toBe(true);
  });

  it("refuses once the rocket is complete", () => {
    const posed = inDraft(bareState(), (d) => {
      d.installed = ROCKET_COMPONENTS.map((c) => c.id);
      d.credits = 100000;
    });
    expect(canFabricate(posed)).toBe(false);
    const after = inDraft(posed, (d) => {
      expect(fabricate(d)).toBe(false);
    });
    expect(after.credits).toBe(100000);
  });
});
