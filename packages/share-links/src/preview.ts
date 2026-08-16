// Link previews: the meta tags a shared run link unfurls into, and the crawlers
// that ask for them.
//
// Two consumers render these from one place. The gallery injects the tags into the
// page it already serves, for every visitor, so a crawler and a person are shown
// the same document — a preview built by serving *different* content to crawlers is
// cloaking, and search engines penalise it. The short-link resolver has no page to
// inject into and must send a person onward, so it answers a crawler with a
// standalone document carrying the same tags.

import type { ShareEntry, ShareTarget } from "./entries.js";

/** Escape a value for interpolation into HTML text or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Title-case a scale value (`great` -> `Great`) for prose. The rating scales are
// single lowercase words, so this needs no lookup table — and keeping one here
// would be a second copy of the UI's display metadata.
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// A run's score as a fraction of the points on offer, e.g. "42/50 points". Omitted
// when the run is unscored or nothing was on offer.
function scoreText(entry: ShareEntry): string | null {
  if (!entry.score || entry.score.total <= 0) return null;
  const round = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return `${round(entry.score.earned)}/${round(entry.score.total)} points`;
}

/** The preview card's title. */
export function previewTitle(entry: ShareEntry, target: ShareTarget): string {
  const subject = `${entry.caseName} · ${entry.model}`;
  return target === "play" ? `Play ${subject}` : subject;
}

/**
 * The preview card's description: the verdict up front, then what produced the
 * run. A failure tier has no rating or score to lead with, so it says what
 * happened instead — a shared link to a catastrophic run should read as one.
 */
export function previewDescription(entry: ShareEntry): string {
  const parts: string[] = [];
  if (entry.rating) parts.push(titleCase(entry.rating));
  const score = scoreText(entry);
  if (score) parts.push(score);
  if (entry.reviews > 0) {
    parts.push(`${entry.reviews} review${entry.reviews === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) {
    // No review to report: the run ended in a failure tier, which is the fact
    // worth showing rather than an empty card.
    parts.push(`Run ended: ${entry.state.replace(/_/g, " ")}`);
  }
  parts.push(`Built with ${entry.harness} on the ${entry.variant} variant`);
  return `${parts.join(" · ")}.`;
}

/**
 * The meta tags for one run's shared page, as an HTML fragment for `<head>`.
 *
 * `canonicalUrl` is the gallery URL the link ultimately names — always a
 * testcabinet.ai address, never the run's own playable-build deployment, so a
 * visitor arriving from a shared link always lands somewhere that can take them
 * into the rest of the cabinet.
 */
export function renderMetaTags(
  entry: ShareEntry,
  target: ShareTarget,
  canonicalUrl: string,
): string {
  const title = escapeHtml(previewTitle(entry, target));
  const description = escapeHtml(previewDescription(entry));
  const url = escapeHtml(canonicalUrl);
  const tags = [
    `<title>${title} — The Test Cabinet</title>`,
    `<meta name="description" content="${description}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:site_name" content="The Test Cabinet" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${url}" />`,
  ];
  if (entry.image) {
    const image = escapeHtml(entry.image);
    tags.push(
      `<meta property="og:image" content="${image}" />`,
      `<meta name="twitter:image" content="${image}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary" />`);
  }
  tags.push(
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
  );
  return tags.join("\n    ");
}

/**
 * A standalone document carrying a run's preview tags, for a resolver that has no
 * page of its own to inject into.
 *
 * It still redirects: a crawler reads the tags and stops, but anything else that
 * reaches this document — a bot list that does not match, a person who disabled
 * scripts — follows the refresh to the gallery rather than sitting on a blank
 * page.
 */
export function renderPreviewDocument(
  entry: ShareEntry,
  target: ShareTarget,
  canonicalUrl: string,
): string {
  const url = escapeHtml(canonicalUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${renderMetaTags(entry, target, canonicalUrl)}
    <meta http-equiv="refresh" content="0; url=${url}" />
  </head>
  <body>
    <p><a href="${url}">Continue to The Test Cabinet</a></p>
  </body>
</html>
`;
}

// The link-unfurling crawlers worth answering with a preview. Matched
// case-insensitively as substrings of the user agent.
//
// This list decides who is shown a preview *instead of* being redirected, so it is
// deliberately a list of known unfurlers rather than a general "looks like a bot"
// heuristic: the cost of missing one is a crawler following the redirect and
// unfurling the gallery page (which carries the same tags anyway), while the cost
// of a false positive is a person landing on a preview stub instead of the run
// they clicked. The failure modes are not symmetric, so the check errs toward
// treating a caller as a person.
const CRAWLER_AGENTS = [
  "applebot",
  "bingbot",
  "bluesky",
  "cardyb",
  "developers.google.com/+/web/snippet",
  "discordbot",
  "embedly",
  "facebookexternalhit",
  "flipboard",
  "google-inspectiontool",
  "googlebot",
  "iframely",
  "linkedinbot",
  "mastodon",
  "nuzzel",
  "outbrain",
  "pinterest",
  "quora link preview",
  "redditbot",
  "rogerbot",
  "skypeuripreview",
  "slackbot",
  "telegrambot",
  "tumblr",
  "twitterbot",
  "vkshare",
  "w3c_validator",
  "whatsapp",
  "xing-contenttabreceiver",
] as const;

/** Whether the user agent is a link-unfurling crawler that should be answered with
 * a preview rather than a redirect. An absent user agent reads as a person. */
export function isCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_AGENTS.some((agent) => ua.includes(agent));
}
