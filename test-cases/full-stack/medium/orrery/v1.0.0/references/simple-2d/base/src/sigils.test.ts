// Orrery — every sigil's condition and every sigil's effect (specs/sigils.md).
//
// One `describe` per sigil, and inside each the two halves the specification
// states: the condition under which it acts, and what it does to its own
// footprint when it does. Each case poses the smallest field that decides the
// question — the sigil, the motes on its hexes, and nothing else — and runs one
// boundary through the `step` action, so what is asserted is what a real cycle
// left rather than what a helper computed.
//
// The bench starts a run on an EMPTY machine and clears the motes, so every
// mote on the field is one the case put there and every part is one it placed.
// Completion is switched off, because a boundary that satisfied a target would
// stop the run before the next case could read it.

import { describe, expect, it } from "vitest";
import { createStateOps, type OrreryStateOps } from "./debug";
import { sameHex } from "./hex";
import { Session } from "./session";
import { stepOneCycle } from "./sim";
import type { MoteState, MoteType, PartKind, SimState, W } from "./types";

/** A game with a live run, an empty machine, and an empty field. */
function bench(): { game: Session; api: OrreryStateOps } {
  const game = new Session();
  const api = createStateOps(game);
  api.openChallenge("extras", 0);
  api.clearMachine();
  api.setCompletion(false);
  api.startRun();
  api.clearMotes();
  return { game, api };
}

/** The live run, or the failure that there is none. */
function runOf(game: Session): W<SimState> {
  const sim = game.state.sim;
  if (sim === null) throw new Error("no run is live");
  return sim;
}

/** Place one part and report its id. */
function place(
  game: Session,
  api: OrreryStateOps,
  kind: PartKind,
  q: number,
  r: number,
  rotation = 0,
): number {
  api.placePart(kind, q, r, rotation);
  const { parts } = game.state.editor;
  return parts[parts.length - 1].id;
}

/** Spawn one mote and report its id. */
function spawn(
  game: Session,
  api: OrreryStateOps,
  q: number,
  r: number,
  type: MoteType,
): number {
  api.spawnMote(q, r, type);
  const { motes } = runOf(game);
  return motes[motes.length - 1].id;
}

/** The mote resting on a hex, a fixture included, or `null`. */
function on(game: Session, q: number, r: number): W<MoteState> | null {
  return runOf(game).motes.find((mote) => sameHex(mote, { q, r })) ?? null;
}

/** The type of the mote resting on a hex, or `null` for a vacant one. */
function typeOn(game: Session, q: number, r: number): MoteType | null {
  return on(game, q, r)?.type ?? null;
}

/** The weight of the filament joining two motes, or `null` for none. */
function weightBetween(game: Session, a: number, b: number): number | null {
  const found = runOf(game).filaments.find(
    (filament) =>
      (filament.a === a && filament.b === b) ||
      (filament.a === b && filament.b === a),
  );
  return found?.weight ?? null;
}

/** Run one whole cycle, and with it exactly one boundary. */
function boundary(game: Session): void {
  stepOneCycle(game);
}

/** Hold the mote on `(q, r)` with an arm reaching onto it from the west. */
function holdAt(
  game: Session,
  api: OrreryStateOps,
  q: number,
  r: number,
  mote: number,
): number {
  const arm = place(game, api, "arm", q - 1, r, 0);
  api.setGrip(arm, 0, mote);
  return arm;
}

