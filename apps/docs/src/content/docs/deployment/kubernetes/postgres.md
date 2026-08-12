---
title: PostgreSQL
---

The backend and the auth service each talk to their store through SeaORM, so the
same binary runs on SQLite or PostgreSQL depending only on
`TCAB_BACKEND_DATABASE_URL` and `TCAB_AUTH_DATABASE_URL`. Pointing both at a
managed PostgreSQL instance removes the single-replica pin and the database
volume, and the schema migrates itself on first start.

## The managed-database shape

The `components/postgres` kustomize component performs that conversion. It
deletes the base's `tcab-backend` and `tcab-auth` `StatefulSet`s and adds
stateless `Deployment`s in their place, with the connection strings supplied by
`Secret`. The `ClusterIP` `Service`s are untouched, and the replacement
`Deployment`s reuse the same selector labels, so the `Service`s keep routing.

The `azure-staging` and `azure-prod` overlays include the component and back it
with Azure Database for PostgreSQL Flexible Server. Apply one of those instead of
`overlays/staging` or `overlays/prod`. Provider backups and point-in-time restore
then replace the SQLite backup work; see
[Backups](/deployment/backups/#managed-postgresql).

Because the component swaps the workload kind, an overlay patch targeting the
backend or auth service must use `kind: Deployment`, not `kind: StatefulSet`.

## Passwordless auth with Microsoft Entra

A connection string of the form `postgres://user:password@host/db` carries a
long-lived shared secret. The `components/postgres-azure-ad` component converts
both services to authenticate as a per-workload user-assigned managed identity
instead. The pod authenticates with Azure Workload Identity, and the
`test-cabinet-db-auth` crate (`crates/db-auth`) mints a short-lived Microsoft
Entra access token for the `https://ossrdbms-aad.database.windows.net` resource
and uses it as the Postgres password.

That token lasts about an hour and Postgres checks it only at connection time, so
the service rebuilds its connection pool on a timer with a fresh token. New
physical connections always present a valid one, and in-flight queries on the old
pool drain naturally.

The component sets `TCAB_BACKEND_DB_AZURE_AD` and `TCAB_AUTH_DB_AZURE_AD`, adds a
workload-identity `ServiceAccount` per service, and patches each `Deployment` to
run under it with the `azure.workload.identity/use: "true"` pod label. The
connection string takes the passwordless form
`postgres://<role>@host:5432/<db>?sslmode=require`, where the username is the
identity's mapped in-DB role.

Each service gets its own identity and its own least-privileged in-DB role:
`tcab-backend-db-<env>` on the backend database and `tcab-auth-db-<env>` on the
auth database.

### Control-plane setup

Per environment, create one managed identity per workload and federate each to
its Kubernetes `ServiceAccount` subject through the cluster's OIDC issuer, then
enable Entra auth on the server and set an Entra admin able to create the in-DB
principals:

```sh
# 1. A user-assigned managed identity per workload.
az identity create -n tcab-backend-db-<env> -g <rg> -l westus2
az identity create -n tcab-auth-db-<env>    -g <rg> -l westus2

# 2. Federate each to its Kubernetes ServiceAccount subject (cluster OIDC issuer).
ISSUER=$(az aks show -g <rg> -n <cluster> --query oidcIssuerProfile.issuerUrl -o tsv)
az identity federated-credential create --name tcab-backend-sa \
  --identity-name tcab-backend-db-<env> -g <rg> --issuer "$ISSUER" \
  --subject system:serviceaccount:tcab-<env>:tcab-backend \
  --audiences api://AzureADTokenExchange
az identity federated-credential create --name tcab-auth-sa \
  --identity-name tcab-auth-db-<env> -g <rg> --issuer "$ISSUER" \
  --subject system:serviceaccount:tcab-<env>:tcab-auth \
  --audiences api://AzureADTokenExchange

# 3. Enable Entra auth on the server (keep password auth on for the cutover), and
#    set an Entra admin able to create the in-DB principals.
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
and pass it as `PGPASSWORD`. Run it once per database, substituting each
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

Repeat on the auth database for `tcab-auth-db-<env>`, making it a member of that
database's owner role. Staging's owner roles are `tcab_backend` and `tcab_auth`;
prod's are `tcab_backend_app` and `tcab_auth_app`. Confirm each with the query
above rather than assuming.

The identities as provisioned:

| Identity | Object id |
| --- | --- |
| `tcab-backend-db-staging` | `2a3ced7d-9476-43e4-ad60-8e0426e34bcf` |
| `tcab-auth-db-staging` | `018baf38-0dbe-4c94-9b21-23115f4f9ec1` |
| `tcab-backend-db-prod` | `71b6b5cf-0731-4510-982a-8582cfa1e210` |
| `tcab-auth-db-prod` | `d51d06ca-ef9b-4940-b58b-8d9ac643f028` |

Some Azure Flexible Server images expose `pgaadauth_create_principal_with_oid`,
which performs the `CREATE ROLE` and `SECURITY LABEL` in one call. Newer images
(PG 17 and 18) do not install those wrappers by default, so use the primitive
form above.

### Cutover order

The conversion works only once the pods run an image containing the db-auth code.
Per environment:

1. Roll the backend and auth images to a build that includes
   `test-cabinet-db-auth`.
2. Run the in-DB principal SQL above on both databases.
3. Switch the Key Vault `tcab-backend-database-url` and `tcab-auth-database-url`
   secrets to the passwordless form, keeping the same object names and keys, then
   `kubectl rollout restart deploy/tcab-keyvault-sync` so the Kubernetes Secrets
   re-materialize.
4. Add `../../components/postgres-azure-ad` to the overlay's `components:` list
   and re-apply it. The component bakes in the prod identity client ids;
   `azure-staging` patches them to the staging identities.

To roll back, remove the component, restore the password-form vault secrets, and
re-apply. Password auth stays enabled on the server throughout.

Once both environments are verified on Entra auth, disable password auth to
remove the fallback. Confirm passwordless works first, since this step is
one-way:

```sh
az postgres flexible-server update -g <rg> -n <server> \
  --password-auth Disabled --microsoft-entra-auth Enabled
```

The administrator password and the password-form vault database URLs can then be
retired.
