---
title: Overview
---

The auth service is a standalone Rust server that holds The Test Cabinet's user
accounts. It handles registration and login and mints the bearer tokens the
[backend](/components/backend/overview/) verifies on every mutating run request,
so every [review](/components/core/results/#reviews) a run carries is attributed
to a named person.

Accounts live in their own service, so the backend stores no credentials. The
backend treats the auth service as an external dependency it asks who a token
belongs to.

## Identity on a private network

The Test Cabinet's services sit on a private network, so reachability is the
first line of access control. Identity is the layer on top of it that says who
inside the network is acting. Reviews depend on it: an assessment is owned by a
named reviewer, and a run can gather several independent reviews from different
people.

Self-registration is open because reaching the service already requires being on
the private network.

## Responsibilities

The auth service owns user identity end to end:

- Registration. Anyone who can reach the service creates an account with a
  username, a password, and a display name. Passwords are hashed with Argon2id.
  Registration returns a token, so a new account is signed in immediately.
- Login. A username and password are exchanged for an opaque bearer token and
  the account it identifies. That token is what the CLI and the consoles present
  on mutating calls.
- Verification. The backend hands each request's bearer token to the auth
  service, which resolves it to an account or rejects it. This is how the
  backend learns who is acting.
- Logout. A token is revoked.
- Profile pictures. An account sets, replaces, or clears its own avatar, and the
  picture is served publicly by account id.

Its only state is its own accounts database.

## HTTP API

The auth service speaks JSON over HTTP. Bodies are camelCase, matching the rest
of the system's contracts. Tokens are presented as
`Authorization: Bearer <token>`.

- `GET /healthz` — liveness probe.
- `POST /auth/register` — open self-registration. Body
  `{ username, password, displayName }`. Answers `201` with the new account and
  a freshly minted token. `409` when the username is taken, `400` when a field
  is empty or the password is shorter than the minimum length.
- `POST /auth/login` — body `{ username, password }`. Returns
  `{ token, account: { id, username, displayName, pictureUpdatedAt } }`. An
  unknown username and a wrong password produce the identical `401`, so the
  endpoint never reveals which usernames exist.
- `POST /auth/verify` — resolves the presented bearer token to its account, or
  answers `401`. The backend calls this to authenticate each mutating run
  request.
- `POST /auth/logout` — revokes the presented bearer token. Idempotent.
- `PUT /auth/profile/picture` — sets or replaces the signed-in account's avatar.
  The body is the raw image bytes and `Content-Type` names an `image/*` type.
  `415` for another type, `413` past 512 KiB. Requires the account's token.
- `DELETE /auth/profile/picture` — clears the signed-in account's avatar.
  Requires the account's token.
- `GET /auth/users/{id}/picture` — an account's avatar bytes, served with their
  stored content type. An open read, since avatars appear beside published
  reviews. `404` when the account has no picture. An account's
  `pictureUpdatedAt` is the cache-busting version.

The account and token shapes are specified in
[`auth.schema.json`](https://docs.testcabinet.ai/schema/backend-api/auth.schema.json).

## Who talks to it

- The [CLI](/components/cli/overview/) (`tcab register`, `login`, `logout`), the
  [Tauri app](/components/tauri/overview/), and the [web
  console](/components/web/overview/) register and log in against it, then send
  the resulting bearer token to the backend on review and publish. The CLI and
  the Tauri app are pointed at it with `TCAB_AUTH_URL`; the web console takes it
  from the deployment's injected runtime config, falling back to the build-time
  `VITE_AUTH_URL` and then to the backend URL. The CLI stores its token at
  `~/.config/tcab/credentials.json`, overridable with `$TCAB_CONFIG_DIR`.
- The [backend](/components/backend/overview/) verifies tokens against it
  (`TCAB_BACKEND_AUTH_URL`) and fetches reviewer avatars from it when it bakes
  the [public snapshot](/components/backend/snapshot/#reviewer-pictures).

## Configuration

The service is the `tcab-auth-service` binary (`crates/auth-service`): an Axum
server over its own account store, with Argon2id password hashing and opaque
bearer tokens. It is configured entirely through environment variables, all of
which have defaults.

| Variable | Purpose | Default |
| --- | --- | --- |
| `TCAB_AUTH_BIND` | Bind address. | `127.0.0.1:8789` |
| `TCAB_AUTH_DATABASE_URL` | Its own accounts database, separate from the backend's; the scheme picks SQLite or PostgreSQL. | `sqlite://./tcab-auth.sqlite?mode=rwc` |
| `TCAB_AUTH_DB_AZURE_AD` | Authenticate to PostgreSQL with a Microsoft Entra managed-identity token. | `false` |

Like the backend, the auth service has no public surface and lives on the
private network. It stores Argon2id password hashes, which the
[backups](/deployment/backups/) page covers alongside the backend's database.
