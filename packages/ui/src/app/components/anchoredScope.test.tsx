import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import {
  AnchoredScopeControls,
  useAnchoredScope,
  versionInAnchoredScope,
} from "./anchoredScope";

// The versions the scope selects among: two on the anchored minor, one more on
// the anchored major, one on an older major. Newest first, as the catalog
// carries them.
const VERSIONS = ["v2.1.1", "v2.1.0", "v2.0.0", "v1.0.0"];
const ANCHOR = "v2.1.0";

function renderScope(
  anchor: Parameters<typeof useAnchoredScope>[0],
  url = "/",
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(
    () => ({
      scope: useAnchoredScope(anchor),
      search: useLocation().search,
    }),
    { wrapper },
  );
}

describe("versionInAnchoredScope", () => {
  it("keeps every version under the `all` scope", () => {
    for (const version of [...VERSIONS, "nonsense"]) {
      expect(versionInAnchoredScope(version, "all", ANCHOR)).toBe(true);
    }
  });

  it("keeps only the anchor under the `version` scope", () => {
    expect(versionInAnchoredScope(ANCHOR, "version", ANCHOR)).toBe(true);
    expect(versionInAnchoredScope("v2.1.1", "version", ANCHOR)).toBe(false);
  });

  it("keeps the anchored major.minor under the `minor` scope, any revision", () => {
    expect(versionInAnchoredScope("v2.1.4", "minor", ANCHOR)).toBe(true);
    expect(versionInAnchoredScope("v2.0.0", "minor", ANCHOR)).toBe(false);
    expect(versionInAnchoredScope("v1.1.0", "minor", ANCHOR)).toBe(false);
  });

  it("keeps the anchored major under the `major` scope, any minor", () => {
    expect(versionInAnchoredScope("v2.0.0", "major", ANCHOR)).toBe(true);
    expect(versionInAnchoredScope("v2.9.7", "major", ANCHOR)).toBe(true);
    expect(versionInAnchoredScope("v1.9.9", "major", ANCHOR)).toBe(false);
  });

  // A malformed version has no comparable parts, so either side failing to
  // parse falls back to an exact match: a malformed value only ever matches its
  // own kind, never a whole cohort.
  it("falls back to an exact match when either version does not parse", () => {
    expect(versionInAnchoredScope("draft", "minor", ANCHOR)).toBe(false);
    expect(versionInAnchoredScope("draft", "major", ANCHOR)).toBe(false);
    expect(versionInAnchoredScope(ANCHOR, "minor", "draft")).toBe(false);
    expect(versionInAnchoredScope("draft", "minor", "draft")).toBe(true);
    expect(versionInAnchoredScope("draft", "version", "draft")).toBe(true);
  });
});

describe("useAnchoredScope", () => {
  // The defaults keep a tab describing the anchor: its major.minor line, the
  // anchored engine, the anchored variant — with a clean URL.
  it("defaults to the anchored minor line with both wideners at the anchor", () => {
    const { result } = renderScope({ version: ANCHOR, versions: VERSIONS });
    const { scope, search } = result.current;
    expect(scope.versionScope).toBe("minor");
    expect(scope.engineScope).toBe("anchor");
    expect(scope.variantScope).toBe("anchor");
    expect(scope.showVersions).toBe(true);
    expect(search).toBe("");
    expect(scope.inVersionScope("v2.1.1")).toBe(true);
    expect(scope.inVersionScope("v2.0.0")).toBe(false);
  });

  it("hides the version segments for a single-version case", () => {
    const { result } = renderScope({ version: "v1.0.0", versions: ["v1.0.0"] });
    expect(result.current.scope.showVersions).toBe(false);
  });

  // A server-side listing sends the concrete versions a relative scope selects
  // (the catalog knows every published version); only `all` travels as no
  // filter at all.
  it("lists the concrete catalog versions each scope selects", () => {
    const { result } = renderScope({ version: ANCHOR, versions: VERSIONS });
    expect(result.current.scope.versionsInScope).toEqual(["v2.1.1", "v2.1.0"]);

    act(() => result.current.scope.setVersionScope("version"));
    expect(result.current.scope.versionsInScope).toEqual(["v2.1.0"]);

    act(() => result.current.scope.setVersionScope("major"));
    expect(result.current.scope.versionsInScope).toEqual([
      "v2.1.1",
      "v2.1.0",
      "v2.0.0",
    ]);

    act(() => result.current.scope.setVersionScope("all"));
    expect(result.current.scope.versionsInScope).toBeNull();
  });

  it("reads a widened scope back from the URL", () => {
    const { result } = renderScope(
      {
        version: ANCHOR,
        versions: VERSIONS,
        engineWidenable: true,
        variantWidenable: true,
      },
      "/?scope=all&engines=all&variants=all",
    );
    const { scope } = result.current;
    expect(scope.versionScope).toBe("all");
    expect(scope.engineScope).toBe("all");
    expect(scope.variantScope).toBe("all");
  });

  // A widening is honored only where the tab offers its control: a stale
  // `?engines=all` carried from a version that had the choice must not change
  // a cohort behind a control that is not on screen.
  it("reads the anchored scope when a widening is not offered", () => {
    const { result } = renderScope(
      { version: ANCHOR, versions: VERSIONS },
      "/?engines=all&variants=all",
    );
    const { scope } = result.current;
    expect(scope.engineScope).toBe("anchor");
    expect(scope.variantScope).toBe("anchor");
  });

  it("reads an unknown scope param as the default", () => {
    const { result } = renderScope(
      { version: ANCHOR, versions: VERSIONS },
      "/?scope=bogus",
    );
    expect(result.current.scope.versionScope).toBe("minor");
  });

  // Every non-default choice is carried in the query string and dropped again
  // at its default, so an ordinary link stays clean.
  it("writes each choice to the URL and elides defaults", () => {
    const { result } = renderScope({ version: ANCHOR, versions: VERSIONS });

    act(() => result.current.scope.setVersionScope("version"));
    expect(result.current.search).toBe("?scope=version");

    act(() => result.current.scope.setVersionScope("minor"));
    expect(result.current.search).toBe("");

    act(() => result.current.scope.setEngineScope("all"));
    expect(result.current.search).toBe("?engines=all");

    act(() => result.current.scope.setVariantScope("all"));
    expect(result.current.search).toBe("?engines=all&variants=all");

    act(() => result.current.scope.setEngineScope("anchor"));
    act(() => result.current.scope.setVariantScope("anchor"));
    expect(result.current.search).toBe("");
  });

  // An unparseable anchor has no major.minor line to widen into: it offers only
  // itself and `all`, its default narrows to the exact version, and a `minor`
  // request from a stale link is ignored rather than half-honoured.
  it("offers only the exact version and `all` for an unparsable anchor", () => {
    const { result } = renderScope(
      { version: "draft", versions: ["draft", "v1.0.0"] },
      "/?scope=minor",
    );
    expect(result.current.scope.versionScope).toBe("version");
    expect(result.current.scope.versionsInScope).toEqual(["draft"]);

    act(() => result.current.scope.setVersionScope("all"));
    expect(result.current.search).toBe("?scope=all");

    // `version` IS the default for an unparsable anchor, so it is elided.
    act(() => result.current.scope.setVersionScope("version"));
    expect(result.current.search).toBe("");
  });
});

