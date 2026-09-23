---
title: Register and Log In
---

## Overview

Launching a run, reviewing, and publishing are attributed to an account. Accounts
live in the [auth service](/components/auth/overview/), which the CLI and the
web console reach through `TCAB_AUTH_URL`. Reading the gallery or the catalog needs
no account.

This is user authentication. The provider credential a run's harness uses is
[harness authentication](/quickstarts/setup/set-up-authentication/).

## Register

Registration is open to anyone who can reach the auth service. Supply a username,
the display name shown beside your reviews, and a password:

```sh
TCAB_PASSWORD=… tcab register --username ada --display-name "Ada"
```

The password comes from `--password` or the `TCAB_PASSWORD` environment variable.
Registering logs you in and stores the bearer token at
`~/.config/tcab/credentials.json`; `TCAB_CONFIG_DIR` relocates that directory.

## Log in

```sh
TCAB_PASSWORD=… tcab login --username ada
```

Login stores the same bearer token, which the CLI attaches to every launch,
review, and publish.

## Log out

```sh
tcab logout
```

This revokes the token at the auth service and deletes the local copy.

## Sign in to the web console

The web console signs in from the top bar's account control,
which links to a sign-in and registration page. Once signed in, the same control
opens your account page.

## Scripted use

`TCAB_TOKEN` supplies a bearer token directly and takes precedence over the
stored one, so a non-interactive environment needs no login step.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/).
- [Review a Run](/quickstarts/development/review-a-run/).
