# Serve the gallery from an origin with share links

This issue follows the v0.7.0 tag and is v0.8.0 work. Replace the static
gallery with a server-routed origin reading a public projection, and ship
short share links for published runs.

## Current state

The gallery at testcabinet.ai is `apps/site`, a static Vite build on Cloudflare
Pages that holds the whole published snapshot in memory. Every run page is
answered with the same document, so a run link shared elsewhere carries no
per-run preview and a missing run cannot be answered with a 404. Nothing mints
a short link.

The design for the origin is parked on `feat/share-links` by
[`move-the-gallery-origin-design-pages-onto-the-share-links-branch.md`](move-the-gallery-origin-design-pages-onto-the-share-links-branch.md):
the site serving page, the backend projection page and the public gallery
deployment page. Those pages are the authoritative design and this issue
summarizes them.

## Design

### The public projection

The backend writes a public projection in Azure Database for PostgreSQL as
part of publishing: one row per published run holding its summary fields and
the object key of its full document, one row per case version a published run
built, one row per model a published run references, and one row per short
code. The projection is written after the run's document and media reach the
public bucket, so the row is what makes a run visible, and it is removed when
a run is unpublished or deleted. Provider tokens are scrubbed before upload.

### The origin

`tcab-gallery` is a Node service on an Azure Container App. It mounts the
same routed application the web console renders, with execution disabled, and
resolves routes from that application's own route table. A path the table
addresses is answered with the shell and a 200, any other path with the shell
and a 404, and a run-shaped path with a 404 unless the run is published. Each
run page carries preview tags written from its projection row, and the origin
embeds the first page of results in the document it serves.

Documents, event streams and media are read by the browser from the public
bucket and cache indefinitely. Index-shaped questions read the projection.
Per-run playable builds stay on Pages.

### Share links

tcab.ai resolves through the same origin. `/r/<code>` redirects to the run's
verdict page and `/p/<code>` to its play page, and a code addresses the same
run for as long as that run is published. The backend mints the code at
publish time and stores it on the run's projection row. The console gains a
share control that offers both links for a published run.

### Identity and deployment

The origin authenticates to the projection as a user-assigned managed identity
mapped to a PostgreSQL role holding SELECT on the projection schema, and reads
the bucket with a read-only credential scoped to it. The origin image is built
and rolled by the Azure pipeline beside the service images, and the design
pages move back onto the release branch as the origin ships.

## Done when

- [ ] Publishing a run writes its projection rows and its short code, and
      unpublishing removes them.
- [ ] `tcab-gallery` serves testcabinet.ai from a Container App, answers
      each URL with the status it deserves, and writes per-run preview tags.
- [ ] `tcab.ai/r/<code>` and `tcab.ai/p/<code>` resolve to the run's verdict
      and play pages.
- [ ] The console offers both share links for a published run.
- [ ] The pipeline builds and rolls the origin with the other services.
- [ ] The site, backend and deployment docs describe the origin as shipped.
- [ ] Gates green.
