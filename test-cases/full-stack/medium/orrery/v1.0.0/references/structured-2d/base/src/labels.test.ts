import { describe, expect, it } from "vitest";

import { rowLabel, rowLabels } from "./labels";
import { createPart } from "./machine";

describe("the identifier on each row (specs/editor.md)", () => {
  it("letters the rows A, B, C, and doubles up past Z", () => {
    expect(rowLabel(0)).toBe("A");
    expect(rowLabel(25)).toBe("Z");
    expect(rowLabel(26)).toBe("AA");
    expect(rowLabel(27)).toBe("AB");
    expect(rowLabel(-1)).toBe("");
  });

  it("gives one identifier per arm and wheel, in placement order", () => {
    const parts = [
      createPart(1, "arm", 0, 0, 0),
      createPart(2, "bind", 2, 0, 0),
      createPart(3, "wheel", -2, 0, 0),
      createPart(4, "piston", 0, 2, 0),
    ];
    const labels = rowLabels(parts);
    expect(labels.get(1)).toBe("A");
    expect(labels.get(3)).toBe("B");
    expect(labels.get(4)).toBe("C");
    // A sigil carries no tape, so it carries no row and no identifier.
    expect(labels.has(2)).toBe(false);
    expect(new Set(labels.values()).size).toBe(labels.size);
  });
});
