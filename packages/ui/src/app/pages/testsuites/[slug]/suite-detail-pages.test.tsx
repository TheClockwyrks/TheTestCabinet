import type {
  SuiteOut,
  SuiteVersionResponse,
} from "@clockwyrks/run-record/backend-api";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuiteAssetsPage } from "./suite-assets-page";
import { SuiteChangelogPage } from "./suite-changelog-page";
import { SuiteDefinitionsPage } from "./suite-definitions-page";
import { SuiteOverviewPage } from "./suite-overview-page";
import { SuiteReferencesPage } from "./suite-references-page";
import { SuiteSpecificationsPage } from "./suite-specifications-page";
import { routePatterns, routes } from "../../../routes";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper, exactly as the case detail
// tabs' tests do.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

// The two reads the layout stands on: the LISTING, which says which suites and
// versions exist, and the per-version RECORD the tabs render from. Both are
// stubbed so each test seeds an exact host.
const listing =
  vi.fn<() => { suites: SuiteOut[]; status: string; error: string | null }>();
const record = vi.fn<
  () => {
    suite: SuiteVersionResponse | undefined;
    status: string;
    error: string | null;
  }
>();
vi.mock("../../../data/use-test-suites", () => ({
  useTestSuites: () => listing(),
  useTestSuiteVersion: (
    slug: string | undefined,
    version: string | undefined,
  ) =>
    slug === undefined || version === undefined
      ? { suite: undefined, status: "loading", error: null }
      : record(),
}));
const galleryData = vi.fn<() => unknown>();
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => galleryData(),
}));

const SLUG = "carom-suite";

function suiteListing(): SuiteOut[] {
  return [
    {
      slug: SLUG,
      // Oldest first, the order the backend serves.
      versions: [
        {
          version: "v1.0.0",
          name: "Carom Suite",
          summary: "An older cut.",
          tags: [],
          experimental: false,
        },
        {
          version: "v2.0.0",
          name: "Carom Suite",
          summary: "A duel of angles.",
          tags: ["arcade"],
          experimental: false,
        },
      ],
    },
  ];
}

function storedSuite(version = "v2.0.0"): SuiteVersionResponse {
  return {
    slug: SLUG,
    version,
    digest: null,
    suite: {
      slug: SLUG,
      name: "Carom Suite",
    },
    manifest: {
      version: version.replace(/^v/, ""),
      tags: ["arcade"],
      summary: "A duel of angles.",
      description: "description.md",
      changelog: "changelog.md",
    },
    description: "The manifest prose.",
    changelog: "Changed everything.",
    specifications: [
      {
        dir: "specifications/ball-physics",
        manifest: {
          id: "ball-physics",
          name: "Ball Physics",
          summary: "How the ball moves.",
          path: "ball-physics.md",
          requirement: [
            {
              id: "constant-speed",
              kind: "functional",
              text: "The ball MUST travel at a constant speed.",
              validators: ["ball/constant-speed.ts"],
            },
          ],
        },
        prose: "The ball is a ball.",
      },
    ],
    testCases: [
      {
        slug: "end-to-end",
        id: "carom-suite-end-to-end",
        definition: {
          name: "Carom, end to end",
          type: "end-to-end",
          difficulty: "easy",
          engines: ["none", "simple-2d"],
          prompt: "prompts/end-to-end.hbs",
        },
      },
    ],
    assets: [
      {
        dir: "assets/player-ship",
        manifest: {
          id: "player-ship",
          name: "Player Ship",
          kind: "sprite",
          specification: "ball-physics",
          files: ["player-ship.png"],
        },
      },
    ],
    demos: [],
    referenceImplementations: ["none", "simple-2d"],
    referenceBuilds: {
      none: `https://backend.test/suites/${SLUG}/versions/${version}/reference-builds/none/`,
    },
    showcase: {
      manifest: { media: [{ file: "title.png", name: "Title screen" }] },
      description: "Store-page prose with ![Title](title.png).",
      media: ["title.png"],
    },
  };
}

function renderTab(
  pattern: string,
  path: string,
  element: ReactNode,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listing.mockReturnValue({
    suites: suiteListing(),
    status: "ready",
    error: null,
  });
  record.mockReturnValue({
    suite: storedSuite(),
    status: "ready",
    error: null,
  });
  galleryData.mockReturnValue({
    testCases: [{ slug: "carom-suite-end-to-end" }],
    testCasesStatus: "ready",
    suiteShowcaseMediaUrl: (slug: string, version: string, file: string) =>
      `https://backend.test/test-suites/${slug}/${version}/showcase/${file}`,
    suiteAssetMediaUrl: (
      slug: string,
      version: string,
      asset: string,
      file: string,
    ) =>
      `https://backend.test/test-suites/${slug}/${version}/assets/${asset}/${file}`,
  });
});

