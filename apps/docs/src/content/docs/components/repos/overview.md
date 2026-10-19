---
title: Overview
---

The repos service owns each run's implementation as a git repository. The
[driver](/components/driver/overview/) commits the model's work at run end and
uploads the repository as a git bundle, the service stores the bundle, and the
[backend](/components/backend/overview/) serves it from here to a
[console](/components/web/overview/), a reviewer or a re-analysis. When a run
[publishes](/components/backend/results/#publish), the service creates the
run's public GitHub repository and pushes the bundle to it.

The service is a data-plane peer of the
[artifacts service](/components/artifacts/overview/). Artifacts holds what a run
produced as files; repos holds the same work as history, so the implementation
can be cloned, diffed against its seed and published as a repository.

## The bundle

A run's working tree is a git repository seeded with the test case's starter
workspace, whose first commit is the seed commit. At run end the driver commits
everything the model left uncommitted on top of the history the run holds, with
the commit message the [contract](/components/contracts/overview/) defines,
writes `git bundle --all` and uploads it. The bundle therefore carries the seed
commit and the implementation on `main`, so the model's work is the diff between
the seed commit and the tip.

The driver's [code analysis](/components/driver/overview/#code-analysis) runs on
the local tree before the upload, so the recorded analysis and the bundle
describe the same commit.

An [asset-generation](/testing/asset-generation/overview/) run uploads a bundle
like any other run, since its workspace is a seeded repository. Its authoritative
output is the recorded operation log on the artifacts service, so publishing one
creates no public repository and the run carries no source link.

## Routes

The path `{id}` on every route is the run record's id.

| Route                      | Caller                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| `POST /runs/{id}/bundle`   | The driver, uploading the run's bundle                                    |
| `GET /runs/{id}/bundle`    | The backend, serving a download to a console, a reviewer or a re-analysis |
| `POST /runs/{id}/publish`  | The publisher Job, creating the public repository and pushing to it       |
| `DELETE /runs/{id}/bundle` | The backend, pruning a deleted run's bundle                               |

The bundle is served as `application/octet-stream` under the file name
`<run-id>.bundle`, and `git clone <run-id>.bundle` recreates the repository.

### Publishing

`POST /runs/{id}/publish` releases the run's implementation:

1. Create the run's public repository, `tcab-<slug>`, under the GitHub
   organization `TCAB_GITHUB_ORG` names, `TheClockwyrks` in prod and
   `TheClockwyrks-Staging` in staging, where `<slug>` is built from the run's
   case, harness, model and a prefix of the run id.
2. Unpack the bundle, scrub every file with the shared
   [redaction](/components/backend/results/#secret-redaction), and commit the
   scrubbed tree on top of the bundle's tip.
3. Push `main` and answer the repository's URL.

The scrub reaches every commit the bundle carries, not the tip's tree alone,
since a push of `main` sends the whole history: a commit whose files held a key
is recreated over its scrubbed tree with its own message, author, committer and
dates, and a commit whose files hold none is pushed as it is.

The route is idempotent, so a publish repeated after a failure at any step
completes it. The commit is deterministic: its message is fixed, its author and
committer are `Clockwyrks <runs@clockwyrks.invalid>`, and both its dates are the
run's end time from its record, so a repeat over the same bundle reproduces the
same SHA. A repository that already exists is reused. The push is a plain push
of `main`, and a remote whose `main` already holds the same tree is a success
whatever commit carries it, so a repeat after a push that landed answers the
URL. The first push after a create is retried with backoff, so GitHub's
permission-propagation lag after a create self-heals. The publisher presents its
per-publish-job token, and a second publish Job for the same run answers the
same URL.

## Storage

Bundles live in a private Azure Blob container of the service's own, one object
per run, authenticated by the service's managed identity. The service is
stateless and scales horizontally. A bundle is written once and replaced only by
a later upload for the same run.

## Auth

The repos service has no Kubernetes API access. It only talks HTTP.

- The upload presents the driver's per-job token, which the service forwards to
  the [backend](/components/backend/overview/) to verify, with the job id in the
  `x-tcab-job-id` header, exactly as an artifacts upload does.
- The publish presents the per-publish-job token, verified against the backend's
  publish-job endpoint, with the publish job id in the
  `x-tcab-publish-job-id` header.
- The download and the delete present the shared control-plane service token
  (`TCAB_BACKEND_SERVICE_TOKEN`). The service sits behind no
  [edge](/deployment/kubernetes/edge/) path: the backend answers a console's
  `GET /runs/{id}/bundle` at `/api/`, verifying the Access assertion before it
  fetches the bundle from here.

The GitHub token the publish uses is the service's own secret. No other
component holds it, and the publisher Job holds only the Cloudflare credential
its Pages deploy needs.

## Deployment

The repos service is the `tcab-repos` binary of the `microservice-repos`
repository, an Axum server over its Blob container, with `git` on its image. Its
configuration is entirely environment variables, documented in the repository's
`crates/repos/src/config.rs`: the container's account and name, the backend URL
the tokens are verified against, the service token, and the GitHub organization
and token.

It binds all interfaces by default (`0.0.0.0:8792`), and is deployed as a
`Deployment` behind a `ClusterIP` `Service`, with its own `ServiceAccount` with
no API access and the workload identity its managed identity binds to. See
[Run plane](/deployment/kubernetes/run-plane/).
