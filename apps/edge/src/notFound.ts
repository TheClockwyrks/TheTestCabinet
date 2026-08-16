// The 404 page for the short domain.
//
// The resolver has no application behind it — `tcab.ai` serves short links and
// nothing else — so a path it cannot resolve has no page of its own to fall back
// to and needs a small standalone document. It is deliberately plain: it carries
// no bundle, no font, and no image, because it exists on a domain whose entire
// purpose is to redirect somewhere else, and the useful thing it can do is say
// what went wrong and offer the gallery.
//
// `noindex` matters here. A short code is a URL a crawler will happily follow
// from wherever it was shared, and a dead one must not become an indexed page.

import { escapeHtml } from "@test-cabinet/share-links";

/**
 * A standalone 404 document offering `galleryUrl` as the way out.
 *
 * Styled inline against `color-scheme: dark light`, so it follows the reader's
 * system preference without shipping a stylesheet or guessing at a background.
 */
export function renderNotFoundDocument(galleryUrl: string): string {
  const url = escapeHtml(galleryUrl);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Nothing at this address — The Test Cabinet</title>
    <style>
      :root { color-scheme: dark light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        padding: 2rem 1rem;
        text-align: center;
        font-family: system-ui, sans-serif;
        line-height: 1.5;
      }
      p { margin: 0; }
      .code { font-size: 2.5rem; letter-spacing: 0.1em; opacity: 0.6; }
      h1 { margin: 0; font-size: 1.25rem; font-weight: 600; }
      .detail { max-width: 34rem; opacity: 0.75; }
    </style>
  </head>
  <body>
    <p class="code">404</p>
    <h1>Nothing at this address</h1>
    <p class="detail">
      This short link doesn't point at a run. It may have been mistyped, or it may
      name a run that was never published.
    </p>
    <p><a href="${url}">Go to The Test Cabinet</a></p>
  </body>
</html>
`;
}
