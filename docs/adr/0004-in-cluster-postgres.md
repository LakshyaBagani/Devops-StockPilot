# ADR-0004: PostgreSQL in the cluster (StatefulSet), not Amazon RDS

- **Status:** Accepted
- **Date:** 2026-10-15
- **Deciders:** Lakshya Bagani
- **Related:** `helm/stockpilot/templates/postgres-statefulset.yaml`,
  `helm/stockpilot/templates/migrate-job.yaml`, [ADR-0005](0005-derived-stock-ledger.md)

## Context

StockPilot needs one PostgreSQL database with Alembic migrations. The deployment targets differ in
lifetime and cost:

- Docker Compose and kind run on a laptop, for free, many times a day.
- EKS runs for a few hours per session (evidence, rehearsal, demo) and is destroyed after each one;
  it bills about $0.30 per hour while it exists.
- The same Helm chart should deploy to kind and EKS, so a rehearsal on kind proves the EKS deploy.

## Decision

Run **`postgres:18-alpine` as a one-replica StatefulSet inside the `stockpilot` namespace**:

- **Storage:** a 5 GiB `ReadWriteOnce` PVC from a volume claim template, on the cluster's default
  StorageClass: EBS gp3 through the EBS CSI driver on EKS (`ebs-csi-default-sc`), `standard`
  (local-path) on kind. It is mounted at `/var/lib/postgresql`, the PostgreSQL 18 layout.
- **Credentials:** Secret `stockpilot-db` (keys `username`, `password`, `database`), created out of
  band by `make kind-up` or `make eks-bootstrap` with a password from `openssl rand`, only when absent,
  and never rotated while the volume exists (Postgres reads it only at initdb). The chart references
  it through `postgres.existingSecret`; no password is in Git or in Helm values.
- **Access:** ClusterIP Service `stockpilot-postgres` on 5432; readiness by
  `pg_isready -h 127.0.0.1`, so the temporary initdb server never counts as ready.
- **Schema:** never created by the app. A Helm hook Job (`post-install,pre-upgrade`) runs
  `python -m app.prestart` (wait for the database, then `alembic upgrade head`) with
  `pg_advisory_xact_lock` inside Alembic's transaction, so concurrent migrators serialise.
- **Security context:** pod `fsGroup: 70` and seccomp `RuntimeDefault`. The official image starts as
  root, prepares its data directory and drops to uid 70. That is the documented exception to the
  hardened defaults: the namespace enforces Pod Security `baseline` (which allows it) and only warns at
  `restricted`.

## Alternatives considered

- **Amazon RDS for PostgreSQL:** managed backups, point-in-time recovery, Multi-AZ and patching. It
  adds a DB subnet group, a security group, a parameter group and a credentials store to Terraform,
  several minutes to every bring-up and teardown, and a second database path that kind cannot
  rehearse. It is the right choice for real shop data and the first item of future work.
- **A PostgreSQL operator (CloudNativePG):** backups and failover inside the cluster, but one more
  controller and set of CRDs to install, explain and tear down.
- **SQLite in the backend pod:** cannot be shared by 2–5 backend replicas and has no row locks, which
  the no-oversell guarantee relies on.

## Consequences

- The same chart and values shape run on kind and EKS; on kind the full path (install, hook
  migration, seed, second-tag upgrade with the migration Job finishing before the first new pod) was
  exercised.
- A single instance: no high availability, no backups, no point-in-time recovery. Data lives as long
  as the PVC. Every bring-up therefore re-runs the idempotent seed, and `make eks-down` deletes the
  PVCs explicitly so the EBS volumes do not outlive the cluster.
- Each deploy prints one expected Pod Security `restricted` warning for the postgres container. An
  opt-in `postgres.hardened=true` runs it as uid/gid 70 from the start with all capabilities dropped;
  it stays off by default, and its optional kind experiment has no recorded result yet.
- Moving to RDS later changes only `DATABASE_URL` (built from the Secret) and removes the
  StatefulSet; the app, migrations and tests are unaffected.
