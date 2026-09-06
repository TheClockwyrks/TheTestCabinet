---
title: Public Gallery
---

The public gallery runs on its own plane, separate from the clusters that hold
the run queue, the harness credentials, and the definition store. This section
covers standing that plane up. The clusters themselves are
[Kubernetes](/deployment/kubernetes/overview/).

## What runs there

| Thing                                                        | Deployed as                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [Gallery origin](/components/site/serving/) (`tcab-gallery`) | An Azure Container App, one image, minimum one replica                                 |
| [Public projection](/components/backend/projection/)         | An Azure Database for PostgreSQL Flexible Server instance, sized for the published set |
| Published documents and media                                | A Cloudflare R2 bucket                                                                 |
| Per-run playable builds, [docs](/components/docs/overview/)  | Cloudflare Pages sites                                                                 |

The origin is one stateless service, so it runs as a Container App rather than a
cluster of its own. The playable builds stay on Pages, where each run's build
holds its own origin and the browser isolates one run's generated code from
another's.

## The boundary

The backend opens every connection between the planes. It writes objects to the
bucket and rows to the projection, and both are outbound from the private
network.

The gallery's subnet routes to the projection database. The projection database
sits in its own subnet, peered to the private network for the backend's writes,
so the origin holds no route toward the clusters. The clusters keep the internal
`Ingress` described in
[Internal ingress](/deployment/kubernetes/internal-ingress/) and stay reachable
over the VPN.

The origin therefore holds read access to published data and nothing else. The
credentials that spend money at a model provider live on the private plane, and
starting a run remains a VPN-only action.

## Identity

The origin authenticates to the projection as a user-assigned managed identity
mapped to a PostgreSQL role holding SELECT on the projection schema. This is the
same passwordless path the backend and auth service use; see
[Passwordless auth with Microsoft Entra](/deployment/kubernetes/postgres/#passwordless-auth-with-microsoft-entra).

Bucket access is a read-only credential scoped to the public bucket.

## DNS and TLS

Cloudflare holds the `testcabinet.ai` and `tcab.ai` zones. Both resolve to the
origin through proxied records, so the CDN fronts it and absorbs traffic the
origin would otherwise serve. The origin accepts requests from the CDN's address
ranges.

The Container App holds a managed certificate for each custom hostname.

## Staging

Staging mirrors the plane: its own Container App, its own projection database,
its own bucket, and its own hostnames. Keep the two identical apart from names
and scale, so staging rehearses a change faithfully.

## Environment

The origin reads its projection connection string, its bucket base URL, and its
`TCAB_ENV` tag from the environment. The `TCAB_ENV` tag names the environment in
[telemetry](/development/observability/) and logs, as it does for every other
service.
