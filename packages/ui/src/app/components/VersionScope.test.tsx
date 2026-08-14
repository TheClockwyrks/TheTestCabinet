import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TestCaseSummary } from "../data/testCases";
import {
  useVersionPick,
  useVersionScope,
  versionInScope,
  VersionPicker,
  type VersionPickState,
} from "./VersionScope";

// A case summary carrying only the version fields the hooks read.
function testCase(versions: string[]): TestCaseSummary {
  return {
    versions,
    latestVersion: versions[0],
  } as unknown as TestCaseSummary;
}

// The case's latest version every scope but `specific` measures against.
const LATEST = "v2.1.0";

describe("versionInScope", () => {
  it("keeps every version under the `all` scope", () => {
    for (const version of ["v1.0.0", "v2.0.3", LATEST, "nonsense"]) {
      expect(versionInScope(version, "all", LATEST, "v1.0.0")).toBe(true);
    }
  });

  it("keeps only the picked version under the `specific` scope", () => {
    expect(versionInScope("v1.4.0", "specific", LATEST, "v1.4.0")).toBe(true);
    expect(versionInScope("v1.4.1", "specific", LATEST, "v1.4.0")).toBe(false);
    // The picked version wins over the latest — `specific` never consults it.
    expect(versionInScope(LATEST, "specific", LATEST, "v1.4.0")).toBe(false);
  });

  it("keeps the latest major under the `major` scope, any minor", () => {
    expect(versionInScope("v2.0.0", "major", LATEST, LATEST)).toBe(true);
    expect(versionInScope("v2.9.7", "major", LATEST, LATEST)).toBe(true);
    expect(versionInScope("v1.9.9", "major", LATEST, LATEST)).toBe(false);
  });

  it("keeps the latest major AND minor under the `current` scope", () => {
    // The revision may differ — a revision is a fix, not a new task.
    expect(versionInScope("v2.1.4", "current", LATEST, LATEST)).toBe(true);
    expect(versionInScope("v2.0.0", "current", LATEST, LATEST)).toBe(false);
    expect(versionInScope("v1.1.0", "current", LATEST, LATEST)).toBe(false);
  });

  // A malformed version has no comparable parts, so it falls back to an exact
  // string match: it matches only when it IS the latest, never a whole cohort.
  it("falls back to an exact match when a version does not parse", () => {
    expect(versionInScope("draft", "current", LATEST, LATEST)).toBe(false);
    expect(versionInScope("draft", "major", LATEST, LATEST)).toBe(false);
    expect(versionInScope("draft", "current", "draft", "draft")).toBe(true);
  });
});

describe("useVersionScope", () => {
  it("defaults to the current scope and hides the control for one version", () => {
    const { result } = renderHook(() => useVersionScope(testCase(["v1.0.0"])));
    expect(result.current.scope).toBe("current");
    expect(result.current.show).toBe(false);
    // The lone version is still in scope — a hidden control filters nothing away.
    expect(result.current.inScope("v1.0.0")).toBe(true);
  });

  it("applies the picked version once the specific scope is selected", () => {
    const { result } = renderHook(() =>
      useVersionScope(testCase(["v2.0.0", "v1.0.0"])),
    );
    expect(result.current.show).toBe(true);
    act(() => result.current.setScope("specific"));
    act(() => result.current.setSpecificVersion("v1.0.0"));
    expect(result.current.inScope("v1.0.0")).toBe(true);
    expect(result.current.inScope("v2.0.0")).toBe(false);
  });

  it("falls back to the latest when the picked version leaves the case", () => {
    const { result, rerender } = renderHook(
      (props: { versions: string[] }) =>
        useVersionScope(testCase(props.versions)),
      { initialProps: { versions: ["v2.0.0", "v1.0.0"] } },
    );
    act(() => result.current.setSpecificVersion("v1.0.0"));
    expect(result.current.specificVersion).toBe("v1.0.0");
    // Another case's versions arrive without the hook remounting.
    rerender({ versions: ["v9.0.0", "v8.0.0"] });
    expect(result.current.specificVersion).toBe("v9.0.0");
  });
});

describe("useVersionPick", () => {
  it("defaults to the latest version and hides the picker for one version", () => {
    const { result } = renderHook(() => useVersionPick(testCase(["v1.0.0"])));
    expect(result.current.version).toBe("v1.0.0");
    expect(result.current.show).toBe(false);
  });

  it("selects an older version", () => {
    const { result } = renderHook(() =>
      useVersionPick(testCase(["v2.0.0", "v1.0.0"])),
    );
    expect(result.current.show).toBe(true);
    act(() => result.current.setVersion("v1.0.0"));
    expect(result.current.version).toBe("v1.0.0");
  });

  it("falls back to the latest when the picked version leaves the case", () => {
    const { result, rerender } = renderHook(
      (props: { versions: string[] }) =>
        useVersionPick(testCase(props.versions)),
      { initialProps: { versions: ["v2.0.0", "v1.0.0"] } },
    );
    act(() => result.current.setVersion("v1.0.0"));
    rerender({ versions: ["v9.0.0", "v8.0.0"] });
    expect(result.current.version).toBe("v9.0.0");
  });
});

describe("VersionPicker", () => {
  // The picker's state, as the hook would hand it over. The non-empty tuple
  // makes the latest (first) version a defined string, as the hook guarantees.
  function pickState(
    versions: [string, ...string[]],
    setVersion = vi.fn(),
  ): VersionPickState {
    return {
      version: versions[0],
      setVersion,
      versions,
      show: versions.length > 1,
    };
  }

  it("renders a labelled option per version", () => {
    render(<VersionPicker state={pickState(["v2.0.0", "v1.0.0"])} />);
    const select = screen.getByLabelText("Version");
    expect(
      [...select.querySelectorAll("option")].map((o) => o.textContent),
    ).toEqual(["v2.0.0", "v1.0.0"]);
    expect(select).toHaveValue("v2.0.0");
  });

  it("reports the newly selected version", () => {
    const setVersion = vi.fn();
    render(
      <VersionPicker state={pickState(["v2.0.0", "v1.0.0"], setVersion)} />,
    );
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "v1.0.0" },
    });
    expect(setVersion).toHaveBeenCalledWith("v1.0.0");
  });

  it("renders nothing for a case with a single version", () => {
    const { container } = render(
      <VersionPicker state={pickState(["v1.0.0"])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
