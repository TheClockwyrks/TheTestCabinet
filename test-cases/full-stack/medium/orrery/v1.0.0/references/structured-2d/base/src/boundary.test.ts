// Orrery — the order the boundary runs its parts in (specs/simulation.md "The
// sigil phase").
//
// Two kinds of case live here.
//
// The first are ORDERINGS A MACHINE CAN SHOW: each of the four waves completes
// before the sets are evaluated, and every set is evaluated before any rise
// spawns. Both are posed as legally placed machines and run through the `step`
// action. A repeating set is what makes them visible at all — its footprint is
// two copies wide but the chain it accepts runs on past it, so a sigil engraved
// beyond the footprint can touch a constellation the set is about to read, and
// a rise engraved there can be blocked by one.
//
// The second are ORDERINGS ONLY THE PHASE ITSELF CAN SHOW. Two sigils that read
// and write the same hex would have to overlap, and specs/parts.md rule 2 makes
// every engraving pairwise disjoint, so no legal machine puts one wave's effect
// where another wave, or another sigil of the same wave, can see it. Those
// cases therefore engrave the machine DIRECTLY, past the placement rules, and
// run the sigil phase over it: the ordering rule of specs/simulation.md is
// stated over the machine's sigils rather than over the placements that made
// them, and this is the only way to hold it to it.

import { describe, expect, it } from "vitest";

import { inReadingOrder, runSigilsSetsAndRises } from "./boundary";
import { createDebugApi, type OrreryDebugApi } from "./debug";
import { Bench } from "./harness";
import { sameHex } from "./hex";
import { simContext, stepOneCycle } from "./sim";
import type {
  MoteState,
  MoteType,
  PartKind,
  PartState,
  SimState,
} from "./types";

/** A repeating product of `nova`, chained east, with room for sigils beyond it. */
const NOVA_CHAIN = {
  name: "Nova Chain",
  reagents: [{ motes: [{ q: 0, r: 0, type: "nova" }], filaments: [] }],
  products: [
    {
      motes: [{ q: 0, r: 0, type: "nova" }],
      filaments: [],
      repeat: {
        vector: { q: 1, r: 0 },
        link: { a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, weight: 1 },
      },
    },
  ],
  permitted: ["arm", "wane", "bind", "sunder"],
  target: 6,
};

/** The same, of `luna`, for the case a rise takes part in. */
const LUNA_CHAIN = {
  ...NOVA_CHAIN,
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
};

/** A game running the given challenge, on an empty machine and an empty field. */
function bench(challenge: unknown): { game: Bench; api: OrreryDebugApi } {
  const game = new Bench();
  const api = createDebugApi(() => game);
  api.loadChallenge(challenge);
  api.clearMachine();
  api.setCompletion(false);
  api.startRun();
  api.clearMotes();
  return { game, api };
}

/** A game on Extras 1, whose machine the cases below engrave by hand. */
function plainBench(): { game: Bench; api: OrreryDebugApi } {
  const game = new Bench();
  const api = createDebugApi(() => game);
  api.openChallenge("extras", 0);
  api.clearMachine();
  api.setCompletion(false);
  api.startRun();
  api.clearMotes();
  return { game, api };
}

/** The live run, or the failure that there is none. */
function runOf(game: Bench): SimState {
  const sim = game.state.sim;
  if (sim === null) throw new Error("no run is live");
  return sim;
}

/** One placed part, as a machine holds it. */
function partAt(
  id: number,
  kind: PartKind,
  q: number,
  r: number,
  rotation = 0,
): PartState {
  return {
    id,
    kind,
    q,
    r,
    rotation,
    length: 1,
    cells: null,
    closed: null,
    index: null,
    tape: null,
  };
}

/**
 * Engrave one sigil onto the machine directly, past the placement rules. Two
 * sigils sharing a hex is what makes an ordering visible, and specs/parts.md
 * forbids the editor from making one.
 */
