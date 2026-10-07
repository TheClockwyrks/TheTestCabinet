// The tables `src/figures.ts` derives from `src/constants.ts`, checked against
// the specification files that state them.
//
// `src/constants.ts` is supplied with the project and is not this build's to
// edit, so what is checked here is the derivation: that every roster is a
// subset of the one `src/constants.ts` names, that no figure was reshaped
// wrongly on the way, and that each table covers exactly what its spec
// tabulates.

import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  BINDINGS,
  CUES,
  CUE_PATHS,
  DIRS as DIR_OFFSETS,
  INSTRUCTIONS,
  LOOPING_CUES,
  PARTS,
  PART_COSTS,
} from "./constants";
import {
  ARM_KINDS,
  ARM_SPOKE_OFFSETS,
  CLOSED_TRACK_MIN_CELLS,
  CUE_NAMES,
  DIRS,
  DRAG_ACTIONS,
  FILAMENT_WEIGHT,
  INSTRUCTION_ACTIONS,
  SCREEN_ACTIONS,
  SIGIL_FOOTPRINTS,
  SIGIL_WAVES,
  TRACK_COST_PER_CELL,
  TRANSFORMING_SIGILS,
  TRIUNE_WEIGHT,
  WHEEL_INSTRUCTIONS,
} from "./figures";

describe("the field's directions (specs/field.md)", () => {
  it("reshapes each `[dq, dr]` pair into the hex the build reads", () => {
    expect(DIRS).toEqual([
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
    ]);
    expect(DIRS).toHaveLength(DIR_OFFSETS.length);
    DIR_OFFSETS.forEach(([q, r], index) => {
      expect(DIRS[index]).toEqual({ q, r });
    });
  });
});

describe("the parts' rosters (specs/parts.md, specs/sigils.md)", () => {
  it("takes the five arm kinds and the twelve sigils out of `PARTS`", () => {
    expect(ARM_KINDS).toHaveLength(5);
    expect(TRANSFORMING_SIGILS).toHaveLength(12);
    for (const kind of [...ARM_KINDS, ...TRANSFORMING_SIGILS]) {
      expect(PARTS, kind).toContain(kind);
    }
    // Together with the wheel, the track, and the two apertures, that is all
    // twenty-one kinds.
    expect(ARM_KINDS.length + TRANSFORMING_SIGILS.length + 4).toBe(
      PARTS.length,
    );
  });

  it("gives each arm kind its gripper spokes", () => {
    for (const kind of ARM_KINDS) {
      const spokes = ARM_SPOKE_OFFSETS[kind];
      expect(spokes.length, kind).toBeGreaterThan(0);
      expect(new Set(spokes).size, kind).toBe(spokes.length);
      for (const spoke of spokes) {
        expect(spoke, kind).toBeGreaterThanOrEqual(0);
        expect(spoke, kind).toBeLessThan(6);
      }
    }
    expect(ARM_SPOKE_OFFSETS.hexarm).toHaveLength(6);
    expect(ARM_SPOKE_OFFSETS.biarm).toEqual([0, 3]);
  });

  it("takes a track's per-cell cost from its entry in `PART_COSTS`", () => {
    expect(TRACK_COST_PER_CELL).toBe(PART_COSTS.track);
    expect(CLOSED_TRACK_MIN_CELLS).toBe(3);
  });

  it("carries the two filament weights", () => {
    expect([FILAMENT_WEIGHT, TRIUNE_WEIGHT]).toEqual([1, 3]);
  });
});

