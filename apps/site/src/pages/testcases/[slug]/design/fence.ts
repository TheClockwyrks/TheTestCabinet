// Markdown source files render as prose; every other text file renders as a
// fenced code block so it is shown verbatim, tagged with its extension as the
// language hint. Shared by every Specifications design so a `.toml` or `.json`
// seed reads the same way no matter which view renders it.
export function fence(path: string, text: string): string {
  if (path.endsWith(".md") || path.endsWith(".markdown")) {
    return text;
  }
  const lang = path.split(".").pop() ?? "";
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

// A short, human-facing title for a seeded file: its name without the directory
// prefix. Used by the document and deck specs views as section/tab headings.
export function fileTitle(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

// A stable DOM id for a seeded file, for in-page anchor links (the document
// view's outline scrolls to these).
export function fileAnchor(path: string): string {
  return `spec-${path.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}
