// The gesture that opens a build's audio: who gets one, and what it leaves behind.
//
// A build may open its audio context from a real DOM event alone, so the gesture
// has to be a GENUINE browser event — which means the game is entitled to act on
// it. A press lands wherever the build put its controls, and a case whose
// specification leaves every key binding to the build has no key that is inert by
// construction either. Both are fine, because of WHEN the gesture happens: before
// the opening `reset`, whose restore erases whatever it moved.
//
// The fixture build carries the two conformant shapes of reading a press side by
// side — `clicks`, latched in the DOM handler, and `taken`, counted by the tick
// that consumed the buffered edges — because the second is the one the ordering
// has to be careful about. Its buffer belongs to its input layer rather than to
// its state, so `reset` does not clear it, exactly as a real build's does not.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createCaseHarness } from "../src/index";
import {
  REQUIRED_OPS,
  STAGE,
  TICK_HZ,
  createHarness,
  type FixtureDebug,
  type FixtureSnapshot,
} from "./fixture";

/** Where the pressing kit presses, in the fixture's logical units. */
const ARM_AT = { x: 2, y: 2 } as const;

/** A kit whose gesture is a real mouse press, which is the shape with teeth. */
const pressing = createCaseHarness<FixtureSnapshot, FixtureDebug>({
  slug: "case-harness",
  handle: "__fixture",
  requiredOps: REQUIRED_OPS,
  step: { kind: "count", op: "advance" },
  stage: STAGE,
  arm: { kind: "click", ...ARM_AT },
  tickHz: TICK_HZ,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

it("hands a build no gesture at all unless the check asked for one", async () => {
  const h = await pressing.createHarness();
  try {
    // Nothing has touched this page: the pointer is where the fixture stood it up,
    // off the stage entirely, and no press has been read by either route. A check
    // that is not about sound cannot be affected by a fault in the arming, because
    // no arming happened.
    const snapshot = await h.snapshot();
    expect(snapshot.pointer).toEqual({ x: -1, y: -1 });
    expect(snapshot.clicks).toBe(0);
    expect(await h.advance(2).then(() => h.snapshot())).toMatchObject({
      taken: 0,
    });
  } finally {
    await h.dispose();
  }
});

it("delivers a real press, and hands over a game the restore put back", async () => {
  const h = await pressing.createHarness({ armAudio: true });
  try {
    const snapshot = await h.snapshot();
    // THAT the gesture happened: `pointer` is the one field the fixture's `reset`
    // leaves alone, and it holds the point the press was made at — a genuine
    // browser event, at the case's logical point taken through the fit.
    expect(snapshot.pointer).toEqual({ x: ARM_AT.x, y: ARM_AT.y });
    // And that nothing of it survived into the game the check is handed: the press
    // the handler latched is cleared, and so is the count of the edges the settling
    // frames let the build consume.
    expect(snapshot.clicks).toBe(0);
    expect(snapshot.taken).toBe(0);
    expect(snapshot.frames).toBe(0);
    expect(h.frame()).toBe(0);

    // The half the settling frames exist for: a build that reads its edges on a
    // frame rather than in the handler had them read BEFORE the restore, so the
    // first frame a check drives finds an empty buffer. Without those frames the
    // edges would still be pending here, and this frame would take them.
    expect((await h.step(1)).taken).toBe(0);
  } finally {
    await h.dispose();
  }
});

it("presses through the fit, so the point is the stage's at any shape", async () => {
  // Twice the stage in both axes: the press must land at twice the coordinate,
  // not at the raw CSS one, or a suite that armed at another shape would press
  // somewhere the case never named.
  const h = await pressing.createHarness({
    armAudio: true,
    cssWidth: STAGE.width * 2,
    cssHeight: STAGE.height * 2,
  });
  try {
    expect((await h.snapshot()).pointer).toEqual({
      x: ARM_AT.x * 2,
      y: ARM_AT.y * 2,
    });
  } finally {
    await h.dispose();
  }
});

it("arms a keyed case without disturbing what it opened on", async () => {
  // The other shape of gesture, which four of the cases use: a key their
  // specification binds to nothing. It leaves no mark to read back, so what is
  // checked is that the game is still the one a fresh harness hands over.
  const h = await createHarness({ armAudio: true });
  try {
    const snapshot = await h.snapshot();
    expect(snapshot.screen).toBe("title");
    expect(snapshot.frames).toBe(0);
    expect(snapshot.heldTicks).toBe(0);
    expect(snapshot.keys).toEqual([]);
  } finally {
    await h.dispose();
  }
});

/* ---- The gesture as a method, at a moment the harness arranged nothing ------ */
//
// `HarnessOptions.armAudio` fires the gesture in the one place the harness
// controls: before the opening `reset`, with settling frames after it, so the
// restore erases whatever it moved. That is the safe position and it is why the
// option exists — but it is a position only the harness can occupy, because it is
// inside `createHarness`. A case whose specification has a screen the audio must
// open ON, rather than before, needs the gesture where its own check has reached.

it("delivers the same gesture at a moment of the check's choosing", async () => {
  const h = await pressing.createHarness();
  try {
    // Nothing armed at open: the page is exactly the one the previous check saw.
    expect((await h.snapshot()).pointer).toEqual({ x: -1, y: -1 });

    await h.armAudio();

    // The same genuine browser event the option delivers, at the same logical
    // point taken through the same fit — the press landed where the case says it
    // does, and the DOM handler latched it.
    const snapshot = await h.snapshot();
    expect(snapshot.pointer).toEqual({ x: ARM_AT.x, y: ARM_AT.y });
    expect(snapshot.clicks).toBe(1);
  } finally {
    await h.dispose();
  }
});

it("leaves the game exactly where the check had it, and drives no frame", async () => {
  const h = await createHarness();
  try {
    // The half a case has to reason about. The method is the gesture and NOTHING
    // else: no settling frames and no reset, because it is called at a moment the
    // harness arranged nothing about, and repairing the state afterwards would
    // erase the check's own arrangement along with the gesture's. A case reaching
    // for it is stating that its gesture is inert where it stands — which the
    // fixture's is, since it binds no key.
    await h.debug.startPlaying();
    await h.advance(3);

    await h.armAudio();

    const snapshot = await h.snapshot();
    expect(snapshot.screen).toBe("playing");
    expect(snapshot.frames).toBe(3);
    expect(h.frame()).toBe(3);
    // A key press does leave the key held for as long as the gesture holds it,
    // and this one is a press and a release: nothing is left down.
    expect(snapshot.keys).toEqual([]);

    // And the sound the build makes afterwards is heard, which is the whole point
    // of arming at all.
    const before = await h.sounds();
    await h.debug.blip();
    expect(await h.sounds()).toBe(before + 1);
  } finally {
    await h.dispose();
  }
});

it("leaves the option it does not replace working exactly as it did", async () => {
  // Both routes on one page: the option fires before the opening reset and this
  // one after it, so a case may use either or both.
  const h = await pressing.createHarness({ armAudio: true });
  try {
    expect((await h.snapshot()).clicks).toBe(0);
    await h.armAudio();
    expect((await h.snapshot()).clicks).toBe(1);
  } finally {
    await h.dispose();
  }
});
