// `@test-cabinet/share-links` — the contract behind a shareable run link.
//
// Three things have to agree about a short link, and none of them can hold the
// rules privately: the gallery build, which mints the codes and publishes the
// index; the gallery itself, which injects a shared page's preview tags; and the
// short-link resolver on the short domain, which turns a code back into a run. The
// rules therefore live here, framework-free and with no runtime dependencies, so
// all three can import them.
//
// See `codes` for how a run id becomes a code and back, `entries` for the index
// the gallery build publishes, and `preview` for the meta tags a shared link
// unfurls into.

export * from "./codes.js";
export * from "./entries.js";
export * from "./preview.js";
