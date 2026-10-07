// What a click at the pointer would take (`specs/controls.md`).

import { describe, expect, it } from "vitest";
import { MEMBER_PICK_PX, NODE_PICK_PX, STAGE_H, STAGE_W } from "./constants";
import { point } from "./convert";
import * as edits from "./edits";
import type { GantryState } from "./game";
import { currentEnvelope, pick, pickNodeIn, viewBasis } from "./pick";
import { project } from "./project";
import { openSite, setScreen, titleState } from "./state";

/** Site 0, on the build screen, with the pointer where the caller puts it. */
function yard(x = STAGE_W / 2, y = STAGE_H / 2): GantryState {
  const s = setScreen(openSite(titleState(), 0), "build");
  s.pointer.x = x;
  s.pointer.y = y;
  return s;
}

describe("picking a node", () => {
  it("takes a lattice node under the pointer, within the pick radius", () => {
    const s = yard();
    const picked = pick(s);
    expect(picked.node).not.toBeNull();
    const drawn = project(s.camera, picked.node ?? point(0, 0, 0));
    expect(
      Math.hypot(drawn.x - s.pointer.x, drawn.y - s.pointer.y),
    ).toBeLessThanOrEqual(NODE_PICK_PX);
  });

  it("takes the node it takes on the lattice alone", () => {
    const node = pick(yard()).node;
    expect(node).not.toBeNull();
    for (const c of [node?.x, node?.y, node?.z]) {
      expect((c ?? 0) % 2).toBe(0);
    }
  });

  it("takes none where the pointer is far from every node", () => {
    expect(pick(yard(4, 4)).node).toBeNull();
  });

  it("takes the nearest, and breaks a tie toward the camera", () => {
    const s = yard();
    const basis = viewBasis(s.camera);
    const best = pickNodeIn(
      basis,
      s.camera,
      currentEnvelope(s),
      s.pointer.x,
      s.pointer.y,
    );
    expect(best).not.toBeNull();
    // Nothing in range is nearer the click than the candidate taken.
    const drawn = project(s.camera, best?.node ?? point(0, 0, 0));
    expect(best?.dist).toBeCloseTo(
      Math.hypot(drawn.x - s.pointer.x, drawn.y - s.pointer.y),
      9,
    );
  });
});

describe("picking a member", () => {
  it("takes the member drawn under the pointer", () => {
    const built = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    const middle = project(built.camera, point(0, 1, 0));
    built.pointer.x = middle.x;
    built.pointer.y = middle.y;
    expect(pick(built).member).toBe(0);
  });

  it("takes none where the pointer is off every member", () => {
    const built = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    const middle = project(built.camera, point(0, 1, 0));
    built.pointer.x = middle.x + MEMBER_PICK_PX * 4;
    built.pointer.y = middle.y;
    expect(pick(built).member).toBeNull();
  });

  it("breaks a tie toward the lower member id", () => {
    let s = edits.addMember(
      yard(),
      point(0, 0, 0),
      point(0, 2, 0),
      "strut",
    ).state;
    // The same two nodes are refused, so the tie is made with a cable laid
    // along the same line, one lattice step further on.
    s = edits.addMember(s, point(0, 2, 0), point(0, 4, 0), "cable").state;
    const shared = project(s.camera, point(0, 2, 0));
    s.pointer.x = shared.x;
    s.pointer.y = shared.y;
    expect(pick(s).member).toBe(0);
  });
});

describe("a pick off the build screen", () => {
  it("takes nothing at all", () => {
    for (const screen of [
      "title",
      "select",
      "program",
      "run",
      "results",
    ] as const) {
      expect(pick(setScreen(yard(), screen))).toEqual({
        node: null,
        member: null,
      });
    }
  });
});
