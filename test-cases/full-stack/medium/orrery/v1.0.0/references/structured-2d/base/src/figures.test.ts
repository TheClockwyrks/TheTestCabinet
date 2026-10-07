import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  ARM_MAX_LEN,
  ARM_MIN_LEN,
  BINDINGS,
  CAMPAIGN_FINALE_PARTS,
  CAMPAIGN_MAX,
  CAMPAIGN_MIN,
  CAMPAIGN_OPENER_PARTS,
  CAMPAIGN_REFERENCE_CYCLES,
  COLLISION_SAMPLES,
  CONSTELLATION_TARGET,
  CUES,
  CUE_PATHS,
  DEFAULT_SPEED_INDEX,
  ESSENCES,
  EXTRA_COUNT,
  FIELD_CX,
  FIELD_CY,
  FIELD_R,
  HEADING_H,
  HEX_HIT_R,
  HEX_PITCH,
  HOWTO_PAGES,
  INSTRUCTIONS,
  LOOPING_CUES,
  MOTES,
  MOTE_COLLIDE_R,
  MOTE_R,
  NAME_MAX,
  ORRERY_DEBUG_VERSION,
  PARTS,
  PART_COSTS,
  PLANETS,
  READOUT_X0,
  REPEAT_MIN,
  SOLVED_ITEMS,
  SPEEDS,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TAPE_CELL_W,
  TAPE_COLS_VISIBLE,
  TAPE_LABEL_W,
  TAPE_ROWS_VISIBLE,
  TAPE_ROW_H,
  TAPE_X0,
  TAPE_Y0,
  TITLE_ITEMS,
  TITLE_TEXT,
  TRAY_MAX,
  TRAY_REGION_W,
  TRAY_SLOT_H,
  TRAY_W,
  TRAY_X0,
  TRAY_Y0,
  WHEEL_MOTES,
} from "./constants";
import {
  CUE_NAMES,
  DIR_OFFSETS,
  INSTRUCTION_ACTIONS,
  SCREEN_ACTIONS,
  SIGIL_FOOTPRINTS,
  SIGIL_WAVES,
  TRANSFORMING_SIGILS,
} from "./figures";