describe("the suite landing tab", () => {
  it("renders the showcase, its carousel and the manifest prose", () => {
    renderTab(
      routePatterns.testSuiteDetail,
      routes.testSuiteDetail(SLUG),
      <SuiteOverviewPage />,
    );

    // The showcase description, with its bare relative image reference resolved
    // to the suite's served showcase file.
    expect(screen.getByText(/Store-page prose/)).toBeInTheDocument();
    const inline = screen.getAllByRole("img", { name: "Title" })[0];
    expect(inline?.getAttribute("src")).toBe(
      `https://backend.test/test-suites/${SLUG}/v2.0.0/showcase/title.png`,
    );
    // The carousel stages the same file under its caption.
    expect(
      screen.getByRole("region", { name: "Showcase" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Title screen")).toBeInTheDocument();
    // And the manifest's own prose sits below them.
    expect(screen.getByText("The manifest prose.")).toBeInTheDocument();
  });

  it("anchors every tab on the version in the query string", () => {
    renderTab(
      routePatterns.testSuiteDetail,
      routes.testSuiteDetail(SLUG, "v1.0.0"),
      <SuiteOverviewPage />,
    );

    expect(record).toHaveBeenCalled();
    // The version selector shows the anchored version, and each tab link carries
    // the query string that anchors it.
    const selector = screen.getByRole("combobox");
    expect(selector.value).toBe("v1.0.0");
    const assets = screen.getByRole("link", { name: "Assets" });
    expect(assets).toHaveAttribute(
      "href",
      "/test-cases/suites/carom-suite/assets?version=v1.0.0",
    );

    // Selecting the newest version drops the parameter, so the ordinary URL is
    // the unqualified suite.
    fireEvent.change(selector, { target: { value: "v2.0.0" } });
    expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute(
      "href",
      "/test-cases/suites/carom-suite/assets",
    );
  });

  it("reports an unknown slug and an unknown version as not found", () => {
    renderTab(
      routePatterns.testSuiteDetail,
      routes.testSuiteDetail("nothing-here"),
      <SuiteOverviewPage />,
    );
    expect(screen.getByText(/No test suite found/)).toBeInTheDocument();

    renderTab(
      routePatterns.testSuiteDetail,
      routes.testSuiteDetail(SLUG, "v9.9.9"),
      <SuiteOverviewPage />,
    );
    expect(screen.getByText(/No version “v9.9.9”/)).toBeInTheDocument();
  });

  it("reports a failed listing read as a failure rather than an absence", () => {
    listing.mockReturnValue({
      suites: [],
      status: "error",
      error: "the backend said no",
    });
    renderTab(
      routePatterns.testSuiteDetail,
      routes.testSuiteDetail(SLUG),
      <SuiteOverviewPage />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not load/);
    expect(screen.queryByText(/No test suite found/)).not.toBeInTheDocument();
  });

  it("reports a failed version read as a failure of that version", () => {
    record.mockReturnValue({
      suite: undefined,
      status: "error",
      error: "the record did not arrive",
    });
    renderTab(
      routePatterns.testSuiteDetail,
      routes.testSuiteDetail(SLUG),
      <SuiteOverviewPage />,
    );
    // The header still resolved from the listing, so the failure is about the
    // version rather than about the suite.
    expect(
      screen.getByRole("heading", { name: "Carom Suite" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/v2\.0\.0/);
  });
});

describe("the entity tabs", () => {
  it("shows a requirement by the identity results record it under", () => {
    renderTab(
      routePatterns.testSuiteSpecifications,
      routes.testSuiteSpecifications(SLUG),
      <SuiteSpecificationsPage />,
    );
    fireEvent.click(screen.getByRole("button", { name: /ball-physics/ }));

    expect(screen.getByText("ball-physics/constant-speed")).toBeInTheDocument();
    expect(screen.getByText("functional")).toBeInTheDocument();
    expect(screen.getByText("ball/constant-speed.ts")).toBeInTheDocument();
  });

  it("expands a definition into what it grades and links to its test case", () => {
    renderTab(
      routePatterns.testSuiteDefinitions,
      routes.testSuiteDefinitions(SLUG),
      <SuiteDefinitionsPage />,
    );

    expect(screen.getByText("Carom, end to end")).toBeInTheDocument();
    // The definition omits `specifications`, which covers every one the version
    // declares — so its requirements are the ones shown.
    expect(screen.getByText("ball-physics/constant-speed")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "carom-suite-end-to-end" }),
    ).toHaveAttribute("href", "/test-cases/carom-suite-end-to-end");
  });

  it("says so when the definition's test case is absent from the catalog", () => {
    galleryData.mockReturnValue({ testCases: [], testCasesStatus: "ready" });
    renderTab(
      routePatterns.testSuiteDefinitions,
      routes.testSuiteDefinitions(SLUG),
      <SuiteDefinitionsPage />,
    );

    expect(
      screen.queryByRole("link", { name: "carom-suite-end-to-end" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/is not in this deployment's catalog/),
    ).toBeInTheDocument();
  });

  it("previews a sprite asset from the backend's suite asset route", () => {
    renderTab(
      routePatterns.testSuiteAssets,
      routes.testSuiteAssets(SLUG),
      <SuiteAssetsPage />,
    );

    expect(screen.getByText("Player Ship")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Player Ship" })).toHaveAttribute(
      "src",
      `https://backend.test/test-suites/${SLUG}/v2.0.0/assets/player-ship/player-ship.png`,
    );
  });

  it("plays an uploaded reference build and lists an engine without one", () => {
    renderTab(
      routePatterns.testSuiteReferences,
      routes.testSuiteReferences(SLUG),
      <SuiteReferencesPage />,
    );

    // The engine with an upload plays inline from the backend route.
    expect(screen.getByTitle(/^Reference implementation for /)).toHaveAttribute(
      "src",
      `https://backend.test/suites/${SLUG}/versions/v2.0.0/reference-builds/none/`,
    );
    expect(
      screen.getByRole("button", { name: "Play the None reference build" }),
    ).toHaveAttribute("aria-pressed", "true");
    // The engine without one is listed, with no play action.
    const simple = screen
      .getAllByRole("listitem")
      .find((entry) => within(entry).queryByText("simple-2d", { exact: true }));
    if (simple === undefined) throw new Error("no entry lists simple-2d");
    expect(within(simple).getByText("No build uploaded")).toBeInTheDocument();
    expect(within(simple).queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the anchored version's changelog", () => {
    renderTab(
      routePatterns.testSuiteChangelog,
      routes.testSuiteChangelog(SLUG),
      <SuiteChangelogPage />,
    );
    expect(screen.getByText("Changed everything.")).toBeInTheDocument();
  });
});
