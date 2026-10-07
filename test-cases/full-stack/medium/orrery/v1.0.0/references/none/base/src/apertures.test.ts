// Orrery — what a rise delivers and what a set accepts (specs/sigils.md "Rises
// and sets").
//
// A rise is checked against its footprint's vacancy and the pose it lays the
// reagent down at. A set is checked against the four halves of "exactly the
// placed pattern" — the types on the hexes, the filaments and their weights,
// nothing further, and the placement itself — and then against the repeating
// form, where `k` chained copies are accepted and the tally rises by `k`.
//
// The challenges are posed through `loadChallenge` rather than taken off the
// Extras shelf wherever the case needs a particular pattern, so each case reads
// as the pattern it is about.

import { describe, expect, it } from "vitest";

import { CUES } from "./constants";
import { createStateOps, type OrreryStateOps } from "./debug";
import { Game } from "./game";
import { sameHex } from "./hex";
import { stepOneCycle } from "./sim";
import type { MoteState, MoteType, SimState } from "./types";

/** A reagent of two motes joined by a triune filament, and a trivial product. */
const PAIRED_REAGENT = {
  name: "Paired Reagent",
  reagents: [
    {
      motes: [
        { q: 0, r: 0, type: "nova" },
        { q: 1, r: 0, type: "comet" },
      ],
      filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 3 }],
    },
  ],
  products: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
  permitted: ["arm"],
  target: 6,
};

/** A plain product of two `luna` joined by a weight `1` filament. */
const PAIR_PRODUCT = {
  name: "Paired Product",
  reagents: [{ motes: [{ q: 0, r: 0, type: "luna" }], filaments: [] }],
  products: [
    {
      motes: [
        { q: 0, r: 0, type: "luna" },
        { q: 1, r: 0, type: "luna" },
      ],
      filaments: [{ a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 }],
    },
  ],
  permitted: ["arm"],
  target: 6,
};