describe("the sigil phase raises no fault (specs/sigils.md)", () => {
  it("leaves a sigil whose condition does not hold waiting", () => {
    const { game, api } = bench();
    place(game, api, "void", 0, 0);
    boundary(game);
    const sim = runOf(game);
    expect(sim.status).toBe("paused");
    expect(sim.fault).toBeNull();
  });

  it("acts at every boundary its condition holds at", () => {
    const { game, api } = bench();
    place(game, api, "void", 0, 0);
    for (let pass = 0; pass < 3; pass += 1) {
      spawn(game, api, 0, 0, "dust");
      boundary(game);
      expect(on(game, 0, 0)).toBeNull();
    }
  });

  it("places a footprint rotated about its anchor", () => {
    const { game, api } = bench();
    place(game, api, "bind", 0, 0, 2);
    const first = spawn(game, api, 0, 0, "dust");
    const second = spawn(game, api, -1, 1, "dust");
    const aside = spawn(game, api, 1, 0, "dust");
    boundary(game);
    expect(weightBetween(game, first, second)).toBe(1);
    expect(weightBetween(game, first, aside)).toBeNull();
  });
});

describe("bind (specs/sigils.md)", () => {
  it("joins the motes on its two hexes with a weight 1 filament", () => {
    const { game, api } = bench();
    place(game, api, "bind", 0, 0);
    const first = spawn(game, api, 0, 0, "dust");
    const second = spawn(game, api, 1, 0, "luna");
    boundary(game);
    expect(weightBetween(game, first, second)).toBe(1);
  });

  it("waits on an empty hex, on an already joined pair, and on a fixture", () => {
    const { game, api } = bench();
    place(game, api, "bind", 0, 0);
    const lone = spawn(game, api, 0, 0, "dust");
    boundary(game);
    expect(runOf(game).filaments).toHaveLength(0);
    // The pair that is already joined gains no second filament.
    const second = spawn(game, api, 1, 0, "dust");
    api.linkMotes(lone, second, 3);
    boundary(game);
    expect(runOf(game).filaments).toHaveLength(1);
    expect(weightBetween(game, lone, second)).toBe(3);
  });

  it("does not join a wheel's fixture", () => {
    const { game, api } = bench();
    place(game, api, "bind", 0, 0);
    // A wheel hub at (0, -1) carries its spoke 1 fixture onto (0, 0).
    place(game, api, "wheel", 0, -1);
    const loose = spawn(game, api, 1, 0, "dust");
    const fixture = on(game, 0, 0);
    expect(fixture?.wheel).not.toBeNull();
    boundary(game);
    expect(weightBetween(game, fixture?.id ?? -1, loose)).toBeNull();
  });
});

describe("manifold (specs/sigils.md)", () => {
  it("binds every occupied reach to the center in one boundary", () => {
    const { game, api } = bench();
    place(game, api, "manifold", 0, 0);
    const center = spawn(game, api, 0, 0, "dust");
    const east = spawn(game, api, 1, 0, "dust");
    const southwest = spawn(game, api, -1, 1, "dust");
    const northwest = spawn(game, api, 0, -1, "dust");
    boundary(game);
    expect(weightBetween(game, center, east)).toBe(1);
    expect(weightBetween(game, center, southwest)).toBe(1);
    expect(weightBetween(game, center, northwest)).toBe(1);
    expect(runOf(game).filaments).toHaveLength(3);
  });

  it("waits on an empty center, and skips an empty or joined reach", () => {
    const { game, api } = bench();
    place(game, api, "manifold", 0, 0);
    spawn(game, api, 1, 0, "dust");
    spawn(game, api, -1, 1, "dust");
    boundary(game);
    expect(runOf(game).filaments).toHaveLength(0);
    // With the center filled, the one already joined reach gains nothing more.
    const center = spawn(game, api, 0, 0, "dust");
    const east = on(game, 1, 0);
    api.linkMotes(center, east?.id ?? -1, 1);
    boundary(game);
    expect(runOf(game).filaments).toHaveLength(2);
  });
});

