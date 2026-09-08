---
title: Overview
---

The UI library (`@clockwyrks/ui`, in `packages/ui`) is the shared frontend code
for The Test Cabinet's three GUIs: the [public
site](/components/site/overview/), the [web console](/components/web/overview/),
and the [Tauri app](/components/tauri/overview/). It hosts the entire routed
gallery application plus the primitives those GUIs render, so all three are thin
hosts over one application.

It ships no service and runs in no process of its own. Each GUI mounts the
shared app inside its own router and supplies it a data source, and the three
hosts differ only in where that data comes from and which capabilities they
enable.

## Subpath entries

A host imports only the entries it needs.

| Entry                       | Contents                                                           |
| --------------------------- | ------------------------------------------------------------------ |
| `@clockwyrks/ui`            | Presentational primitives, the rating model, and model-id helpers. |
| `@clockwyrks/ui/app`        | The full routed gallery application and its data context.          |
| `@clockwyrks/ui/client`     | The transport-agnostic client interfaces and their React contexts. |
| `@clockwyrks/ui/transport`  | The HTTP transports the live consoles mount.                       |
| `@clockwyrks/ui/tokens.css` | The `--tcab-*` theme token defaults.                               |

## The gallery application

One routed application serves every host. It covers the gallery a reader
browses, the run-execution surface an operator launches, watches, reviews and
publishes runs from, and the notification subsystem. It reads its data and its
capabilities from context, so a host varies it by what it provides rather than
by swapping screens. Route paths are built through the exported route builders,
so each path is defined in one place.

## The data and capability context

Each host builds the gallery data value from its own source. The static site
builds it from the build-time public snapshot. The web and desktop consoles
build it live from a backend.

A `canExecute` flag on that value gates the run-execution surface, including
authentication and notifications. Optional capability members gate the rest.
`arena` is present on a host that can run adversarial matches and tournaments.
`harnessAuth` is present only on the Tauri app, and carries the harness
credential controls. A host that omits one hides the corresponding surface.

The value also resolves a run's media to loadable URLs, whichever host is
asking: proof-of-implementation media, an asset-generation run's regenerated,
target and preview images with its action log, a voxel run's per-part `.glb` and
`rig.json`, a particle run's `system.json`, and case-scoped validation
baselines. The site resolves these from snapshot assets, a console from the
backend for a published run and from the [artifact
service](/components/artifacts/overview/) for a produced one.

A run's inputs resolve one variant of one exact case version rendered for one
engine, using the run's own recorded version and engine. A console resolves them
from the backend's version and specs routes. The site resolves them from the
snapshot's case document for that version.

Listing pages are answered through a paged, filtered, sorted query the host
implements. A console forwards it to the backend's offset endpoint. The site
answers it from its in-memory summary index with the same semantics, so paging
is identical on either host.

## The case detail coordinate

A test case's detail page is anchored to one selected coordinate: a version, a
variant of that version, and an engine that version supports. The coordinate
lives in the URL and travels across the whole page, so everything describing the
deliverable describes the same one and any selection is a link someone else can
open. Selection is canonical: an unknown version resolves to the latest, and a
variant or engine the selected version does not declare resolves to that
version's default. A run is launched against the resolved coordinate.

The page's run aggregations scope relative to the anchored coordinate rather
than selecting one of their own, and that scope lives in the URL alongside it. A
view widened across engines lists each engine separately rather than folding
them, since runs under different engines measure different work.

A case's changelog and errata cover every version regardless of the anchor.

## The run log

Every listing of runs renders one shared log. A listing that includes runs still
in flight lists them apart from the finished rows, since a run with no record
yet has nothing to sort or page by.

A run's duration counts from its `startedAt` and from nothing else, which keeps
queued time out of it, and the count begins when the run reaches `starting`. It
advances off one clock the whole log shares, and the log holds that clock only
while a duration is moving.

## Asset viewers

A produced asset is rendered interactively rather than as a still image. A voxel
run mounts the [voxel runtime](/components/voxel-runtime/overview/)'s rig in a
React Three Fiber canvas, where its joints are posed and its model-authored
animations played. A particle run mounts the [particle
runtime](/components/particle-runtime/overview/)'s player and simulates the
effect live. Each 3D view falls back to the emitted preview image where WebGL is
unavailable or reduced motion is requested, so a run stays reviewable.

## Client interfaces and transports

`./client` declares the backend and worker client interfaces the console is
written against, plus the React contexts that supply them and the
authentication context. The app depends only on these interfaces.

`./transport` is the single implementation of the backend wire protocol: the
HTTP backend and execution clients, the HTTP arena client, and the helpers that
read the artifact, arena, snapshot, and Grafana URLs the backend reports from
`GET /config`. Both consoles mount these transports. The desktop app supplies
its own arena transport, because its arena runs in-process.

## Submit outcomes

Every save, launch and publish reports its outcome, covering the failure that
stopped it and the progress and success of one that ran.

## Dialogs

Every question a destructive control asks is asked through the themed modal
rather than the browser's own `alert()` and `confirm()`, so a destructive action
confirms before it runs and its question carries more than a line of plain text.

The dialog is modal and its confirmation is awaited at the call site. Both a
confirmation and an alert may carry details beyond the question itself.

## Theming

Components are themed through the `--tcab-*` CSS custom properties. The
`tokens.css` entry supplies working defaults, and an app may override any
property in its own global styles. Every palette value comes from a token.
