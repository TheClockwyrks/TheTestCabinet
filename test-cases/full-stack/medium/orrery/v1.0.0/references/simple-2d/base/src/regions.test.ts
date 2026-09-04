import { describe, expect, it } from "vitest";

import {
  HEADING_H,
  READOUT_X0,
  STAGE_H,
  STAGE_W,
  TAPE_Y0,
  TRAY_REGION_W,
} from "./constants";
import { insideRect, insideTapePanel, regionAt } from "./regions";

describe("the editor's five regions (specs/editor.md)", () => {
  it("places a point well inside each region", () => {
    expect(regionAt(640, 20)).toBe("heading");
    expect(regionAt(100, 300)).toBe("tray");
    expect(regionAt(616, 304)).toBe("field");
    expect(regionAt(1100, 300)).toBe("readout");
    expect(regionAt(700, 600)).toBe("tape");
  });

  it("includes a rectangle's lower bound and excludes its upper", () => {
    // A press at x 223 within the tray's y span is a tray press.
    expect(regionAt(TRAY_REGION_W - 1, 300)).toBe("tray");
    // A press at (TRAY_REGION_W, HEADING_H) is a field press.
    expect(regionAt(TRAY_REGION_W, HEADING_H)).toBe("field");
    expect(regionAt(TRAY_REGION_W, HEADING_H - 1)).toBe("heading");
    expect(regionAt(READOUT_X0 - 1, TAPE_Y0 - 1)).toBe("field");
    expect(regionAt(READOUT_X0, TAPE_Y0 - 1)).toBe("readout");
  });

  it("gives the shared corner to the tape panel", () => {
    expect(regionAt(TRAY_REGION_W, TAPE_Y0)).toBe("tape");
    expect(regionAt(TRAY_REGION_W - 1, TAPE_Y0)).toBe("tray");
    expect(regionAt(TRAY_REGION_W, TAPE_Y0 - 1)).toBe("field");
  });

  it("names no region off the stage", () => {
    expect(regionAt(-1, 300)).toBeNull();
    expect(regionAt(STAGE_W, 300)).toBeNull();
    expect(regionAt(300, -1)).toBeNull();
    expect(regionAt(300, STAGE_H)).toBeNull();
  });

  it("reads the focus rule over the tape panel's extent", () => {
    expect(insideTapePanel(TRAY_REGION_W, TAPE_Y0)).toBe(true);
    expect(insideTapePanel(TRAY_REGION_W - 1, TAPE_Y0)).toBe(false);
    expect(insideTapePanel(TRAY_REGION_W, TAPE_Y0 - 1)).toBe(false);
  });

  it("tests a half-open rectangle on each of its four edges", () => {
    expect(insideRect(0, 0, 0, 0, 10, 10)).toBe(true);
    expect(insideRect(9.99, 9.99, 0, 0, 10, 10)).toBe(true);
    expect(insideRect(10, 5, 0, 0, 10, 10)).toBe(false);
    expect(insideRect(5, 10, 0, 0, 10, 10)).toBe(false);
    expect(insideRect(-0.01, 5, 0, 0, 10, 10)).toBe(false);
  });
});
