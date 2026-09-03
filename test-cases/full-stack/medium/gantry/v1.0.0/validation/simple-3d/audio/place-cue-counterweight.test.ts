// audio/place-cue-counterweight — placing a counterweight sounds the place cue.
//
// specs/ui.md § Audio: "| `place` | a structure edit places a member, the ring,
// or a counterweight |". The row names three parts and one cue, so each of them
// is a requirement of its own; this is the counterweight's.
//
// THE WORLD HOLDS THE LEAST THE EDIT NEEDS. Everything is cleared, and the ring
// alone is put back: specs/structure.md places a counterweight "on any node the
// structure uses, a node a member ends at or a flange node of the ring", so a
// ring is the whole of what a counterweight placement requires and the crane
// carries no member that a second edit could be confused for. The ring's own
// placement sounds its own `place`, so the queue is drained after it and the
// counterweight's cue is read on its own.
//
// The edit is posed rather than clicked, because specs/instrumentation.md has a
// pose enter "the rule pipeline the build tools feed" — a build whose pointer
// picking is broken must fail the picking items and pass this one. The
// placement is read back off the snapshot before the cue is judged, so a
// refusal, which specs/instrumentation.md makes silent, cannot be mistaken for
// a build that simply did not sound anything.
//
// A CUE A POSE RAISES SOUNDS ON THE FRAME THAT FOLLOWS IT, so one frame is
// advanced before the queue is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this runs on; the editor's cues are the same on every one. */
const SITE = 0;

/** The ring's base corner: one lattice pitch off the ground, as the rule asks. */
const RING = { x: 0, y: 2, z: 0 } as const;

/** A bottom-flange node of that ring, so the structure uses it. */
const NODE = { x: 0, y: 2, z: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the place cue when an edit places a counterweight", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.advance(1);
  await h.cues(); // the ring placement's own `place`, drained

  await h.debug.addCounterweight(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  const played = await h.cues();
  const state = await h.snapshot();
  await h.capture("state", "the counterweight the edit placed on the ring");

  assertLength(
    state.structure.counterweights,
    1,
    "the counterweights standing after the edit: it is placed on a flange " +
      "node of the ring, which specs/structure.md makes a node the structure " +
      "uses, so nothing refuses it",
  );
  assertContains(
    played,
    "place",
    "the cues the edit sounded: `place` plays when a structure edit places a " +
      "counterweight (specs/ui.md § Audio)",
  );
});