describe("triune (specs/sigils.md)", () => {
  it("joins two nova with a weight 3 filament", () => {
    const { game, api } = bench();
    place(game, api, "triune", 0, 0);
    const first = spawn(game, api, 0, 0, "nova");
    const second = spawn(game, api, 1, 0, "nova");
    boundary(game);
    expect(weightBetween(game, first, second)).toBe(3);
  });

  it("waits on any pair that is not two unjoined nova", () => {
    const { game, api } = bench();
    place(game, api, "triune", 0, 0);
    const first = spawn(game, api, 0, 0, "nova");
    const second = spawn(game, api, 1, 0, "comet");
    boundary(game);
    expect(weightBetween(game, first, second)).toBeNull();
    // Two nova a weight 1 filament already joins keep that one filament.
    api.removeMote(second);
    const nova = spawn(game, api, 1, 0, "nova");
    api.linkMotes(first, nova, 1);
    boundary(game);
    expect(weightBetween(game, first, nova)).toBe(1);
    expect(runOf(game).filaments).toHaveLength(1);
  });
});

describe("sunder (specs/sigils.md)", () => {
  it("removes the filament joining its two hexes, whatever its weight", () => {
    const { game, api } = bench();
    place(game, api, "sunder", 0, 0);
    const first = spawn(game, api, 0, 0, "nova");
    const second = spawn(game, api, 1, 0, "nova");
    api.linkMotes(first, second, 3);
    boundary(game);
    expect(weightBetween(game, first, second)).toBeNull();
    expect(on(game, 0, 0)?.id).toBe(first);
    expect(on(game, 1, 0)?.id).toBe(second);
  });

  it("waits on an unjoined pair and leaves other filaments alone", () => {
    const { game, api } = bench();
    place(game, api, "sunder", 0, 0);
    const first = spawn(game, api, 0, 0, "dust");
    const second = spawn(game, api, 1, 0, "dust");
    const third = spawn(game, api, 2, 0, "dust");
    api.linkMotes(second, third, 1);
    boundary(game);
    expect(runOf(game).filaments).toHaveLength(1);
    expect(weightBetween(game, second, third)).toBe(1);
    expect(weightBetween(game, first, second)).toBeNull();
  });
});

describe("wane (specs/sigils.md)", () => {
  it("turns an essence on its seat to dust, keeping its filaments and hold", () => {
    const { game, api } = bench();
    place(game, api, "wane", 0, 0);
    const seat = spawn(game, api, 0, 0, "comet");
    const neighbor = spawn(game, api, 1, 0, "dust");
    api.linkMotes(seat, neighbor, 1);
    const arm = holdAt(game, api, 0, 0, seat);
    boundary(game);
    expect(on(game, 0, 0)?.id).toBe(seat);
    expect(typeOn(game, 0, 0)).toBe("dust");
    expect(weightBetween(game, seat, neighbor)).toBe(1);
    expect(runOf(game).grips).toEqual([{ part: arm, spoke: 0, mote: seat }]);
  });

  it("leaves every type but an essence as it is", () => {
    const { game, api } = bench();
    place(game, api, "wane", 0, 0);
    for (const type of [
      "dust",
      "mercury",
      "luna",
      "umbra",
      "aether",
    ] as const) {
      const mote = spawn(game, api, 0, 0, type);
      boundary(game);
      expect(typeOn(game, 0, 0)).toBe(type);
      api.removeMote(mote);
    }
  });
});

