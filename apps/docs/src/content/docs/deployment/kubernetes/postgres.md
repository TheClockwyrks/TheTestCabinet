---
title: PostgreSQL
---

The backend talks to its store through SeaORM, so the same binary runs on
SQLite or PostgreSQL depending only on `TCAB_BACKEND_DATABASE_URL`. Pointing it
at a managed PostgreSQL instance removes the single-replica pin and the
database volume, and the schema migrates itself on first start.

## The managed-database shape

The `components/postgres` kustomize component performs that conversion. It
deletes the base's `tcab-backend` `StatefulSet` and adds a stateless
`Deployment` in its place, `the-test-cabinet-backend` (the name the workspace
template's deploy waits on), with the connection string supplied by `Secret`.
The `ClusterIP` `Service` is untouched, and the replacement `Deployment` reuses
the same selector labels, so the `Service` keeps routing.

The `staging` and `prod` overlays include the component and back it with Azure
Database for PostgreSQL Flexible Server. Provider backups and point-in-time
restore therefore replace the SQLite backup work; see
[Backups](/deployment/backups/#managed-postgresql).

Because the component swaps the workload kind, an overlay patch targeting the
backend must use `kind: Deployment`, not `kind: StatefulSet`.

## Passwordless auth with Microsoft Entra

A connection string of the form `postgres://user:password@host/db` carries a
long-lived shared secret. The `components/postgres-azure-ad` component converts
the backend to authenticate as a user-assigned managed identity instead. The
pod authenticates with Azure Workload Identity, and the
`test-cabinet-db-auth` crate (`db-auth`, in `microservice-backend`) mints a
short-lived Microsoft Entra access token for the
`https://ossrdbms-aad.database.windows.net` resource and uses it as the
Postgres password.

That token lasts about an hour and Postgres checks it only at connection time, so
the service rebuilds its connection pool on a timer with a fresh token. New
physical connections always present a valid one, and in-flight queries on the old
pool drain naturally.

The component sets `TCAB_BACKEND_DB_AZURE_AD`, adds a workload-identity
`ServiceAccount`, and patches the `Deployment` to run under it with the
`azure.workload.identity/use: "true"` pod label. The connection string takes
the passwordless form `postgres://<role>@host:5432/<db>?sslmode=require`, where
the username is the identity's mapped in-DB role.

The identity is `tcab-backend-db-<env>`, with its own least-privileged in-DB
role on the backend database. The artifacts and repos services bind their Blob
identities to their `ServiceAccount`s through the same federation; see
[Run plane](/deployment/kubernetes/run-plane/#artifacts-service).

### Control-plane setup

Per environment, create the managed identity and federate it to the backend's
Kubernetes `ServiceAccount` subject through the cluster's OIDC issuer, then
enable Entra auth on the server and set an Entra admin able to create the in-DB
principal:

```sh
# 1. A user-assigned managed identity for the backend.
az identity create -n tcab-backend-db-<env> -g <rg> -l westus2

# 2. Federate it to the Kubernetes ServiceAccount subject (cluster OIDC issuer).
ISSUER=$(az aks show -g <rg> -n <cluster> --query oidcIssuerProfile.issuerUrl -o tsv)
az identity federated-credential create --name tcab-backend-sa \
  --identity-name tcab-backend-db-<env> -g <rg> --issuer "$ISSUER" \
  --subject system:serviceaccount:tcab-<env>:tcab-backend \
  --audiences api://AzureADTokenExchange

# 3. Enable Entra auth on the server (keep password auth on for the cutover), and
#    set an Entra admin able to create the in-DB principal.
az postgres flexible-server update -g <rg> -n <server> \
  --microsoft-entra-auth Enabled --password-auth Enabled
az postgres flexible-server microsoft-entra-admin create -g <rg> -s <server> \
  --object-id <operator-object-id> --display-name <operator-upn> --type User
```

### In-DB principals and grants

The servers are private, so this SQL runs from inside the cluster (a one-off psql
pod, or `az aks command invoke`) authenticated as the Entra admin above. Fetch
the admin token with
`az account get-access-token --resource https://ossrdbms-aad.database.windows.net`
and pass it as `PGPASSWORD`. Run it on the backend database, substituting the
identity's object (principal) id:

```sql
-- On the backend database (tcab_backend), as the Entra admin.
-- Register the managed identity as an Entra-authable login role: a CREATE ROLE
-- plus a pgaadauth SECURITY LABEL carrying the identity's object id, which is
-- the primitive the server itself uses to register the Entra admin.
CREATE ROLE "tcab-backend-db-<env>" WITH LOGIN;
SECURITY LABEL FOR "pgaadauth" ON ROLE "tcab-backend-db-<env>"
  IS 'aadauth,oid=<backend-identity-object-id>,type=service';
-- Grant it everything the password owner-role has, existing and future objects
-- plus the ownership rights migrations need, by making it a member of the role
-- that OWNS the database. Confirm that role name first: it is environment
-- specific, and is also the username in the password-form connection string.
--   SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'tcab_backend';
GRANT "<owner-role>" TO "tcab-backend-db-<env>";
```

`type=service` is the label form for a managed identity or service principal; the
Entra admin's own label is the same shape with `type=user,admin`. Membership in
the owner role subsumes per-object `GRANT … ON ALL TABLES/SEQUENCES` plus
`ALTER DEFAULT PRIVILEGES`, and lets the app run schema-altering migrations under
its Entra role.

Staging's owner role is `tcab_backend`; prod's is `tcab_backend_app`. Confirm
each with the query above rather than assuming.

The identities as provisioned:

| Identity                  | Object id                              |
| ------------------------- | -------------------------------------- |
| `tcab-backend-db-staging` | `2a3ced7d-9476-43e4-ad60-8e0426e34bcf` |
| `tcab-backend-db-prod`    | `71b6b5cf-0731-4510-982a-8582cfa1e210` |

Some Azure Flexible Server images expose `pgaadauth_create_principal_with_oid`,
which performs the `CREATE ROLE` and `SECURITY LABEL` in one call. Newer images
(PG 17 and 18) do not install those wrappers by default, so use the primitive
form above.

### Cutover order

The conversion works only once the pod runs an image containing the db-auth
code. Per environment:

1. Roll the backend image to a build that includes `test-cabinet-db-auth`.
2. Run the in-DB principal SQL above on the backend database.
3. Switch the Key Vault `tcab-backend-database-url` secret to the passwordless
   form, keeping the same object name and key, then
   `kubectl rollout restart deploy/tcab-keyvault-sync` so the Kubernetes Secret
   re-materializes.
4. Add `../../components/postgres-azure-ad` to the overlay's `components:` list
   and re-apply it. The component bakes in the prod identity client id;
   the `staging` overlay patches it to the staging identity.

To roll back, remove the component, restore the password-form vault secret, and
re-apply. Password auth stays enabled on the server throughout.

Once both environments are verified on Entra auth, disable password auth to
remove the fallback. Confirm passwordless works first, since this step is
one-way:

```sh
az postgres flexible-server update -g <rg> -n <server> \
  --password-auth Disabled --microsoft-entra-auth Enabled
```

The administrator password and the password-form vault database URL can then be
retired.
