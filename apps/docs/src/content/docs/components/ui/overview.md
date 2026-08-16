---
title: Overview
---

The UI library (`@test-cabinet/ui`, in `packages/ui`) is the shared frontend
code for The Test Cabinet's three GUIs — the [public site](/components/site/overview/),
the [web console](/components/web/overview/), and the
[Tauri app](/components/tauri/overview/). It hosts the **entire routed gallery
application** plus the presentational primitives those GUIs render, so the three
apps are thin hosts over one shared app rather than three separate
implementations.

It is a code-sharing library, not a component itself: it ships no service and
runs in no process of its own. Each GUI mounts the shared app inside its own
router and supplies it a data source; the [site](/components/site/overview/),
[web](/components/web/overview/), and [Tauri](/components/tauri/overview/) hosts
differ only in (a) where that data comes from and (b) whether they enable run
execution.

## What it provides

The package exposes three subpath entries: its root (`@test-cabinet/ui`) ships
the primitives and the rating model; `@test-cabinet/ui/app` ships the full routed
gallery application; and `@test-cabinet/ui/client` ships the backend/worker client
interfaces. A host imports only what it needs.

- **The routed gallery application** (`./app`) — the whole site UI: the routed
  pages (Home, Test Cases, Runs, Models, About), the app shell and topbar, and
  the synthwave backdrop, *plus* the run-execution screens (new run, live
  monitor, review, the account and sign-in/registration pages, the Connections
  settings) and the notification subsystem. The topbar carries the console-only
  affordances — the notifications bell and the account control (the signed-in
  user, linking to the account page, or a sign-in prompt) — beside the Settings
  gear. All three GUIs mount the same `GalleryApp` component. It reads its data and its
  capabilities from context, so a host varies it only by what it provides — not
  by swapping out screens. There is no longer a separate "console" build: the
  consoles *are* this gallery app with run execution turned on.
