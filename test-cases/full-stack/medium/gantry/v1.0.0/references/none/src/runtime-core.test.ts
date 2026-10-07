// The runtime layer as the game reaches it: input in, sound out, the overlay
// beside it, and the first interaction that opens the bus.

import { describe, expect, it } from "vitest";
import { CUES, type CueName } from "./constants";
import { MUSIC_NAME, type AudioSink } from "./runtime-audio";
import { RuntimeCore } from "./runtime-core";
import { OVERLAY_TOGGLE_CODE, type OverlayView } from "./runtime-overlay";

interface Harness {
  core: RuntimeCore;
  opens: number;
  played: string[];
  loops: string[];
  view: { visible: boolean; lines: readonly string[] };
  settle(): Promise<void>;
}

function harness(): Harness {
  const played: string[] = [];
  const loops: string[] = [];
  let resolve = (): void => {};
  const loaded = new Promise<void>((r) => {
    resolve = r;
  });
  const sink: AudioSink = {
    async load() {
      resolve();
    },
    play(name) {
      played.push(name);
    },
    startLoop(name) {
      if (!loops.includes(name)) loops.push(name);
    },
    stopLoop(name) {
      const at = loops.indexOf(name);
      if (at >= 0) loops.splice(at, 1);
    },
    setMuted() {},
  };
  const view: { visible: boolean; lines: readonly string[] } = {
    visible: true,
    lines: [],
  };
  const overlay: OverlayView = {
    setVisible(visible) {
      view.visible = visible;
    },
    setLines(lines) {
      view.lines = lines;
    },
  };
  const h: Harness = {
    core: new RuntimeCore({
      openAudio: () => {
        h.opens += 1;
        return sink;
      },
      overlay,
    }),
    opens: 0,
    played,
    loops,
    view,
    async settle() {
      await loaded;
      await Promise.resolve();
      await Promise.resolve();
    },
  };
  return h;
}

const cueBytes = (): Record<CueName, ArrayBuffer> => {
  const cues = {} as Record<CueName, ArrayBuffer>;
  for (const cue of CUES) cues[cue] = new ArrayBuffer(2);
  return cues;
};

describe("input", () => {
  it("hands the frame its press edges and empties them", () => {
    const { core } = harness();
    core.feedKeyDown("KeyG");
    core.feedKeyDown("KeyM");
    expect(core.takeInput().actions).toEqual(["run", "mute"]);
    expect(core.takeInput().actions).toEqual([]);
  });

  it("answers what is held for the frame being run", () => {
    const { core } = harness();
    core.feedKeyDown("ArrowLeft");
    expect(core.held("left")).toBe(true);
    core.takeInput();
    expect(core.held("left")).toBe(true);
    core.feedKeyUp("ArrowLeft");
    expect(core.held("left")).toBe(false);
  });

  it("reports the pointer in logical stage units", () => {
    const { core } = harness();
    core.feedPointerDown(320, 180);
    expect(core.pointerX()).toBe(320);
    expect(core.pointerY()).toBe(180);
    core.feedPointerMove(321, 181);
    core.feedPointerUp();
    expect(core.takeInput().pointer).toEqual([
      { kind: "down", x: 320, y: 180 },
      { kind: "move", x: 321, y: 181 },
      { kind: "up", x: 321, y: 181 },
    ]);
  });

  it("knows whether a press is live", () => {
    const { core } = harness();
    expect(core.pointerPressed()).toBe(false);
    core.feedPointerDown(1, 1);
    expect(core.pointerPressed()).toBe(true);
    core.feedPointerUp();
    expect(core.pointerPressed()).toBe(false);
  });
});

describe("the overlay key", () => {
  it("toggles the overlay and fires no action", () => {
    const h = harness();
    expect(h.view.visible).toBe(false);
    h.core.feedKeyDown(OVERLAY_TOGGLE_CODE);
    expect(h.core.overlayVisible).toBe(true);
    expect(h.view.visible).toBe(true);
    expect(h.core.takeInput().actions).toEqual([]);
    h.core.feedKeyUp(OVERLAY_TOGGLE_CODE);
    h.core.feedKeyDown(OVERLAY_TOGGLE_CODE);
    expect(h.core.overlayVisible).toBe(false);
  });

  it("draws the registered diagnostic source", () => {
    const h = harness();
    let reads = 0;
    h.core.setDiagnostics(() => {
      reads += 1;
      return ["screen title", "run idle"];
    });
    h.core.refreshOverlay();
    expect(reads).toBe(0);
    h.core.feedKeyDown(OVERLAY_TOGGLE_CODE);
    expect(h.view.lines).toEqual(["screen title", "run idle"]);
    h.core.refreshOverlay();
    expect(reads).toBeGreaterThan(0);
  });
});

describe("sound", () => {
  it("waits for the player's first interaction with the page", async () => {
    const h = harness();
    h.core.installAudio(cueBytes(), new ArrayBuffer(2));
    expect(h.opens).toBe(0);
    h.core.playCue("place");
    expect(h.played).toEqual([]);

    h.core.feedPointerDown(10, 10);
    expect(h.opens).toBe(1);
    await h.settle();
    h.core.playCue("place");
    expect(h.played).toEqual(["place"]);
    expect(h.loops).toContain(MUSIC_NAME);
  });

  it("takes a key press as that first interaction too", () => {
    const h = harness();
    h.core.feedKeyDown("KeyG");
    expect(h.opens).toBe(1);
  });

  it("does not open on a mere move or release", () => {
    const h = harness();
    h.core.feedPointerMove(1, 1);
    h.core.feedPointerUp();
    h.core.feedKeyUp("KeyG");
    expect(h.opens).toBe(0);
  });

  it("runs the motor as the one loop", async () => {
    const h = harness();
    h.core.installAudio(cueBytes(), new ArrayBuffer(2));
    h.core.feedKeyDown("KeyG");
    await h.settle();
    h.core.setMotor(true);
    expect(h.loops).toContain("motor");
    h.core.setMotor(true);
    expect(h.loops.filter((name) => name === "motor")).toHaveLength(1);
    h.core.setMotor(false);
    expect(h.loops).not.toContain("motor");
  });

  it("mirrors and toggles the mute bit", () => {
    const { core } = harness();
    expect(core.isMuted()).toBe(false);
    core.toggleMute();
    expect(core.isMuted()).toBe(true);
    core.toggleMute();
    expect(core.isMuted()).toBe(false);
  });
});
