---
title: Serving
---

The gallery is a static shell on Cloudflare Pages that reads the public dataset
from the bucket at runtime, with two Workers beside it: one writes a run page's
preview tags and decides its status, and one resolves share links. A published
run reaches visitors as soon as its publish has written the bucket, with no
build in between.

## The static shell

`apps/site` in the `testcabinet.ai` repository builds the shell, deployed to
the Pages project that serves [testcabinet.ai](https://testcabinet.ai). It
mounts the same routed application the [console](/components/web/overview/)
mounts, shared through [`ui-common`](/components/ui/overview/), with execution
disabled so it presents the published gallery alone.

Pages serves the shell for every path the project holds no file for, at the URL
requested and with a 200, so a deep link such as `/runs/<id>` resolves directly
and the application's catch-all route renders the not-found page for a path its
route table does not address. The console-only routes the gallery leaves
unmounted are answered that way too.

## Reading the dataset

The shell reads the bucket described in [Public
Snapshot](/components/backend/snapshot/) over its public hostname,
`snapshot.testcabinet.ai`, which the build takes as `TCAB_SNAPSHOT_URL`. On load
it fetches `index.json` and follows it to the run index, the model catalog, the
comparison index, the test-case group set, and the gg document corpus, which
together are what the list, home, leaderboard, model, and Discover views read,
and mounts its routes once they are in. It then reads the case metadata of every
case version the run index names, and the case showcases, from which it builds
the case catalog, while the pages already render. A run's document, its code
analysis, and its media are fetched when the page that shows them opens.

Listing pages are answered in the browser from the run index with the same
paged, filtered, sorted semantics as the console's backend query, so paging is
identical on either host. A bucket with no `index.json`, which is a deployment
nothing has been published to yet, renders the empty states.

## Preview tags and status

A Worker is routed in front of the gallery's run routes, `/runs/<id>` and every
path beneath it. It reads `index.json`, takes the run's summary card from that
generation's run index, and answers one of two ways:

- A published run: the Pages shell with the run's title, description, and image
  written into the document head as preview tags, with a 200. Every visitor is
  served the same document.
- An unknown id: the shell with a 404, and the application renders the
  not-found page inside it.

The gallery's own pages beneath `/runs/`, the comparisons index at
`/runs/comparisons` and `/runs/` itself, are the shell with a 200 and no tags.
While the bucket cannot be read, every run route is answered with the shell
with a 200, uncached and without tags, since the application reads the bucket
for itself and may still load.

The title and the description are written from the card: the case, the model
and the harness, and the run's rating, score and review count. The image is the
first still image of the run's document, which the card names by its
`documentKey`, taken in the order the run's page presents its media: the
showcase, then the produced asset, then the proof. A run with none is given no
image, and its card is a summary card without one.

The Worker holds a generation's run index in memory for as long as the pointer
names it, because a generation is never rewritten, and a run's document for as
long as it can, because the document's key is content-addressed. It reads the
pointer again once the pointer's freshness window has passed. Every other route
is served by Pages directly.

## Share links

[tcab.ai](https://tcab.ai) is a Worker bound to the bucket. `/r/<code>` reads
the object `codes/<code>` and redirects with a 302 to the run's verdict page,
`https://testcabinet.ai/runs/<id>/verdict`; `/p/<code>` redirects the same way
to its play page, `https://testcabinet.ai/runs/<id>`. A code the bucket holds
no object for is answered with a 404, and so is any other path, except the bare
host, which redirects to the gallery's home page. A code addresses the same run for as long
as the gallery exists, because it is [assigned
once](/components/backend/snapshot/#short-codes) and never reassigned.

## The public read surface

Everything on the public plane reads. The shell fetches public objects, each
Worker only reads its bucket binding, and each Worker answers GET and HEAD
alone.
Enqueueing a run, reviewing, and publishing stay behind
[Access](/components/auth/overview/) on the private plane, so the credentials
that spend money live only there.

## Caching

The shell, the Workers' responses, and the bucket's objects are served through
Cloudflare's cache with explicit cache headers. `index.json` takes a short
freshness window, because a publish replaces it, and a miss on a `codes/`
object is left uncached, because the next publish may write it. Every other
object is immutable once written: a generation's index objects, a run's
document, a `codes/` object, and media are cached indefinitely.

The headers are these:

| Response                                  | `Cache-Control`                       |
| ----------------------------------------- | ------------------------------------- |
| `index.json`                              | `public, max-age=60`                  |
| Every other bucket object                 | `public, max-age=31536000, immutable` |
| A bucket miss, a `codes/` miss included   | Left uncached                         |
| A published run's page, from the Worker   | `public, max-age=60`                  |
| An unknown run id's page, from the Worker | `no-store`                            |
| A share link's redirect                   | `public, max-age=31536000, immutable` |
| The bare `tcab.ai` host's redirect        | `public, max-age=3600`                |
| An unknown share code                     | `no-store`                            |

The [artifacts service](/components/artifacts/overview/) stores a bucket
object's header on the object when it writes it, so the bucket's custom domain
serves it with the object. A Worker's response carries its header to the
browser and to any cache downstream of it, and the Worker holds what it reads
from the bucket in memory. A run's page holds a minute because a publish or a
deploy may change it.

## Staging

Staging mirrors the plane under its own names: the `staging.testcabinet.ai`
Pages project, the preview-tag Worker on its run routes, the `staging.tcab.ai`
Worker, and the staging bucket at `snapshot.staging.testcabinet.ai`. Apart from
the hostnames and the bucket the two are identical, so staging rehearses a
change faithfully. The projects, routes, and bindings are listed in [Public
Gallery](/deployment/public-gallery/).
