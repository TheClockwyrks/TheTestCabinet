# A Suite's Page Shows Every Entity It Holds

Give an ingested test suite a detail page in The Test Cabinet: a landing tab
rendered from the suite's showcase and prose, plus read-only views of the
entities the selected suite version holds.

## Current state

[`test-suites/showcase.md`](../../apps/docs/src/content/docs/test-suites/showcase.md)
settles that The Test Cabinet renders the showcase as the test suite's landing
page, and
[`components/core/showcase.md`](../../apps/docs/src/content/docs/components/core/showcase.md)
settles the directory's format, the extension-to-kind mapping, and the caps on
the description, the carousel, and each media file. The suite's own identity and
prose come from
[`suite-manifest.md`](../../apps/docs/src/content/docs/test-suites/suite-manifest.md).

What each other entity presents is settled by
[`specifications.md`](../../apps/docs/src/content/docs/test-suites/specifications.md),
[`test-case-definition.md`](../../apps/docs/src/content/docs/test-suites/test-case-definition.md),
[`validators.md`](../../apps/docs/src/content/docs/test-suites/validators.md),
[`assets.md`](../../apps/docs/src/content/docs/test-suites/assets.md),
[`demonstrations.md`](../../apps/docs/src/content/docs/test-suites/demonstrations.md)
and
[`reference-implementations.md`](../../apps/docs/src/content/docs/test-suites/reference-implementations.md).

`packages/ui/src/app/layouts/testcases/TestCaseDetailLayout.tsx` is the pattern
to follow. It resolves its subject from the URL slug, owns the loading, load
failure and not-found states, holds the coordinate selectors in its header, and
renders a tab strip over per-tab bodies in
`packages/ui/src/app/pages/testcases/[slug]/`, handing each body the resolved
subject and anchored coordinate. `useSelectedCoordinate.ts` beside those pages is
how a coordinate is read from and written to the query string.

The presentation pieces these tabs need already exist: `Markdown`, `Panel` and
`SpecAccordion` in `packages/ui/src/primitives/`, `MediaView` in
`packages/ui/src/app/components/`, and the description-plus-carousel rendering in
`packages/ui/src/app/pages/runs/[runId]/ShowcaseSection.tsx`.

The Test Suites tab that lists suites and links here is
[`test-suites-tab.md`](test-suites-tab.md), and it is a prerequisite. The suite
documents and byte-serving endpoints these surfaces read come from
[`suite-ingestion.md`](suite-ingestion.md).

## Design

A suite detail layout under `packages/ui/src/app/layouts/testsuites/` anchored on
suite slug and version, with its tab bodies as pages under
`packages/ui/src/app/pages/testsuites/[slug]/`. Routes sit under
`/test-cases/suites/:slug`, beside the listing route at `/test-cases/suites`, so
the suite slug never collides with the `/test-cases/:slug` case route. Add a
builder and a pattern per tab to `packages/ui/src/app/routes.ts`; no component
carries a path literal.

The layout resolves the suite from the URL slug and the version from the query
string, and holds the version selector in its header alongside the suite's name,
summary and tags, so every tab describes one version coordinate at a time. Tab
links carry the current query string, so switching tabs keeps the anchored
version. The layout owns the loading, load failure and not-found states the way
`TestCaseDetailLayout` does, and hands each tab body the resolved suite version.

### Landing tab

The landing tab renders the suite's showcase: the description as Markdown with
its image references resolved against the suite's served showcase files, above
the carousel in the order `showcase.toml` declares. Reuse the rendering in
`ShowcaseSection.tsx` rather than writing a second one, so a suite's showcase and
a run's read identically. The manifest's `description.md` prose renders below the
carousel, so the suite's player-facing and descriptive prose are both reachable
from the landing tab.

### Specifications

One tab presenting the version's specifications, each with its display name,
summary, seeded output path and prose, and under it the requirements in
declaration order. Each requirement shows its identity, its `kind`, its RFC 2119
text, and the validator module paths it claims. Requirement identity displays as
`<specification id>/<requirement id>`, which is the form results record.

### Test case definitions

One tab presenting the definitions the version declares: display name, type,
difficulty, and the specifications the definition covers, expanded into the
requirements those specifications hold so a reader sees exactly what the
definition grades. A code-producing definition also shows the engines a run may
select from, and an asset-producing definition shows the asset its type table
targets.

Each definition links to the test case it was ingested as, so a reader moves from
the definition to its runs in one step. A definition whose test case is absent
from the catalog says so in place of the link.

### Assets, demonstrations and reference implementations

One tab per group. Assets present each asset's id, display name, kind, the
specification describing it, and its declared files, with a `sprite` or
`sprite-sheet` asset previewed through `MediaView`. Demonstrations present each
one's id, display name, summary, and the specification whose mechanic it
illustrates. Reference implementations present the engine each targets.

### Changelog

One tab rendering the anchored version's `changelog.md` as Markdown.

### Settled decisions

These surfaces are read-only. Authoring every entity shown here belongs to The
Spec Cabinet, and a user reaches this page to understand a suite rather than to
change it.

These tabs present what the suite read endpoints serve. Viewing the suite's debug
API and validator sources, and playing a demonstration or a reference
implementation build, are left to later passes.

Media bytes reach the browser through the backend's suite byte-serving endpoints,
which read the stored suite version, so a deployment serves what it ingested
without the browser reaching the suites checkout.

## Done when

- [ ] A suite's landing page renders its showcase description and carousel, with
      description image references resolved to the served files, and the
      manifest's description prose below them.
- [ ] Every entity group is reachable from the layout's tab strip on one version
      coordinate, and switching tabs keeps that coordinate.
- [ ] A requirement displays as `<specification id>/<requirement id>` with its
      kind and the validator paths it claims.
- [ ] A test case definition shows the requirements it grades and links to the
      test case it was ingested as.
- [ ] Assets, demonstrations and reference implementations each present what the
      suite declares, with sprite previews served from the backend.
- [ ] An unknown suite slug or version renders the not-found state, and a failed
      fetch renders the load failure state.
- [ ] `routes.test.ts` and `routeSmoke.test.tsx` cover the new routes.
- [ ] Gates green.
