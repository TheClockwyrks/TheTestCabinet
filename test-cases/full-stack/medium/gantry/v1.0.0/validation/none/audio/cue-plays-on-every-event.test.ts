// audio/cue-plays-on-every-event — a cue sounds for EVERY event that raises it.
//
// specs/ui.md § Audio: "A cue plays once for the event that raises it, and at
// most once on a given tick or edit." This point decides the first half. A build
// that seats the `place` clack the first time a member goes in and then treats
// the sound as spent — one clack a site, or one a session — satisfies the second
// half and fails this one, and a player building a crane hears nothing after the
// first strut.
//
// THREE SEPARATE EDITS, EACH READ ON ITS OWN. The cue queue is drained before
// each placement and read after it, so every sound is paired with the edit it
// fell on rather than counted over the three together. Three is the smallest
// number that tells "once per event" from "once per run" and from "once, then
// once more": a build that played the cue on the first two edits and stopped
// would still fail here.
//
// THE WORLD HOLDS NOTHING ELSE. The yard is emptied and the structure cleared, so
// the only events in the window are the three `addMember` poses, which "pose
// single edits on the build screen, entering the rule pipeline the build tools
// feed" (specs/instrumentation.md) — the same pipeline a click feeds, so each one
// is a structure edit that places a member in the sense specs/ui.md's `place` row
// names.
//
// THE THREE MEMBERS ARE THREE OF THE MINIMAL CRANE'S LEGS: distinct pairs of
// lattice nodes two units apart, well inside `STRUT_MAX_LEN`, inside site 1's
// envelope, clear of its (emptied) obstacles and far inside its budget, so none
// of the refusals of specs/structure.md reaches any of them. The structure's
// member count is read back after each, which is what says the edit LANDED: a
// refusal is silent, and a silent refusal must not be read as a silent placement.
//
// A CUE IS READ A FRAME AFTER THE EDIT THAT RAISED IT, as the harness's `cues()`
// states: a pose "establishes a precondition and never an outcome".

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Site 1, First Lift. */
const SITE = 0;

/** Three of the minimal crane's legs: anchor node up to the flange node over it. */
const MEMBERS = [
  { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 2, z: 0 } },
  { a: { x: 2, y: 0, z: 0 }, b: { x: 2, y: 2, z: 0 } },
  { a: { x: 0, y: 0, z: 2 }, b: { x: 0, y: 2, z: 2 } },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the place cue on each of three separate placements", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  await h.cues();

  const heard: string[][] = [];
  for (const [index, { a, b }] of MEMBERS.entries()) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "strut");
    await h.advance(1);
    heard.push(await h.cues());
    assertEqual(
      (await h.snapshot()).structure.members.length,
      index + 1,
      `the members standing after edit ${index + 1}, so the edit placed one ` +
        "rather than being refused (specs/structure.md)",
    );
  }

  await h.capture("three", "The three members placed");

  for (const [index, sounds] of heard.entries()) {
    assertContains(
      sounds,
      "place",
      `the cue edit ${index + 1} of 3 raised: "a structure edit places a ` +
        'member" plays `place`, and "a cue plays once for the event that ' +
        'raises it" — so every placement sounds, not just the first ' +
        `(specs/ui.md § Audio). The three edits sounded ` +
        `${JSON.stringify(heard)}`,
    );
  }
});
