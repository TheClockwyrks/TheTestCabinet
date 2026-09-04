// instrumentation/surface-present — every operation the specification names is on
// the surface, under its own name, taking the arguments its row names.
//
// THE RULE. "You implement it. Every operation this file specifies is a
// deliverable, and the build installs the finished surface on `window.__orrery` as
// soon as the game has initialized" — and, under an engine, "the build's
// `initialize` returns the finished surface" which "the engine returns ... from
// `engine.debug`" (`specs/instrumentation.md`). What is on it is fixed in The
// operations: "The surface carries `version` (`ORRERY_DEBUG_VERSION`, `1`), a plain
// number, and the operations below", each of which "takes only the arguments its
// row names".
//
// THE TWO CLOCK OPERATIONS ARE THE ONE ENGINE DIFFERENCE, and the specification
// states it. Under no engine "the clock is the exception, because nothing outside
// this build owns it. The surface is what takes the game off real time and
// advances it, through `setAutoStep` and `advance` below"; under either engine
// "the clock, the keyboard, the pointer, and the overlay belong to the ... engine
// ... and the surface carries no operation for any of them". `REQUIRED_OPS` is each
// project's transcription of what its own engine's specification requires, so the
// reading below asks for the fifty-three under no engine and the fifty-one under
// either.
//
// THE VERDICT is in two halves. First the reflective one: the surface answers at
// all and carries every required name as a function, found without invoking
// anything. Then the calling one: one operation out of each of the specification's
// six groups is called with the full argument list its row names and read back
// through `snapshot`, which is what "accepts the arguments its row names" means. A
// surface whose names are all present but whose parameters sit in another order
// passes the first half and fails the second.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at } from "../field";
import { ORIGIN } from "../fixtures";
import {
  REQUIRED_OPS,
  captureStill,
  createHarness,
  heldBy,
  moteAt,
  partById,
  type Harness,
} from "../harness";

/** The gripper hex of an arm at {@link ORIGIN}, rotation 2, length 1: base + DIRS[2]. */
const GRIPPED = at(-1, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every operation the specification names, each taking its row's arguments", async () => {
  assertNull(
    h.surfaceFault,
    "the build installs the finished surface as soon as the game has initialized",
  );

  // The reflective half. Nothing is invoked to find this out.
  const probed = await h.probe(REQUIRED_OPS);
  const missing = REQUIRED_OPS.filter(
    (name) => probed.ops[name] !== "function",
  );
  assertLength(
    missing,
    0,
    `every operation specs/instrumentation.md names is present as a function, missing or uncallable: ${missing.join(", ")}`,
  );
  // The calling half, group by group. Session and Navigation first, read back
  // before the editor is opened over them.
  await h.debug.reset();
  await h.debug.setCompletion(false);
  await h.debug.setMode("extras");
  await h.debug.setSelectIndex(2);

  const navigated = await h.snapshot();
  assertEqual(
    navigated.completion,
    false,
    "setCompletion(enabled) set the completion switch",
  );
  assertEqual(navigated.mode, "extras", "setMode(mode) set the course");
  assertEqual(
    navigated.selectIndex,
    2,
    "setSelectIndex(n) set the highlighted select row",
  );

  await h.debug.openChallenge("extras", 0);
  await h.debug.clearMachine();
  await h.debug.placePart("arm", ORIGIN.q, ORIGIN.r, 2);
  const machine = (await h.snapshot()).editor.parts;
  const arm = machine[machine.length - 1]?.id ?? -1;
  await h.debug.setTapeCell(arm, 1, "rotate-cw");
  await h.debug.setFocus("tape");
  await h.debug.startRun();
  await h.debug.clearMotes();
  await h.debug.spawnMote(GRIPPED.q, GRIPPED.r, "luna");
  const field = (await h.snapshot()).sim?.motes ?? [];
  const mote = field[field.length - 1]?.id ?? -1;
  await h.debug.setGrip(arm, 2, mote);
  await h.advance(1);
  await captureStill(h, "surface");

  const snapshot = await h.snapshot();
  assertEqual(
    snapshot.challenge?.source,
    "extras",
    "openChallenge(mode, index) opened that mode's shipped challenge",
  );
  assertEqual(snapshot.challenge?.index, 0, "at the index it was given");
  const part = partById(snapshot, arm);
  assertNotNull(part, "placePart(kind, q, r, rotation) placed one part");
  assertEqual(part?.kind, "arm", "of the kind it was given");
  assertEqual(part?.q, ORIGIN.q, "anchored on the hex it was given");
  assertEqual(part?.r, ORIGIN.r);
  assertEqual(part?.rotation, 2, "at the rotation it was given");
  assertEqual(
    part?.tape?.[1],
    "rotate-cw",
    "setTapeCell(part, col, instruction) wrote that instruction at that column",
  );
  assertEqual(snapshot.editor.focus, "tape", "setFocus(where) set the focus");
  assertNotNull(snapshot.sim, "startRun() left a live run");
  assertEqual(
    moteAt(snapshot, GRIPPED)?.type,
    "luna",
    "spawnMote(q, r, type) put one mote of that type on that hex",
  );
  assertEqual(
    heldBy(snapshot, arm, 2),
    mote,
    "setGrip(part, spoke, mote) closed that part's gripper on that spoke",
  );
});
