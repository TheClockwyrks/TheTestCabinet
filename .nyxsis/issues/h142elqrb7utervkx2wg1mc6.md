---
format: nyxsis-issue
version: 3
id: h142elqrb7utervkx2wg1mc6
zone: NYX
number: 7
title: Repair the-test-cabinet failing on staging
type: ci
priority: 0
state: done
created: 2026-10-23T07:22:20.420664051Z
done: 2026-10-23T16:56:29.539379401Z
outcome: |
  Nightly was promoted into staging through PR 5165 (merge ad5ddb55a). Staging run
  18702 (20261023.14) succeeded in every stage: Gates, Publish, Docs and Deploy.
  The ingest sidecar fetches the test suites from the public mirror without a
  token, the backend runs the-test-cabinet-backend:ad5ddb55a, and the deploy's
  retirement step removed the tcab-keyvault-sync-test-suites mounter, its
  SecretProviderClass and the tcab-test-suites-credential Secret from
  tcab-staging. Earlier, run 18696 at the previous head 2343daf3c also deployed
  green once a valid token had been uploaded to the staging vault; that vault
  secret, test-suites-read-token, is now unused and an operator can delete it.
---

The latest run of `the-test-cabinet` on the promotion branch `staging` failed at
the branch's head.

- Run: 20261023.12 (18599),
  <https://dev.azure.com/genyume/the-test-cabinet/_build/results?buildId=18599>
- Branch: `staging`
- Commit: `2343daf3c4f6cca16431485a27b276aeb2508592`

## Failed stages

- `Deploy` (stage)

## Earlier repairs

The ci issues last closed for `staging`, most recently closed first: NYX-6,
NYX-5, NYX-4, NYX-3. Read how each repair went.

Repair the failure on the main checkout's branch; the fix reaches `staging` by
promotion.