- **The data and capability context** — `GalleryDataProvider` and the
  `GalleryData` it carries. Each host builds this from its own source: the static
  [site](/components/site/overview/) from the build-time public snapshot, and the
  [web](/components/web/overview/) and [Tauri](/components/tauri/overview/)
  consoles live from a backend (via the shared `useLiveGallery`
  assembly). A `canExecute` flag on this value is what gates the run-execution
  surface — the new-run button, the live monitor, the editable review, the
  account and sign-in/registration pages with their topbar account control, the
  Connections settings, and the notification layer — so the static site renders
  the same component with those parts off. The value also resolves each run's
  submitted [proof-of-implementation](/components/core/validation/#proofs) media to
  loadable URLs (a published run from the backend; a produced run over HTTP from
  the [artifact service](/components/artifacts/overview/)'s proof endpoint; the
  site from snapshot assets), which the reworked review flow and the run **Proof**
  tab display beside the expected references. It resolves an
  [asset-generation](/testing/asset-generation/overview/) run's media — the
  regenerated, target, and preview images plus the action log, and for a
  [voxel](/testing/asset-generation/overview/#voxel-models-and-rigs) run its
  emitted per-part `.glb` and `rig.json` — the same way (a
  published run from the backend's `/runs/{id}/asset/{file}` endpoint; a produced
  run from the artifact service's matching endpoint; the site from snapshot
  assets), which the **Verdict** tab's result view shows side by side. A voxel run
  additionally renders an **interactive 3D model** through the `VoxelViewer`
  component — a lazy-loaded React Three Fiber canvas that mounts the
  [voxel-runtime](/components/voxel-runtime/overview/)'s `VoxelRig` (a `voxel-model`
  auto-rotating; a `voxel-animation` orbit-drag with a range control per caller
  joint, e.g. `turret_yaw`, playback of each auto-play joint, and a play button per
  case-authored **predetermined animation**), falling back to the emitted
  preview PNG (rendered by the binary with wgpu) where WebGL is unavailable or reduced motion is requested so the run
  stays reviewable. Each 3D view carries an **expand-to-fullscreen** button: inline,
  scroll-to-zoom is disabled (the model rotates but does not zoom); expanded, both
  scroll-to-zoom and grab-to-rotate are enabled. The **live monitor** renders a
  voxel run's in-progress model the same way — rebuilding it in 3D from the streamed
  `.glb` bytes (decoded with the same `parseGlb`) after each operation (a **Scene** view assembling every part whose
  mount location is known, and a **Model** view for one part at a time) instead of
  the emitted preview PNG. (Both
  consoles share the **same HTTP transport** — `@test-cabinet/ui/transport`; the
  desktop's old `tcab-proof://` / `tcab-asset://` schemes were removed.)
- **Presentational primitives** (`./` root) — the brand-neutral building blocks
  every GUI uses: the Markdown renderer, the rating badge, panels, the metric
  tile, the spec/reference accordion, pagination, the chart wrapper, and the
  modal `Dialog` (see [Dialogs](#dialogs)).
- **The client interfaces** (`./client`) — the `BackendClient` and
  `WorkerClient` interfaces the consoles are written against, plus the React
  contexts that supply them. The app depends only on these interfaces; each
  console provides a transport (HTTP in the web app, Tauri commands in the desktop
  app) behind them. This is what lets one app serve both consoles.
- **The rating model** (`./` root) — the `Rating` tiers and their display
  metadata, mirroring the [reviews](/components/core/results/#reviews) model in
  the core, so every GUI shows ratings identically.

## Dialogs

No GUI uses the browser's own `alert()` / `confirm()`. Every question a
destructive control asks — deleting a run, killing or sweeping in-flight runs,
halting a plan or ladder, deleting a group/plan/ladder or a model configuration,
marking a run unplayable, restoring a run's validator verdicts — is asked through
the themed modal instead, so it reads as part of the cabinet rather than as the
operating system, and so it can carry more than a line of plain text.

Two pieces:

- **`Dialog`** (a presentational primitive) — the scrim and neon-outlined panel,
  portalled to `document.body` so it escapes any panel's overflow or stacking
  context. It is modal: Escape and a click on the scrim dismiss it, focus opens
  on the default action and is trapped until the dialog is answered, and the page
  behind it cannot scroll. Its height is capped at the viewport, and its optional
  **detail region** scrolls at a capped height inside that — so a dialog that
  enumerates a hundred changes asks its question exactly the way a three-line one
  does, and can never grow taller than the page.
- **`useConfirm()`** (app layer, provided once by `GalleryApp`) — the imperative
  `confirm(…)` / `alert(…)` pair a click handler awaits, so a call site keeps the
  guard-clause shape the native dialogs had:

  ```tsx
  if (!(await confirm({ title: "Delete run", message: "…" }))) return;
  ```

  Both take an optional `details` node, which lands in the dialog's scrollable
  detail region. The reviewer's bulk **Restore validator verdicts** uses it to
  list every point the restore would change and which way each verdict would flip
  (`describeAutoVerdictRestore`), because by the time a reviewer reaches for that
  control they cannot be expected to hold which of their own calls the machine
  disagrees with.

## Theming

The components are themed through a small set of `--tcab-*` CSS custom
properties (a documented token contract with synthwave defaults). Each app
supplies its own values: the site maps them onto its existing palette so the
moved components render exactly as before, and the console apps can theme
themselves independently. No component hard-codes a palette.

## Status

Implemented in `packages/ui`. All three hosts mount the shared `GalleryApp`: the
[site](/components/site/overview/) renders it from the build-time snapshot with
run execution off, and the [web](/components/web/overview/) and
[Tauri](/components/tauri/overview/) consoles render it live with run execution
on, supplying the backend/worker transports behind the client interfaces. The
earlier separate "console" build and the standalone tab console it grew out of
have been retired in favor of this single shared app.
