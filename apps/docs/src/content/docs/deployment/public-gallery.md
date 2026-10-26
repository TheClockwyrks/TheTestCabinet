---
title: Public Gallery
---

The public gallery runs on Cloudflare, on a plane of its own, separate from the
clusters that hold the run queue, the harness credentials, and the definition
store. This section covers standing that plane up. The clusters themselves are
[Kubernetes](/deployment/kubernetes/overview/).

## What runs there

| Thing                                                                                 | Deployed as                                                          |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [The gallery shell](/components/site/serving/) (`apps/site`)                          | The Pages project `the-test-cabinet`, custom domain `testcabinet.ai` |
| The preview-tag Worker (`tcab-preview-tags`)                                          | A Worker on the route `testcabinet.ai/runs/*`, bound to the bucket   |
| The share-link Worker (`tcab-share-links`)                                            | A Worker on the custom domain `tcab.ai`, bound to the bucket         |
| [Published documents, media, index objects, and codes](/components/backend/snapshot/) | The R2 bucket `tcab-snapshot`, at `snapshot.testcabinet.ai`          |
| Per-run playable builds, [docs](/components/docs/overview/)                           | Cloudflare Pages sites                                               |

Nothing on the plane is a server of the project's own. The shell and the per-run
builds are static files on Pages, where each run's build holds its own origin
and the browser isolates one run's generated code from another's, and the two
Workers are the only code that runs at request time.

## The boundary

The [artifacts service](/components/artifacts/overview/) is the one writer of the
bucket, over an R2 API token scoped to that bucket with object read and write,
held in the cluster. The backend writes the public snapshot through it, so every
connection between the planes is outbound from the cluster and nothing on the
public plane holds a route into it. The clusters are reached through the
[edge](/deployment/kubernetes/edge/) alone.

Each Worker only reads its bucket binding, and the bucket's custom domain is a
public read. The shell reads the bucket from the gallery's origin, so the
bucket carries a CORS policy allowing `GET` from `https://testcabinet.ai`, and
the staging bucket one allowing it from `https://staging.testcabinet.ai`; a
development server reading a bucket adds its own origin to that bucket's
policy. The credentials that spend money at a model provider live on the
private plane, and starting a run remains an action behind Access.

## The Workers

Both Workers live in the `testcabinet.ai` repository, `apps/preview-tags` and
`apps/share-links`, each with its own `wrangler.toml` declaring a `production`
and a `staging` environment, and are deployed with `wrangler deploy --env`.
Each reads its binding alone and answers GET and HEAD alone.

The preview-tag Worker declares the bucket as the R2 binding `SNAPSHOT` and
takes the Pages project's origin as the variable `SHELL_ORIGIN`, which it
fetches the shell from, `https://the-test-cabinet.pages.dev`, and the bucket's
public origin as `SNAPSHOT_ORIGIN`, the prefix of a preview image's URL. Its
route is `testcabinet.ai/runs/*`.

The share-link Worker declares the same binding and takes the gallery's public
origin as `GALLERY_ORIGIN`, the prefix of every redirect it issues. Its
hostname is the Worker custom domain `tcab.ai`, which answers every path of the
host.

## DNS and TLS

Cloudflare holds the `testcabinet.ai` and `tcab.ai` zones. `testcabinet.ai` is
the gallery Pages project's custom domain, `snapshot.testcabinet.ai` is the
bucket's custom domain, and `tcab.ai` is the share-link Worker's custom domain,
each a proxied record whose certificate Cloudflare issues. The Worker's deploy
creates its record, so the `tcab.ai` zone needs no record of its own
beforehand. `docs.testcabinet.ai` is the docs Pages project's custom domain.

## Deploying

The `testcabinet.ai` repository's pipeline builds the shell and deploys it with
`wrangler pages deploy`, and deploys both Workers with `wrangler deploy`
(`scripts/ci/deploy-workers.sh`), `master` their `production` environment and
`staging` their `staging` one. Its API token holds Pages and Workers Scripts
edit on the account, and Workers Routes and DNS edit on the `testcabinet.ai` and
`tcab.ai` zones. A publish writes the
bucket, which the shell and the Workers read at request time, so nothing on the
plane redeploys when a run publishes.

## Staging

Staging mirrors the plane under its own names: the Pages project
`the-test-cabinet-staging` at `staging.testcabinet.ai`, the bucket
`tcab-snapshot-staging` at the custom domain `snapshot.staging.testcabinet.ai`,
the preview-tag Worker `tcab-preview-tags-staging` on
`staging.testcabinet.ai/runs/*`, and the share-link Worker
`tcab-share-links-staging` at the custom domain `staging.tcab.ai`, each bound
to the staging bucket. Keep the two identical
apart from names, so staging rehearses a change faithfully.

## Environment

The shell's build takes `TCAB_SNAPSHOT_URL`, the bucket's public base it fetches
`index.json` from, so the prod and staging builds differ in that one value. Each
Worker takes its bucket binding and its origin variables from its
`wrangler.toml` environment.
