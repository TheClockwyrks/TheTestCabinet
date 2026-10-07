import { describe, expect, it } from "vitest";

import { EXTRA_CHALLENGES } from "./challenges";
import { EXTRA_COUNT } from "./constants";
import {
  DocumentError,
  cloneChallenge,
  fitsField,
  parseChallenge,
  parseMolecule,
  parseSolution,
  solutionFromMachine,
} from "./formats";
import { createDebugApi, type OrreryDebugApi } from "./debug";
import { Bench } from "./harness";
import { createPart } from "./machine";

const oneMote = { motes: [{ q: 0, r: 0, type: "luna" }], filaments: [] };

function challenge(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: "Twin Moons",
    reagents: [oneMote],
    products: [oneMote],
    permitted: ["arm"],
    target: 6,
    ...overrides,
  };
}

describe("the shipped challenge documents (specs/challenges.md)", () => {
  it("ships the ten Extras, in order, each well formed", () => {
    expect(EXTRA_CHALLENGES).toHaveLength(EXTRA_COUNT);
    expect(EXTRA_CHALLENGES.map((entry) => entry.name)).toEqual([
      "First Light",
      "Twin Moons",
      "Waning Crescent",
      "Mirrorwright",
      "Ascendant",
      "Great Conjunction",
      "Syzygy",
      "Aetherfall",
      "Trine",
      "Procession",
    ]);
    expect(EXTRA_CHALLENGES.every((entry) => entry.target === 6)).toBe(true);
  });

  it("carries Procession's repeating product and Trine's triune filament", () => {
    expect(EXTRA_CHALLENGES[9].products[0].repeat).toEqual({
      vector: { q: 1, r: 0 },
      link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
    });
    expect(EXTRA_CHALLENGES[8].products[0].filaments[0].weight).toBe(3);
  });
});

describe("parsing a challenge (specs/formats.md)", () => {
  it("accepts a well-formed document", () => {
    expect(parseChallenge(challenge()).name).toBe("Twin Moons");
  });

  it("refuses a document that is not an object", () => {
    expect(() => parseChallenge(null)).toThrow(DocumentError);
    expect(() => parseChallenge([])).toThrow(/not an object/);
  });

  it("refuses an empty reagents or products list", () => {
    expect(() => parseChallenge(challenge({ reagents: [] }))).toThrow(/empty/);
    expect(() => parseChallenge(challenge({ products: [] }))).toThrow(/empty/);
  });

  it("refuses a target below 1", () => {
    expect(() => parseChallenge(challenge({ target: 0 }))).toThrow(/target/);
  });

  it("refuses a name outside 1 to NAME_MAX characters", () => {
    expect(() => parseChallenge(challenge({ name: "" }))).toThrow(/name/);
    expect(() => parseChallenge(challenge({ name: "x".repeat(33) }))).toThrow(
      /name/,
    );
  });

  it("refuses a permitted list that is empty, duplicated, or not a kind", () => {
    expect(() => parseChallenge(challenge({ permitted: [] }))).toThrow(/empty/);
    expect(() =>
      parseChallenge(challenge({ permitted: ["arm", "arm"] })),
    ).toThrow(/twice/);
    expect(() => parseChallenge(challenge({ permitted: ["lever"] }))).toThrow(
      /part kind/,
    );
    expect(() => parseChallenge(challenge({ permitted: ["rise"] }))).toThrow(
      /the tray derives/,
    );
  });

  it("refuses a derived tray above TRAY_MAX entries", () => {
    const many = Array.from({ length: 14 }, () => oneMote);
    expect(() =>
      parseChallenge(challenge({ reagents: many, products: many })),
    ).toThrow(/TRAY_MAX/);
  });

  it("refuses a pattern that fits nowhere on the field", () => {
    const long = {
      motes: Array.from({ length: 12 }, (_entry, index) => ({
        q: index,
        r: 0,
        type: "dust",
      })),
      filaments: Array.from({ length: 11 }, (_entry, index) => ({
        a: { q: index, r: 0 },
        b: { q: index + 1, r: 0 },
        weight: 1,
      })),
    };
    expect(() => parseChallenge(challenge({ reagents: [long] }))).toThrow(
      /fits nowhere/,
    );
  });
});

