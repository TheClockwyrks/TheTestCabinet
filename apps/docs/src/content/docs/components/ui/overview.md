---
title: Overview
---

The UI library (`@test-cabinet/ui`, in `packages/ui`) is the shared frontend
code for The Test Cabinet's three GUIs — the [public site](/components/site/overview/),
the [web console](/components/web/overview/), and the
[Tauri app](/components/tauri/overview/). It exists so those GUIs share one set
of components and one definition of the concepts they all render, rather than
each re-implementing them.

It is a code-sharing library, not a component itself: it ships no service and
runs in no process of its own. Each GUI bundles the parts of it that it needs.

## What it provides

- **Presentational primitives** — the brand-neutral building blocks every GUI
  uses: the Markdown renderer, the rating badge, panels, the metric tile, the
  spec/reference accordion, pagination, and the chart wrapper. The site uses
  these in its gallery; the console uses them in its screens.
- **The runner/reporter console** — the full console UI (the Run, Specs, Runs &
  Review, and Connections screens and the app shell) that the
  [web](/components/web/overview/) and [Tauri](/components/tauri/overview/) apps
  both mount. This is shared by those two but not the site.
- **The client interfaces** — the `BackendClient` and `WorkerClient` interfaces
  the console is written against, plus the React contexts that supply them. The
  console depends only on these interfaces; each app provides a transport (HTTP
  in the web app, Tauri commands in the desktop app) behind them. This is what
  lets one console serve both apps.
- **The rating model** — the `Rating` tiers and their display metadata, mirroring
  the [reviews](/components/core/results/#reviews) model in the core, so every
  GUI shows ratings identically.

## Theming

The components are themed through a small set of `--tcab-*` CSS custom
properties (a documented token contract with synthwave defaults). Each app
supplies its own values: the site maps them onto its existing palette so the
moved components render exactly as before, and the console apps can theme
themselves independently. No component hard-codes a palette.

## Status

Implemented in `packages/ui`. The site consumes the primitives; the
[web console](/components/web/overview/) consumes the console, the client
interfaces, and the primitives. The Tauri app's adoption of the shared console
is the next step (see the [Roadmap](/roadmap/)).
