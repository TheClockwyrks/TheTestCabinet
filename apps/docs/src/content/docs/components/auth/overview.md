---
title: Overview
---

The auth service is a small, standalone Rust server that holds The Test Cabinet's
**user accounts**. It exists so that every [review](/components/core/results/#reviews)
a run carries can be attributed to a real person rather than being anonymous: it
handles registration and login, and mints the bearer tokens the
[backend](/components/backend/overview/) verifies on every mutating run request.

Keeping accounts in their own service — separate from the backend — means the
backend never stores credentials. The backend treats the auth service as an
external dependency it asks "who is this token?", and nothing more.

## Why a separate service

The Test Cabinet's services sit on a **private network**, so reachability is the
first line of access control (see
[Backend authentication](/components/backend/overview/#authentication)). That keeps
the public internet out, but on a shared private network it does not say *who*
inside it is acting. Reviews need that: a benchmark is more credible when each
assessment is owned by a named reviewer, and when a run can gather several
independent reviews from different people.

The auth service adds exactly that identity layer, and nothing more. It is an
*addition* to the network boundary, not a replacement: open self-registration is
acceptable precisely because reaching the service already requires being on the
private network. There is no public sign-up surface.

## Responsibilities

The auth service owns user identity end to end:

- **Self-registration.** Anyone on the private network can create an account with a
  username, a password, and a display name. Passwords are hashed with **Argon2id**;
  a plaintext password is never stored.
- **Login.** A username and password are exchanged for an **opaque bearer token**
  and the account it identifies. The token is what runners, the consoles, and the
  worker present on mutating calls.
- **Verification.** The backend hands each request's bearer token to the auth
  service, which resolves it to an account (or rejects it). This is the only way
  the backend learns who is acting; it stores no credentials of its own.
- **Logout.** A token can be invalidated.

It does **not** distribute definitions, store run results, render anything, or
reach the public internet. Its only state is its own accounts database.

## HTTP API

The auth service speaks JSON over HTTP. Bodies are camelCase, matching the rest of
the system's contracts. Tokens are presented as `Authorization: Bearer <token>`.

- **`POST /auth/register`** — open self-registration. Body
  `{ username, password, displayName }`. Creates the account.
- **`POST /auth/login`** — body `{ username, password }`. On success returns
  `{ token, account: { id, username, displayName } }`: the opaque bearer token and
  the account it identifies.
- **`POST /auth/verify`** — given a bearer token (the `Authorization` header),
  resolves it to its account, or rejects it. Used by the
  [backend](/components/backend/overview/) to authenticate each mutating run
  request; it is not a surface end users call directly.
- **`POST /auth/logout`** — invalidates the presented bearer token.

The account and token shapes are specified in
[`backend-api/auth.schema.json`](https://docs.testcabinet.ai/schema/backend-api/auth.schema.json).
The [backend](/components/backend/overview/) **proxies** `POST /auth/register` and
`POST /auth/login` so the consoles have a single origin to talk to, and verifies a
user's bearer token against the auth service on push, review, and publish.

## Who talks to it

- The [CLI](/components/cli/overview/) (`tcab register` / `login` / `logout`), the
  [Tauri app](/components/tauri/overview/), and the
  [web console](/components/web/overview/) call it to register and log in, then send
  the resulting bearer token on push/review/publish. They are pointed at it with
  `TCAB_AUTH_URL`. The CLI stores its token at `~/.config/tcab/credentials.json`
  (overridable with `$TCAB_CONFIG_DIR`).
- The [backend](/components/backend/overview/) proxies register/login to it and
  verifies tokens against it (`TCAB_BACKEND_AUTH_URL`, default
  `http://127.0.0.1:8789`).

## Status

The auth service ships in [v0.3.0](/changelogs/v0.3.0/) as the
`tcab-auth-service` crate (`crates/auth-service`): an Axum server with its own
SQLite store of accounts, Argon2id password hashing, and opaque bearer tokens. It
is configured entirely through environment variables:

- `TCAB_AUTH_BIND` — its bind address (default `127.0.0.1:8789`). The backend binds
  to `8787` and the worker to `8788`, so the three coexist on one host (local dev)
  or as distinct `Service`s in a namespace (a [cluster deployment](/deployment/kubernetes/))
  without colliding.
- `TCAB_AUTH_DATABASE_URL` — its **own** accounts database, separate from the
  backend's database (SQLite by default, or an external database).

Like the backend, it has no public surface and is meant to live on the private
network; it stores only Argon2id password hashes, which the
[backups](/deployment/backups/) page covers alongside the backend's database.
