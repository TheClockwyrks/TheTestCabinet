---
title: Public Gallery
---

The public gallery runs on Cloudflare, on a plane of its own, separate from the
clusters that hold the run queue, the harness credentials, and the definition
store. This section covers standing that plane up. The clusters themselves are
[Kubernetes](/deployment/kubernetes/overview/).

## What runs there

| Thing                                                                                 | Deployed as                                                           |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [The gallery shell](/components/site/serving/) (`apps/site`)                          | The Pages project `the-test-cabinet`, custom domain `testcabinet.ai`  |
| The preview-tag Worker (`tcab-preview-tags`)                                          | A Worker on the route `testcabinet.ai/runs/*`, bound to the bucket    |
| The share-link Worker (`tcab-share-links`)                                            | A Worker on the route `tcab.ai/*`, bound to the bucket                |
| [Published documents, media, index objects, and codes](/components/backend/snapshot/) | The R2 bucket `snapshot.testcabinet.ai`, served at that custom domain |
| Per-run playable builds, [docs](/components/docs/overview/)                           | Cloudflare Pages sites                                                |

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

Each Worker's bucket binding is read-only, and the bucket's custom domain is a
public read. The credentials that spend money at a model provider live on the
private plane, and starting a run remains an action behind Access.

## The Workers

Both Workers live in the `testcabinet.ai` repository, each with its own
`wrangler.toml`, and are deployed with `wrangler deploy`.

The preview-tag Worker declares the bucket as the R2 binding `SNAPSHOT` and
takes the Pages project's origin as the variable `SHELL_ORIGIN`, which it
fetches the shell from. Its route is `testcabinet.ai/runs/*`.

The share-link Worker declares the same binding and takes the gallery's public
origin as `GALLERY_ORIGIN`, the prefix of every redirect it issues. Its route
is `tcab.ai/*`.

## DNS and TLS

Cloudflare holds the `testcabinet.ai` and `tcab.ai` zones. `testcabinet.ai` is
the gallery Pages project's custom domain, `snapshot.testcabinet.ai` is the
bucket's custom domain, and `tcab.ai` is the share-link Worker's route, each a
proxied record whose certificate Cloudflare issues. `docs.testcabinet.ai` is the
docs Pages project's custom domain.

## Deploying

The `testcabinet.ai` repository's pipeline builds the shell and deploys it with
`wrangler pages deploy`, and deploys both Workers with `wrangler deploy`, under
an API token holding Pages and Workers edit on the account. A publish writes the
bucket, which the shell and the Workers read at request time, so nothing on the
plane redeploys when a run publishes.

## Staging

Staging mirrors the plane under its own names: the Pages project
`the-test-cabinet-staging` at `staging.testcabinet.ai`, the bucket
`snapshot.staging.testcabinet.ai` at that custom domain, the preview-tag Worker
on `staging.testcabinet.ai/runs/*`, and the share-link Worker on
`staging.tcab.ai/*`, each bound to the staging bucket. Keep the two identical
apart from names, so staging rehearses a change faithfully.

## Environment

The shell's build takes `TCAB_SNAPSHOT_URL`, the bucket's public base it fetches
`index.json` from, so the prod and staging builds differ in that one value. Each
Worker takes its bucket binding and its origin variable from its `wrangler.toml`
environment.
