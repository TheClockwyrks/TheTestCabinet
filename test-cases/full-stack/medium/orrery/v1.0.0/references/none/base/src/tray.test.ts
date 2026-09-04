import { describe, expect, it } from "vitest";

import { PART_COSTS, TRAY_SLOT_H, TRAY_W, TRAY_X0, TRAY_Y0 } from "./constants";
import { createPart } from "./machine";
import {
  entrySpent,
  traySlotRect,
  trayEntries,
  trayEntryIndexAt,
} from "./tray";
import type { Challenge, Molecule } from "./types";

/** A one-mote molecule of `dust` at the origin. */
function dust(): Molecule {
  return { motes: [{ q: 0, r: 0, type: "dust" }], filaments: [], repeat: null };
}

/** A challenge whose `permitted` list is deliberately out of `PARTS` order. */
function challenge(): Challenge {
  return {
    name: "Tray",
    reagents: [dust(), dust()],
    products: [dust()],
    permitted: ["bind", "track", "arm"],
    target: 6,
  };
}

describe("the tray (specs/editor.md)", () => {
  it("lists the permitted kinds in PARTS order, whatever the document said", () => {
    const entries = trayEntries(challenge());
    expect(entries.slice(0, 3).map((entry) => entry.kind)).toEqual([
      "arm",
      "track",
      "bind",
    ]);
  });

  it("derives one rise per reagent and one set per product, in order", () => {
    const entries = trayEntries(challenge());
    expect(entries.map((entry) => [entry.kind, entry.index])).toEqual([
      ["arm", null],
      ["track", null],
      ["bind", null],
      ["rise", 0],
      ["rise", 1],
      ["set", 0],
    ]);
  });

  it("shows each entry's cost from PART_COSTS, a track's charged per cell", () => {
    const entries = trayEntries(challenge());
    expect(entries[0].cost).toBe(PART_COSTS.arm);
    expect(entries[1]).toMatchObject({ cost: PART_COSTS.track, perCell: true });
    expect(entries[2]).toMatchObject({ cost: PART_COSTS.bind, perCell: false });
    expect(entries[3].label).toBe("rise 1");
    expect(entries[5].label).toBe("set 1");
  });

  it("offers nothing with no challenge open", () => {
    expect(trayEntries(null)).toEqual([]);
  });

  it("puts entry k at the rectangle specs/editor.md fixes", () => {
    expect(traySlotRect(0)).toEqual({
      x0: TRAY_X0,
      y0: TRAY_Y0,
      x1: TRAY_X0 + TRAY_W,
      y1: TRAY_Y0 + TRAY_SLOT_H,
    });
    expect(traySlotRect(3).y0).toBe(TRAY_Y0 + 3 * TRAY_SLOT_H);
  });

  it("includes a slot's lower bound and excludes its upper", () => {
    expect(trayEntryIndexAt(TRAY_X0, TRAY_Y0 + 2 * TRAY_SLOT_H, 6)).toBe(2);
    expect(trayEntryIndexAt(TRAY_X0, TRAY_Y0 + 2 * TRAY_SLOT_H - 1, 6)).toBe(1);
    expect(trayEntryIndexAt(TRAY_X0 + TRAY_W - 1, TRAY_Y0, 6)).toBe(0);
    expect(trayEntryIndexAt(TRAY_X0 + TRAY_W, TRAY_Y0, 6)).toBeNull();
  });

  it("lands on no entry outside every rectangle", () => {
    expect(trayEntryIndexAt(TRAY_X0 - 1, TRAY_Y0 + 5, 6)).toBeNull();
    expect(trayEntryIndexAt(TRAY_X0 + 5, TRAY_Y0 - 1, 6)).toBeNull();
    expect(
      trayEntryIndexAt(TRAY_X0 + 5, TRAY_Y0 + 6 * TRAY_SLOT_H, 6),
    ).toBeNull();
  });

  it("spends a rise or set entry while its part is on the field", () => {
    const entries = trayEntries(challenge());
    const rise = createPart(1, "rise", 0, 0, 0, { index: 0 });
    expect(entrySpent(entries[3], [rise])).toBe(true);
    expect(entrySpent(entries[4], [rise])).toBe(false);
    expect(entrySpent(entries[5], [rise])).toBe(false);
  });

  it("never spends any other entry", () => {
    const entries = trayEntries(challenge());
    const arm = createPart(1, "arm", 0, 0, 0);
    expect(entrySpent(entries[0], [arm])).toBe(false);
  });
});
