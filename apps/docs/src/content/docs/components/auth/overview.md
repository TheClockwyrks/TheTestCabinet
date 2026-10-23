---
title: Overview
---

Identity in The Test Cabinet is Cloudflare Access in front of every
environment, with Microsoft Entra ID as the identity provider. A person signs
in once at the Microsoft login page, Cloudflare attaches a signed assertion to
every request that crosses the edge, and the services verify that assertion
themselves. The services hold no login of their own, and what a
[review](/components/backend/results/#reviews) records is the identity the
assertion carries.

The edge itself, the tunnel, the Access applications, the hostnames and the
DNS, is built in [Edge](/deployment/kubernetes/edge/). This page is the contract
between the edge and the services, and between the services and their clients.

## The assertion

Every request that passes an Access application carries the header
`Cf-Access-Jwt-Assertion`, a JWT signed by the team's Access instance. The
[backend](/components/backend/overview/), the
[artifacts service](/components/artifacts/overview/) and the
[arena](/components/arena/overview/) verify it on every request that arrives
through the edge:

- the signature, against the keys published at
  `https://shrill-term-5c16.cloudflareaccess.com/cdn-cgi/access/certs`, which
  a service caches and refreshes when a token names a key the cached set lacks;
- the `aud` claim, which must contain the audience tag of the Access
  application the service sits behind;
- the expiry.

A request that carries no valid assertion and none of the in-cluster tokens
below is refused with `401`. The check is the same for a read and a write, so
every route a browser or the CLI can reach is behind a verified identity.

The assertion names one of two kinds of caller:

- A person. The `email` claim is the identity: it is what a review is
  attributed to and what the console shows beside it.
- A service token. The assertion carries the token's `common_name` and no
  `email`. The mutating routes automation drives (ingest, a snapshot refresh,
  tournaments, the reference-build writes and the CLI's public object writes)
  take a service token, and a review submitted under one is attributed to the
  token's name.

## Configuration

Each service that sits behind the edge reads two variables:

| Variable                  | Purpose                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TCAB_ACCESS_TEAM_DOMAIN` | The Access team domain, `shrill-term-5c16.cloudflareaccess.com`, whose certificates sign the assertion |
| `TCAB_ACCESS_AUDIENCE`    | The audience tag of the Access application that protects the service's hostname                        |

The backend, the artifacts service and the arena share one hostname per
environment, so they carry the same audience tag. The
[repos service](/components/repos/overview/) sits behind no edge path: the
backend serves a bundle download on its behalf. With
`TCAB_ACCESS_AUDIENCE` unset, the `local` overlay's shape, a service performs no
verification and takes the identity from the `Cf-Access-Authenticated-User-Email`
header as presented, which is what the local console and a local `tcab` send,
`dev@local` by default.

## In-cluster callers

A caller inside the cluster never crosses the edge and presents a token the
backend minted or shares:

- The [dispatcher](/components/dispatcher/overview/) presents the shared
  service token, `TCAB_BACKEND_SERVICE_TOKEN`, to claim queued runs and publish
  jobs. The backend presents the same token to the artifacts and repos services
  for the writes only it may make and for the bundle reads it serves.
- A [driver](/components/driver/overview/) `Job` presents the per-job token
  the dispatcher passed in, on every report to the backend and on its uploads to
  the artifacts and repos services, which forward it to the backend to verify.
- A publisher `Job` presents its per-publish-job token the same way.
- The backend pod's ingest sidecar calls `POST /ingest` on the backend's
  in-cluster `Service` and presents the shared service token.

## Clients

- The [console](/components/web/overview/) runs in a browser that holds the
  Access cookie for its origin. The edge turns the cookie into the assertion on
  every request to `/api/`, `/artifacts/` and `/arena/`, so the console stores
  no token and presents no login form. Signing out is the edge's
  `/cdn-cgi/access/logout` on the origin.
- The [operator client](/components/client/overview/) is a WebView on the same
  origin, and holds the same cookie.
- The [CLI](/components/cli/overview/) presents an Access credential on every
  request to a deployed environment. A service token is the pair
  `TCAB_ACCESS_CLIENT_ID` and `TCAB_ACCESS_CLIENT_SECRET`, sent as the
  `CF-Access-Client-Id` and `CF-Access-Client-Secret` headers, and is what
  automation and CI use. A person's own identity is a user token from
  `cloudflared access login` on the environment's origin, placed in
  `TCAB_ACCESS_TOKEN` and sent as the `cf-access-token` header. The CLI reaches
  the backend at the origin's `/api` path, so `TCAB_BACKEND_URL` is
  `https://console.testcabinet.ai/api` for prod.

## Policy

An Access application admits a person by their email address, listed in the
application's policy, and by the Entra ID login method alone. Multi-factor
authentication, lockout and conditional access are Entra's, and Cloudflare's
WAF and rate limiting sit in front of the origin. Granting or revoking access is
an edit of the policy, with nothing to deploy. See
[Access applications](/deployment/kubernetes/edge/#access-applications).
