import { describe, expect, it } from "vitest";
import { findGgConfig, savedKey, type GgConfigOption } from "./useGgConfigs";

function option(id: string): GgConfigOption {
  return {
    key: savedKey(id),
    name: id,
    description: "",
    capabilitySet: { agents: [] },
    draft: {},
  } as unknown as GgConfigOption;
}

// One lookup for every surface that turns a stored reference back into a configuration.
// The coverage dashboard and the combination picker each had their own, and a reference
// one resolved and the other did not would report the same configuration as deleted on
// one screen while offering it on the next.
describe("findGgConfig", () => {
  it("resolves the picker's own key", () => {
    const options = [option("cfg-1"), option("cfg-2")];
    expect(findGgConfig(options, "saved:cfg-2")?.name).toBe("cfg-2");
  });

  it("resolves a bare id, which the wire contract also accepts", () => {
    const options = [option("cfg-1"), option("cfg-2")];
    expect(findGgConfig(options, "cfg-2")?.name).toBe("cfg-2");
  });

  it("finds nothing for a configuration the account no longer holds", () => {
    expect(findGgConfig([option("cfg-1")], "cfg-9")).toBeUndefined();
  });
});