describe("parsing a molecule (specs/formats.md)", () => {
  it("refuses two motes on one hex", () => {
    expect(() =>
      parseMolecule(
        {
          motes: [
            { q: 0, r: 0, type: "dust" },
            { q: 0, r: 0, type: "dust" },
          ],
          filaments: [],
        },
        "m",
        false,
      ),
    ).toThrow(/two motes/);
  });

  it("refuses a filament that is not between two adjacent motes of the pattern", () => {
    const motes = [
      { q: 0, r: 0, type: "dust" },
      { q: 2, r: 0, type: "dust" },
    ];
    expect(() =>
      parseMolecule(
        {
          motes,
          filaments: [{ a: { q: 0, r: 0 }, b: { q: 2, r: 0 }, weight: 1 }],
        },
        "m",
        false,
      ),
    ).toThrow(/not adjacent/);
  });

  it("refuses a weight that is not 1 or 3", () => {
    expect(() =>
      parseMolecule(
        {
          motes: [
            { q: 0, r: 0, type: "dust" },
            { q: 1, r: 0, type: "dust" },
          ],
          filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 2 }],
        },
        "m",
        false,
      ),
    ).toThrow(/weight/);
  });

  it("refuses a pattern that is not one connected constellation", () => {
    expect(() =>
      parseMolecule(
        {
          motes: [
            { q: 0, r: 0, type: "dust" },
            { q: 1, r: 0, type: "dust" },
          ],
          filaments: [],
        },
        "m",
        false,
      ),
    ).toThrow(/connected/);
  });

  it("refuses a repeat on a reagent, and a zero repeat vector", () => {
    const repeating = {
      motes: [{ q: 0, r: 0, type: "dust" }],
      filaments: [],
      repeat: {
        vector: { q: 1, r: 0 },
        link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
      },
    };
    expect(() => parseMolecule(repeating, "m", false)).toThrow(/repeating/);
    expect(parseMolecule(repeating, "m", true).repeat).not.toBeNull();
    expect(() =>
      parseMolecule(
        {
          ...repeating,
          repeat: { ...repeating.repeat, vector: { q: 0, r: 0 } },
        },
        "m",
        true,
      ),
    ).toThrow(/zero offset/);
  });

  it("treats an absent repeat and a repeat of null alike", () => {
    expect(
      parseMolecule({ ...oneMote, repeat: null }, "m", true).repeat,
    ).toBeNull();
    expect(parseMolecule(oneMote, "m", true).repeat).toBeNull();
  });

  it("fits a one-mote pattern on the field and a huge one nowhere", () => {
    expect(fitsField(parseMolecule(oneMote, "m", false), false)).toBe(true);
  });
});

describe("solutions (specs/formats.md)", () => {
  it("parses each class's own keys", () => {
    const document = parseSolution({
      parts: [
        { kind: "rise", index: 0, q: -2, r: 0, rotation: 0 },
        {
          kind: "arm",
          q: 0,
          r: 0,
          rotation: 3,
          length: 2,
          tape: ["grab", null],
        },
        {
          kind: "track",
          cells: [
            { q: 0, r: 2 },
            { q: 1, r: 2 },
          ],
          closed: false,
        },
      ],
    });
    expect(document.parts[0].index).toBe(0);
    expect(document.parts[1].tape).toEqual(["grab"]);
    expect(document.parts[2].cells).toHaveLength(2);
    expect(document.parts[2].q).toBeUndefined();
  });

  it("refuses a bad rotation, length, tape entry, or empty path", () => {
    const arm = { kind: "arm", q: 0, r: 0, rotation: 0, length: 1, tape: [] };
    expect(() => parseSolution({ parts: [{ ...arm, rotation: 6 }] })).toThrow(
      /0 to 5/,
    );
    expect(() => parseSolution({ parts: [{ ...arm, length: 4 }] })).toThrow(
      /1 to 3/,
    );
    expect(() =>
      parseSolution({ parts: [{ ...arm, tape: ["spin"] }] }),
    ).toThrow(/instruction/);
    expect(() =>
      parseSolution({ parts: [{ kind: "track", cells: [] }] }),
    ).toThrow(/empty/);
    expect(() =>
      parseSolution({
        parts: [{ kind: "wheel", q: 0, r: 0, rotation: 0, length: 2 }],
      }),
    ).toThrow(/not 1/);
  });

  it("writes a machine back out in the form it accepts", () => {
    const machine = [
      createPart(1, "set", 2, 0, 1, { index: 0 }),
      createPart(2, "piston", 0, 0, 2, { length: 3, tape: ["extend"] }),
      createPart(3, "track", 0, 0, 0, {
        cells: [
          { q: 0, r: 3 },
          { q: 1, r: 3 },
        ],
      }),
    ];
    const document = solutionFromMachine(machine);
    expect(parseSolution(document)).toEqual(document);
    expect(document.parts.map((part) => part.kind)).toEqual([
      "set",
      "piston",
      "track",
    ]);
  });

  it("copies a challenge so a load shares nothing with the shipped one", () => {
    const original = EXTRA_CHALLENGES[1];
    const copy = cloneChallenge(original);
    copy.reagents[0].motes[0].q = 9;
    expect(original.reagents[0].motes[0].q).toBe(0);
  });
});