describe("the sigils' footprints and waves (specs/sigils.md)", () => {
  it("anchors every footprint on (0, 0)", () => {
    for (const kind of TRANSFORMING_SIGILS) {
      expect(SIGIL_FOOTPRINTS[kind][0], kind).toMatchObject({ q: 0, r: 0 });
      const hexes = SIGIL_FOOTPRINTS[kind].map((hex) => `${hex.q},${hex.r}`);
      expect(new Set(hexes).size, kind).toBe(hexes.length);
    }
    expect(SIGIL_FOOTPRINTS.void).toHaveLength(7);
    expect(SIGIL_FOOTPRINTS.confluence).toHaveLength(5);
    expect(SIGIL_FOOTPRINTS.wane).toHaveLength(1);
  });

  it("runs every sigil in exactly one of the four waves", () => {
    expect(SIGIL_WAVES).toHaveLength(4);
    expect([...SIGIL_WAVES.flat()].sort()).toEqual(
      [...TRANSFORMING_SIGILS].sort(),
    );
  });
});

describe("the instructions (specs/instructions.md)", () => {
  it("lets a wheel execute the two rotations and nothing else", () => {
    expect(WHEEL_INSTRUCTIONS).toEqual(["rotate-cw", "rotate-ccw"]);
    for (const instruction of WHEEL_INSTRUCTIONS) {
      expect(INSTRUCTIONS).toContain(instruction);
    }
  });

  it("writes one instruction per tape-focus action, and all ten", () => {
    const written = Object.values(INSTRUCTION_ACTIONS);
    expect(written).toHaveLength(INSTRUCTIONS.length);
    expect([...written].sort()).toEqual([...INSTRUCTIONS].sort());
    for (const action of Object.keys(INSTRUCTION_ACTIONS)) {
      expect(ACTIONS, action).toContain(action);
    }
  });
});

describe("the cues (specs/ui.md)", () => {
  it("names all seven, in the order the specification tabulates them", () => {
    expect(CUE_NAMES).toEqual(Object.values(CUES));
    expect(CUE_NAMES).toHaveLength(7);
    for (const cue of CUE_NAMES) {
      expect(CUE_PATHS[cue]).toBe(`audio/${cue}.wav`);
    }
    expect(LOOPING_CUES).toEqual(["music"]);
  });
});

describe("what each screen reads (specs/controls.md)", () => {
  it("routes only registered actions, and `mute` on every screen", () => {
    for (const [context, actions] of Object.entries(SCREEN_ACTIONS)) {
      expect(actions, context).toContain("mute");
      for (const action of actions) expect(ACTIONS, context).toContain(action);
      expect(new Set(actions).size, context).toBe(actions.length);
    }
  });

  it("gives each context exactly the row the specification writes", () => {
    expect(SCREEN_ACTIONS.title).toEqual(["up", "down", "confirm", "mute"]);
    expect(SCREEN_ACTIONS.howto).toEqual([
      "left",
      "right",
      "confirm",
      "back",
      "mute",
    ]);
    expect(SCREEN_ACTIONS["editor-running"]).toEqual([
      "play",
      "step",
      "speed-up",
      "speed-down",
      "back",
      "mute",
    ]);
    expect(SCREEN_ACTIONS["editor-halted"]).toEqual([
      "up",
      "down",
      "confirm",
      "back",
      "mute",
    ]);
  });

  it("keeps only the ghost's four verbs live while a drag is", () => {
    expect(DRAG_ACTIONS).toEqual([
      "part-cw",
      "part-ccw",
      "part-grow",
      "part-shrink",
      "mute",
    ]);
    for (const action of DRAG_ACTIONS) {
      expect(SCREEN_ACTIONS["editor-editing"]).toContain(action);
    }
  });

  it("shares KeyW and KeyS across the focus, and nothing else", () => {
    const shared = (code: string): string[] =>
      ACTIONS.filter((action) => BINDINGS[action].includes(code));
    expect(shared("KeyW")).toEqual(["part-grow", "ins-extend"]);
    expect(shared("KeyS")).toEqual(["part-shrink", "ins-retract"]);
    // The overlay's key is engine chrome, never a registered action.
    expect(shared("Backquote")).toEqual([]);
    for (const action of ACTIONS) {
      expect(BINDINGS[action].length, action).toBeGreaterThan(0);
    }
  });
});
