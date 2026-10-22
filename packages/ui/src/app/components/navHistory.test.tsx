import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  Link,
  MemoryRouter,
  NavigationType,
  RouterProvider,
  createBrowserRouter,
  useLocation,
  useNavigate,
} from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { BackChevron, BackLink } from "./BackChevron";
import {
  NavHistoryProvider,
  advanceHistory,
  withinScope,
  type HistoryEntry,
} from "./navHistory";

function entry(key: string, href: string): HistoryEntry {
  return { key, pathname: href.split(/[?#]/, 1)[0]!, href, idx: null };
}

describe("advanceHistory", () => {
  it("appends a push after the current entry, dropping what was ahead of it", () => {
    let h = advanceHistory(null, NavigationType.Pop, entry("a", "/a"));
    h = advanceHistory(h, NavigationType.Push, entry("b", "/b"));
    h = advanceHistory(h, NavigationType.Push, entry("c", "/c"));
    h = advanceHistory(h, NavigationType.Pop, entry("a", "/a"));
    h = advanceHistory(h, NavigationType.Push, entry("d", "/d"));
    expect(h.entries.map((e) => e.key)).toEqual(["a", "d"]);
    expect(h.index).toBe(1);
  });

  it("swaps the current entry on a replace", () => {
    let h = advanceHistory(null, NavigationType.Pop, entry("a", "/a"));
    h = advanceHistory(h, NavigationType.Push, entry("b", "/b"));
    h = advanceHistory(h, NavigationType.Replace, entry("c", "/c"));
    expect(h.entries.map((e) => e.key)).toEqual(["a", "c"]);
    expect(h.index).toBe(1);
  });

  it("moves to the popped entry, keeping what lies ahead for a forward", () => {
    let h = advanceHistory(null, NavigationType.Pop, entry("a", "/a"));
    h = advanceHistory(h, NavigationType.Push, entry("b", "/b"));
    h = advanceHistory(h, NavigationType.Push, entry("c", "/c"));
    h = advanceHistory(h, NavigationType.Pop, entry("a", "/a"));
    expect(h.index).toBe(0);
    expect(h.entries).toHaveLength(3);
  });

  it("starts afresh on a pop to an entry it never saw", () => {
    let h = advanceHistory(null, NavigationType.Pop, entry("a", "/a"));
    h = advanceHistory(h, NavigationType.Push, entry("b", "/b"));
    h = advanceHistory(h, NavigationType.Pop, entry("z", "/z"));
    expect(h).toEqual({ entries: [entry("z", "/z")], index: 0 });
  });

  it("leaves the record alone for a navigation it already holds (a reload)", () => {
    let h = advanceHistory(null, NavigationType.Pop, entry("a", "/a"));
    h = advanceHistory(h, NavigationType.Push, entry("b", "/b"));
    expect(advanceHistory(h, NavigationType.Pop, entry("b", "/b"))).toBe(h);
    expect(advanceHistory(h, NavigationType.Push, entry("b", "/b"))).toBe(h);
  });
});

describe("withinScope", () => {
  it("matches the scope and the routes beneath it, on a segment boundary", () => {
    expect(withinScope("/runs/abc", "/runs/abc")).toBe(true);
    expect(withinScope("/runs/abc/logs", "/runs/abc")).toBe(true);
    expect(withinScope("/runs/abcd", "/runs/abc")).toBe(false);
    expect(withinScope("/runs", "/runs/abc")).toBe(false);
    expect(withinScope("/models/new", "/models/new?fromRun=r1")).toBe(true);
    // A model opened by an alias answers to both its alias and its slug.
    expect(
      withinScope("/models/slug/stats", ["/models/slug", "/models/alias"]),
    ).toBe(true);
    expect(
      withinScope("/models/alias", ["/models/slug", "/models/alias"]),
    ).toBe(true);
  });
});

// A stand-in app: every page is a pair of links plus, on a detail page, its back
// control, scoped as the real detail layouts scope theirs.
function Page() {
  const { pathname, search } = useLocation();
  const run = /^\/runs\/([^/]+)/.exec(pathname)?.[1];
  const testCase = /^\/test-cases\/([^/]+)/.exec(pathname)?.[1];
  return (
    <>
      <p data-testid="at">{`${pathname}${search}`}</p>
      {run && (
        <BackChevron scope={`/runs/${run}`} fallback="/runs" label="All runs" />
      )}
      {!run && testCase && !["2d", "end-to-end"].includes(testCase) && (
        <BackChevron
          scope={`/test-cases/${testCase}`}
          fallback="/test-cases/end-to-end"
          label="All test cases"
        />
      )}
      <Link to="/runs/abc">open run abc</Link>
      <Link to="/runs/abc/logs">run logs tab</Link>
      <Link to="/test-cases/pong">open pong</Link>
      <Link to="/test-cases/pong/runs">pong runs tab</Link>
      {run && (
        <BackLink scope={`/runs/${run}/reviews`} fallback={`/runs/${run}`}>
          Results
        </BackLink>
      )}
    </>
  );
}

function renderAt(...initialEntries: string[]) {
  return render(
    <MemoryRouter
      initialEntries={initialEntries}
      initialIndex={initialEntries.length - 1}
    >
      <NavHistoryProvider>
        <Page />
      </NavHistoryProvider>
    </MemoryRouter>,
  );
}

const at = () => screen.getByTestId("at").textContent;
const click = (name: string) =>
  fireEvent.click(screen.getByRole("link", { name }));

describe("a back control", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("returns from a run to the test case's Runs tab it was opened from", async () => {
    renderAt("/test-cases/end-to-end");
    click("open pong");
    click("pong runs tab");
    click("open run abc");
    expect(at()).toBe("/runs/abc");
    const back = screen.getByRole("link", { name: "Back" });
    expect(back.getAttribute("href")).toBe("/test-cases/pong/runs");
    fireEvent.click(back);
    await waitFor(() => expect(at()).toBe("/test-cases/pong/runs"));
  });

  it("skips the page's own tabs", async () => {
    renderAt("/test-cases/pong/runs");
    click("open run abc");
    click("run logs tab");
    expect(at()).toBe("/runs/abc/logs");
    click("Back");
    await waitFor(() => expect(at()).toBe("/test-cases/pong/runs"));
  });

  it("walks the trail back step by step instead of ping-ponging", async () => {
    renderAt("/test-cases/end-to-end");
    click("open pong");
    click("open run abc");
    click("Back");
    await waitFor(() => expect(at()).toBe("/test-cases/pong"));
    // The case's own back control now returns to where the case was opened from,
    // not to the run just left.
    expect(
      screen.getByRole("link", { name: "Back" }).getAttribute("href"),
    ).toBe("/test-cases/end-to-end");
    click("Back");
    await waitFor(() => expect(at()).toBe("/test-cases/end-to-end"));
  });

  it("falls back to the named parent on a deep link with nothing behind it", () => {
    renderAt("/runs/abc");
    const back = screen.getByRole("link", { name: "All runs" });
    expect(back.getAttribute("href")).toBe("/runs");
    fireEvent.click(back);
    expect(at()).toBe("/runs");
  });

  it("leaves a modified click to the link's own href", () => {
    renderAt("/test-cases/pong/runs");
    click("open run abc");
    // Stands in for the browser opening the href in a new tab, which jsdom cannot;
    // registered on the document so it runs after the app's own handlers.
    const browser = (e: Event) => e.preventDefault();
    document.addEventListener("click", browser);
    try {
      fireEvent.click(screen.getByRole("link", { name: "Back" }), {
        ctrlKey: true,
      });
    } finally {
      document.removeEventListener("click", browser);
    }
    expect(at()).toBe("/runs/abc");
  });

  it("works for a text back link the same way", async () => {
    renderAt("/test-cases/pong");
    click("open run abc");
    // The page is a review-scoped link here only to exercise BackLink; from the run
    // the previous page is the case.
    const back = screen.getByRole("link", { name: "← Back" });
    expect(back.getAttribute("href")).toBe("/test-cases/pong");
    fireEvent.click(back);
    await waitFor(() => expect(at()).toBe("/test-cases/pong"));
  });

  it("names its fallback when there is no history (text link)", () => {
    renderAt("/runs/abc");
    expect(
      screen.getByRole("link", { name: "← Results" }).getAttribute("href"),
    ).toBe("/runs/abc");
  });
});

// Under a browser router two navigations in one handler can render once, leaving the
// record one entry short of the browser's history; the step must still land on the
// page the control points at.
describe("a back control under a browser router", () => {
  function TwoStep() {
    const navigate = useNavigate();
    return (
      <>
        <p data-testid="at">{useLocation().pathname}</p>
        <button
          type="button"
          onClick={() => {
            void navigate("/c");
            void navigate("/d");
          }}
        >
          two steps
        </button>
        <BackChevron scope="/d" fallback="/" label="Home" />
        <Link to="/b">to b</Link>
      </>
    );
  }

  it("lands on the entry it names after a skipped render", async () => {
    window.history.replaceState(null, "", "/a");
    const wrapped = createBrowserRouter([
      {
        path: "*",
        element: (
          <NavHistoryProvider>
            <TwoStep />
          </NavHistoryProvider>
        ),
      },
    ]);
    render(<RouterProvider router={wrapped} />);
    click("to b");
    await waitFor(() => expect(at()).toBe("/b"));
    fireEvent.click(screen.getByRole("button", { name: "two steps" }));
    await waitFor(() => expect(at()).toBe("/d"));
    // The record saw /a, /b and /d; the browser holds /c between /b and /d too.
    const back = screen.getByRole("link", { name: "Back" });
    expect(back.getAttribute("href")).toBe("/b");
    fireEvent.click(back);
    await waitFor(() => expect(at()).toBe("/b"));
    wrapped.dispose();
  });
});