describe("loading a solution onto the machine (specs/formats.md)", () => {
  /** Extras 1, opened, with the state operations over it. */
  function opened(): { game: Bench; api: OrreryDebugApi } {
    const game = new Bench();
    const api = createDebugApi(() => game);
    api.openChallenge("extras", 0);
    return { game, api };
  }

  it("applies the parts in the order the document lists them", () => {
    const { game, api } = opened();
    api.loadSolution({
      parts: [
        { kind: "rise", index: 0, q: -3, r: 0, rotation: 0 },
        {
          kind: "arm",
          q: 0,
          r: 0,
          rotation: 3,
          length: 2,
          tape: ["grab", null, "drop"],
        },
        {
          kind: "track",
          cells: [
            { q: 0, r: 2 },
            { q: 1, r: 2 },
          ],
          closed: false,
        },
      ],
    });
    expect(game.state.editor.parts.map((part) => part.kind)).toEqual([
      "rise",
      "arm",
      "track",
    ]);
    expect(game.state.editor.parts[1]).toMatchObject({
      rotation: 3,
      length: 2,
      tape: ["grab", null, "drop"],
    });
    expect(game.state.editor.parts[2].cells).toHaveLength(2);
  });

  it("clears the hands and both histories", () => {
    const { game, api } = opened();
    api.loadSolution({ parts: [{ kind: "arm", q: 0, r: 0, rotation: 0 }] });
    expect(game.state.editor.undo).toHaveLength(0);
    expect(game.state.editor.redo).toHaveLength(0);
    expect(game.state.editor.selected).toBeNull();
    expect(game.state.editor.cursor).toBeNull();
    expect(game.state.editor.drag).toBeNull();
  });

  it("refuses a whole document one part of which breaks a placement rule", () => {
    const { api } = opened();
    api.placePart("arm", 2, 0, 0);
    const standing = JSON.stringify(api.readSolution());
    expect(() =>
      api.loadSolution({
        parts: [
          { kind: "arm", q: 0, r: 0, rotation: 0 },
          { kind: "arm", q: 0, r: 0, rotation: 0 },
        ],
      }),
    ).toThrow(/parts\[1\]/);
    expect(JSON.stringify(api.readSolution())).toBe(standing);
  });

  it("refuses a malformed document before it writes anything", () => {
    const { game, api } = opened();
    api.placePart("arm", 2, 0, 0);
    expect(() => api.loadSolution({ parts: [{ kind: "nonsense" }] })).toThrow(
      DocumentError,
    );
    expect(game.state.editor.parts).toHaveLength(1);
  });

  it("refuses a rise or set whose index the challenge does not carry", () => {
    const { api } = opened();
    expect(() =>
      api.loadSolution({
        parts: [{ kind: "rise", index: 4, q: 0, r: 0, rotation: 0 }],
      }),
    ).toThrow(/no footprint/);
  });

  it("accepts an empty machine, and a machine that omits its rises and sets", () => {
    const { game, api } = opened();
    api.loadSolution({ parts: [] });
    expect(game.state.editor.parts).toEqual([]);
    api.loadSolution({ parts: [{ kind: "arm", q: 0, r: 0, rotation: 0 }] });
    expect(game.state.editor.parts).toHaveLength(1);
  });
});