// The control row, wired the way a tab mounts it: state from the hook, wideners
// passed only when the tab has a real choice to offer.
function ScopeHarness({
  anchor,
  engine,
  variant,
}: {
  anchor: { version: string; versions: readonly string[] };
  engine?: { name: string };
  variant?: { name: string };
}) {
  const state = useAnchoredScope(anchor);
  return (
    <>
      <AnchoredScopeControls state={state} engine={engine} variant={variant} />
      <output data-testid="search">{useLocation().search}</output>
    </>
  );
}

function renderControls(props: Parameters<typeof ScopeHarness>[0], url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ScopeHarness {...props} />
    </MemoryRouter>,
  );
}

describe("AnchoredScopeControls", () => {
  // With one version and no wideners there is no real choice, so the row is
  // omitted entirely — the common case for a single-version, engineless,
  // single-variant case.
  it("renders nothing when there is no choice to offer", () => {
    renderControls({ anchor: { version: "v1.0.0", versions: ["v1.0.0"] } });
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  // The segments name concrete cohorts of the anchor rather than abstract ones,
  // and the default minor line reads as selected.
  it("labels the version segments with the anchor's concrete cohorts", () => {
    renderControls({ anchor: { version: ANCHOR, versions: VERSIONS } });
    const group = screen.getByRole("radiogroup", { name: "Version scope" });
    expect(group).toBeInTheDocument();
    expect(
      screen.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["v2.1.0", "v2.1.x", "v2.x", "All versions"]);
    expect(screen.getByRole("radio", { name: "v2.1.x" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("offers only the anchor and `all` segments for an unparsable anchor", () => {
    renderControls({
      anchor: { version: "draft", versions: ["draft", "v1.0.0"] },
    });
    expect(
      screen.getAllByRole("radio").map((radio) => radio.textContent),
    ).toEqual(["draft", "All versions"]);
  });

  // The wideners render only when passed, labeled by the anchored engine and
  // variant, and each writes its widening to the URL.
  it("widens the engine and variant scopes through the URL", () => {
    renderControls({
      anchor: { version: ANCHOR, versions: VERSIONS },
      engine: { name: "Simple 2D" },
      variant: { name: "Base" },
    });
    expect(
      screen.getByRole("radiogroup", { name: "Engine scope" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Variant scope" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Simple 2D" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: "All engines" }));
    expect(screen.getByTestId("search")).toHaveTextContent("?engines=all");

    fireEvent.click(screen.getByRole("radio", { name: "All variants" }));
    expect(screen.getByTestId("search")).toHaveTextContent(
      "?engines=all&variants=all",
    );
  });

  it("keeps the wideners off the row when the tab does not pass them", () => {
    renderControls({ anchor: { version: ANCHOR, versions: VERSIONS } });
    expect(
      screen.queryByRole("radiogroup", { name: "Engine scope" }),
    ).toBeNull();
    expect(
      screen.queryByRole("radiogroup", { name: "Variant scope" }),
    ).toBeNull();
  });
});
