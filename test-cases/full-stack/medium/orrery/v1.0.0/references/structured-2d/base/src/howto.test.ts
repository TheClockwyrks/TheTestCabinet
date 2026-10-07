import { describe, expect, it } from "vitest";

import { HOWTO_PAGES } from "./constants";
import { TRANSFORMING_SIGILS } from "./figures";
import { HOWTO_CONTENT, howtoPage } from "./howto";

describe("the how-to (specs/ui.md `howto`)", () => {
  it("runs to exactly HOWTO_PAGES pages, each with a heading and copy", () => {
    expect(HOWTO_CONTENT).toHaveLength(HOWTO_PAGES);
    for (const page of HOWTO_CONTENT) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.lines.length).toBeGreaterThan(0);
    }
  });

  it("names every transforming sigil's engraving in one line apiece", () => {
    const sigils = HOWTO_CONTENT[1].columns ?? [];
    expect(sigils).toHaveLength(TRANSFORMING_SIGILS.length);
    for (const kind of TRANSFORMING_SIGILS) {
      expect(sigils.some((entry) => entry.startsWith(`${kind} —`))).toBe(true);
    }
  });

  it("names the keys running a machine is worked with", () => {
    const running = HOWTO_CONTENT[3].lines.join(" ");
    expect(running).toContain("SPACE");
    expect(running).toContain("N runs");
    expect(running).toContain("ESC");
    const tape = HOWTO_CONTENT[2].lines.join(" ");
    for (const key of ["G grab", "V drop", "A / D", "W / S", "T / B"]) {
      expect(tape).toContain(key);
    }
  });

  it("says what a finished machine is scored on, and which way is better", () => {
    const finishing = HOWTO_CONTENT[4].lines.join(" ");
    for (const metric of ["cost", "cycles", "area"]) {
      expect(finishing).toContain(metric);
    }
    expect(finishing).toContain("Lower is better");
  });

  it("clamps a page index to the pages this build ships", () => {
    expect(howtoPage(-3)).toBe(HOWTO_CONTENT[0]);
    expect(howtoPage(99)).toBe(HOWTO_CONTENT[HOWTO_PAGES - 1]);
    expect(howtoPage(2)).toBe(HOWTO_CONTENT[2]);
  });
});