function engrave(
  game: Bench,
  kind: PartKind,
  q: number,
  r: number,
  rotation = 0,
): number {
  const { editor } = game.state;
  const id = editor.nextId;
  editor.nextId += 1;
  editor.parts.push(partAt(id, kind, q, r, rotation));
  return id;
}

/** Spawn one mote and report its id. */
function spawn(
  game: Bench,
  api: OrreryDebugApi,
  q: number,
  r: number,
  type: MoteType,
): number {
  api.spawnMote(q, r, type);
  const { motes } = runOf(game);
  return motes[motes.length - 1].id;
}

/** The mote resting on a hex, or `null`. */
function on(game: Bench, q: number, r: number): MoteState | null {
  return runOf(game).motes.find((mote) => sameHex(mote, { q, r })) ?? null;
}

/** Run the sigil phase alone, over the machine as it stands. */
function sigilPhase(game: Bench): void {
  const context = simContext(game);
  if (context === null) throw new Error("no run is live");
  runSigilsSetsAndRises(context);
}

/** Lay a chain of `count` motes east from `(0, 0)`, joined at weight `1`. */
function chain(
  game: Bench,
  api: OrreryDebugApi,
  count: number,
  type: MoteType,
): number[] {
  const ids: number[] = [];
  for (let copy = 0; copy < count; copy += 1) {
    ids.push(spawn(game, api, copy, 0, type));
    if (copy > 0) api.linkMotes(ids[copy - 1], ids[copy], 1);
  }
  return ids;
}

describe("reading order (specs/simulation.md)", () => {
  it("orders by ascending r, then ascending q, keeping ties as placed", () => {
    const parts = [
      partAt(1, "bind", 2, 1),
      partAt(2, "bind", -1, 0),
      partAt(3, "bind", 3, -2),
      partAt(4, "bind", 0, 1),
      partAt(5, "sunder", 0, 0),
      partAt(6, "bind", 0, 0),
    ];
    expect(inReadingOrder(parts, ["bind"]).map((part) => part.id)).toEqual([
      3, 2, 6, 4, 1,
    ]);
    // Only the kinds asked for take part.
    expect(inReadingOrder(parts, ["sunder"]).map((part) => part.id)).toEqual([
      5,
    ]);
  });

  it("lets each sigil of a wave read the field the one before it left", () => {
    const { game, api } = plainBench();
    // Two mirrors chained east: (0, 0) -> (1, 0), then (1, 0) -> (2, 0). The
    // second is engraved FIRST, so only the reading order can decide.
    engrave(game, "mirror", 1, 0);
    engrave(game, "mirror", 0, 0);
    spawn(game, api, 0, 0, "nova");
    spawn(game, api, 1, 0, "dust");
    spawn(game, api, 2, 0, "dust");
    sigilPhase(game);
    expect(on(game, 1, 0)?.type).toBe("nova");
    expect(on(game, 2, 0)?.type).toBe("nova");
  });

  it("does not carry an effect backwards along the reading order", () => {
    const { game, api } = plainBench();
    // The same chain running west: the mirror at (-1, 0) reads its source
    // BEFORE the mirror at (0, 0) has written it, so the cascade stops.
    engrave(game, "mirror", 0, 0, 3);
    engrave(game, "mirror", -1, 0, 3);
    spawn(game, api, 0, 0, "nova");
    spawn(game, api, -1, 0, "dust");
    spawn(game, api, -2, 0, "dust");
    sigilPhase(game);
    expect(on(game, -1, 0)?.type).toBe("nova");
    expect(on(game, -2, 0)?.type).toBe("dust");
  });
});

