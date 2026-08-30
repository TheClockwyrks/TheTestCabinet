# Deleting A Run Prunes Its Artifact Tree

A deleted run's artifact tree is removed from the artifact service.

## Current behaviour

`crates/backend/src/config.rs` populates `artifacts_url` from
`TCAB_ARTIFACTS_PUBLIC_URL`, which is the browser-facing URL the backend
advertises to the console through `GET /config`. `delete_run_tree`
(`crates/backend/src/artifacts.rs`) uses that same value for a call from inside
the backend pod.

In the local cluster the value is the developer's port forward,
`http://127.0.0.1:8790`, which resolves to nothing inside the pod. Every delete
logs the same warning and leaves the tree:

```
could not reach the artifact service to prune the deleted run's tree; leaving it
for a later sweep
error=error sending request for url (http://127.0.0.1:8790/runs/<id>/artifacts)
```

The artifacts volume in the local cluster holds 955 MB across 127 run trees
against 11 run rows.

The field's own documentation states that the artifact bytes never transit the
backend, so the prune path uses the field for something it was documented not to
serve. The dispatcher receives an in-cluster URL through `TCAB_ARTIFACTS_URL`
(`deployments/k8s/base/dispatcher.yaml`). No overlay gives the backend one.

Both warning strings name a later sweep. The tree carries no sweep, so an
orphaned tree stays.

## Design

Give the backend an in-cluster artifact service URL of its own and call the
prune through it. Keep the advertised public URL for what the console reads.

Add the sweep the warnings name, so a prune that fails is reclaimed rather than
kept forever.

## Done when

- [ ] The backend calls the artifact service through an in-cluster URL.
- [ ] Every deployment overlay supplies that URL.
- [ ] Deleting a run removes its artifact tree.
- [ ] A sweep reclaims trees whose run rows are gone.
- [ ] Gates green.
