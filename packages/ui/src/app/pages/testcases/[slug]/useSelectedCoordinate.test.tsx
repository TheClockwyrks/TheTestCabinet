import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { TestCaseDetail } from "../../../data/testCases";
import { useSelectedCoordinate } from "./useSelectedCoordinate";

// A case with everything the coordinate selects across: two versions, of which
// only the newer declares a second variant and a second engine. That asymmetry
// is the point — it is what a version switch has to re-derive against.
function detail(extra: Partial<TestCaseDetail> = {}): TestCaseDetail {
  return {
    slug: "carom",
    versions: ["v2.0.0", "v1.0.0"],
    latestVersion: "v2.0.0",
    variantsByVersion: {
      "v2.0.0": [
        { slug: "base", name: "Base" },
        { slug: "gyre", name: "Gyre" },
      ],
      "v1.0.0": [{ slug: "base", name: "Base" }],
    },
    enginesByVersion: {
      "v2.0.0": ["none", "simple-2d"],
      "v1.0.0": ["none"],
    },
    ...extra,
  } as TestCaseDetail;
}

// The hook owns the query string, so every test reads the coordinate and the
// URL it wrote side by side: the round-trip (what a link carries) is as much
// the contract as the resolved values.
function renderCoordinate(testCase: TestCaseDetail | undefined, url = "/") {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({
      coordinate: useSelectedCoordinate(testCase),
      search: useLocation().search,
    }),
    { wrapper },
  );
}

describe("useSelectedCoordinate", () => {
  // Nothing selected reads as the deliverable as it stands: the latest version,
  // its default (first) variant, rendered engineless — with a clean URL.
  it("defaults to the latest version, first variant, engineless", () => {
    const { result } = renderCoordinate(detail());
    const { coordinate, search } = result.current;
    expect(coordinate.version).toBe("v2.0.0");
    expect(coordinate.isLatest).toBe(true);
    expect(coordinate.variant?.slug).toBe("base");
    expect(coordinate.engine).toBe("none");
    expect(search).toBe("");
  });

  // The layout calls the hook before its case fetch settles (hook rules), so an
  // undefined case must resolve to a harmless empty coordinate, not throw.
  it("tolerates an undefined case with an empty coordinate", () => {
    const { result } = renderCoordinate(undefined);
    expect(result.current.coordinate.version).toBe("");
    expect(result.current.coordinate.variant).toBeUndefined();
    expect(result.current.coordinate.engine).toBe("none");
  });

  // Each selection is carried in the URL, and each is dropped again at its
  // default so an ordinary link stays clean.
  it("round-trips each selection through the URL and elides defaults", () => {
    const { result } = renderCoordinate(detail());

    act(() => result.current.coordinate.setVariant("gyre"));
    expect(result.current.search).toBe("?variant=gyre");
    expect(result.current.coordinate.variant?.slug).toBe("gyre");

    act(() => result.current.coordinate.setEngine("simple-2d"));
    expect(result.current.search).toBe("?variant=gyre&engine=simple-2d");
    expect(result.current.coordinate.engine).toBe("simple-2d");

    act(() => result.current.coordinate.setVariant("base"));
    expect(result.current.search).toBe("?engine=simple-2d");

    act(() => result.current.coordinate.setEngine("none"));
    expect(result.current.search).toBe("");

    act(() => result.current.coordinate.setVersion("v1.0.0"));
    expect(result.current.search).toBe("?version=v1.0.0");
    expect(result.current.coordinate.version).toBe("v1.0.0");
    expect(result.current.coordinate.isLatest).toBe(false);

    act(() => result.current.coordinate.setVersion("v2.0.0"));
    expect(result.current.search).toBe("");
    expect(result.current.coordinate.isLatest).toBe(true);
  });

  // A stale deep link must never leave the page naming a deliverable it is not
  // showing: unknown params read as the defaults rather than passing through.
  it("canonicalizes unknown version, variant, and engine params", () => {
    const { result } = renderCoordinate(
      detail(),
      "/?version=v9.9.9&variant=nope&engine=quantum",
    );
    const { coordinate } = result.current;
    expect(coordinate.version).toBe("v2.0.0");
    expect(coordinate.isLatest).toBe(true);
    expect(coordinate.variant?.slug).toBe("base");
    expect(coordinate.engine).toBe("none");
  });

  // A version declares its own variants and engines, so switching to one that
  // has neither of the carried selections drops both params outright — the URL
  // must not keep naming a rendering the new version does not have.
  it("scrubs a stale variant and engine when the version changes", () => {
    const { result } = renderCoordinate(
      detail(),
      "/?variant=gyre&engine=simple-2d",
    );
    expect(result.current.coordinate.variant?.slug).toBe("gyre");
    expect(result.current.coordinate.engine).toBe("simple-2d");

    act(() => result.current.coordinate.setVersion("v1.0.0"));

    expect(result.current.search).toBe("?version=v1.0.0");
    expect(result.current.coordinate.variant?.slug).toBe("base");
    expect(result.current.coordinate.engine).toBe("none");
  });

  // The scrub is a drop of what the new version lacks, not a reset: a selection
  // the new version does declare rides along.
  it("keeps a selection the new version still declares", () => {
    const { result } = renderCoordinate(
      detail({
        variantsByVersion: {
          "v2.0.0": [
            { slug: "base", name: "Base" },
            { slug: "gyre", name: "Gyre" },
          ],
          "v1.0.0": [
            { slug: "base", name: "Base" },
            { slug: "gyre", name: "Gyre" },
          ],
        },
      }),
      "/?variant=gyre",
    );

    act(() => result.current.coordinate.setVersion("v1.0.0"));

    // Param order is insertion order: the carried variant precedes the version
    // the switch just wrote.
    expect(result.current.search).toBe("?variant=gyre&version=v1.0.0");
    expect(result.current.coordinate.variant?.slug).toBe("gyre");
  });

  // The engines offered are the selected version's own, in catalog order with
  // the engineless rendering leading when the version offers it.
  it("orders a version's engines with the engineless rendering first", () => {
    const { result } = renderCoordinate(
      detail({ enginesByVersion: { "v2.0.0": ["simple-2d", "none"] } }),
    );
    expect(result.current.coordinate.engines).toEqual(["none", "simple-2d"]);
    expect(result.current.coordinate.engine).toBe("none");
  });

  // A case built against a runtime need not support the engineless run at all;
  // its default is then the first engine it does offer, and that default is the
  // one elided from the URL.
  it("defaults to the first engine when engineless is not offered", () => {
    const { result } = renderCoordinate(
      detail({ enginesByVersion: { "v2.0.0": ["simple-2d", "custom-3d"] } }),
    );
    expect(result.current.coordinate.engine).toBe("simple-2d");

    act(() => result.current.coordinate.setEngine("custom-3d"));
    expect(result.current.search).toBe("?engine=custom-3d");

    act(() => result.current.coordinate.setEngine("simple-2d"));
    expect(result.current.search).toBe("");
  });

  // A version the host carries no engine entry for still offers the engineless
  // rendering — it is what every host publishes as the variant's own inputs.
  it("offers only the engineless rendering when a version lists no engines", () => {
    const { result } = renderCoordinate(detail({ enginesByVersion: {} }));
    expect(result.current.coordinate.engines).toEqual(["none"]);
    expect(result.current.coordinate.engine).toBe("none");
  });
});
