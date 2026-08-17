---
title: Overview
---

The UI library (`@test-cabinet/ui`, in `packages/ui`) is the shared frontend
code for The Test Cabinet's three GUIs: the [public
site](/components/site/overview/), the [web console](/components/web/overview/),
and the [Tauri app](/components/tauri/overview/). It hosts the entire routed
gallery application plus the primitives those GUIs render, so all three are thin
hosts over one application.

It is a code-sharing library rather than a component: it ships no service and
runs in no process of its own. Each GUI mounts the shared app inside its own
router and supplies it a data source. The three hosts differ only in where that
data comes from and whether they enable run execution.

## Subpath entries

A host imports only the entries it needs.

| Entry                         | Contents                                                           |
| ----------------------------- | ------------------------------------------------------------------ |
| `@test-cabinet/ui`            | Presentational primitives, the rating model, and model-id helpers. |
| `@test-cabinet/ui/app`        | The full routed gallery application and its data context.          |
| `@test-cabinet/ui/client`     | The transport-agnostic client interfaces and their React contexts. |
| `@test-cabinet/ui/transport`  | The HTTP transports the live consoles mount.                       |
| `@test-cabinet/ui/tokens.css` | The `--tcab-*` theme token defaults.                               |

## The gallery application

`./app` exports `GalleryApp`, the whole console UI: the routed pages (home, test
cases, runs, models, game jams, comparisons, gg analysis, tournaments, account,
settings, about), the app shell and topbar, the backdrop, the run-execution
screens (new run, live monitor, review, sign-in and registration), and the
notification subsystem. All three GUIs mount this one component. It reads its
data and its capabilities from context, so a host varies it by what it provides
rather than by swapping screens.

The topbar carries the notifications bell and the account control beside the
Settings gear. Route paths are built through the exported `routes` builders, so
each path is defined in one place.

## The data and capability context

`GalleryDataProvider` carries the `GalleryData` value each host builds from its
own source. The static site builds it from the build-time public snapshot; the
web and desktop consoles build it live from a backend through the shared
`useLiveGallery` assembly.

A `canExecute` flag on that value gates the run-execution surface: the new-run
button, the live monitor, the editable review, the account and authentication
pages, the Connections settings, and the notification layer. The static site
renders the same component with those parts off.

Optional capability members gate the rest. `arena` is present on a host that can
run [adversarial](/testing/adversarial/overview/) matches and tournaments;
`harnessAuth` is present only on the Tauri app, and carries the harness
credential controls. A host that omits one hides the corresponding surface.

The value also resolves a run's media to loadable URLs, whichever host is
asking: [proof-of-implementation](/components/core/validation/#proofs) media, an
[asset-generation](/testing/asset-generation/overview/) run's regenerated,
target and preview images with its action log, a voxel run's per-part `.glb` and
`rig.json`, a particle run's `system.json`, and case-scoped validation
baselines. The site resolves these from snapshot assets, a console from the
backend for a published run and from the [artifact
service](/components/artifacts/overview/) for a produced one.

Listing pages are answered through `queryRunSummaries`, a paged, filtered,
sorted query the host implements. A console forwards it to the backend's offset
endpoint; the site answers it from its in-memory summary index with the same
semantics, so a numbered pager sizes identically on either host.

## Asset viewers

The run-detail and live-monitor screens render a produced asset interactively
rather than as a still image. A voxel run mounts the [voxel
runtime](/components/voxel-runtime/overview/)'s `VoxelRig` or `SkinnedVoxelRig`
in a React Three Fiber canvas, with a control per caller joint and a play
control per model-authored animation. A particle run mounts the [particle
runtime](/components/particle-runtime/overview/)'s player and simulates the
effect live. Each 3D view expands to fullscreen, and falls back to the emitted
preview image where WebGL is unavailable or reduced motion is requested, so a
run stays reviewable.

## Client interfaces and transports

`./client` declares the `BackendClient` and `WorkerClient` interfaces the
console is written against, plus the React contexts that supply them and the
authentication context. The app depends only on these interfaces.

`./transport` is the single implementation of the backend wire protocol: the
HTTP backend and execution clients, the HTTP arena client, and the helpers that
read the artifact, arena, snapshot, and Grafana URLs the backend reports from
`GET /config`. Both consoles mount these transports, so neither host duplicates
the protocol. The desktop app supplies its own arena transport, because its
arena runs in-process.

## Dialogs

No GUI uses the browser's own `alert()` or `confirm()`. Every question a
destructive control asks is asked through the themed modal instead: deleting a
run, killing or sweeping in-flight runs, halting a plan or a ladder, deleting a
group, plan, ladder or model configuration, marking a run unplayable, and
restoring a run's validator verdicts. It reads as part of the cabinet rather
than as the operating system, and it can carry more than a line of plain text.

`Dialog` is the presentational half, a scrim and outlined panel portalled to
`document.body` so it escapes any panel's overflow or stacking context. It is
modal: Escape and a click on the scrim dismiss it, focus opens on the default
action and is trapped until the dialog is answered, and the page behind it does
not scroll. Its height is capped at the viewport, and its optional detail region
scrolls at a capped height inside that, so a dialog enumerating a hundred
changes asks its question exactly the way a three-line one does and never grows
taller than the page.

`useConfirm()` is the app-layer half, provided once by `GalleryApp`. It hands a
click handler the imperative `confirm(…)` and `alert(…)` pair it awaits, so a
call site keeps the guard-clause shape the native dialogs had:

```tsx
if (!(await confirm({ title: "Delete run", message: "…" }))) return;
```

Both take an optional `details` node that lands in the dialog's scrollable
detail region. The reviewer's bulk restore of validator verdicts uses it to list
every point the restore would change and which way each verdict would flip
(`describeAutoVerdictRestore`), because by the time a reviewer reaches for that
control they cannot be expected to hold in mind which of their own calls the
machine disagrees with.

## Theming

Components are themed through the `--tcab-*` CSS custom properties. The
`tokens.css` entry supplies working defaults; an app may override any property
in its own global styles. No component hard-codes a palette.
