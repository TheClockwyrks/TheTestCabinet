import { describe, expect, it } from "vitest";

import { PARTS, PART_COSTS, WHEEL_MOTES } from "./constants";
import { createPart } from "./machine";
import {
  apertureFootprint,
  armGripperHexes,
  armSpokes,
  lengthInBounds,
  machineCost,
  partClass,
  partCost,
  partHexes,
  placementFailure,
  placementLegal,
  mountedTrack,
  sigilFootprint,
  wheelFixture,
} from "./parts";
import type { Challenge, Molecule, PartState, W } from "./types";

const dust: W<Molecule> = {
  motes: [{ q: 0, r: 0, type: "dust" }],
  filaments: [],
  repeat: null,
};

const pair: W<Molecule> = {
  motes: [
    { q: 0, r: 0, type: "luna" },
    { q: 1, r: 0, type: "luna" },
  ],
  filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
  repeat: null,
};

const challenge: W<Challenge> = {
  name: "Fixture",
  reagents: [dust],
  products: [pair],
  permitted: ["arm"],
  target: 6,
};

let nextId = 1;
function part(
  kind: W<PartState>["kind"],
  q: number,
  r: number,
  rotation = 0,
  options: Parameters<typeof createPart>[5] = {},
): W<PartState> {
  nextId += 1;
  return createPart(nextId, kind, q, r, rotation, options);
}

describe("part anatomy (specs/parts.md)", () => {
  it("names each part kind's class", () => {
    expect(PARTS).toHaveLength(21);
    expect(partClass("piston")).toBe("arm");
    expect(partClass("wheel")).toBe("wheel");
    expect(partClass("track")).toBe("track");
    expect(partClass("void")).toBe("sigil");
    expect(partClass("rise")).toBe("rise");
    expect(partClass("set")).toBe("set");
  });

  it("gives each arm kind its spokes, relative to the rotation", () => {
    expect(armSpokes("arm", 2)).toEqual([2]);
    expect(armSpokes("piston", 0)).toEqual([0]);
    expect(armSpokes("biarm", 1)).toEqual([1, 4]);
    expect(armSpokes("triarm", 1)).toEqual([1, 3, 5]);
    expect(armSpokes("hexarm", 4)).toEqual([4, 5, 0, 1, 2, 3]);
  });

  it("stands a gripper at base + length * DIRS[spoke]", () => {
    expect(armGripperHexes("arm", { q: 0, r: 0 }, 0, 3)).toEqual([
      { q: 3, r: 0 },
    ]);
    expect(armGripperHexes("biarm", { q: 1, r: 1 }, 1, 2)).toEqual([
      { q: 1, r: 3 },
      { q: 1, r: -1 },
    ]);
  });

  it("turns the wheel's whole ring with its rotation", () => {
    expect(WHEEL_MOTES).toHaveLength(6);
    expect(wheelFixture(0, 0)).toBe("nebula");
    expect(wheelFixture(1, 1)).toBe("nebula");
    expect(wheelFixture(0, 1)).toBe("dust");
    expect(wheelFixture(2, 2)).toBe("nebula");
  });

  it("rotates a sigil's footprint about its anchor", () => {
    const upright = sigilFootprint("conjoin", { q: 0, r: 0 }, 0);
    expect(upright.map((entry) => entry.hex)).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 0, r: 1 },
    ]);
    expect(upright.map((entry) => entry.role)).toEqual([
      "fount",
      "fount",
      "crown",
    ]);
    const turned = sigilFootprint("conjoin", { q: 0, r: 0 }, 1);
    expect(turned.map((entry) => entry.hex)).toEqual([
      { q: 0, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
    ]);
  });

  it("gives a void sigil a maw and six rim hexes", () => {
    expect(sigilFootprint("void", { q: 0, r: 0 }, 0)).toHaveLength(7);
  });

  it("adds the repeat translate to a repeating product's set footprint", () => {
    const repeating: W<Molecule> = {
      motes: [{ q: 0, r: 0, type: "luna" }],
      filaments: [],
      repeat: {
        vector: { q: 1, r: 0 },
        link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
      },
    };
    expect(apertureFootprint(repeating, { q: 0, r: 0 }, 0, true)).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
    expect(apertureFootprint(repeating, { q: 0, r: 0 }, 0, false)).toEqual([
      { q: 0, r: 0 },
    ]);
  });

  it("reports every hex a placed part occupies", () => {
    expect(partHexes(part("arm", 1, 1), challenge)).toEqual([{ q: 1, r: 1 }]);
    expect(
      partHexes(
        part("track", 0, 0, 0, {
          cells: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
          ],
        }),
        challenge,
      ),
    ).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
    expect(partHexes(part("set", 0, 0, 0, { index: 0 }), challenge)).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
  });

  it("finds the track a mechanism's anchor sits on", () => {
    const track = part("track", 0, 0, 0, {
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
    });
    expect(mountedTrack({ q: 1, r: 0 }, [track])).toBe(track);
    expect(mountedTrack({ q: 2, r: 0 }, [track])).toBeNull();
  });
});

