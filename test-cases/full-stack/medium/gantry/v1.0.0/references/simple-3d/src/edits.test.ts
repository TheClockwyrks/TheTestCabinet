// The structure editor's edits: the rules they pass, the history they push,
// and the cues they raise.

import { describe, expect, it } from "vitest";
import { SITES } from "./constants";
import { point } from "./convert";
import * as edits from "./edits";
import type { GantryState } from "./game";
import { openSite, setScreen, titleState } from "./state";

/** Site 0, opened on the build screen with nothing built. */
const yard = (): GantryState => setScreen(openSite(titleState(), 0), "build");

const structureOf = (s: GantryState) => s.sites[s.siteIndex].structure;
const cueNames = (s: GantryState): string[] => s.cues.map((c) => c.cue);

describe("placing a member", () => {
  it("gives it nextMemberId, advances it, and pushes the history", () => {
    const first = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    );
    expect(first.refusal).toBeNull();
    const structure = structureOf(first.state);
    expect(structure.members).toHaveLength(1);
    expect(structure.members[0].id).toBe(0);
    expect(structure.nextMemberId).toBe(1);
    expect(first.state.history).toHaveLength(1);
    expect(cueNames(first.state)).toEqual(["place"]);
  });

  it("is refused off the envelope, and changes nothing", () => {
    const out = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 100),
      "strut",
    );
    expect(out.refusal).toBe("outside-envelope");
    expect(structureOf(out.state).members).toEqual([]);
    expect(out.state.history).toEqual([]);
    expect(out.state.cues).toEqual([]);
  });

  it("is refused past the material's maximum length", () => {
    const out = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(8, 0, 0),
      "strut",
    );
    expect(out.refusal).toBe("too-long");
  });

  it("is refused where a member already joins the two nodes", () => {
    const one = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    const again = edits.addMember(one, point(0, 2, 0), point(0, 0, 0), "cable");
    expect(again.refusal).toBe("duplicate");
  });

  it("is refused where a rail is not horizontal", () => {
    const out = edits.addMember(yard(), point(0, 0, 0), point(0, 2, 0), "rail");
    expect(out.refusal).toBe("rail-not-horizontal");
  });

  it("is refused where the segment reaches inside an obstacle", () => {
    // Site 3 carries the wall of `specs/sites.md`.
    const wall = setScreen(openSite(titleState(), 2), "build");
    const out = edits.addMember(wall, point(4, 4, 0), point(8, 4, 0), "cable");
    expect(out.refusal).toBe("inside-obstacle");
  });
});

describe("removing", () => {
  it("removes a member and never gives its id back", () => {
    let s = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    s = edits.addMember(s, point(2, 0, 0), point(2, 2, 0), "strut").state;
    s = edits.removeMember(s, 1).state;
    expect(structureOf(s).members.map((m) => m.id)).toEqual([0]);
    expect(structureOf(s).nextMemberId).toBe(2);
    expect(cueNames(s)).toEqual(["place", "place", "delete"]);
  });

  it("removes nothing, silently, for an id the structure does not carry", () => {
    const s = yard();
    const out = edits.removeMember(s, 7);
    expect(out.refusal).toBeNull();
    expect(out.state.history).toEqual([]);
    expect(out.state.cues).toEqual([]);
  });

  it("is a silent refusal where there is no ring or counterweight to remove", () => {
    const noRing = edits.clearRing(yard());
    expect(noRing.state.history).toEqual([]);
    expect(noRing.state.cues).toEqual([]);
    const noWeight = edits.removeCounterweight(yard(), point(0, 0, 0));
    expect(noWeight.state.history).toEqual([]);
  });
});

