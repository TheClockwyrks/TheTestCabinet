import type { ReviewDocument } from "../../client/types";

// Reconstruct a writeup's `---\nrating: …\n---\n\n<body>` framing from a
// structured review, so a live host (web/desktop) can feed the gallery the same
// raw writeup form `parseWriteup` reads — identical to what the public snapshot
// emits for the static site. Checklist verdicts become the `review.<id>:
// <status> [note]` frontmatter lines the parser recovers.
export function frameReview(review: ReviewDocument): string {
  const verdicts = (review.checklist ?? [])
    .map((v) => {
      const note = (v.note ?? "").replace(/\s+/g, " ").trim();
      return `review.${v.id}: ${v.status}${note ? ` ${note}` : ""}`;
    })
    .join("\n");
  const frontmatter = verdicts
    ? `rating: ${review.rating}\n${verdicts}`
    : `rating: ${review.rating}`;
  return `---\n${frontmatter}\n---\n\n${review.writeup ?? ""}`;
}
