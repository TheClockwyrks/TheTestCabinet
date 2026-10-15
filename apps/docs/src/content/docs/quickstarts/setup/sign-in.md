---
title: Sign In
---

## Overview

Every deployed environment sits behind Cloudflare Access, and a person signs in
through Microsoft Entra ID. Launching a run, reviewing, and publishing are
attributed to the signed-in identity, which is the email address the edge's
assertion carries; see [Identity](/components/auth/overview/). Reading the
public gallery needs no sign-in.

This is user identity. The provider credential a run's harness uses is
[harness authentication](/quickstarts/setup/set-up-authentication/).

## The console

Open the environment's origin, `https://console.testcabinet.ai` or
`https://console.staging.testcabinet.ai`, and sign in on the Microsoft login
page. The browser holds the Access cookie from then on, and the console shows
your email beside the reviews you submit. The [operator
client](/components/client/overview/) signs in the same way, inside its WebView.

To sign out, open `/cdn-cgi/access/logout` on the origin.

## The CLI

`tcab` reaches a deployed backend at the origin's `/api` path and presents an
Access credential on every request. As yourself, take a user token from
`cloudflared`, which opens the Microsoft login page in a browser:

```sh
export TCAB_BACKEND_URL=https://console.testcabinet.ai/api
cloudflared access login https://console.testcabinet.ai
export TCAB_ACCESS_TOKEN=$(cloudflared access token --app https://console.testcabinet.ai)
tcab prompt --test-case carom --version v1.0.0 --variant base
```

A run itself is launched from the console; the CLI inspects what a run would
seed and prompt, validates a tree, and ingests definitions.

The token is sent as the `cf-access-token` header and is good for the Access
application's session, after which `cloudflared access login` is run again.

## Automation

A script, CI, `tcab ingest --env` and the reference publishes present the
environment's Access service token instead, which needs no browser:

```sh
export TCAB_ACCESS_CLIENT_ID=…       # the service token's client id
export TCAB_ACCESS_CLIENT_SECRET=…   # and its secret
tcab ingest --env prod --changed
```

The pair is sent as the `CF-Access-Client-Id` and `CF-Access-Client-Secret`
headers, and what the backend records for a service-token request is the
token's name. The token's values are the environment's Key Vault secrets
`cloudflare-access-client-id` and `cloudflare-access-client-secret`; see
[The service token](/deployment/kubernetes/edge/#the-service-token).

## The local stack

The local k3d stack has no edge. The local console and `tcab` send the identity
in the `Cf-Access-Authenticated-User-Email` header, `dev@local` by default, and
a local service, which verifies no assertion, records it as presented.

## Next steps

- [Run a Test Case](/quickstarts/development/run-a-test-case/).
- [Review a Run](/quickstarts/development/review-a-run/).
