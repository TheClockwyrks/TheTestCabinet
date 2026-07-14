---
title: Register and Log In
---

Pushing, reviewing, and publishing a run are attributed to a real
[account](/components/backend/overview/#accounts), so before you do any of them you
need to register once and log in. Accounts live in the standalone
[auth service](/components/auth/overview/); reading the gallery or the catalog
needs no account. This is **user** authentication — distinct from
[harness authentication](/quickstarts/setup/set-up-authentication/), which is the
provider credential a run's model needs.

## Register

Create an account on the auth service. You supply a username and a display name
(the name shown beside your reviews); the password is prompted for, or passed with
`--password`:

```sh
tcab register --username ada --display-name "Ada"
```

Registration is **open** — anyone who can reach the auth service on the private
network can create an account — and it logs you in, storing the resulting bearer
token at `~/.config/tcab/credentials.json` (override the location with
`$TCAB_CONFIG_DIR`).

## Log in

On another machine, or after logging out, sign in with your username:

```sh
tcab login --username ada
```

The password is prompted interactively, or supplied with `--password` or the
`TCAB_PASSWORD` environment variable (handy for scripts and CI). Login stores the
same bearer token, which the CLI then sends on every push, review, and publish.

## Log out

Discard the stored token when you are done:

```sh
tcab logout
```

## Point at the auth service

The CLI, the desktop app, and the web console reach the auth service through
`TCAB_AUTH_URL`. In a console, you sign in from the UI rather than the shell: the
top bar's account control links to a dedicated sign-in (and registration) page,
and once signed in the same control opens your account page, where you can sign
out. The [web console](/components/web/overview/) authenticates through the
worker, which proxies registration and login to the auth service for it.

## Next steps

- [Review a Run](/quickstarts/development/review-a-run/) — submit an assessment, attributed to
  your account.
- [Publish a Run](/quickstarts/devops/publish-a-run/) — push, review, and publish a run to
  the gallery.
