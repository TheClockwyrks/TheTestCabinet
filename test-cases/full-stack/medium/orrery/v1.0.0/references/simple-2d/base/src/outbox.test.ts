// The cues and effects a transition raised, waiting for a frame
// (specs/ui.md "Audio", specs/assets.md "The particle effects").

import { describe, expect, it } from "vitest";

import { CUES } from "./constants";
import {
  clearOutbox,
  drainCues,
  drainEffects,
  pendingCues,
  raiseCue,
  raiseEffect,
} from "./outbox";

describe("the cue outbox (specs/ui.md)", () => {
  it("holds one entry per cue, however often it was asked for", () => {
    clearOutbox();
    raiseCue(CUES.place);
    raiseCue(CUES.place);
    raiseCue(CUES.erase);
    expect(pendingCues()).toEqual([CUES.place, CUES.erase]);
  });

  it("empties on the frame that takes it, so nothing sounds twice", () => {
    clearOutbox();
    raiseCue(CUES.start);
    expect(drainCues()).toEqual([CUES.start]);
    expect(drainCues()).toEqual([]);
  });

  it("clears both queues at once", () => {
    clearOutbox();
    raiseCue(CUES.halt);
    raiseEffect("fault", { x: 1, y: 2 });
    clearOutbox();
    expect(pendingCues()).toEqual([]);
    expect(drainEffects()).toEqual([]);
  });
});

describe("the effect outbox (specs/assets.md)", () => {
  it("keeps each raise, in order, with a position of its own", () => {
    clearOutbox();
    raiseEffect("deliver", { x: 1, y: 2 });
    raiseEffect("complete", { x: 3, y: 4 });
    expect(drainEffects()).toEqual([
      { system: "deliver", at: { x: 1, y: 2 } },
      { system: "complete", at: { x: 3, y: 4 } },
    ]);
  });

  it("stays bounded when nothing ever drains it", () => {
    clearOutbox();
    for (let raised = 0; raised < 40; raised += 1) {
      raiseEffect("deliver", { x: raised, y: 0 });
    }
    const taken = drainEffects();
    expect(taken.length).toBeLessThanOrEqual(16);
    // The oldest are the ones dropped, so the newest survive.
    expect(taken[taken.length - 1].at.x).toBe(39);
  });
});