describe("the four waves, in order (specs/simulation.md)", () => {
  it("runs the transmuting wave before the binding wave", () => {
    const { game, api } = plainBench();
    // The wane dims the nova on (0, 0) before the triune looks for two.
    engrave(game, "wane", 0, 0);
    engrave(game, "triune", 0, 0);
    const first = spawn(game, api, 0, 0, "nova");
    const second = spawn(game, api, 1, 0, "nova");
    sigilPhase(game);
    expect(on(game, 0, 0)?.type).toBe("dust");
    expect(runOf(game).filaments).toHaveLength(0);
    expect([first, second]).toHaveLength(2);
  });

  it("runs the binding wave before sunder", () => {
    const { game, api } = plainBench();
    // The bind creates the filament; the sunder, a wave later, removes it.
    engrave(game, "bind", 0, 0);
    engrave(game, "sunder", 0, 0);
    spawn(game, api, 0, 0, "dust");
    spawn(game, api, 1, 0, "dust");
    sigilPhase(game);
    expect(runOf(game).filaments).toHaveLength(0);
    expect(runOf(game).motes).toHaveLength(2);
  });

  it("runs the binding wave before void", () => {
    const { game, api } = plainBench();
    // Bound by the wave before it, the mote on the maw is no longer unbonded.
    engrave(game, "bind", 0, 0);
    engrave(game, "void", 0, 0);
    spawn(game, api, 0, 0, "dust");
    spawn(game, api, 1, 0, "dust");
    sigilPhase(game);
    expect(runOf(game).filaments).toHaveLength(1);
    expect(on(game, 0, 0)).not.toBeNull();
  });

  it("runs sunder before void", () => {
    const { game, api } = plainBench();
    // The sunder frees the mote on the maw, and the void then consumes it.
    engrave(game, "sunder", 0, 0);
    engrave(game, "void", 0, 0);
    const first = spawn(game, api, 0, 0, "dust");
    const second = spawn(game, api, 1, 0, "dust");
    api.linkMotes(first, second, 1);
    sigilPhase(game);
    expect(on(game, 0, 0)).toBeNull();
    expect(on(game, 1, 0)).not.toBeNull();
  });
});

describe("the waves run before the sets (specs/simulation.md)", () => {
  it("dims a chain's mote before the set reads it", () => {
    const { game, api } = bench(NOVA_CHAIN);
    api.placeSet(0, 0, 0, 0);
    // The set's own footprint is (0, 0) and (1, 0); the wane is beyond it.
    api.placePart("wane", 2, 0, 0);
    chain(game, api, 4, "nova");
    stepOneCycle(game);
    expect(on(game, 2, 0)?.type).toBe("dust");
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(4);
  });

  it("binds a further mote onto a chain before the set reads it", () => {
    const { game, api } = bench(NOVA_CHAIN);
    api.placeSet(0, 0, 0, 0);
    // A bind on (2, 0) and (2, 1), clear of the set's footprint.
    api.placePart("bind", 2, 0, 1);
    chain(game, api, 3, "nova");
    spawn(game, api, 2, 1, "nova");
    stepOneCycle(game);
    expect(runOf(game).filaments).toHaveLength(3);
    expect(runOf(game).tallies).toEqual([0]);
    expect(runOf(game).motes).toHaveLength(4);
  });

  it("sunders a chain before the set reads it, and the set takes what is left", () => {
    const { game, api } = bench(NOVA_CHAIN);
    api.placeSet(0, 0, 0, 0);
    // The sunder removes the link between the third and fourth copies.
    api.placePart("sunder", 2, 0, 0);
    chain(game, api, 4, "nova");
    stepOneCycle(game);
    expect(runOf(game).tallies).toEqual([3]);
    expect(runOf(game).motes).toHaveLength(1);
    expect(on(game, 3, 0)?.type).toBe("nova");
  });
});

describe("the sets run before the rises (specs/simulation.md)", () => {
  it("refills a footprint a set cleared at the same boundary", () => {
    const { game, api } = bench(LUNA_CHAIN);
    api.placeSet(0, 0, 0, 0);
    api.placeRise(0, 3, 0, 0);
    const ids = chain(game, api, 4, "luna");
    stepOneCycle(game);
    expect(runOf(game).tallies).toEqual([4]);
    const delivered = on(game, 3, 0);
    expect(delivered?.type).toBe("luna");
    // A fresh mote, not the one the set consumed.
    expect(ids).not.toContain(delivered?.id);
    expect(runOf(game).motes).toHaveLength(1);
  });
});
