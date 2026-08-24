// The frame both Reference tabs share.
//
// Three properties, and all three are about *what is fetched when* — none of them shows
// in the rendered output, which is why they are asserted on the client's call log.
//
// **Flipping tabs must not re-fetch the index.** The two tab URLs are two routes, and if
// they mounted two different component types React would unmount one subtree and mount the
// other on every click, taking the fetch with it — so a reader comparing a tool against
// its API counterpart would watch the document they were reading vanish behind a loading
// line each way.
//
// **The Tools tab must not fetch an arm.** The tools are the same in every language;
// pulling ninety kilobytes of one arm's signatures to read them would be paying for the
// half of the surface the reader is not on.
//
// **The arm must survive a tab flip.** The tab bar's own link carries no query, so without
// the page remembering the pick, a round trip through Tools would silently return a reader
// to whichever arm the index happens to list first.
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgProgramLanguage } from "@test-cabinet/run-record/gg";
import type {
  GgReference,
  GgReferenceApi,
} from "@test-cabinet/run-record/gg-reference";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import { GgReferencePage } from "./GgReferencePage";

vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
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

const INDEX: GgReference = {
  ggVersion: "9.9.9",
  categories: [
    {
      id: "gg-filesystem",
      title: "Filesystem",
      description: "Reading, writing and editing files in the workspace.",
    },
  ],
  tools: [
    {
      name: "read_file",
      category: "gg-filesystem",
      description: "Read a file and return its contents.",
      parameters: { type: "object", properties: {} },
      capabilities: ["filesystem"],
    },
  ],
  languages: [
    { id: "typescript", moduleCount: 1, functionCount: 1, typeCount: 0 },
    { id: "rust", moduleCount: 1, functionCount: 1, typeCount: 0 },
  ],
};

function arm(
  language: GgProgramLanguage,
  path: string,
  fqn: string,
): GgReferenceApi {
  return {
    ggVersion: "9.9.9",
    language,
    modules: [
      {
        id: "files",
        path,
        summary: "Read, write, edit and list the files of the workspace.",
        category: "gg-filesystem",
      },
    ],
    entries: [
      {
        kind: "function",
        fqn,
        name: "readFile",
        module: "files",
        category: "gg-filesystem",
        brief: "Read a file.",
        body: `${fqn}(path)\n\nRead a file and return its contents.`,
        operation: "files.read_file",
      },
    ],
  };
}

const ARMS: Record<string, GgReferenceApi> = {
  typescript: arm("typescript", "gg.files", "gg.files.readFile"),
  rust: arm("rust", "gg::files", "gg::files::read_file"),
};

const ggReference = vi.fn();
const ggReferenceApi = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { ggReference, ggReferenceApi },
  } as unknown as BackendContextValue;
}

// Both tab routes, mounted together, so a click on the tab bar really navigates rather
// than being swallowed by a router that knows only the route under test.
function renderSection(at = "/gg/reference/tools") {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route
            path="/gg/reference/tools"
            element={<GgReferencePage tab="tools" />}
          />
          <Route
            path="/gg/reference/api"
            element={<GgReferencePage tab="api" />}
          />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

async function clickTab(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("link", { name }));
  });
}

describe("GgReferencePage", () => {
  beforeEach(() => {
    ggReference.mockReset();
    ggReference.mockResolvedValue(INDEX);
    ggReferenceApi.mockReset();
    ggReferenceApi.mockImplementation((language: GgProgramLanguage) =>
      Promise.resolve(ARMS[language]),
    );
  });

  it("fetches the index once, however many times the tabs are flipped", async () => {
    renderSection();
    await screen.findByRole("heading", { name: "read_file" });
    expect(ggReference).toHaveBeenCalledTimes(1);
    // And no arm at all while the tools — which belong to no language — are what is on
    // screen.
    expect(ggReferenceApi).not.toHaveBeenCalled();

    await clickTab("API");
    expect(
      await screen.findByRole("heading", { name: "gg.files.readFile" }),
    ).toBeInTheDocument();
    // No loading line on the way: the index was never thrown away.
    expect(screen.queryByText(/Loading gg/)).not.toBeInTheDocument();

    await clickTab("Tools");
    expect(
      screen.getByRole("heading", { name: "read_file" }),
    ).toBeInTheDocument();
    expect(ggReference).toHaveBeenCalledTimes(1);
  });

  it("returns to the arm the reader picked, not to the first one", async () => {
    renderSection("/gg/reference/api");
    await screen.findByRole("heading", { name: "gg.files.readFile" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Rust/ }));
    });
    await screen.findByRole("heading", { name: "gg::files::read_file" });

    // Out to the tools and back. The tab bar links to a bare `/gg/reference/api`, so the
    // address says nothing about the arm — this is the page's memory of the pick, and
    // without it the reader lands back on TypeScript having asked for nothing.
    await clickTab("Tools");
    await screen.findByRole("heading", { name: "read_file" });
    await clickTab("API");
    expect(
      await screen.findByRole("heading", { name: "gg::files::read_file" }),
    ).toBeInTheDocument();
  });

  it("shows the backend's own words when the reference is not available", async () => {
    // A deployment whose reference documents are missing answers `503` with a message
    // naming the two things that fix it. The transport unwraps it into the error's
    // message, and this page is where whoever can fix it will read it — so it is put on
    // screen verbatim rather than replaced with a house sentence about something going
    // wrong.
    ggReference.mockRejectedValue(
      new Error(
        "503 gg's reference documents are not available (cannot read " +
          "/opt/gg-reference/index.json: No such file or directory). They are written " +
          "by `gg reference --out <dir>`: the backend image bakes them and points " +
          "TCAB_GG_REFERENCE at them, and from a checkout `scripts/gg-reference.sh` " +
          "writes them to the default location.",
      ),
    );
    renderSection();
    const notice = await screen.findByText(/reference documents are not/);
    expect(notice.textContent).toContain("scripts");
    expect(notice.textContent).toContain("TCAB_GG_REFERENCE");
    // Not prefixed with `Error:` — a stack-trace artifact leaking onto a documentation
    // page, and the reason the hook unwraps the message rather than stringifying the
    // whole error.
    expect(notice.textContent?.startsWith("Error:")).toBe(false);
  });
});