describe("mirror (specs/sigils.md)", () => {
  it("copies the source essence onto dust, leaving the source in place", () => {
    const { game, api } = bench();
    place(game, api, "mirror", 0, 0);
    spawn(game, api, 0, 0, "nova");
    spawn(game, api, 1, 0, "dust");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("nova");
    expect(typeOn(game, 1, 0)).toBe("nova");
  });

  it("waits on a source that is no essence and a target that is no dust", () => {
    const { game, api } = bench();
    place(game, api, "mirror", 0, 0);
    const source = spawn(game, api, 0, 0, "luna");
    const target = spawn(game, api, 1, 0, "dust");
    boundary(game);
    expect(typeOn(game, 1, 0)).toBe("dust");
    api.removeMote(source);
    api.removeMote(target);
    spawn(game, api, 0, 0, "comet");
    spawn(game, api, 1, 0, "meteor");
    boundary(game);
    expect(typeOn(game, 1, 0)).toBe("meteor");
  });

  it("reads a wheel's essence fixture as a source, and never as a target", () => {
    const { game, api } = bench();
    place(game, api, "mirror", 0, 0);
    // The wheel at (0, -1) carries its spoke 1 fixture, `comet`, onto (0, 0).
    place(game, api, "wheel", 0, -1);
    expect(on(game, 0, 0)?.wheel).not.toBeNull();
    expect(typeOn(game, 0, 0)).toBe("comet");
    spawn(game, api, 1, 0, "dust");
    boundary(game);
    expect(typeOn(game, 1, 0)).toBe("comet");

    // A dust FIXTURE on the target satisfies no target condition.
    const other = bench();
    place(other.game, other.api, "mirror", 0, 0);
    // A wheel at (1, 1) carries its spoke 4 fixture, `dust`, onto (1, 0).
    place(other.game, other.api, "wheel", 1, 1);
    expect(typeOn(other.game, 1, 0)).toBe("dust");
    spawn(other.game, other.api, 0, 0, "nova");
    boundary(other.game);
    expect(typeOn(other.game, 1, 0)).toBe("dust");
  });
});

describe("ascend (specs/sigils.md)", () => {
  it("spends the mercury and raises the crown's planet one rung", () => {
    const { game, api } = bench();
    place(game, api, "ascend", 0, 0);
    const ladder = [
      ["saturn", "jupiter"],
      ["jupiter", "mars"],
      ["mars", "venus"],
      ["venus", "luna"],
      ["luna", "sol"],
    ] as const;
    for (const [rung, risen] of ladder) {
      const mercury = spawn(game, api, 0, 0, "mercury");
      const planet = spawn(game, api, 1, 0, rung);
      boundary(game);
      expect(on(game, 0, 0)).toBeNull();
      expect(runOf(game).motes.some((mote) => mote.id === mercury)).toBe(false);
      expect(typeOn(game, 1, 0)).toBe(risen);
      api.removeMote(planet);
    }
  });

  it("waits on a sol crown, and on a bonded or a held mercury", () => {
    const { game, api } = bench();
    place(game, api, "ascend", 0, 0);
    spawn(game, api, 0, 0, "mercury");
    const top = spawn(game, api, 1, 0, "sol");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("mercury");
    expect(typeOn(game, 1, 0)).toBe("sol");
    api.removeMote(top);

    // A bonded mercury is not spent.
    const mercury = on(game, 0, 0);
    const planet = spawn(game, api, 1, 0, "saturn");
    const anchor = spawn(game, api, 0, -1, "dust");
    api.linkMotes(mercury?.id ?? -1, anchor, 1);
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("mercury");
    expect(typeOn(game, 1, 0)).toBe("saturn");

    // A held mercury is not spent either.
    api.unlinkMotes(mercury?.id ?? -1, anchor);
    holdAt(game, api, 0, 0, mercury?.id ?? -1);
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("mercury");
    expect(typeOn(game, 1, 0)).toBe("saturn");
    expect(runOf(game).motes.some((mote) => mote.id === planet)).toBe(true);
  });

  it("raises a planet that is itself bonded and held", () => {
    const { game, api } = bench();
    place(game, api, "ascend", 0, 0);
    spawn(game, api, 0, 0, "mercury");
    const planet = spawn(game, api, 1, 0, "mars");
    const partner = spawn(game, api, 2, 0, "dust");
    api.linkMotes(planet, partner, 1);
    holdAt(game, api, 1, 0, planet);
    boundary(game);
    expect(typeOn(game, 1, 0)).toBe("venus");
    expect(on(game, 0, 0)).toBeNull();
  });
});

