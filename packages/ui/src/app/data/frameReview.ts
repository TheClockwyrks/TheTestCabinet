import type { ReviewDocument } from "../../client/types";

// Reconstruct a writeup's `---\nrating.<domain>: …\n---\n\n<body>` framing from a
// structured review, so a live host (web/desktop) can feed the gallery the same
// raw writeup form `parseWriteup` reads — identical to what the public snapshot
// emits for the static site. Per-domain ratings become `rating.<domain>: <tier>`
// lines and checklist verdicts become `review.<id>: <status> [note]` lines, both
// of which the parser recovers.
export function frameReview(review: ReviewDocument): string {
  const ratings = (review.ratings ?? []).map(
    (r) => `rating.${r.domain}: ${r.rating}`,
  );
  const verdicts = (review.checklist ?? []).map((v) => {
    const note = (v.note ?? "").replace(/\s+/g, " ").trim();
    return `review.${v.id}: ${v.status}${note ? ` ${note}` : ""}`;
  });
  const frontmatter = [...ratings, ...verdicts].join("\n");
  return `---\n${frontmatter}\n---\n\n${review.writeup ?? ""}`;
}