describe("costs (specs/parts.md)", () => {
  it("charges a track per cell and every other part its own figure", () => {
    expect(partCost(part("hexarm", 0, 0))).toBe(PART_COSTS.hexarm);
    expect(
      partCost(
        part("track", 0, 0, 0, {
          cells: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 2, r: 0 },
          ],
        }),
      ),
    ).toBe(15);
    expect(partCost(part("void", 0, 0))).toBe(0);
  });

  it("sums the machine", () => {
    expect(machineCost([part("arm", 0, 0), part("bind", 2, 0)])).toBe(30);
    expect(machineCost([])).toBe(0);
  });
});

describe("the placement rules (specs/parts.md)", () => {
  it("refuses a part with a hex off the field", () => {
    expect(placementFailure(part("arm", 6, 0), [], challenge)).toMatch(
      /on the field/,
    );
    expect(placementFailure(part("bind", 5, 0), [], challenge)).toMatch(
      /on the field/,
    );
    expect(placementLegal(part("bind", 4, 0), [], challenge)).toBe(true);
  });

  it("refuses two engravings that overlap", () => {
    const first = part("bind", 0, 0);
    expect(placementFailure(part("wane", 1, 0), [first], challenge)).toMatch(
      /engraving/,
    );
    expect(placementLegal(part("wane", 2, 0), [first], challenge)).toBe(true);
  });

  it("refuses a track cell on an engraving, and an engraving over a track", () => {
    const sigil = part("bind", 0, 0);
    const track = part("track", 3, 0, 0, { cells: [{ q: 3, r: 0 }] });
    expect(
      placementFailure(
        part("track", 0, 0, 0, { cells: [{ q: 0, r: 0 }] }),
        [sigil],
        challenge,
      ),
    ).toMatch(/engraving/);
    expect(placementFailure(part("bind", 3, 0), [track], challenge)).toMatch(
      /track cell/,
    );
  });

  it("refuses a hex in two tracks, and a hex twice in one track", () => {
    const track = part("track", 0, 0, 0, {
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
      ],
    });
    expect(
      placementFailure(
        part("track", 1, 0, 0, { cells: [{ q: 1, r: 0 }] }),
        [track],
        challenge,
      ),
    ).toMatch(/another track/);
    expect(
      placementFailure(
        part("track", 0, 0, 0, {
          cells: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 0, r: 0 },
          ],
        }),
        [],
        challenge,
      ),
    ).toMatch(/one track twice/);
  });

  it("refuses two arms or wheels on one anchor, and allows one over a sigil", () => {
    const arm = part("arm", 0, 0);
    expect(placementFailure(part("wheel", 0, 0), [arm], challenge)).toMatch(
      /already stands/,
    );
    const sigil = part("bind", 2, 0);
    expect(placementLegal(part("arm", 2, 0), [sigil], challenge)).toBe(true);
  });

  it("refuses two wheels whose rings meet, and allows them three apart", () => {
    const wheel = part("wheel", 0, 0);
    // Anchors one apart share two ring hexes; two apart share the one between
    // them. Either way a hex is adjacent to both anchors.
    expect(placementFailure(part("wheel", 1, 0), [wheel], challenge)).toMatch(
      /ring/,
    );
    expect(placementFailure(part("wheel", 2, 0), [wheel], challenge)).toMatch(
      /ring/,
    );
    // Three apart, no hex is adjacent to both.
    expect(placementLegal(part("wheel", 3, 0), [wheel], challenge)).toBe(true);
    // The clause is wheel to wheel: an arm may stand on a wheel's ring.
    expect(placementLegal(part("arm", 1, 0), [wheel], challenge)).toBe(true);
  });

  it("refuses a second rise or set for one index", () => {
    const rise = part("rise", 0, 0, 0, { index: 0 });
    expect(
      placementFailure(part("rise", 3, 0, 0, { index: 0 }), [rise], challenge),
    ).toMatch(/already placed/);
  });

  it("refuses a track whose cells are not a path", () => {
    expect(
      placementFailure(
        part("track", 0, 0, 0, {
          cells: [
            { q: 0, r: 0 },
            { q: 2, r: 0 },
          ],
        }),
        [],
        challenge,
      ),
    ).toMatch(/adjacent/);
  });

  it("refuses a closed track under three cells, or whose ends do not meet", () => {
    expect(
      placementFailure(
        part("track", 0, 0, 0, {
          cells: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
          ],
          closed: true,
        }),
        [],
        challenge,
      ),
    ).toMatch(/at least 3 cells/);
    expect(
      placementFailure(
        part("track", 0, 0, 0, {
          cells: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 2, r: 0 },
          ],
          closed: true,
        }),
        [],
        challenge,
      ),
    ).toMatch(/adjacent to its first/);
    expect(
      placementLegal(
        part("track", 0, 0, 0, {
          cells: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
            { q: 0, r: 1 },
          ],
          closed: true,
        }),
        [],
        challenge,
      ),
    ).toBe(true);
  });

  it("reads no permitted list: that is a tray rule of specs/editor.md", () => {
    expect(placementLegal(part("hexarm", 0, 0), [], challenge)).toBe(true);
  });
});