describe("conjoin (specs/sigils.md)", () => {
  it("consumes two of one planet and crowns the next rung", () => {
    const { game, api } = bench();
    place(game, api, "conjoin", 0, 0);
    spawn(game, api, 0, 0, "venus");
    spawn(game, api, 1, 0, "venus");
    boundary(game);
    expect(on(game, 0, 0)).toBeNull();
    expect(on(game, 1, 0)).toBeNull();
    expect(typeOn(game, 0, 1)).toBe("luna");
    expect(runOf(game).grips).toHaveLength(0);
    expect(runOf(game).filaments).toHaveLength(0);
  });

  it("waits on differing planets, on two sol, and on an occupied crown", () => {
    const { game, api } = bench();
    place(game, api, "conjoin", 0, 0);
    const first = spawn(game, api, 0, 0, "saturn");
    const second = spawn(game, api, 1, 0, "jupiter");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("saturn");
    expect(typeOn(game, 1, 0)).toBe("jupiter");
    api.removeMote(first);
    api.removeMote(second);

    spawn(game, api, 0, 0, "sol");
    spawn(game, api, 1, 0, "sol");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("sol");
    expect(typeOn(game, 1, 0)).toBe("sol");
  });

  it("waits while a mote or a fixture stands on the crown", () => {
    const { game, api } = bench();
    place(game, api, "conjoin", 0, 0);
    // A wheel at (0, 2) carries its spoke 4 fixture onto the crown at (0, 1).
    place(game, api, "wheel", 0, 2);
    expect(on(game, 0, 1)?.wheel).not.toBeNull();
    spawn(game, api, 0, 0, "mars");
    spawn(game, api, 1, 0, "mars");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("mars");
    expect(typeOn(game, 1, 0)).toBe("mars");
  });

  it("waits on a bonded or a held fount mote", () => {
    const { game, api } = bench();
    place(game, api, "conjoin", 0, 0);
    const first = spawn(game, api, 0, 0, "saturn");
    spawn(game, api, 1, 0, "saturn");
    const partner = spawn(game, api, 0, -1, "dust");
    api.linkMotes(first, partner, 1);
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("saturn");
    expect(on(game, 0, 1)).toBeNull();

    api.unlinkMotes(first, partner);
    holdAt(game, api, 0, 0, first);
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("saturn");
    expect(on(game, 0, 1)).toBeNull();
  });
});

describe("eclipse (specs/sigils.md)", () => {
  it("turns two dust into an umbra and a lumen on their named crowns", () => {
    const { game, api } = bench();
    place(game, api, "eclipse", 0, 0);
    spawn(game, api, 0, 0, "dust");
    spawn(game, api, 1, 0, "dust");
    boundary(game);
    expect(on(game, 0, 0)).toBeNull();
    expect(on(game, 1, 0)).toBeNull();
    expect(typeOn(game, 0, 1)).toBe("umbra");
    expect(typeOn(game, 1, -1)).toBe("lumen");
  });

  it("waits on a fount that is not dust and on an occupied crown", () => {
    const { game, api } = bench();
    place(game, api, "eclipse", 0, 0);
    spawn(game, api, 0, 0, "dust");
    const wrong = spawn(game, api, 1, 0, "nebula");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("dust");
    expect(typeOn(game, 1, 0)).toBe("nebula");
    api.removeMote(wrong);

    spawn(game, api, 1, 0, "dust");
    const blocker = spawn(game, api, 1, -1, "luna");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("dust");
    expect(typeOn(game, 1, 0)).toBe("dust");
    expect(on(game, 0, 1)).toBeNull();
    expect(typeOn(game, 1, -1)).toBe("luna");
    api.removeMote(blocker);

    // A bonded fount dust blocks it too.
    const partner = spawn(game, api, 0, -1, "dust");
    api.linkMotes(on(game, 0, 0)?.id ?? -1, partner, 1);
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("dust");
    expect(on(game, 0, 1)).toBeNull();
  });
});

