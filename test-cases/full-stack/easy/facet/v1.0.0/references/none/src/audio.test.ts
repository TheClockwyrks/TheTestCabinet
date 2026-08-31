import { describe, expect, it } from "vitest";
import {
  CUE_SPECS,
  defineCues,
  playFrameEvents,
  trackForScreen,
} from "./audio";
import { LADDER_RUNGS, MUSIC_PLAY, MUSIC_TITLE, ladderKey } from "./assets";
import { CUES, MAX_MULTIPLIER } from "./constants";
import { NO_EVENTS, type FacetEvents, type Screen } from "./core";

/** An audio api that records what a frame asked for. */
function recorder() {
  const played: [string, number | undefined][] = [];
  const tracks: (string | null)[] = [];
  return {
    played,
    tracks,
    api: {
      audio: {
        play(cue: string, variant?: number) {
          played.push([cue, variant]);
        },
        setTrack(key: string | null) {
          tracks.push(key);
        },
        setMuted() {},
        muted: () => false,
      },
    },
  };
}

describe("the cue declarations", () => {
  it("declares exactly the nine cues specs/ui.md names", () => {
    expect(Object.keys(CUE_SPECS).sort()).toEqual(
      Object.values(CUES).slice().sort(),
    );
  });

  it("sounds the chain ladder from the clear cue rather than as its own", () => {
    const clear = CUE_SPECS[CUES.clear];
    expect(clear.ladder).toEqual(
      Array.from({ length: LADDER_RUNGS }, (_, index) => ladderKey(index + 1)),
    );
    expect(clear.ladder).toHaveLength(MAX_MULTIPLIER);
    // The sampled shatter body sits under the rung.
    expect(clear.layers).toEqual(["shatter"]);
  });

  it("gives every other cue a produced file of its own", () => {
    for (const [cue, spec] of Object.entries(CUE_SPECS)) {
      if (cue === CUES.clear) continue;
      expect(spec.layers).toHaveLength(1);
      expect(spec.ladder).toBeUndefined();
    }
  });

  it("declares every cue with the runtime, once", () => {
    const declared: string[] = [];
    defineCues({ audio: { define: (cue) => declared.push(cue) } });
    expect(declared.sort()).toEqual(Object.values(CUES).slice().sort());
  });
});

describe("trackForScreen", () => {
  it("plays the title theme on the two menu screens", () => {
    expect(trackForScreen("title")).toBe(MUSIC_TITLE);
    expect(trackForScreen("howto")).toBe(MUSIC_TITLE);
  });

  it("plays the bed on the four screens a round is on", () => {
    const round: Screen[] = ["playing", "paused", "levelclear", "gameover"];
    for (const screen of round) {
      expect(trackForScreen(screen)).toBe(MUSIC_PLAY);
    }
  });
});

describe("playFrameEvents", () => {
  it("plays nothing on a frame that raised nothing", () => {
    const { api, played } = recorder();
    playFrameEvents(api, NO_EVENTS, 0, "playing");
    expect(played).toEqual([]);
  });

  it("plays each raised cue exactly once, whatever raised it", () => {
    const { api, played } = recorder();
    const events: FacetEvents = {
      ...NO_EVENTS,
      swap: true,
      clear: true,
      land: true,
      flaw: true,
      cut: true,
    };
    playFrameEvents(api, events, 3, "playing");
    expect(played.map(([cue]) => cue)).toEqual([
      CUES.swap,
      CUES.clear,
      CUES.land,
      CUES.flaw,
      CUES.cut,
    ]);
  });

  it("knocks when a step's stones land after a long fall", () => {
    const { api, played } = recorder();
    playFrameEvents(api, { ...NO_EVENTS, land: true }, 0, "playing");
    expect(played).toEqual([[CUES.land, undefined]]);
  });

  it("sounds the ladder rung the step's multiplier names", () => {
    const { api, played } = recorder();
    playFrameEvents(api, { ...NO_EVENTS, clear: true }, 5, "playing");
    expect(played).toEqual([[CUES.clear, 5]]);
  });

  it("holds the top rung once the multiplier has capped", () => {
    const { api, played } = recorder();
    playFrameEvents(api, { ...NO_EVENTS, clear: true }, 99, "playing");
    expect(played).toEqual([[CUES.clear, MAX_MULTIPLIER]]);
  });

  it("asks for at least the lowest rung when no step scored", () => {
    const { api, played } = recorder();
    playFrameEvents(api, { ...NO_EVENTS, clear: true }, 0, "playing");
    expect(played).toEqual([[CUES.clear, 1]]);
  });

  it("plays the ending cues too, in the order the frame raised them", () => {
    const { api, played } = recorder();
    playFrameEvents(
      api,
      {
        ...NO_EVENTS,
        select: true,
        refuse: true,
        levelUp: true,
        gameOver: true,
      },
      0,
      "gameover",
    );
    expect(played.map(([cue]) => cue)).toEqual([
      CUES.select,
      CUES.refuse,
      CUES.levelUp,
      CUES.gameOver,
    ]);
  });

  it("asks for the screen's bed on every frame", () => {
    const { api, tracks } = recorder();
    playFrameEvents(api, NO_EVENTS, 0, "title");
    playFrameEvents(api, NO_EVENTS, 0, "playing");
    expect(tracks).toEqual([MUSIC_TITLE, MUSIC_PLAY]);
  });
});
