import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SourceView } from "./SourceView";

describe("SourceView", () => {
  it("renders a recognized language with syntax token markup", () => {
    const { container } = render(
      <SourceView path="src/main.ts" text={'export const x = "hi";\n'} />,
    );

    const code = container.querySelector("code");
    expect(code?.textContent).toBe('export const x = "hi";\n');
    // The grammar marked up at least the keywords and the string.
    expect(container.querySelector(".hljs-keyword")?.textContent).toBe(
      "export",
    );
    expect(container.querySelector(".hljs-string")?.textContent).toBe('"hi"');
  });

  it("renders an unrecognized extension as plain text", () => {
    const { container } = render(
      <SourceView path="Dockerfile.frag" text={"FROM scratch\n"} />,
    );

    expect(container.querySelector("code")?.textContent).toBe("FROM scratch\n");
    expect(container.querySelector("[class^='hljs-']")).toBeNull();
  });

  it("escapes markup in highlighted sources rather than injecting it", () => {
    const { container } = render(
      <SourceView
        path="index.html"
        text={'<img src=x onerror="alert(1)">\n'}
      />,
    );

    // The tag reads as text in the pane; no <img> element was created.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain(
      "<img src=x",
    );
  });
});
