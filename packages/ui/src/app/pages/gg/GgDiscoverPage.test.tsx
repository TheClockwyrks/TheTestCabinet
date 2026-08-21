// Discover, end to end: the URL, the range, and the request that goes out.
//
// The state model is the thing worth pinning. The **URL carries the query as text**, never
// its compiled form — that is what keeps `now-30d` relative, so a link shared on Monday
// still means "the last thirty days" when it is opened on Friday — while the **compiled**
// query is derived and sent, so the backend needs no parser and no clock.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgQuery, GgRunDoc } from "@test-cabinet/run-record/gg-query";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { GgDiscoverPage } from "./GgDiscoverPage";

// The app chrome reads contexts irrelevant to the surface under test.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  // The header's chrome is not what these tests are about; its slots are, because a
  // page's own actions live in them. Stub the chrome and pass the slots through, so a
  // control that moves into the header does not silently vanish from the test.
  PromptHeader: ({
    titleActions,
    actions,
  }: {
    titleActions?: ReactNode;
    actions?: ReactNode;
  }) => (
    <>
      {titleActions}
      {actions}
    </>
  ),
}));
vi.mock("../../../client/auth", () => ({ useAuth: () => ({ token: "t0" }) }));

const runGgQuery = vi.fn();
const getGgFields = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { runGgQuery, getGgFields },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

/** The minimum gallery data the page's chrome and its source hook read. `ggData` is the
 *  static site's shipped corpus; a console leaves it absent. */
function galleryValue(ggData?: GalleryDataInput["ggData"]): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: false,
    ggData,
  } as unknown as GalleryDataInput;
}

