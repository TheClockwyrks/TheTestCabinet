import { describe, expect, it } from "vitest";
import {
  MUSIC_PLAY,
  MUSIC_TITLE,
  bedForScreen,
  cueSources,
  fallbackSpec,
  installCues,
  ladderCue,
  playBed,
  playFrameEvents,
} from "./audio";
import { LADDER_RUNGS } from "./assets";
import { CUES, MAX_MULTIPLIER } from "./constants";
import { NO_EVENTS, type FacetEvents } from "./core";
import type { CueSpec, UpdateApi } from "@test-cabinet/simple-2d";

/** A bus that records what it was asked to do. */
function bus() {
  const played: string[] = [];
  const looping = new Set<string>();
  const stopped: string[] = [];
  const api = {
    audio: {
      play: (cue: string) => played.push(cue),
      loop: (cue: string) => looping.add(cue),
      stop: (cue: string) => {
        stopped.push(cue);
        looping.delete(cue);
      },
      looping: (cue: string) => looping.has(cue),
      setMuted: () => {},
      muted: () => false,
    },
  } as unknown as Pick<UpdateApi, "audio">;
  return { api, played, looping, stopped };
}

/** Events with just the named flags raised. */
function raise(...flags: (keyof FacetEvents)[]): FacetEvents {
  return flags.reduce<FacetEvents>(
    (events, flag) => ({ ...events, [flag]: true }),
    NO_EVENTS,
  );
}

describe("the cue sources", () => {
  it("binds each of the nine cues specs/ui.md names to a produced file", () => {
    const sources = cueSources();
    for (const cue of Object.values(CUES)) {
      expect(sources[cue], cue).toMatch(/^audio\/[a-z]+\.wav$/);
    }
  });

  it("binds the clear cue to the sampled shatter body", () => {
    expect(cueSources()[CUES.clear]).toBe("audio/shatter.wav");
  });

  it("binds one rung per step of the ladder, in ascending order", () => {
    const sources = cueSources();
    for (let rung = 1; rung <= LADDER_RUNGS; rung += 1) {
      expect(sources[ladderCue(rung)]).toBe(`audio/chain-${rung}.wav`);
    }
    expect(LADDER_RUNGS).toBe(MAX_MULTIPLIER);
  });

  it("binds the two beds", () => {
    expect(cueSources()[MUSIC_TITLE]).toBe("audio/title.wav");
    expect(cueSources()[MUSIC_PLAY]).toBe("audio/play.wav");
  });

  it("binds the land cue to its own produced sound", () => {
    expect(cueSources()[CUES.land]).toBe("audio/land.wav");
  });

  it("names nineteen files in all, each exactly once", () => {
    const sources = cueSources();
    expect(Object.keys(sources)).toHaveLength(19);
    expect(new Set(Object.values(sources)).size).toBe(19);
  });
});

describe("installing the cues", () => {
  /** An init-side bus that fails the paths named. */
  function initBus(failing: readonly string[] = []) {
    const loaded: string[] = [];
    const defined = new Map<string, CueSpec>();
    const api = {
      audio: {
        load: (cue: string, path: string) => {
          if (failing.includes(path)) return Promise.reject(new Error("gone"));
          loaded.push(cue);
          return Promise.resolve();
        },
        define: (cue: string, spec: CueSpec) => defined.set(cue, spec),
      },
    };
    return { api, loaded, defined };
  }

  it("binds every cue to its file and declares no bleep when all arrive", async () => {
    const { api, loaded, defined } = initBus();
    const missing = await installCues(api);

    expect(missing).toEqual([]);
    expect(loaded.sort()).toEqual(Object.keys(cueSources()).sort());
    expect(defined.size).toBe(0);
  });

  it("declares a bleep under any name whose file did not arrive", async () => {
    const { api, defined } = initBus(["audio/select.wav", "audio/title.wav"]);
    const missing = await installCues(api);

    expect(missing).toEqual([CUES.select, MUSIC_TITLE].sort());
    expect(defined.has(CUES.select)).toBe(true);
    expect(defined.has(MUSIC_TITLE)).toBe(true);
    // A bed's stand-in is quieter and longer than a cue's, since it loops.
    expect(defined.get(MUSIC_TITLE)?.durationMs).toBeGreaterThan(
      defined.get(CUES.select)?.durationMs ?? 0,
    );
  });

  it("gives every cue a playable stand-in", () => {
    for (const cue of Object.keys(cueSources())) {
      const spec = fallbackSpec(cue);
      expect(spec.freq).toBeGreaterThan(0);
      expect(spec.durationMs).toBeGreaterThan(0);
    }
  });
});

describe("the bed", () => {
  it("is the title theme on the two menu screens and the play bed elsewhere", () => {
    expect(bedForScreen("title")).toBe(MUSIC_TITLE);
    expect(bedForScreen("howto")).toBe(MUSIC_TITLE);
    expect(bedForScreen("playing")).toBe(MUSIC_PLAY);
    expect(bedForScreen("paused")).toBe(MUSIC_PLAY);
    expect(bedForScreen("levelclear")).toBe(MUSIC_PLAY);
    expect(bedForScreen("gameover")).toBe(MUSIC_PLAY);
  });

  it("starts one and only one bed, and swaps it on the screen change", () => {
    const { api, looping, stopped } = bus();
    playBed(api, "title");
    expect([...looping]).toEqual([MUSIC_TITLE]);

    playBed(api, "playing");
    expect([...looping]).toEqual([MUSIC_PLAY]);
    expect(stopped).toEqual([MUSIC_TITLE]);
  });

  it("asks again for a bed already sounding without restarting it", () => {
    const { api, looping, stopped } = bus();
    playBed(api, "playing");
    playBed(api, "playing");
    expect([...looping]).toEqual([MUSIC_PLAY]);
    expect(stopped).toEqual([]);
  });
});

describe("playing a frame's events", () => {
  it("plays nothing but the bed on a frame that raised nothing", () => {
    const { api, played, looping } = bus();
    playFrameEvents(api, NO_EVENTS, 0, "playing");
    expect(played).toEqual([]);
    expect([...looping]).toEqual([MUSIC_PLAY]);
  });

  it("plays each raised cue exactly once", () => {
    const { api, played } = bus();
    playFrameEvents(
      api,
      raise(
        "select",
        "swap",
        "refuse",
        "land",
        "flaw",
        "cut",
        "levelUp",
        "gameOver",
      ),
      0,
      "playing",
    );
    expect(played).toEqual([
      CUES.select,
      CUES.swap,
      CUES.refuse,
      CUES.land,
      CUES.flaw,
      CUES.cut,
      CUES.levelUp,
      CUES.gameOver,
    ]);
  });

  it("sounds the shatter body and the step's rung on a clear", () => {
    const { api, played } = bus();
    playFrameEvents(api, raise("clear"), 3, "playing");
    expect(played).toEqual([CUES.clear, ladderCue(3)]);
  });

  it("holds on the top rung once the multiplier has capped", () => {
    const { api, played } = bus();
    playFrameEvents(api, raise("clear"), MAX_MULTIPLIER + 5, "playing");
    expect(played).toEqual([CUES.clear, ladderCue(MAX_MULTIPLIER)]);
  });

  it("starts on the lowest rung, even where no multiplier was reported", () => {
    const { api, played } = bus();
    playFrameEvents(api, raise("clear"), 0, "playing");
    expect(played).toEqual([CUES.clear, ladderCue(1)]);
  });
});
