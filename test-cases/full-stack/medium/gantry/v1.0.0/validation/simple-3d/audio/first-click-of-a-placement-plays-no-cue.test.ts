// audio/first-click-of-a-placement-plays-no-cue — the first click places nothing,
// so it sounds nothing.
//
// specs/ui.md § Audio binds `place` to "a structure edit places a member, the
// ring, or a counterweight". A strut, cable or rail placement takes two clicks
// and places on the second: specs/controls.md has the first click hold the picked
// node as the pending first node — the build screen "marks a pending first node"
// (specs/ui.md § Build) — and the member appears only when the second click names
// its other end. So the first click raises no event the `place` cue plays on, and
// a build that clacks on it clacks twice for one member and clacks when a player
// changes their mind.
//
// THE TWO CLICKS ARE MADE THROUGH THE POINTER, because the pending node is a
// thing only a click creates: `setPendingNode` poses the same state, but the
// requirement is about what the FIRST CLICK of a placement does, so the click is
// the route. Where a node is drawn is asked of the build, since specs/controls.md
// fixes how a click picks rather than how the yard is drawn — the pointer is
// moved there and the reported pick is read back before the press, so the click
// is known to be landing on the node this check names.
//
// THE WORLD IS EMPTY. The yard and the structure are cleared, so the member count
// after the first click is a complete reading of what was placed, and nothing
// else in the scene can be picked or sounded.
//
// THE SECOND CLICK IS MADE TOO, and it is what makes the first click's silence a
// verdict rather than a build that cannot place at all: the same tool and the
// same two nodes produce the member and its `place` cue one click later.
//
// The two nodes are two units apart, inside `STRUT_MAX_LEN` and inside site 1's
// envelope, on a structure with no ring — so no refusal of specs/structure.md
// reaches the placement.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertContains,
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** The first click's node, and the second's: two units apart. */
const FIRST: Vec3 = { x: 0, y: 4, z: 0 };
const SECOND: Vec3 = { x: 0, y: 2, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays no cue on the first click of a two-click member placement", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await h.debug.setTool("strut");

  /** Aim at a node and read back the pick the build reports there. */
  const aimAt = async (node: Vec3): Promise<{ x: number; y: number }> => {
    const at = await h.project(node.x, node.y, node.z);
    assertTrue(
      at.visible,
      `the node (${node.x}, ${node.y}, ${node.z}) is drawn on the stage`,
    );
    await h.pointerMove(at.x, at.y);
    await h.advance(1);
    const { pick } = await h.snapshot();
    assertEqual(
      JSON.stringify(pick.node),
      JSON.stringify(node),
      `the node a click at the pointer would take (specs/controls.md)`,
    );
    return at;
  };

  const firstAt = await aimAt(FIRST);
  await h.cues();
  await h.click(firstAt.x, firstAt.y);
  const onFirst = await h.cues();
  const held = await h.snapshot();
  await h.capture("pending", "The pending node held after the first click");

  assertNotNull(
    held.pendingNode,
    "the pending first node the strut tool's first click holds " +
      "(specs/controls.md)",
  );
  assertLength(
    held.structure.members,
    0,
    "the members standing after one click: a member placement takes two, and " +
      "places on the second (specs/controls.md)",
  );
  assertLength(
    onFirst,
    0,
    'the sounds the first click of a placement plays: `place` follows "a ' +
      'structure edit places a member, the ring, or a counterweight" ' +
      "(specs/ui.md § Audio), and the first click places nothing — it only " +
      `holds the pending node. It sounded ${JSON.stringify(onFirst)}`,
  );

  // The second click, which does place the member: the same tool, the same
  // pending node, one click later.
  const secondAt = await aimAt(SECOND);
  await h.click(secondAt.x, secondAt.y);
  const onSecond = await h.cues();
  const placed = await h.snapshot();

  assertLength(
    placed.structure.members,
    1,
    "the member the second click places (specs/controls.md)",
  );
  assertContains(
    onSecond,
    "place",
    "the cue the click that PLACES the member raises (specs/ui.md § Audio), " +
      "which is what makes the first click's silence the two-click rule and " +
      `not a build that cannot place. It sounded ${JSON.stringify(onSecond)}`,
  );
});
