---
title: Serving
---

The gallery is served by an origin that resolves routes before it answers. The
origin decides the status a URL is answered with, writes each run page's preview
tags, and reads the published set at request time, so a published run reaches
visitors without a rebuild.

## The origin

`tcab-gallery` is a Node service that serves [testcabinet.ai](https://testcabinet.ai).
It mounts the same routed application the [web](/components/web/overview/) and
Tauri consoles mount, shared through the [UI library](/components/ui/overview/),
with execution disabled so it presents the published gallery alone. It resolves
routes from that application's own route table, so the routes the origin
resolves and the routes the application renders are one definition.

The service ships as a container image built alongside the other service images
and runs on the plane described in [Public Gallery](/deployment/public-gallery/).

## Route resolution

A path the route table addresses is answered with the application shell and
a 200. Any other path is answered with the shell and a 404, and the
application's catch-all route renders the not-found page inside it. A path
shaped like a run page is answered with a 404 unless its run id names a
published run.

Every route is served at the URL requested, so a deep link such as `/runs/<id>`
resolves directly. The console-only routes the gallery leaves unmounted are
answered as unrecognized paths.

## Preview tags

Each run page carries preview tags describing that run: its title, description,
and image, written into the document head from the run's projection row. Every
visitor is served the same document.

## Data sources

The gallery reads two stores, split by whether the answer is a document or a
query.

A run's full record, its event stream, and all media are objects in the public
bucket, addressed by content and fetched by the browser. These reads reach
neither the origin nor the database, and the objects they name are immutable, so
they cache indefinitely.

Index-shaped questions are answered from the
[public projection](/components/backend/projection/): run listings, search,
leaderboards, model pages, and short-code lookups. The origin queries the
projection and embeds the first page of results in the document it serves, so a
page renders from one request.

## Short links

[tcab.ai](https://tcab.ai) resolves through the same origin. `/r/<code>` and
`/p/<code>` look the code up in the projection and redirect to the run's verdict
or play page. A code addresses the same run for as long as that run is published,
because it is [assigned once](/components/backend/projection/#short-codes) and
stored.

## The public read surface

The origin serves reads. Its database role holds SELECT on the projection schema,
its object-store access is read-only, and every route it exposes is a GET.
Enqueueing a run, reviewing, and publishing stay on the private plane, so the
credentials that spend money live only there.

The endpoints that serve client-side navigation accept an allowlisted set of sort
keys and a capped page size, so each request maps to an indexed query over a
bounded result set. The projection role carries a statement timeout and a
connection cap.

## Caching

Responses are served through a CDN and carry explicit cache headers. Listing
responses take a short freshness window, because a publish changes them. Per-run
documents and media are addressed by content and are cached indefinitely.