/** Reports the current location, so a redirect can be asserted on. */
function Where() {
  const location = useLocation();
  return (
    <output data-testid="where">{`${location.pathname}${location.search}`}</output>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GalleryDataProvider value={galleryValue()}>
        <BackendProvider value={backendValue()}>
          <Where />
          <Routes>
            <Route path="/gg/query" element={<GgDiscoverPage />} />
          </Routes>
        </BackendProvider>
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

/** One shipped document, as the snapshot's `gg-runs.json` carries it. */
function doc(fields: Record<string, string | number | boolean>): GgRunDoc {
  return { fields } as GgRunDoc;
}

/**
 * Render Discover as the **public static site** does: no backend at all, the corpus
 * shipped in the gallery data, and every query answered by the mirrored evaluator in the
 * browser.
 */
function renderStatic(
  path: string,
  documents: GgRunDoc[],
  generatedAt: string,
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GalleryDataProvider value={galleryValue({ generatedAt, documents })}>
        <Where />
        <Routes>
          <Route path="/gg/query" element={<GgDiscoverPage />} />
        </Routes>
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

/** The last query the page compiled and sent. */
function lastQuery(): GgQuery {
  const call = runGgQuery.mock.calls[runGgQuery.mock.calls.length - 1];
  return call?.[0] as GgQuery;
}

const where = () => screen.getByTestId("where").textContent ?? "";

describe("GgDiscoverPage", () => {
  beforeEach(() => {
    runGgQuery.mockReset();
    getGgFields.mockReset();
    runGgQuery.mockResolvedValue({
      totalRuns: 0,
      documents: [],
      truncated: false,
    });
    getGgFields.mockResolvedValue({ documents: 0, fields: [] });
  });

  it("compiles the URL's text and sends the compiled form", async () => {
    renderAt(
      "/gg/query?q=" + encodeURIComponent("state:hung or state:timed_out"),
    );
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    // The wire form is the tree, not the text — the server never parses.
    expect(lastQuery().filter).toEqual({
      kind: "or",
      clauses: [
        { kind: "compare", field: "state", op: "eq", value: "hung" },
        { kind: "compare", field: "state", op: "eq", value: "timed_out" },
      ],
    });
  });

  it("scopes the query with the range, without putting it in the text", async () => {
    renderAt("/gg/query?q=" + encodeURIComponent("state:hung") + "&range=24h");
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    const filter = lastQuery().filter;
    expect(filter?.kind).toBe("and");
    const clauses = filter?.kind === "and" ? filter.clauses : [];
    // Resolved to absolute milliseconds here, so the backend needs no clock of its own.
    expect(clauses[0]).toMatchObject({ kind: "range", field: "started" });
    expect(typeof (clauses[0] as { from?: number }).from).toBe("number");
    expect(clauses[1]).toEqual({
      kind: "compare",
      field: "state",
      op: "eq",
      value: "hung",
    });
  });

  it("sends the range alone when the query is empty", async () => {
    renderAt("/gg/query?range=7d");
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    expect(lastQuery().filter).toMatchObject({
      kind: "range",
      field: "started",
    });
  });

  it("puts a submitted query in the URL, as text", async () => {
    renderAt("/gg/query");
    await waitFor(() => expect(runGgQuery).toHaveBeenCalled());
    const box = screen.getByRole("combobox", { name: "Query" });
    fireEvent.change(box, { target: { value: "state:hung" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(where()).toContain("q=state%3Ahung"));
  });

  it("renders the aggregated shape when the response carries columns", async () => {
    runGgQuery.mockResolvedValue({
      totalRuns: 3,
      buckets: [
        {
          key: [{ field: "preset", value: "planning" }],
          n: 3,
          values: [{ name: "count()", value: 3, contributing: 3 }],
        },
      ],
      columns: [{ name: "count()", func: "count" }],
      truncated: false,
    });
    renderAt("/gg/query?q=" + encodeURIComponent("| stats count() by preset"));
    await waitFor(() =>
      expect(
        screen.getByRole("cell", { name: "planning" }),
      ).toBeInTheDocument(),
    );
    // The matched-run count is the denominator every figure on the page is read against,
    // so it is stated whatever shape the result came back in.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          (element.textContent ?? "").startsWith("3 runs matched"),
      ),
    ).toBeInTheDocument();
  });
});

describe("Discover on the public static site", () => {
  const CORPUS: GgRunDoc[] = [
    doc({
      id: "run-a",
      case: "pong",
      model: "anthropic/claude-a",
      state: "completed",
      finished: 1_800_000_000_000,
      "code.language": "typescript",
    }),
    doc({
      id: "run-b",
      case: "pong",
      model: "openai/gpt-b",
      state: "hung",
      finished: 1_700_000_000_000,
      "code.language": "rust",
    }),
  ];

  it("answers from the shipped corpus and makes no backend call", async () => {
    // The property the whole public surface rests on: **zero** requests. The mirrored
    // evaluator runs the same compiled query in the browser that the backend would have
    // run in Rust, so the site needs no query endpoint and no backend at all.
    runGgQuery.mockReset();
    getGgFields.mockReset();

    renderStatic("/gg/query", CORPUS, "2026-07-30T09:00:00Z");

    await waitFor(() => expect(screen.getByTitle("run-a")).toBeInTheDocument());
    expect(runGgQuery).not.toHaveBeenCalled();
    expect(getGgFields).not.toHaveBeenCalled();
  });

  it("prints run ids without linking them, because most have no public page", async () => {
    // The corpus is decoupled from publication — it holds every recorded gg run while the
    // public gallery holds only the published ones — so a table of links would mostly be
    // a table of 404s.
    renderStatic("/gg/query", CORPUS, "2026-07-30T09:00:00Z");
    await waitFor(() => expect(screen.getByTitle("run-a")).toBeInTheDocument());
    expect(
      screen.queryByRole("link", { name: /run-a/ }),
    ).not.toBeInTheDocument();
  });

  it("filters and aggregates locally with the same semantics", async () => {
    // Not a smoke test of "something rendered": the query is compiled from the URL and
    // evaluated against the corpus, so a divergence in the browser evaluator shows up
    // here as a wrong count rather than as an empty page.
    renderStatic(
      "/gg/query?q=" + encodeURIComponent("state:hung"),
      CORPUS,
      "2026-07-30T09:00:00Z",
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          (_, element) =>
            element?.tagName === "P" &&
            (element.textContent ?? "").startsWith("1 run matched"),
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders the snapshot's build time beside the figures", async () => {
    // The public corpus is a build-time export and legitimately lags the console's, so
    // every figure it produces is labelled with the instant it was true. Without that,
    // "the site disagrees with the console" is unanswerable.
    renderStatic("/gg/query", CORPUS, "2026-07-30T09:00:00Z");
    await waitFor(() =>
      expect(
        screen.getByText(
          (_, element) =>
            element?.tagName === "P" &&
            (element.textContent ?? "").includes("as of"),
        ),
      ).toBeInTheDocument(),
    );
  });

  it("offers no save affordance, because there is no account to save under", async () => {
    renderStatic("/gg/query", CORPUS, "2026-07-30T09:00:00Z");
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Query" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("link", { name: "Save this query" }),
    ).not.toBeInTheDocument();
  });

  it("builds the field catalog from the corpus, so the sidebar still works", async () => {
    // The catalog is the *second* mirrored function. A field the corpus carries has to
    // be offered here exactly as `GET /gg/fields` would offer it on a console — including
    // the `code.*` namespace this milestone made publishable.
    renderStatic("/gg/query", CORPUS, "2026-07-30T09:00:00Z");
    await waitFor(() =>
      expect(screen.getByText("code.language")).toBeInTheDocument(),
    );
  });
});
