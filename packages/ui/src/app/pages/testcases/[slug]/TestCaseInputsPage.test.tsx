import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { CaseVariantRef } from "../../../data/galleryContext";
import type { TestCaseDetail, VariantSummary } from "../../../data/testCases";
import { routePatterns, routes } from "../../../routes";
import { TestCaseInputsPage } from "./TestCaseInputsPage";

// The detail layout's chrome pulls in PageLayout (backdrop/prompt contexts) that
// are irrelevant here; stub it to a bare wrapper.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const catalog = vi.fn<() => { testCases: TestCaseDetail[]; status: string }>();
// The layout resolves the case it is about through `useTestCase` (a per-slug
// fetch), so the stub answers from the fixture catalog each test seeds — the same
// lookup the real hook performs against the host.
vi.mock("../../../data/useTestCase", () => ({
  useTestCase: (slug: string | undefined) => {
    const { testCases, status } = catalog();
    return { testCase: testCases.find((c) => c.slug === slug), status };
  },
}));

// The variants a host holds, keyed exactly as the tab asks for them. Anything
// absent resolves null, which is how a version that predates a variant behaves.
const VARIANTS = new Set([
  "carom@v2.0.0/base/none",
  "carom@v2.0.0/base/simple-2d",
  "carom@v1.0.0/base/none",
  "coil@v1.0.0/base/none",
]);

// A host resolver of stable identity — the resolution cache keys on it, and a new
// function each render would restart the fetch forever. Each rendering answers
// with a seeded file named after the coordinates it was asked for, so a test can
// tell which of them the tab actually resolved from the accordion alone.
const fetchCaseVariant = vi.fn(async (ref: CaseVariantRef) => {
  const key = `${ref.slug}@${ref.version}/${ref.variant}/${ref.engine}`;
  if (!VARIANTS.has(key)) return null;
  return {
    slug: ref.variant,
    name: "Base",
    description: null,
    prompt: "Build the thing.",
    seededInputs: [
      { path: `${ref.version}/${ref.engine}/specification.md`, kind: "text" },
    ],
    packages: [],
    referenceScreenshots: [],
    reviewItems: [],
    domains: [],
    validatorRated: false,
    referenceBuilds: {},
    referenceSheet: null,
  } as VariantSummary;
});
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => ({
    canExecute: false,
    arena: undefined,
    fetchCaseVariant,
  }),
}));

function testCase(extra: Partial<TestCaseDetail> = {}): TestCaseDetail {
  return {
    slug: "carom",
    name: "Carom",
    testType: "end-to-end",
    difficulty: "easy",
    tags: [],
    summary: null,
    description: null,
    versions: ["v2.0.0", "v1.0.0"],
    latestVersion: "v2.0.0",
    enginesByVersion: {
      "v2.0.0": ["none", "simple-2d"],
      "v1.0.0": ["none"],
    },
    // The frame the header's selectors are built from: every version's variant
    // identities. Both versions declare the one Base variant, so the version
    // switch below re-resolves the same variant rather than dropping it.
    variantsByVersion: {
      "v2.0.0": [{ slug: "base", name: "Base" }],
      "v1.0.0": [{ slug: "base", name: "Base" }],
    },
    variants: [{ slug: "base", name: "Base", referenceBuilds: {} }],
    changelog: [],
    errata: [],
    ...extra,
  } as TestCaseDetail;
}

function renderInputs(slug = "carom") {
  return render(
    <MemoryRouter initialEntries={[routes.testCaseInputs(slug)]}>
      <Routes>
        <Route
          path={routePatterns.testCaseInputs}
          element={<TestCaseInputsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCaseInputsPage", () => {
  // Nothing selected means the case's newest version rendered engineless — the
  // deliverable as it stands, which is what a reader browsing the catalog wants.
  it("shows the latest version rendered engineless by default", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    renderInputs();

    expect(
      await screen.findByText("v2.0.0/none/specification.md"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Version")).toHaveValue("v2.0.0");
    expect(screen.getByLabelText("Engine")).toHaveValue("none");
  });

  // The engine branch of the templates is a whole set of inputs the engineless
  // rendering does not show, so selecting one has to re-resolve rather than
  // re-render the same text.
  it("resolves the engine's rendering when one is selected", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    renderInputs();
    await screen.findByText("v2.0.0/none/specification.md");

    fireEvent.change(screen.getByLabelText("Engine"), {
      target: { value: "simple-2d" },
    });

    expect(
      await screen.findByText("v2.0.0/simple-2d/specification.md"),
    ).toBeInTheDocument();
  });

  // A version offers its own engines, so moving to one that supports fewer must
  // both re-resolve and stop offering the engine it has no rendering for.
  it("re-resolves against an older version and offers only its engines", async () => {
    catalog.mockReturnValue({ testCases: [testCase()], status: "ready" });
    renderInputs();
    await screen.findByText("v2.0.0/none/specification.md");
    fireEvent.change(screen.getByLabelText("Engine"), {
      target: { value: "simple-2d" },
    });
    await screen.findByText("v2.0.0/simple-2d/specification.md");

    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "v1.0.0" },
    });

    expect(
      await screen.findByText("v1.0.0/none/specification.md"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Engine")).toBeNull();
  });

  // A case with one version and one engine has exactly one set of inputs; a
  // picker that cannot be changed would say nothing the page does not show.
  it("offers no pickers for a case with a single rendering", async () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({
          slug: "coil",
          name: "Coil",
          versions: ["v1.0.0"],
          latestVersion: "v1.0.0",
          enginesByVersion: { "v1.0.0": ["none"] },
        }),
      ],
      status: "ready",
    });
    renderInputs("coil");

    expect(
      await screen.findByText("v1.0.0/none/specification.md"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Version")).toBeNull();
    expect(screen.queryByLabelText("Engine")).toBeNull();
  });

  // A coordinate the host resolves null for — a static snapshot without that
  // rendering, or a failed fetch — surfaces the layout's "cannot show" panel
  // rather than an empty input list, which would read as "this run was given
  // nothing". The header stays so the visitor can select their way back out.
  it("shows the layout's cannot-show panel when the host resolves null", async () => {
    catalog.mockReturnValue({
      testCases: [
        testCase({
          slug: "wireworm",
          name: "Wireworm",
          versions: ["v1.0.0"],
          latestVersion: "v1.0.0",
          enginesByVersion: { "v1.0.0": ["none"] },
        }),
      ],
      status: "ready",
    });
    renderInputs("wireworm");

    expect(
      await screen.findByText("This host cannot show Base at v1.0.0 on None."),
    ).toBeInTheDocument();
    // The version badge (a single-version case renders no select) stays in the
    // header above the panel.
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });
});
