import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEngineChoice } from "./useEngineChoice";

// The engine is a run dimension the *case version* gates, and the set it gates moves
// under the selection — a form switching cases, an editor whose catalog has not
// answered yet. These cover what the hook exists to guarantee: what it reports is
// always something the version on screen would actually accept.
describe("useEngineChoice", () => {
  it("offers the version's engines in catalog order, whatever order they arrived in", () => {
    const { result } = renderHook(() =>
      useEngineChoice(["structured-2d", "none", "simple-2d"]),
    );
    expect(result.current.options).toEqual([
      "none",
      "simple-2d",
      "structured-2d",
    ]);
  });

  it("appends an engine the console has never heard of rather than dropping it", () => {
    // A console older than the backend it is pointed at still has to be able to
    // launch on an engine that landed after it shipped.
    const { result } = renderHook(() => useEngineChoice(["voxel-3d", "none"]));
    expect(result.current.options).toEqual(["none", "voxel-3d"]);
  });

  it("starts on the engineless run, the one every case supports", () => {
    const { result } = renderHook(() =>
      useEngineChoice(["none", "simple-2d"]),
    );
    expect(result.current.engine).toBe("none");
  });

  it("reports nothing to choose from before the version resolves", () => {
    // Null is what the catalog holds until a resolve answers. The answer is still
    // the engineless run, because that is the pin an add would file right now.
    const { result } = renderHook(() => useEngineChoice(null));
    expect(result.current.options).toEqual([]);
    expect(result.current.engine).toBe("none");
  });

  it("falls back to the first supported engine when the engineless run is not on offer", () => {
    // A case built against a runtime need not support being built from nothing.
    const { result } = renderHook(() =>
      useEngineChoice(["simple-2d", "structured-2d"]),
    );
    expect(result.current.engine).toBe("simple-2d");
  });

  it("keeps the operator's pick", () => {
    const { result } = renderHook(() =>
      useEngineChoice(["none", "simple-2d"]),
    );
    act(() => result.current.setEngine("simple-2d"));
    expect(result.current.engine).toBe("simple-2d");
  });

  it("holds a pick the version stops supporting, on the render that drops it", () => {
    // Derived rather than synced through an effect, which is the whole point: an
    // effect would leave one render — the one where Add can be pressed — reporting an
    // engine the case on screen would refuse.
    const { result, rerender } = renderHook(
      ({ engines }: { engines: string[] }) => useEngineChoice(engines),
      { initialProps: { engines: ["none", "simple-2d"] } },
    );
    act(() => result.current.setEngine("simple-2d"));
    rerender({ engines: ["none"] });
    expect(result.current.engine).toBe("none");
  });

  it("remembers the pick as a preference, so a case that supports it again gets it", () => {
    const { result, rerender } = renderHook(
      ({ engines }: { engines: string[] }) => useEngineChoice(engines),
      { initialProps: { engines: ["none", "simple-2d"] } },
    );
    act(() => result.current.setEngine("simple-2d"));
    rerender({ engines: ["none"] });
    rerender({ engines: ["none", "simple-2d"] });
    expect(result.current.engine).toBe("simple-2d");
  });

  it("opens on an engine it was handed, for a surface navigated to with one in hand", () => {
    const { result } = renderHook(() =>
      useEngineChoice(["none", "simple-2d"], "simple-2d"),
    );
    expect(result.current.engine).toBe("simple-2d");
  });

  it("holds a handed-in engine the version does not support, like any other pick", () => {
    const { result } = renderHook(() =>
      useEngineChoice(["none"], "structured-2d"),
    );
    expect(result.current.engine).toBe("none");
  });
});