describe("the ring", () => {
  it("is refused on the ground and where one already stands", () => {
    expect(edits.setRing(yard(), point(0, 0, 0)).refusal).toBe(
      "ring-on-ground",
    );
    const placed = edits.setRing(yard(), point(0, 2, 0)).state;
    expect(edits.setRing(placed, point(4, 4, 0)).refusal).toBe("ring-exists");
  });

  it("goes and comes back through clearRing", () => {
    const placed = edits.setRing(yard(), point(0, 2, 0)).state;
    expect(structureOf(placed).ring).toEqual({ corner: point(0, 2, 0) });
    const gone = edits.clearRing(placed).state;
    expect(structureOf(gone).ring).toBeNull();
    expect(cueNames(gone)).toEqual(["place", "delete"]);
  });
});

describe("counterweights", () => {
  it("are refused on a node the structure does not use", () => {
    expect(edits.addCounterweight(yard(), point(6, 6, 6)).refusal).toBe(
      "node-unused",
    );
  });

  it("are placed once per node and removed from it", () => {
    let s = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    s = edits.addCounterweight(s, point(0, 2, 0)).state;
    expect(edits.carriesCounterweight(s, point(0, 2, 0))).toBe(true);
    expect(edits.addCounterweight(s, point(0, 2, 0)).refusal).toBe(
      "counterweight-exists",
    );
    s = edits.removeCounterweight(s, point(0, 2, 0)).state;
    expect(structureOf(s).counterweights).toEqual([]);
  });
});

describe("clearing the structure", () => {
  it("empties it, returns nextMemberId to 0, and pushes one history entry", () => {
    let s = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    s = edits.setRing(s, point(0, 2, 0)).state;
    const depth = s.history.length;
    s = edits.clearStructure(s).state;
    expect(structureOf(s)).toEqual({
      members: [],
      nextMemberId: 0,
      ring: null,
      counterweights: [],
    });
    expect(s.history).toHaveLength(depth + 1);
  });

  it("pushes nothing on a structure already empty, and still resets the id", () => {
    const bare = edits.clearStructure(yard());
    expect(bare.state.history).toEqual([]);
    expect(bare.state.cues).toEqual([]);

    let s = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    s = edits.removeMember(s, 0).state;
    expect(structureOf(s).nextMemberId).toBe(1);
    const cleared = edits.clearStructure(s);
    expect(structureOf(cleared.state).nextMemberId).toBe(0);
    expect(cleared.state.history).toHaveLength(s.history.length);
  });
});

describe("undo", () => {
  it("restores the structure before the last edit, and gives no id back", () => {
    let s = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    s = edits.addMember(s, point(2, 0, 0), point(2, 2, 0), "strut").state;
    s = edits.undo(s).state;
    expect(structureOf(s).members.map((m) => m.id)).toEqual([0]);
    expect(structureOf(s).nextMemberId).toBe(2);
    expect(s.history).toHaveLength(1);
    expect(cueNames(s)[cueNames(s).length - 1]).toBe("delete");
  });

  it("changes nothing with an empty history", () => {
    const out = edits.undo(yard());
    expect(structureOf(out.state).members).toEqual([]);
    expect(out.state.cues).toEqual([]);
  });
});

describe("the static check", () => {
  it("shows a result, with the readiness issues named", () => {
    const s = edits.showCheck(yard());
    expect(s.checkResult).not.toBeNull();
    expect(s.checkResult?.issues).toEqual([
      "no-ring",
      "no-rail",
      "empty-program",
    ]);
    expect(s.checkResult?.stable).toBe(false);
    expect(s.checkResult?.members).toEqual([]);
    expect(s.checkResult?.budget).toBe(SITES[0].budget);
  });

  it("is cleared again by the next structure edit", () => {
    const shown = edits.showCheck(yard());
    const edited = edits.addMember(
      shown,
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    expect(edited.checkResult).toBeNull();
  });
});

describe("every edit", () => {
  it("leaves the state it was handed exactly as it was", () => {
    const before = yard();
    const copy = structuredClone(before);
    edits.addMember(before, point(0, 0, 0), point(0, 2, 0), "strut");
    edits.setRing(before, point(0, 2, 0));
    edits.clearStructure(before);
    edits.showCheck(before);
    expect(before).toEqual(copy);
  });
});
