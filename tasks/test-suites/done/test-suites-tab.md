# Test Suites Is The First Tab Under Test Cases

Add a Test Suites surface as the first tab of the Test Cases section, listing
every suite the backend offers along with the versions it holds. The tab is the
entry point every later suite surface hangs off.

## Current state

`packages/ui/src/app/` owns every catalog surface and is consumed by `apps/web`,
`apps/desktop` and `apps/site`, so a tab added there arrives in every host at
once.

`packages/ui/src/app/routes.ts` holds the `CatalogTab` union, the `routes`
builders and the `routePatterns` table. Each tab slug is a literal path segment
under `/test-cases`, a sibling of the `:slug` detail route, the same
literal-beside-param shape `/runs/failures` uses beside `/runs/:runId`.

`packages/ui/src/app/data/testCaseTabs.ts` holds `CATALOG_TABS` in display
order plus `inTab`, `tabOf`, `tabLabel` and the `CatalogCategory` set the
coverage plan editor and the new-run pickers bucket cases with.
`packages/ui/src/app/pages/testcases/router.tsx` redirects bare `/test-cases`
to the first type tab and mounts one route per tab;
`packages/ui/src/app/pages/testcases/TestCasesPage.tsx` renders the tab bar
from `visibleTabs` and an index filtered by `inTab`.
`packages/ui/src/app/pages/router.tsx` assembles every section's routes and is
where `canExecute` and the shipped gg corpus reach the section routers.

A suite's identity, prose and classification live in its `suite.toml`, whose
keys are fixed by
[`test-suites/suite-manifest.md`](../../apps/docs/src/content/docs/test-suites/suite-manifest.md).
The listing reads the slug, name, version, summary, tags and the experimental
flag from it. A suite holds many versions, each a frozen unit under
`<slug>/v<major>.<minor>.<patch>/`.

A deployment decides whether experimental definitions are offered at all, via
`allow_experimental` in `crates/backend/src/config.rs`, so a client shows what
it is served rather than filtering again.

## Design

Test suites are not test cases, so the tab is a literal route beside the
existing ones rather than a `CatalogTab` member. That keeps `inTab` exhaustive
over real test types and leaves the category pickers untouched. Add
`testCasesSuites` to `routes` and `routePatterns` at `/test-cases/suites`, a
literal that outranks `:slug` and that no case slug matches.

Lift the tab bar out of `TestCasesPage.tsx` into a shared component in
`packages/ui/src/app/pages/testcases/`. It takes the active selection, renders
the Test Suites entry ahead of `visibleTabs`, and both the catalog page and the
suites page render it, so the bar is identical whichever tab is selected.

One condition decides the whole surface: whether the active transport exposes
the suite reads. Declare those reads as optional methods on `BackendClient` in
`packages/ui/src/client/clients.ts`, the pattern the coverage plan and gg
configuration reads use, and implement them in
`packages/ui/src/transport/httpBackend.ts`. Where they are absent, including the
static gallery, which mounts no backend provider at all, the tab bar omits the
Test Suites entry and the bar renders exactly as it does today.

Thread that condition into `testCasesRoutes()` from
`packages/ui/src/app/pages/router.tsx`, which passes it no arguments today, and
mount the suites route behind it. The bare `/test-cases` redirect targets the
suites tab where the route is mounted, which is what makes it first, and the
catalog's first type tab where it is not, so no host redirects at the catch-all.

The page lists every offered suite as a row carrying its name, slug, newest
version, summary and tags, with the versions it holds reachable from the row,
and links each row into the suite detail surface owned by
[`suite-detail-surfaces.md`](suite-detail-surfaces.md). A suite served as
experimental is labeled experimental. The page renders its own chrome, loading
state and empty state in the data-first order `TestCasesPage.tsx` uses: held
data renders, and a failed re-read is a notice above the rows.

Listing data comes from the suite read endpoints added by
[`suite-ingestion.md`](suite-ingestion.md), reached through a hook in
`packages/ui/src/app/data/` that resolves its client with `useOptionalBackend`
from `packages/ui/src/client/context.tsx`, the shape `useComparisons.ts` uses,
so a host without the reads reports none instead of crashing.

`routes.test.ts` walks `routePatterns` and `routeSmoke.test.tsx` drives every
pattern through the real app against each host fixture in
`routeSmokeFixtures.tsx`. Stock the console fixture with a suite so the smoke
walk visits a populated page, and keep the gallery fixture without the suite
reads so the walk covers the hidden tab and its redirect.

## Done when

- [ ] `routes.ts` declares `testCasesSuites` at `/test-cases/suites`, and
      `routes.test.ts` resolves it without shadowing `/test-cases/:slug`.
- [ ] The tab bar is a shared component rendered by both the catalog page and
      the suites page.
- [ ] A host whose transport exposes the suite reads shows Test Suites as the
      first tab and redirects bare `/test-cases` to it.
- [ ] A host whose transport lacks the suite reads renders the tab bar it
      renders today and redirects bare `/test-cases` to the first type tab.
- [ ] `BackendClient` declares the suite reads as optional methods,
      `httpBackend.ts` implements them, and the data hook resolves its client
      optionally.
- [ ] The listing shows each offered suite with its name, slug, newest version,
      summary, tags and the versions it holds, and each row links into the suite
      detail surface.
- [ ] A suite the backend serves as experimental is labeled experimental in the
      listing.
- [ ] The page renders its loading state, its empty state, and a re-read failure
      as a notice above held rows.
- [ ] `routeSmoke.test.tsx` walks the new route on a console fixture stocked
      with a suite and on a gallery fixture without the suite reads.
- [ ] Gates green.