/** A three-mote product carrying two of the three possible filaments. */
const TRIANGLE_PRODUCT = {
  name: "Open Triangle",
  reagents: [{ motes: [{ q: 0, r: 0, type: "dust" }], filaments: [] }],
  products: [
    {
      motes: [
        { q: 0, r: 0, type: "dust" },
        { q: 1, r: 0, type: "dust" },
        { q: 0, r: 1, type: "dust" },
      ],
      filaments: [
        { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
        { a: { q: 0, r: 0 }, b: { q: 0, r: 1 }, weight: 1 },
      ],
    },
  ],
  permitted: ["arm"],
  target: 6,
};

/** A repeating product: one `luna` per copy, chained east by weight `1`. */
const CHAIN_PRODUCT = {
  name: "Luna Chain",
  reagents: [{ motes: [{ q: 0, r: 0, type: "luna" }], filaments: [] }],
  products: [
    {
      motes: [{ q: 0, r: 0, type: "luna" }],
      filaments: [],
      repeat: {
        vector: { q: 1, r: 0 },
        link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
      },
    },
  ],
  permitted: ["arm"],
  target: 6,
};

/** A game running the given challenge, on an empty machine and an empty field. */
function bench(challenge: unknown): { game: Game; api: OrreryStateOps } {
  const game = new Game();
  const api = createStateOps(game);
  api.loadChallenge(challenge);
  api.clearMachine();
  api.setCompletion(false);
  api.startRun();
  api.clearMotes();
  return { game, api };
}

/** The live run, or the failure that there is none. */
function runOf(game: Game): SimState {
  const sim = game.state.sim;
  if (sim === null) throw new Error("no run is live");
  return sim;
}

/** Spawn one mote and report its id. */
function spawn(
  game: Game,
  api: OrreryStateOps,
  q: number,
  r: number,
  type: MoteType,
): number {
  api.spawnMote(q, r, type);
  const { motes } = runOf(game);
  return motes[motes.length - 1].id;
}

/** The mote resting on a hex, or `null`. */
function on(game: Game, q: number, r: number): MoteState | null {
  return runOf(game).motes.find((mote) => sameHex(mote, { q, r })) ?? null;
}

/** The weight of the filament joining two motes, or `null` for none. */
function weightBetween(game: Game, a: number, b: number): number | null {
  const found = runOf(game).filaments.find(
    (filament) =>
      (filament.a === a && filament.b === b) ||
      (filament.a === b && filament.b === a),
  );
  return found?.weight ?? null;
}

/** Run one whole cycle, and with it exactly one boundary. */
function boundary(game: Game): void {
  stepOneCycle(game);
}

/** Lay a chain of `count` `luna` east from `(0, 0)`, joined at `weight`. */
function chain(
  game: Game,
  api: OrreryStateOps,
  count: number,
  weight = 1,
): number[] {
  const ids: number[] = [];
  for (let copy = 0; copy < count; copy += 1) {
    ids.push(spawn(game, api, copy, 0, "luna"));
    if (copy > 0) api.linkMotes(ids[copy - 1], ids[copy], weight);
  }
  return ids;
}

describe("a rise (specs/sigils.md)", () => {
  it("lays its reagent's motes and filaments down at the placed pose", () => {
    const { game, api } = bench(PAIRED_REAGENT);
    api.placeRise(0, 0, 0, 2);
    boundary(game);
    // Rotation 2 carries the pattern's (1, 0) onto (-1, 1).
    const first = on(game, 0, 0);
    const second = on(game, -1, 1);
    expect(first?.type).toBe("nova");
    expect(second?.type).toBe("comet");
    expect(weightBetween(game, first?.id ?? -1, second?.id ?? -1)).toBe(3);
    expect(runOf(game).grips).toHaveLength(0);
  });

  it("waits while any footprint hex holds a mote or a fixture", () => {
    const { game, api } = bench(PAIRED_REAGENT);
    api.placeRise(0, 0, 0, 0);
    const blocker = spawn(game, api, 1, 0, "dust");
    boundary(game);
    expect(runOf(game).motes).toHaveLength(1);
    expect(on(game, 0, 0)).toBeNull();

    // A wheel's fixture makes a footprint hex not vacant just as a mote does.
    api.removeMote(blocker);
    api.placePart("wheel", 2, 0, 0);
    expect(on(game, 1, 0)?.wheel).not.toBeNull();
    boundary(game);
    expect(on(game, 0, 0)).toBeNull();
  });

  it("reads its own pattern hexes alone, and delivers again once cleared", () => {
    const { game, api } = bench(PAIRED_REAGENT);
    api.placeRise(0, 0, 0, 0);
    // A mote beside the footprint but off it blocks nothing.
    spawn(game, api, 0, 1, "dust");
    boundary(game);
    expect(on(game, 0, 0)?.type).toBe("nova");
    expect(on(game, 1, 0)?.type).toBe("comet");

    // While the footprint stands occupied nothing further is delivered.
    boundary(game);
    expect(runOf(game).motes).toHaveLength(3);

    // Cleared, it delivers again at the next boundary.
    api.removeMote(on(game, 0, 0)?.id ?? -1);
    api.removeMote(on(game, 1, 0)?.id ?? -1);
    boundary(game);
    expect(on(game, 0, 0)?.type).toBe("nova");
    expect(on(game, 1, 0)?.type).toBe("comet");
  });
});

describe("a plain set (specs/sigils.md)", () => {
  it("consumes a constellation that is exactly the placed pattern", () => {
    const { game, api } = bench(PAIR_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    const [first, second] = chain(game, api, 2);
    boundary(game);
    expect(runOf(game).motes).toHaveLength(0);
    expect(runOf(game).filaments).toHaveLength(0);
    expect(runOf(game).tallies).toEqual([1]);
    expect(weightBetween(game, first, second)).toBeNull();
  });

  it("refuses a held constellation", () => {
    const { game, api } = bench(PAIR_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    const [first] = chain(game, api, 2);
    // An arm at (-1, 0) reaches its one gripper onto (0, 0).
    api.placePart("arm", -1, 0, 0);
    const arm = game.state.editor.parts.slice(-1)[0].id;
    api.setGrip(arm, 0, first);
    boundary(game);
    expect(runOf(game).motes).toHaveLength(2);
    expect(runOf(game).tallies).toEqual([0]);
  });

  it("refuses a wrong type, a wrong weight, and a missing filament", () => {
    const { game, api } = bench(PAIR_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    const wrong = spawn(game, api, 0, 0, "sol");
    const partner = spawn(game, api, 1, 0, "luna");
    api.linkMotes(wrong, partner, 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    api.removeMote(wrong);
    api.removeMote(partner);

    const heavy = chain(game, api, 2, 3);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    api.unlinkMotes(heavy[0], heavy[1]);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(2);
  });

  it("refuses a constellation carrying a further mote", () => {
    const { game, api } = bench(PAIR_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    const ids = chain(game, api, 2);
    const extra = spawn(game, api, 1, 1, "luna");
    api.linkMotes(ids[1], extra, 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(3);
  });

  it("refuses a constellation carrying a further filament", () => {
    const { game, api } = bench(TRIANGLE_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    const center = spawn(game, api, 0, 0, "dust");
    const east = spawn(game, api, 1, 0, "dust");
    const south = spawn(game, api, 0, 1, "dust");
    api.linkMotes(center, east, 1);
    api.linkMotes(center, south, 1);
    api.linkMotes(east, south, 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(3);

    // With that third filament gone it is exactly the pattern.
    api.unlinkMotes(east, south);
    boundary(game);
    expect(runOf(game).tallies).toEqual([1]);
    expect(runOf(game).motes).toHaveLength(0);
  });

  it("refuses a match resting off its hexes or at another rotation", () => {
    const { game, api } = bench(PAIR_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    // The same pattern, one hex east of the set's own hexes.
    const shifted = [
      spawn(game, api, 1, 0, "luna"),
      spawn(game, api, 2, 0, "luna"),
    ];
    api.linkMotes(shifted[0], shifted[1], 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    api.removeMote(shifted[0]);
    api.removeMote(shifted[1]);

    // The pattern rotated about the set's anchor rather than at its rotation.
    const turned = [
      spawn(game, api, 0, 0, "luna"),
      spawn(game, api, 0, 1, "luna"),
    ];
    api.linkMotes(turned[0], turned[1], 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(2);
  });
});

describe("a repeating set (specs/sigils.md)", () => {
  it("consumes a chain of k copies and raises the tally by k", () => {
    const { game, api } = bench(CHAIN_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    chain(game, api, 4);
    boundary(game);
    expect(runOf(game).motes).toHaveLength(0);
    expect(runOf(game).tallies).toEqual([4]);
  });

  it("refuses a single copy, below REPEAT_MIN", () => {
    const { game, api } = bench(CHAIN_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    chain(game, api, 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(1);
  });

  it("refuses copies that march along another offset", () => {
    const { game, api } = bench(CHAIN_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    // Three copies chained southeast rather than along the repeat vector.
    const ids = [
      spawn(game, api, 0, 0, "luna"),
      spawn(game, api, 0, 1, "luna"),
      spawn(game, api, 0, 2, "luna"),
    ];
    api.linkMotes(ids[0], ids[1], 1);
    api.linkMotes(ids[1], ids[2], 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(3);
  });

  it("refuses a chain linked at another weight", () => {
    const { game, api } = bench(CHAIN_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    chain(game, api, 3, 3);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(3);
  });

  it("refuses a chain carrying anything further", () => {
    const { game, api } = bench(CHAIN_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    const ids = chain(game, api, 2);
    const extra = spawn(game, api, 1, 1, "luna");
    api.linkMotes(ids[1], extra, 1);
    boundary(game);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(3);
  });
});

describe("the constellation cue (specs/ui.md)", () => {
  it("sounds on the boundary a set consumes at, and on no other", () => {
    const { game, api } = bench(PAIR_PRODUCT);
    api.placeSet(0, 0, 0, 0);
    boundary(game);
    expect(game.pendingCues()).not.toContain(CUES.constellation);
    chain(game, api, 2);
    boundary(game);
    expect(game.pendingCues()).toContain(CUES.constellation);
  });
});
