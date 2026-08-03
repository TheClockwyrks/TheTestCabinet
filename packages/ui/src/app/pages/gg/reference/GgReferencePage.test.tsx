// The frame both Reference tabs share.
//
// One property, and it is the one the page's shape exists for: **flipping tabs must not
// re-fetch**. The two tab URLs are two routes, and if they mounted two different component
// types React would unmount one subtree and mount the other on every click, taking the
// fetch with it — so a reader comparing a tool against its API counterpart would watch the
// document they were reading vanish behind a loading line each way. Nothing about the
// rendered output gives that away, which is why it is asserted on the client call count
// rather than on the markup.
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgReference } from "@test-cabinet/run-record/gg-reference";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import { GgReferencePage } from "./GgReferencePage";

vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));

const REFERENCE: GgReference = {
  ggVersion: "9.9.9",
  categories: [
    {
      id: "gg-filesystem",
      title: "Filesystem",
      description: "Reading, writing and editing files in the workspace.",
      objects: ["fs"],
    },
  ],
  tools: [
    {
      name: "read_file",
      category: "gg-filesystem",
      description: "Read a file and return its contents.",
      parameters: { type: "object", properties: {} },
      capability: "filesystem",
    },
  ],
  functions: [
    {
      object: "fs",
      name: "readFile",
      category: "gg-filesystem",
      summary: "Read a file.",
      signature: "readFile(path: string): string",
      doc: "Read a file and return its contents.",
      gate: "read_file",
      library: false,
      types: [],
    },
  ],
};

const ggReference = vi.fn();

function backendValue(): BackendContextValue {
  return { client: { ggReference } } as unknown as BackendContextValue;
}

// Both tab routes, mounted together, so a click on the tab bar really navigates rather
// than being swallowed by a router that knows only the route under test.
function renderSection() {
  return render(
    <MemoryRouter initialEntries={["/gg/reference/tools"]}>
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

describe("GgReferencePage", () => {
  beforeEach(() => {
    ggReference.mockReset();
    ggReference.mockResolvedValue(REFERENCE);
  });

  it("fetches the document once, however many times the tabs are flipped", async () => {
    renderSection();
    await screen.findByRole("heading", { name: "read_file" });
    expect(ggReference).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "API" }));
    });
    expect(
      screen.getByRole("heading", { name: "fs.readFile" }),
    ).toBeInTheDocument();
    // No loading line on the way: the document was never thrown away.
    expect(screen.queryByText(/Loading gg/)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: "Tools" }));
    });
    expect(
      screen.getByRole("heading", { name: "read_file" }),
    ).toBeInTheDocument();
    expect(ggReference).toHaveBeenCalledTimes(1);
  });
});