describe("the figures the specification fixes (src/constants.ts, src/figures.ts)", () => {
  it("carries the stage of specs/overview.md", () => {
    expect([STAGE_W, STAGE_H, STAGE_CX, STAGE_CY]).toEqual([
      1280, 720, 640, 360,
    ]);
  });

  it("carries the field of specs/field.md", () => {
    expect([FIELD_CX, FIELD_CY, HEX_PITCH, FIELD_R, HEX_HIT_R]).toEqual([
      616, 304, 48, 5, 26,
    ]);
    expect([MOTE_R, MOTE_COLLIDE_R]).toEqual([22, 19]);
    expect(DIR_OFFSETS).toEqual([
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
    ]);
  });

  it("carries the fifteen motes, the four essences, and the ladder", () => {
    expect(MOTES).toHaveLength(15);
    expect(new Set(MOTES).size).toBe(15);
    expect(ESSENCES).toEqual(["nebula", "comet", "nova", "meteor"]);
    expect(PLANETS).toEqual([
      "saturn",
      "jupiter",
      "mars",
      "venus",
      "luna",
      "sol",
    ]);
    for (const type of [...ESSENCES, ...PLANETS]) {
      expect(MOTES).toContain(type);
    }
  });

  it("carries the twenty-one parts, their costs, and the wheel's ring", () => {
    expect(PARTS).toHaveLength(21);
    expect(new Set(PARTS).size).toBe(21);
    for (const kind of PARTS)
      expect(PART_COSTS[kind]).toBeGreaterThanOrEqual(0);
    expect(PART_COSTS.hexarm).toBe(60);
    expect(PART_COSTS.track).toBe(5);
    expect(PART_COSTS.void).toBe(0);
    expect([ARM_MIN_LEN, ARM_MAX_LEN]).toEqual([1, 3]);
    expect(WHEEL_MOTES).toEqual([
      "nebula",
      "comet",
      "nova",
      "meteor",
      "dust",
      "dust",
    ]);
  });

  it("carries the twelve transforming sigils and their footprints", () => {
    expect(TRANSFORMING_SIGILS).toHaveLength(12);
    for (const kind of TRANSFORMING_SIGILS) {
      expect(PARTS).toContain(kind);
      expect(SIGIL_FOOTPRINTS[kind][0]).toMatchObject({ q: 0, r: 0 });
    }
    expect(SIGIL_FOOTPRINTS.void).toHaveLength(7);
    expect(SIGIL_FOOTPRINTS.confluence).toHaveLength(5);
    expect(SIGIL_WAVES.flat().sort()).toEqual([...TRANSFORMING_SIGILS].sort());
  });

  it("carries the ten instructions and the clock of specs/simulation.md", () => {
    expect(INSTRUCTIONS).toHaveLength(10);
    expect(SPEEDS).toEqual([1, 3, 10, 30]);
    expect(DEFAULT_SPEED_INDEX).toBe(1);
    expect(COLLISION_SAMPLES).toBe(8);
  });

  it("carries the editor's geometry of specs/editor.md", () => {
    expect([HEADING_H, TRAY_REGION_W, READOUT_X0, TAPE_Y0]).toEqual([
      48, 224, 1008, 560,
    ]);
    expect([TRAY_X0, TRAY_Y0, TRAY_SLOT_H, TRAY_W]).toEqual([8, 56, 30, 208]);
    expect([
      TAPE_ROW_H,
      TAPE_ROWS_VISIBLE,
      TAPE_LABEL_W,
      TAPE_X0,
      TAPE_CELL_W,
      TAPE_COLS_VISIBLE,
    ]).toEqual([28, 5, 80, 88, 24, 40]);
  });

  it("carries the formats' and the modes' figures", () => {
    expect([NAME_MAX, TRAY_MAX, REPEAT_MIN, CONSTELLATION_TARGET]).toEqual([
      32, 16, 2, 6,
    ]);
    expect(EXTRA_COUNT).toBe(10);
    expect([CAMPAIGN_MIN, CAMPAIGN_MAX]).toEqual([8, 16]);
    expect(CAMPAIGN_REFERENCE_CYCLES).toBe(600);
    expect([CAMPAIGN_OPENER_PARTS, CAMPAIGN_FINALE_PARTS]).toEqual([3, 8]);
  });

  it("carries the screen copy of specs/ui.md", () => {
    expect(TITLE_TEXT).toBe("ORRERY");
    expect(TAGLINE_TEXT).toBe("SET THE HEAVENS TURNING");
    expect(TITLE_ITEMS).toEqual(["CAMPAIGN", "EXTRAS", "HOW TO PLAY"]);
    expect(SOLVED_ITEMS).toEqual([
      "NEXT CHALLENGE",
      "KEEP TINKERING",
      "BACK TO SELECT",
    ]);
    expect(HOWTO_PAGES).toBe(5);
  });

  it("carries the seven cues, one of which loops", () => {
    expect(CUE_NAMES).toHaveLength(7);
    expect(Object.keys(CUES)).toEqual(CUE_NAMES);
    expect(LOOPING_CUES).toEqual(["music"]);
    for (const cue of CUE_NAMES) {
      expect(CUE_PATHS[cue]).toBe(`audio/${cue}.wav`);
    }
  });

  it("binds every action, and shares KeyW and KeyS across the focus", () => {
    for (const action of ACTIONS) {
      expect(BINDINGS[action].length, action).toBeGreaterThan(0);
    }
    const shared = (code: string): string[] =>
      ACTIONS.filter((action) => BINDINGS[action].includes(code));
    expect(shared("KeyW")).toEqual(["part-grow", "ins-extend"]);
    expect(shared("KeyS")).toEqual(["part-shrink", "ins-retract"]);
    // The overlay's toggle is engine chrome rather than a game action.
    expect(shared("Backquote")).toEqual([]);
    for (const [action, instruction] of Object.entries(INSTRUCTION_ACTIONS)) {
      expect(ACTIONS).toContain(action);
      expect(INSTRUCTIONS).toContain(instruction);
    }
    expect(Object.keys(INSTRUCTION_ACTIONS)).toHaveLength(10);
  });

  it("routes each screen to the actions specs/controls.md gives it", () => {
    for (const [context, actions] of Object.entries(SCREEN_ACTIONS)) {
      expect(actions, context).toContain("mute");
      for (const action of actions) expect(ACTIONS).toContain(action);
    }
    expect(SCREEN_ACTIONS.title).toEqual(["up", "down", "confirm", "mute"]);
    expect(SCREEN_ACTIONS["editor-running"]).toEqual([
      "play",
      "step",
      "speed-up",
      "speed-down",
      "back",
      "mute",
    ]);
  });

  it("carries the surface's version", () => {
    expect(ORRERY_DEBUG_VERSION).toBe(1);
  });
});
