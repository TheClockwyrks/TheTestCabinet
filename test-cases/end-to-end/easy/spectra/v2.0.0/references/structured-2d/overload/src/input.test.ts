import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS, LAYOUT, OVERLAY_KEY } from "./constants";
import { registerActions } from "./input";
import { CUE_SPECS, defineCues, noCues, playCues } from "./audio";
import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";

function inputApi(layout: string | null) {
  const registered = new Map<string, string[]>();
  const api = {
    input: {
      register: (name: string, binding: { keys: string[] }) => {
        registered.set(name, binding.keys);
      },
      layout: () => (layout === null ? null : { name: layout, actions: [] }),
    },
  } as unknown as Pick<InitApi, "input">;
  return { api, registered };
}

describe("the actions", () => {
  it("registers the whole vocabulary against its own keys", () => {
    const { api, registered } = inputApi(LAYOUT);
    registerActions(api);
    expect([...registered.keys()].sort()).toEqual([...ACTIONS].sort());
    for (const action of ACTIONS) {
      expect(registered.get(action)).toEqual([...BINDINGS[action]]);
    }
  });

  it("refuses an engine built without the layout it is written against", () => {
    expect(() => registerActions(inputApi(null).api)).toThrow(LAYOUT);
    expect(() => registerActions(inputApi("dpad-4").api)).toThrow("dpad-4");
  });

  it("leaves the overlay's key free of a binding", () => {
    for (const keys of Object.values(BINDINGS)) {
      expect(keys).not.toContain(OVERLAY_KEY);
    }
  });
});

describe("the cues", () => {
  it("defines one for every name the game plays", () => {
    const defined = new Map<string, CueSpec>();
    defineCues({
      audio: {
        define: (cue: string, spec: CueSpec) => defined.set(cue, spec),
        load: async () => {},
      },
    } as unknown as Pick<InitApi, "audio">);
    expect(defined.size).toBe(Object.keys(CUE_SPECS).length);
    for (const [cue, spec] of defined) {
      expect(spec.durationMs).toBeGreaterThan(0);
      expect(spec.freq).toBeGreaterThan(0);
      expect(cue.length).toBeGreaterThan(0);
    }
  });

  it("plays each raised cue once, and nothing at all while muted", () => {
    const played: string[] = [];
    const bus = (muted: boolean): WorldAudio =>
      ({
        play: (cue: string) => played.push(cue),
        muted: () => muted,
      }) as unknown as WorldAudio;

    const cues = noCues();
    cues.fire = true;
    cues.kill = true;
    playCues(bus(false), cues);
    expect(played).toEqual(["fire", "kill"]);

    played.length = 0;
    playCues(bus(true), cues);
    expect(played).toEqual([]);
  });

  it("plays nothing for a batch that raised nothing", () => {
    const played: string[] = [];
    playCues(
      {
        play: (cue: string) => played.push(cue),
        muted: () => false,
      } as unknown as WorldAudio,
      noCues(),
    );
    expect(played).toEqual([]);
  });
});