describe("what the placement rules leave free (specs/parts.md)", () => {
  it("lets a gripper and a fixture ring stand off the field", () => {
    // A hexarm on the rim reaches three hexes past it, and only its anchor is
    // ruled on: only motes collide, so a gripper passes over anything.
    const hexarm = part("hexarm", 5, 0, 0, { length: 3 });
    expect(placementLegal(hexarm, [], challenge)).toBe(true);
    expect(
      armGripperHexes("hexarm", { q: 5, r: 0 }, 0, 3).some(
        (cell) => Math.max(Math.abs(cell.q), Math.abs(cell.r)) > 5,
      ),
    ).toBe(true);
    // A wheel's anatomy is its hub and its ring, so its anchor alone is ruled
    // on and its ring may hang off the field.
    expect(placementLegal(part("wheel", 5, 0), [], challenge)).toBe(true);
  });

  it("mounts an arm positionally, on whatever track holds its anchor", () => {
    const track = part("track", 0, 0, 0, {
      cells: [
        { q: 0, r: 0 },
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
    });
    const arm = part("arm", 1, 0);
    expect(placementLegal(arm, [track], challenge)).toBe(true);
    expect(mountedTrack({ q: 1, r: 0 }, [track, arm])?.id).toBe(track.id);
    // Moving the arm off the path unmounts it, with nothing else changed.
    expect(mountedTrack({ q: 1, r: 2 }, [track, arm])).toBeNull();
    // Moving the track off the arm does the same.
    const moved = { ...track, cells: [{ q: 0, r: 3 }] };
    expect(mountedTrack({ q: 1, r: 0 }, [moved, arm])).toBeNull();
  });

  it("bounds an arm's rest length to ARM_MIN_LEN through ARM_MAX_LEN", () => {
    expect(lengthInBounds(1)).toBe(true);
    expect(lengthInBounds(3)).toBe(true);
    expect(lengthInBounds(0)).toBe(false);
    expect(lengthInBounds(4)).toBe(false);
    expect(lengthInBounds(1.5)).toBe(false);
  });

  it("lets a sigil footprint hex carry an arm's anchor", () => {
    const bind = part("bind", 0, 0);
    const arm = part("arm", 1, 0);
    expect(placementLegal(arm, [bind], challenge)).toBe(true);
    expect(placementLegal(bind, [arm], challenge)).toBe(true);
  });
});
