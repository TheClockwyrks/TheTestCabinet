import { afterEach, describe, expect, it, vi } from "vitest";

import { ORRERY_DEBUG_VERSION, ORRERY_SURFACE_KEY } from "./constants";
import { Game } from "./game";
import { createSurface, installSurface } from "./surface";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installing the surface (specs/instrumentation.md)", () => {
  it("puts the finished surface on window.__orrery", () => {
    const page: Record<string, unknown> = {};
    vi.stubGlobal("window", page);
    const api = createSurface(new Game(), {
      setAutoStep: () => undefined,
      advance: () => undefined,
    });
    installSurface(api);
    expect(page[ORRERY_SURFACE_KEY]).toBe(api);
    expect((page[ORRERY_SURFACE_KEY] as { version: number }).version).toBe(
      ORRERY_DEBUG_VERSION,
    );
  });

  it("is inert until something calls it", () => {
    const game = new Game();
    createSurface(game, {
      setAutoStep: () => undefined,
      advance: () => undefined,
    });
    expect(game.state.screen).toBe("title");
    expect(game.state.simTime).toBe(0);
  });

  it("refuses an advance whose seconds are not a finite number", () => {
    const api = createSurface(new Game(), {
      setAutoStep: () => undefined,
      advance: () => undefined,
    });
    expect(() => api.advance(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => api.advance(1, 1.5)).toThrow(/whole number/);
  });
});
