import { describe, expect, it } from "vitest";
import { ACTIONS, BINDINGS } from "./constants";
import {
  back,
  confirm,
  down,
  left,
  mute,
  pause,
  registerActions,
  right,
  up,
} from "./input";
import type { UpdateApi } from "./runtime";

/** An api that answers `true` for exactly one action name. */
function armed(name: string): UpdateApi {
  return {
    input: {
      pressed: (asked) => asked === name,
      pointer: () => ({ x: 0, y: 0, down: false }),
      pointerSamples: () => [],
    },
    audio: {
      play: () => {},
      setTrack: () => {},
      setMuted: () => {},
      muted: () => false,
    },
    assets: {} as UpdateApi["assets"],
  };
}

describe("registerActions", () => {
  it("registers every action in ACTIONS, against its own binding", () => {
    const registered = new Map<string, readonly string[]>();
    registerActions({
      input: { register: (name, keys) => registered.set(name, keys) },
    });
    expect([...registered.keys()]).toEqual([...ACTIONS]);
    for (const action of ACTIONS) {
      expect(registered.get(action)).toEqual(BINDINGS[action]);
    }
  });

  it("binds the three keys specs/controls.md fixes", () => {
    expect(BINDINGS.pause).toEqual(["KeyP"]);
    expect(BINDINGS.mute).toEqual(["KeyM"]);
    expect(BINDINGS.back).toEqual(["Escape"]);
  });
});

describe("the action readers", () => {
  const readers: [string, (api: UpdateApi) => boolean][] = [
    ["up", up],
    ["down", down],
    ["left", left],
    ["right", right],
    ["confirm", confirm],
    ["back", back],
    ["pause", pause],
    ["mute", mute],
  ];

  it("covers every registered action, one reader each", () => {
    expect(readers.map(([name]) => name)).toEqual([...ACTIONS]);
  });

  it("reads its own action and no other", () => {
    for (const [name, read] of readers) {
      expect(read(armed(name)), name).toBe(true);
      for (const [other, otherRead] of readers) {
        if (other === name) continue;
        expect(otherRead(armed(name)), `${other} on ${name}`).toBe(false);
      }
    }
  });
});
