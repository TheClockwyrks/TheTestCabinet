import type { ReviewDocument, StoredReview } from "../../client/types";
import {
  worstGrade,
  worstRating,
  type DomainRating,
  type Rating,
  type VerdictStatus,
} from "../../ratings";

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

// Reconstruct a single *aggregate* writeup from a run's reviews, so the gallery's
// cards, leaderboard, and badges — which read one framed writeup per run via
// `findReview` — show the aggregate verdict across every reviewer. The aggregate
// rating for a domain is the worst any reviewer gave it, and a checklist item
// reads `pass` only when every reviewer who judged it passed it (the strictest
// reading, matching the worst-wins aggregate rating). The body concatenates each
// reviewer's writeup, attributed by display name. Returns null for no reviews so
// the caller can omit the run's writeup entirely.
export function frameReviews(reviews: readonly StoredReview[]): string | null {
  if (reviews.length === 0) return null;

  // Worst rating per domain across reviewers.
  const ratingsByDomain = new Map<string, Rating[]>();
  for (const review of reviews) {
    for (const r of review.ratings ?? []) {
      const list = ratingsByDomain.get(r.domain) ?? [];
      list.push(r.rating);
      ratingsByDomain.set(r.domain, list);
    }
  }
  const ratings: DomainRating[] = [];
  for (const [domain, tiers] of ratingsByDomain) {
    const worst = worstRating(tiers);
    if (worst) ratings.push({ domain, rating: worst });
  }

  // A binary checklist item passes only when every reviewer who judged it passed
  // it; a graded item (a game jam's category, and its whole-game `overall` mark)
  // takes the worst grade any reviewer gave — the strictest reading, matching the
  // worst-wins aggregate rating.
  const statusesByItem = new Map<string, VerdictStatus[]>();
  for (const review of reviews) {
    for (const v of review.checklist ?? []) {
      const list = statusesByItem.get(v.id) ?? [];
      list.push(v.status);
      statusesByItem.set(v.id, list);
    }
  }
  const ratingLines = ratings.map((r) => `rating.${r.domain}: ${r.rating}`);
  const verdictLines: string[] = [];
  for (const [id, statuses] of statusesByItem) {
    // `worstGrade` is null unless the statuses are graded tiers, so a binary item
    // falls through to the unchanged all-must-pass reading.
    const status =
      worstGrade(statuses) ?? (statuses.every((s) => s === "pass") ? "pass" : "fail");
    verdictLines.push(`review.${id}: ${status}`);
  }

  // Attribute each reviewer's prose so the aggregate body reads clearly.
  const body = reviews
    .map((review) => {
      const text = (review.writeup ?? "").trim();
      return text ? `**${review.reviewer}**\n\n${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n---\n\n");

  const frontmatter = [...ratingLines, ...verdictLines].join("\n");
  return `---\n${frontmatter}\n---\n\n${body}`;
}
