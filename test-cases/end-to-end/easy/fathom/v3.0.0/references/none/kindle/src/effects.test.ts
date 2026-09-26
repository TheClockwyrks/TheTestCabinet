import { describe, expect, it } from "vitest";

import { ALERT_TIME, TICK_DT } from "./constants";
import { Effects } from "./effects";

describe("Effects", () => {
  it("keeps a burst for the alert window and no longer", () => {
    const effects = new Effects();
    effects.add(100, 100, "gloamfin");
    const ticks = Math.ceil(ALERT_TIME / TICK_DT);
    for (let i = 0; i < ticks - 1; i++) effects.update(TICK_DT);
    expect(effects.all).toHaveLength(1);
    effects.update(TICK_DT);
    effects.update(TICK_DT);
    expect(effects.all).toHaveLength(0);
  });

  it("carries the hunter that fired it, so it is drawn in that color", () => {
    const effects = new Effects();
    effects.add(10, 20, "flarefish");
    expect(effects.all[0]).toMatchObject({ x: 10, y: 20, kind: "flarefish" });
  });

  it("drops every burst when cleared", () => {
    const effects = new Effects();
    effects.add(1, 2, "gloamfin");
    effects.add(3, 4, "flarefish");
    effects.clear();
    expect(effects.all).toHaveLength(0);
  });
});
