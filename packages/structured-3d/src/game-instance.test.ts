import { describe, expect, it, vi } from "vitest";
import type { Engine } from "./engine";
import { GameInstance, bindGameInstance, type InitApi } from "./game-instance";
import type { EngineEvents, World } from "./worlds";

/**
 * The instance class alone: its construction contract, the base
 * implementations, and the `bindGameInstance` seam. What the engine does with
 * the returned surface — refusing `undefined`, holding it as `engine.debug`,
 * awaiting a promised one before the start level — is the engine module's to
 * assert; this suite proves the instance side of each promise.
 */

/**
 * An `InitApi` whose input half records registrations — all the base class and
 * the examples here touch. The rest of the surface is present but inert.
 */
function initApi(): { api: InitApi; registered: string[] } {
  const registered: string[] = [];
  const api = {
    input: {
      register: (name: string) => {
        registered.push(name);
      },
      layout: () => null,
    },
    audio: { define: vi.fn(), load: vi.fn() },
    assets: {
      loadMesh: vi.fn(),
      loadTexture: vi.fn(),
      loadMaterial: vi.fn(),
      loadAudio: vi.fn(),
      load: vi.fn(),
      resolve: (path: string) => path,
    },
    diagnostics: { register: vi.fn() },
    events: { on: () => () => {} },
    viewport: () => ({
      width: 640,
      height: 360,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    }),
  } as unknown as InitApi;
  return { api, registered };
}

describe("GameInstance", () => {
  it("constructs with no arguments and its base initialize returns null", () => {
    const instance = new GameInstance<null>();
    expect(instance.initialize(initApi().api)).toBeNull();
  });

  it("has do-nothing worldOpened, worldClosing, and shutdown", () => {
    const instance = new GameInstance<null>();
    const world = {} as World;
    // The base implementations are documented no-ops: a subclass overrides
    // only what it needs, so the bases must be safe to call bare.
    expect(() => {
      instance.worldOpened(world);
      instance.worldClosing(world);
      instance.shutdown();
    }).not.toThrow();
  });

  it("is handed engine and events by bindGameInstance before initialize", () => {
    const engine = { tag: "engine" } as unknown as Engine<null>;
    const events = { on: () => () => {} } as EngineEvents;
    const seen: unknown[] = [];

    class Probing extends GameInstance<null> {
      override initialize(api: InitApi): null {
        void api;
        // `engine` is assigned before `initialize` runs, so an override that
        // reads it here is exactly the documented calling pattern.
        seen.push(this.engine, this.events);
        return null;
      }
    }

    const instance = new Probing();
    bindGameInstance(instance, engine, events);
    instance.initialize(initApi().api);
    expect(seen).toEqual([engine, events]);
  });

  it("lets a constructor set defaults that initialize then reads", () => {
    // The docs' Arcade idiom: fields with initializers, initialize doing the
    // work that needs the InitApi.
    class Arcade extends GameInstance<null> {
      best = 0;

      override initialize(api: InitApi): null {
        api.input.register("thrust", { keys: ["KeyW", "ArrowUp"] });
        return null;
      }
    }

    const { api, registered } = initApi();
    const arcade = new Arcade();
    expect(arcade.best).toBe(0);
    expect(arcade.initialize(api)).toBeNull();
    expect(registered).toEqual(["thrust"]);
  });

  it("supports an async initialize returning the debug surface", async () => {
    interface Debug {
      ping(): string;
    }

    class Deferred extends GameInstance<Debug> {
      override async initialize(api: InitApi): Promise<Debug> {
        void api;
        await Promise.resolve();
        return { ping: () => "pong" };
      }
    }

    const surface = await new Deferred().initialize(initApi().api);
    expect(surface.ping()).toBe("pong");
  });

  it("keeps the surface the instance returned by identity", () => {
    // The engine holds the value unchanged; the instance side of that
    // promise is simply that initialize returns one stable object.
    const surface = { poke: vi.fn() };

    class Surfaced extends GameInstance<typeof surface> {
      override initialize(api: InitApi): typeof surface {
        void api;
        return surface;
      }
    }

    expect(new Surfaced().initialize(initApi().api)).toBe(surface);
  });

  it("supports the debug-surface idiom of reaching the live world per call", () => {
    // A pose reads `this.engine.world` at the moment of the call rather than
    // holding a world of its own, so it follows every transition.
    interface Debug {
      level(): string;
    }

    class Surfaced extends GameInstance<Debug> {
      override initialize(api: InitApi): Debug {
        void api;
        return { level: () => this.engine.world.level };
      }
    }

    const worlds = [{ level: "title" }, { level: "arena" }];
    let at = 0;
    const engine = {
      get world() {
        return worlds[at] as unknown as World;
      },
    } as unknown as Engine<Debug>;

    const instance = new Surfaced();
    bindGameInstance(instance, engine, { on: () => () => {} } as EngineEvents);
    const surface = instance.initialize(initApi().api) as Debug;
    expect(surface.level()).toBe("title");
    at = 1;
    expect(surface.level()).toBe("arena");
  });
});
