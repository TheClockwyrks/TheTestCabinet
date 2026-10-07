// The cue declarations and the bed policy of specs/assets.md "The sound":
// every name is declared before any file is asked for, the produced file is
// loaded over its name, and each screen runs exactly its bed.

import { describe, expect, it } from "vitest";
import { CUES, CUE_PATHS } from "./constants";
import { BED_NAMES, bedForScreen, defineCues, syncBeds } from "./audio";
import { SCREENS } from "./figures";

describe("defineCues", () => {
  it("defines every cue and bed, then loads the produced file over it", async () => {
    const defined: string[] = [];
    const loaded: [string, string][] = [];
    await defineCues({
      audio: {
        define: (cue) => defined.push(cue),
        load: (cue, path) => {
          loaded.push([cue, path]);
          return Promise.reject(new Error("no fetch in this process"));
        },
      },
    });
    for (const cue of Object.values(CUES)) {
      expect(defined).toContain(cue);
      expect(loaded).toContainEqual([cue, CUE_PATHS[cue]]);
    }
    expect(defined).toContain(BED_NAMES.title);
    expect(defined).toContain(BED_NAMES.play);
    // Every name was declared before any load could have resolved, so a
    // build whose files never arrive still plays its fallback shapes.
    expect(defined.length).toBe(Object.values(CUES).length + 2);
  });
});

describe("the beds", () => {
  it("maps each screen to the bed specs/assets.md fixes", () => {
    expect(bedForScreen("title")).toBe(BED_NAMES.title);
    expect(bedForScreen("howto")).toBe(BED_NAMES.title);
    expect(bedForScreen("playing")).toBe(BED_NAMES.play);
    expect(bedForScreen("waveclear")).toBe(BED_NAMES.play);
    expect(bedForScreen("paused")).toBe(BED_NAMES.play);
    expect(bedForScreen("gameover")).toBeNull();
  });

  it("keeps exactly the screen's bed looping", () => {
    for (const screen of SCREENS) {
      const looping = new Set<string>([BED_NAMES.title, BED_NAMES.play]);
      syncBeds(
        {
          audio: {
            play: () => undefined,
            loop: (cue) => void looping.add(cue),
            stop: (cue) => void looping.delete(cue),
            looping: (cue) => looping.has(cue),
            setMuted: () => undefined,
            muted: () => false,
          },
        },
        screen,
      );
      const want = bedForScreen(screen);
      expect([...looping]).toEqual(want === null ? [] : [want]);
    }
  });
});