describe("confluence (specs/sigils.md)", () => {
  it("unites one of each essence, in any arrangement, into aether", () => {
    const { game, api } = bench();
    place(game, api, "confluence", 0, 0);
    spawn(game, api, 1, 0, "meteor");
    spawn(game, api, 0, 1, "nova");
    spawn(game, api, -1, 0, "comet");
    spawn(game, api, 0, -1, "nebula");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("aether");
    for (const [q, r] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      expect(on(game, q, r)).toBeNull();
    }
  });

  it("waits unless every fount holds one unbonded, unheld essence", () => {
    const { game, api } = bench();
    place(game, api, "confluence", 0, 0);
    spawn(game, api, 1, 0, "nova");
    spawn(game, api, 0, 1, "nova");
    spawn(game, api, -1, 0, "comet");
    const wrong = spawn(game, api, 0, -1, "nebula");
    boundary(game);
    expect(on(game, 0, 0)).toBeNull();
    expect(typeOn(game, 1, 0)).toBe("nova");

    // One of each, but with an empty fount, is still no confluence.
    api.removeMote(wrong);
    boundary(game);
    expect(on(game, 0, 0)).toBeNull();
    expect(typeOn(game, 0, 1)).toBe("nova");
  });
});

describe("dispersion (specs/sigils.md)", () => {
  it("breaks an aether into the four essences on their named crowns", () => {
    const { game, api } = bench();
    place(game, api, "dispersion", 0, 0);
    spawn(game, api, 0, 0, "aether");
    boundary(game);
    expect(on(game, 0, 0)).toBeNull();
    expect(typeOn(game, 1, 0)).toBe("nebula");
    expect(typeOn(game, 0, 1)).toBe("comet");
    expect(typeOn(game, -1, 0)).toBe("nova");
    expect(typeOn(game, 0, -1)).toBe("meteor");
  });

  it("waits on a fount that is no aether and on any occupied crown", () => {
    const { game, api } = bench();
    place(game, api, "dispersion", 0, 0);
    const wrong = spawn(game, api, 0, 0, "lumen");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("lumen");
    expect(on(game, 1, 0)).toBeNull();
    api.removeMote(wrong);

    spawn(game, api, 0, 0, "aether");
    const blocker = spawn(game, api, 0, -1, "dust");
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("aether");
    expect(on(game, 1, 0)).toBeNull();
    api.removeMote(blocker);

    // A held aether does not disperse.
    holdAt(game, api, 0, 0, on(game, 0, 0)?.id ?? -1);
    boundary(game);
    expect(typeOn(game, 0, 0)).toBe("aether");
    expect(on(game, 1, 0)).toBeNull();
  });
});

describe("void (specs/sigils.md)", () => {
  it("consumes an unbonded, unheld mote on its maw, whatever its type", () => {
    const { game, api } = bench();
    place(game, api, "void", 0, 0);
    for (const type of ["dust", "sol", "aether", "mercury"] as const) {
      spawn(game, api, 0, 0, type);
      boundary(game);
      expect(on(game, 0, 0)).toBeNull();
    }
  });

  it("spares a bonded mote, a held mote, and every mote on the rim", () => {
    const { game, api } = bench();
    place(game, api, "void", 0, 0);
    const maw = spawn(game, api, 0, 0, "dust");
    const rim = spawn(game, api, 1, 0, "dust");
    api.linkMotes(maw, rim, 1);
    boundary(game);
    expect(on(game, 0, 0)?.id).toBe(maw);
    expect(on(game, 1, 0)?.id).toBe(rim);

    // Unbonded but held, it survives; the rim mote survives on its own terms.
    api.unlinkMotes(maw, rim);
    holdAt(game, api, 0, 0, maw);
    boundary(game);
    expect(on(game, 0, 0)?.id).toBe(maw);
    expect(on(game, 1, 0)?.id).toBe(rim);
  });

  it("spares a wheel's fixture on the maw", () => {
    const { game, api } = bench();
    place(game, api, "void", 0, 0);
    // The wheel at (0, -1) carries its spoke 1 fixture onto the maw.
    place(game, api, "wheel", 0, -1);
    const fixture = on(game, 0, 0);
    expect(fixture?.wheel).not.toBeNull();
    boundary(game);
    expect(on(game, 0, 0)?.id).toBe(fixture?.id);
  });
});
