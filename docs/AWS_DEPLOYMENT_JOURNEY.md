# Moving SomaCue to AWS: an engineering case study

How a Next.js + PostgreSQL + file-upload app went from three managed vendors to one small, locked-down AWS stack in
`ap-southeast-2` (Sydney), for about **USD 22.90 a month**, and launched with 0 users on a clean database.

This is the write-up of what was built, what was rejected and why, what broke, and how it would grow. Every number,
file path and parameter here was read from the repository or from the live system on 2026-11-23, and the
implementation details match `infra/aws/`, `apps/web/` and [`AWS_DEPLOYMENT_PLAN.md`](AWS_DEPLOYMENT_PLAN.md).
Where a figure is an estimate, it says so. Where something is a known limitation, it is listed rather than hidden.

> **Privacy note.** Account ids, bucket names, instance and distribution ids, IP addresses, e-mail addresses and every
> secret are deliberately left out. Resources are described by role (for example "the uploads bucket"). The scripts
> in `infra/aws/` look identifiers up at run time instead of storing them.

**Contents**

1. [Executive summary and architecture overview](#1-executive-summary-and-architecture-overview)
2. [Architectural decision matrix](#2-architectural-decision-matrix)
3. [End-to-end security and zero-trust posture](#3-end-to-end-security-and-zero-trust-posture)
4. [Production challenges and debugging stories](#4-production-challenges-and-debugging-stories)
5. [Resume-ready impact bullets](#5-resume-ready-impact-bullets)
6. [System design and cloud interview Q&A](#6-system-design-and-cloud-interview-qa)
7. [Scaling roadmap](#7-scaling-roadmap-from-0-users-to-10000-users)

---

## 1. Executive summary and architecture overview

### The starting point

SomaCue is an AI-assisted home-rehabilitation app (Next.js 16, React 19, Prisma 7, a 3D guided-exercise stage). Before
the migration it depended on three separate managed services for hosting concerns, and ran on a developer machine:

| Concern | Before | After |
|---|---|---|
| App server | `next start` on a Windows laptop, no public address | One Arm64 EC2 instance behind CloudFront |
| Database | Neon PostgreSQL (hosted) | PostgreSQL 18.7 on the same instance, loopback only |
| Patient files | Azure Blob Storage, plus a local-disk fallback | Private Amazon S3 bucket, signed 5-minute downloads |
| TLS and DNS | None (localhost) | ACM + Let's Encrypt certificates, Route 53 |
| Secrets | A `.env` file on disk | SSM Parameter Store, injected into memory at start |
| Deploys | Manual | CodeBuild (Arm) to S3 to SSM Run Command, with health-checked automatic rollback |

The goal was a **100% AWS-hosted** footprint (compute, database, object storage, TLS, secrets, DNS) that is production
hardened but costs almost nothing, and launches with **0 users and 0 reports**: no data was migrated from Neon or Azure.
`prisma migrate deploy` ran 16 migrations onto an empty database.

What stays external, on purpose: the AI provider API (Gemini), Razorpay (payments), Google sign-in, and the domain
registrar. Those are services the product calls, not hosting infrastructure.

### Result at a glance

| Metric | Value | Source |
|---|---|---|
| Monthly run cost | **about USD 22.90** | Itemized from the AWS Price List API, section 2.1 |
| vs. RDS-based design of the same app | 47.8% less (USD 43.88) | Same price list |
| vs. RDS + Application Load Balancer design | 68.1% less (USD 71.77) | Same price list |
| Free Plan credit runway at this rate | about 6 months (USD 139.99) | `get-account-plan-state` |
| Inbound ports open to the internet | **0** (443 only from CloudFront's address range) | Security group |
| Infrastructure as code | 49 resources in 4 CloudFormation templates (40 deployed through CloudFormation) | `infra/aws/cfn/` |
| Release build on Arm | 98 s (CodeBuild `BUILD_GENERAL1_SMALL`) | CodeBuild history |
| Release artifact | 149.7 MB (standalone server, 39.6 MB of public assets, pinned Prisma CLI) | S3 |
| Idle footprint on a 1.8 GiB host | app 235 MB, PostgreSQL 58 MB, 529 MB used, 1.1 GiB available, 0 MB swap | measured on the live host |
| Tests | 921 passing in 65 files; 47 new tests in 5 new files for this work | `pnpm test` |
| Size of the change | 58 files, +3,224 / -413 lines across 2 commits (18 app, 26 infra, 13 test, 1 doc) | `git diff --stat` |
| Database after launch | 0 rows in every one of 13 tables checked | live query |

### Architecture

Traffic flow. Route 53 only answers DNS (an alias record); it is not in the data path after the lookup.

```
                           DNS lookup (alias A/AAAA, no data path)
   +---------+          +-------------------+
   |  User   | -------> |     Route 53      |  public zone for somacue.abhishekt.dev
   | browser |          | (delegated from   |  (apex abhishekt.dev stays on GitHub Pages)
   +----+----+          |   the registrar)  |
        |               +-------------------+
        | HTTPS (TLS 1.2+, HTTP/2 and HTTP/3)
        v
   +-----------------------------------------------------------------+
   | CloudFront                                  free ACM certificate|
   |  - uncached: pages, server actions, APIs    (issued in us-east-1)|
   |  - cached:   /_next/static, /assets, /models, /_next/image      |
   |  - adds header  X-Origin-Verify: <secret>                       |
   +--------------------------------+--------------------------------+
                                    | HTTPS to origin.somacue.abhishekt.dev
                                    v
   +=================== VPC 10.20.0.0/16, public subnet ===================+
   |  Security group: TCP 443 from the CloudFront managed prefix list only |
   |                  (no 22, no 80)                                       |
   |                                                                       |
   |  EC2 t4g.small (Arm64, Amazon Linux 2023, 20 GiB encrypted gp3)       |
   |  +-----------------------------------------------------------------+  |
   |  | nginx :443  (Let's Encrypt cert via certbot DNS-01)             |  |
   |  |   returns 403 unless X-Origin-Verify matches                    |  |
   |  |        |  proxy, Host rewritten to the public name              |  |
   |  |        v                                                        |  |
   |  | Next.js standalone, systemd `somacue`, 127.0.0.1:3100           |  |
   |  |   MemoryHigh=1100M  MemoryMax=1200M                             |  |
   |  |        |  role somacue_app (DML only)                           |  |
   |  |        v                                                        |  |
   |  | PostgreSQL 18.7, 127.0.0.1:5432, shared_buffers=256MB           |  |
   |  +-----------------------------------------------------------------+  |
   |   cron: /api/health probes (1 min), nightly encrypted pg_dump (02:30) |
   |   instance role (no keys on disk) -------------------------+         |
   +-------------------------------------------------------------|---------+
                                                                 | S3 gateway endpoint
                          +--------------------------------------+-------------+
                          v                                      v             v
              +-------------------------+        +----------------------+  +------------------+
              | Private S3 uploads      |        | SSM Parameter Store  |  | S3 backups       |
              | SSE-S3, versioned,      |        | SecureString secrets |  | AES-256 dumps,   |
              | Block Public Access,    |        | -> /run/somacue/env  |  | 30-day lifecycle |
              | 5-minute signed links   |        |    (tmpfs, 0600)     |  |                  |
              +-------------------------+        +----------------------+  +------------------+

   Delivery:  git tree -> S3 -> CodeBuild (Arm) -> release.tgz in S3 -> SSM Run Command -> deploy.sh
              (migrate, atomic symlink switch, health check, automatic rollback)
   Watching:  9 CloudWatch alarms + SNS email, USD 35 monthly budget, Cost Anomaly Detection
```

### The three constraints that shaped everything

1. **Cost.** A solo project on an AWS Free Plan account with USD 139.99 of credits. Every always-on managed service
   (load balancer, NAT Gateway, RDS) was priced against that budget before it was allowed in.
2. **Account guard rails.** The account carries a service control policy: all regional resources must be in one
   Region, and `us-east-1` is allowed only for a short list of global services. This forced several design changes
   (section 4, challenge 3).
3. **Health data.** The app stores symptoms, scans and prescriptions, so "cheap" could not mean "open". Security
   controls were treated as requirements, not extras (section 3).

---

## 2. Architectural decision matrix

For each layer: what was on the table, what was chosen, and the reasoning. Prices are `ap-southeast-2`, on-demand,
730 hours a month, read from the AWS Price List API on 2026-11-23 unless marked as an estimate.

### 2.1 Cost model

| Item | Basis | USD a month |
|---|---|---|
| EC2 `t4g.small` | 0.0212 per hour | 15.48 |
| EBS gp3, 20 GiB | 0.096 per GiB-month | 1.92 |
| Public IPv4 (Elastic IP) | 0.005 per hour | 3.65 |
| S3 storage and requests | under 3 GiB (estimate) | 0.25 |
| Route 53 hosted zone and queries | 0.50 per zone (estimate for queries) | 0.60 |
| EBS snapshots, daily, 7 kept | incremental (estimate) | 0.50 |
| CodeBuild, Arm small | about 10 builds (estimate) | 0.50 |
| CloudFront, ACM, SSM Parameter Store, KMS managed keys, CloudWatch free tier, SNS email, Budgets, Cost Anomaly Detection | free allowances | 0.00 |
| **Total** | | **about 22.90** |

Variants priced the same way, to show what each decision saves:

| Design | USD a month | Notes |
|---|---|---|
| **Chosen: one instance, PostgreSQL local** | **22.90** | |
| Same, with Amazon RDS `db.t4g.micro` (single-AZ, 20 GiB gp3) | 43.88 | RDS adds 21.01 (0.025 per hour + 0.138 per GiB-month) |
| RDS and an Application Load Balancer | 71.77 | ALB adds 27.89: 0.0252 per hour, one LCU, and a second public IPv4 |
| Either of the above plus a NAT Gateway for private subnets | roughly 105 to 115 | NAT adds about 33 to 43 a month for the hourly charge alone (zonal 0.045 per hour is a commonly quoted figure and was not re-verified; the regional price-list entry is 0.059 per hour); data processing is extra |

### 2.2 Compute and database

| Option | Monthly cost | Why it was or was not chosen |
|---|---|---|
| **One Arm64 `t4g.small` running Next.js and PostgreSQL 18.7** | 15.48 (+ disk, IP) | **Chosen.** Prisma wants a long-lived pooled connection, the AI actions run for minutes, and traffic starts at zero. One host is the cheapest always-on shape that supports all of that. |
| Amazon RDS PostgreSQL, single-AZ | +21.01 | Better operations (managed patching, 7-day point-in-time recovery) but it doubles the bill for a launch with no users. Kept as the first scale-out step (section 7). |
| ECS on Fargate | not itemized | Needs a load balancer or public IPs per task for CloudFront to reach it, and still needs a database. More moving parts for the same single container. |
| Lambda / Amplify SSR | not itemized | Cannot reach a private database without a proxy, and function time limits fight the multi-minute AI calls. |
| `t4g.micro` | -7.74 | 1 GiB is too tight for Next.js 16, nginx, PostgreSQL and the CloudWatch agent together. |
| `t4g.medium` | +15.48 | Held back as the vertical-scale step; triggered by alarms, not guessed. |

**Instance hardening and sizing (all in `infra/aws/`):**

- `t4g.small` (2 vCPU Arm Graviton, 2 GiB), **CPU credits in `standard` mode** so a busy hour can never create a
  surplus-credit charge. Encrypted 20 GiB gp3 root volume, IMDSv2 required, termination protection on, a 2 GiB swap
  file with `vm.swappiness=20`.
- The app runs as a non-root `somacue` user under systemd with `MemoryHigh=1100M`, `MemoryMax=1200M`,
  `NoNewPrivileges`, `PrivateTmp` and `ProtectSystem=full`. The cap leaves room for PostgreSQL, nginx and the
  agents on a host with 1.8 GiB visible. Measured idle: app 235 MB, PostgreSQL 58 MB, 529 MB used in total.
- PostgreSQL 18.7 comes straight from the Amazon Linux 2023 repository (`postgresql18-server`), so no third-party
  repository is needed. The cluster is created with data checksums, `listen_addresses = '127.0.0.1'`,
  `max_connections = 40`, `shared_buffers = 256MB`, `effective_cache_size = 768MB`, `work_mem = 4MB`,
  `maintenance_work_mem = 64MB`, `wal_compression = on` and `scram-sha-256` for every connection.
- Two database roles: `somacue_owner` owns the schema and runs migrations; `somacue_app` can `SELECT`, `INSERT`,
  `UPDATE` and `DELETE` and use sequences, and nothing else. `PUBLIC` privileges on the database and schema are
  revoked, and default privileges grant the app role access to future tables.

### 2.3 Edge, routing and TLS

| Option | Monthly cost | Why it was or was not chosen |
|---|---|---|
| **CloudFront + ACM, origin on the instance** | 0 | **Chosen.** The always-free CloudFront allowance covers this traffic; ACM certificates are free and renew themselves; static files (38 MB of 3D assets) are served from the edge. |
| Application Load Balancer + ACM | +27.89 | Would remove the origin-certificate step and lift the timeout limit, but the cost is more than the whole rest of the stack. Held as the fallback. |
| NAT Gateway and private subnets | +33 to 43 | The instance needs outbound internet (Razorpay, Google, the AI API). A public subnet with a tight security group does that for 0. |
| CloudFront VPC origin | n/a | Requires a private subnet, which brings the NAT Gateway back. |
| Let's Encrypt on the instance only | 0 | Works, but no CDN, no edge TLS, no DDoS absorption. |

**DNS decision.** The apex `abhishekt.dev` already serves a GitHub Pages site (four A records). Moving it would take
that site down, so the app lives on the subdomain `somacue.abhishekt.dev`. A Route 53 public hosted zone is created for
the subdomain only, and four NS records at the registrar delegate it. Nothing existing was touched, which was
verified on two public resolvers before any certificate was requested.

**Two certificates, deliberately.** ACM issues the viewer-facing certificate for CloudFront. ACM certificates cannot
be exported on this plan, so they cannot be installed on the instance; the CloudFront-to-origin leg uses a free Let's
Encrypt certificate obtained with certbot's Route 53 DNS-01 challenge (details in challenge 1).

**CloudFront behaviors.**

| Path | Cache | Origin request |
|---|---|---|
| Default (pages, server actions, `/api/*`) | `CachingDisabled` | all viewer headers, cookies and query strings except `Host`; all HTTP methods |
| `/_next/static/*` | `CachingOptimized` (fingerprinted files) | GET, HEAD |
| `/_next/image*` | custom policy keyed on the full query string plus the `Accept` header | GET, HEAD |
| `/assets/*`, `/models/*` | `CachingOptimized`; nginx sets `Cache-Control: public, max-age=86400` because these files are not fingerprinted | GET, HEAD |

The image behavior needed its own policy: the managed one ignores query strings, which would serve one resized image
for every size and quality request. All behaviors redirect HTTP to HTTPS, use TLS 1.2 or newer, and attach the
managed security-headers policy.

### 2.4 Long-running AI requests

The product has four heavy AI actions, with provider timeouts of 60 s (triage) and 180 s (plan generation and
rescheduling). CloudFront waits only a limited time for the origin to respond: 30 s by default, 60 s as configured
for this distribution, and a per-origin quota of 120 s on this account.

| Option | Cost | Verdict |
|---|---|---|
| Raise the quota to 180 s and keep synchronous requests | 0 | Requested (a support case is open), but approval is not guaranteed and a 3-minute held connection is fragile on mobile networks. Not relied on. |
| Add an ALB (idle timeout up to 4,000 s) | +27.89 | Works, but spends more than the instance costs. |
| Shorten the AI timeouts | 0 | Directly degrades plan quality. |
| **Run each action as a background job; the request returns at once and the browser polls** | 0 | **Chosen.** Every HTTP request is short, whatever the AI provider does. |

**How it works** (`apps/web/actions/aiJobs.ts`, `lib/jobs/store.ts`, `lib/jobs/client.ts`):

- Four start actions, `startIntakeJob`, `startQuizJob`, `startPainRescheduleJob` and `startFeedbackJob`, check that a
  user is signed in, register a job and return its id in milliseconds.
- The original action then runs **after the response is sent** using `after()` from `next/server`, which keeps the
  request's cookies available. The action is unchanged: it still checks the session, the plan limits and ownership
  itself, so a job can never do more than a direct call could.
- The browser polls `getAiJob` every **2 s**. It tolerates up to 4 failed polls in a row (a dropped connection or a
  deploy), then fails on the fifth, and gives up after **6.5 minutes**.
- The job store is an in-memory `Map` on `globalThis` (Next can load a module more than once). It is **owner-scoped**
  (another user gets "unknown", never a hint that the job exists), **deduplicates** a repeated start of the same kind
  by the same user (a double click joins the running job), caps concurrency at **6 running jobs** (then a polite
  "busy" answer), marks a job that runs longer than **6 minutes** as failed, and forgets finished jobs after
  **15 minutes**. Error text shown to the user is filtered so database or SDK internals never leak.
- Tests: 15 for the store and the polling client, 6 for the start actions, covering ownership, dedup, the cap, the
  timeouts and the leak filter.

### 2.5 Object storage

| Option | Why it was or was not chosen |
|---|---|
| Stay on Azure Blob Storage | Violates the single-cloud goal, adds a second set of credentials, and the old container was reachable by URL. |
| Files on the instance's disk | Lost with the instance, no versioning, and the web server would hold patient files. |
| EFS | Costs more and offers file semantics the app does not need. |
| **Private S3 bucket** | **Chosen.** |

**Implementation** (`lib/storage/s3.ts`, `lib/intake/storage.ts`, `app/api/files/[reportId]/[index]/route.ts`):

- `@azure/storage-blob` was replaced by `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Credentials come
  from the default provider chain, which on EC2 means the instance role; there are no access keys anywhere.
- Stored references look like `s3://<bucket>/uploads/<uuid>.<ext>`. `parseUploadUrl` accepts only the configured
  bucket and a strict `uploads/<uuid>[.ext]` key pattern, so a stored value can never point the server at another
  bucket or path. The same allow-list protects the AI file loader, which reads these files back server-side, from being pointed at arbitrary buckets, hosts or local paths.
- Objects are written with `ServerSideEncryption: AES256`. The bucket has Block Public Access (all four settings),
  a TLS-only bucket policy, versioning, a 30-day rule for old versions and a 7-day rule for abandoned uploads.
- Downloads go through `GET /api/files/[reportId]/[index]`: signed-in owners only, answering 302 to a **5-minute**
  pre-signed URL with `Cache-Control: no-store`. A report that belongs to someone else returns **404, not 403**, so
  the route does not confirm that a report id exists. `orderedReportFiles` defines one stable ordering (scans, then
  prescriptions, then older uploads) shared by the dashboard links and the route.
- Local development keeps working: with no bucket set, `pnpm dev` saves to `apps/web/public/uploads`. In production
  the same situation is an error, so a missing setting can never silently write patient files to the web server's disk.
- Tests: 11 for the S3 module and `storeUpload`, 13 for the download route (ownership, ordering, bad indexes, foreign references, signing failures).

### 2.6 Secrets and privilege separation

| Option | Why it was or was not chosen |
|---|---|
| `.env` file on the instance | A secret at rest on disk, in snapshots and in backups of the volume. |
| Secrets Manager | USD 0.40 per secret per month and managed rotation; worth it later, not for a handful of values at launch. |
| **SSM Parameter Store `SecureString`, loaded into memory at start** | **Chosen.** Free, encrypted with an AWS-managed key, readable only by the instance role. |

How the secret path works (`infra/aws/instance/load-env.sh`, `somacue.service`):

1. `ExecStartPre=+/opt/somacue/bin/load-env.sh` runs as root before the app **and** before nginx.
2. It calls `get-parameters-by-path /somacue/prod/ --with-decryption` and writes `/run/somacue/env` (the app's
   environment) and `/run/somacue/origin-verify.conf` (nginx's header check). `/run` is a tmpfs, files are created
   with mode `0600` through an atomic write, and nothing is written to the disk image or the release artifact.
3. A deny-list keeps **admin material out of the app's environment**: the owner database password, the backup
   passphrase and the CloudFront shared secret are never in `/run/somacue/env`. The app only has the credentials
   of the DML-only `somacue_app` role.
4. A separate `put-secrets.ps1` populates SSM from a local `.env`, generates fresh `SESSION_SECRET`, database passwords,
   origin-verify value and backup passphrase, keeps existing generated values on re-runs (no accidental rotation),
   and never prints a value.

Migrations run as `somacue_owner`, with that password fetched into a shell variable inside `deploy.sh` and discarded
immediately. The app role cannot create tables; this was tested on the live host and returns
`permission denied for schema public`.

### 2.7 CI/CD, backups and observability

**Delivery pipeline.**

| Stage | Mechanism | Detail |
|---|---|---|
| Package | `infra/aws/package-source.ps1` | Zips tracked and untracked-not-ignored files; refuses to continue if an env file is in the archive |
| Build | CodeBuild project `ARM_CONTAINER`, `BUILD_GENERAL1_SMALL`, Node 22, pnpm 12 | Builds on the same CPU architecture as the server, so native modules such as `sharp` match. 98 s for a successful build. `NEXT_OUTPUT=standalone` turns on standalone output only here, because standalone builds need symlink privileges that Windows lacks |
| Artifact | `release.tgz` to the artifacts bucket | 149.7 MB: standalone server, static files, public assets, and a pinned Prisma CLI plus migrations in `migrate/` so the host can run `prisma migrate deploy` without the dev toolchain |
| Deploy | SSM Run Command (`AWS-RunShellScript`) runs `deploy.sh` | No SSH. Every deploy is an audited API call |
| Switch | `deploy.sh` | Download, extract, migrate as the owner role, atomic `ln -sfn` + `mv -T` symlink swap, `systemctl restart`, then poll `/api/health` for up to 40 tries 2 s apart |
| Rollback | `deploy.sh` | On an unhealthy release, repoint `current` at the previous release and restart; it keeps the three newest releases |

The working rule is that a release must be **backward compatible with the previous schema for one deploy**, so a rollback
never needs a database restore. It is a convention, not something the tooling enforces yet.

**Backups and recovery.**

- **Nightly 02:30 UTC:** `pg_dump --format=custom --compress=6`, piped through `openssl enc -aes-256-cbc -pbkdf2
  -iter 200000` with a passphrase from SSM, streamed to S3 with SSE (never written to local disk). A dump smaller than
  512 bytes counts as a failure. Success publishes the `BackupSuccess` metric; a missing metric raises an alarm.
  A hook file (`/etc/somacue/ping-url`) can ping an external uptime monitor.
- **Daily EBS snapshots** through Data Lifecycle Manager (17:30 UTC), 7 kept.
- **Retention:** the backups bucket expires `db/` objects after 30 days.
- **Verified:** the first dump was fetched, decrypted and listed with `pg_restore -l` (17 table-data entries); the
  stored object starts with the OpenSSL `Salted__` header and shows `AES256` server-side encryption. A full restore
  drill into a scratch database is still on the to-do list (section 3, known limitations).
- `restore-db.sh` stops the app, restores into the live database, and refuses to run without an explicit `--yes`.

**Observability and cost control.**

| Signal | How |
|---|---|
| 9 CloudWatch alarms, all to one SNS topic | system status check (also triggers EC2 auto-recover), instance status check, CPU credit balance under 20, memory over 85%, swap over 50%, disk over 80%, local `/api/health` failing for 5 minutes, public address failing for 5 minutes, no backup in 24 hours |
| Memory, swap and disk metrics | CloudWatch agent (namespace `CWAgent`) |
| Application and nginx logs | CloudWatch Logs, 14-day retention; nginx **access logging is off** on purpose because request lines carry query strings and client IPs |
| Spend | a USD 35 monthly budget alerting at 50% and 80% actual and 100% forecast; Cost Anomaly Detection by service with a USD 5 daily-digest threshold; every resource tagged `Project=SomaCue` |

### 2.8 Infrastructure as code

| Template | Resources | Contents |
|---|---|---|
| `01-core.yaml` | 24 | VPC, public subnet, route table, S3 gateway endpoint, security group, three buckets and their policies, the Route 53 zone, SNS topic, log group, instance and CodeBuild roles, the CodeBuild project |
| `02-compute.yaml` | 16 | Instance, Elastic IP and association, origin DNS record, 9 alarms, snapshot role and lifecycle policy |
| `03-acm-us-east-1.yaml`, `04-edge-us-east-1.yaml` | 1 and 8 | Kept as documented reference; they could **not** be deployed because of the account policy (challenge 3) |

`AlertEmail` is a required template parameter with no default, because the repository is public.

---

## 3. End-to-end security and zero-trust posture

Defense in depth, from the edge to the data. Each control lists how it was checked, not just that it exists.

| Layer | Control | Verified how |
|---|---|---|
| Network | No inbound SSH (22) or HTTP (80). The only inbound rule is TCP 443 from `com.amazonaws.global.cloudfront.origin-facing` | Security group definition; a direct connection to the origin from the internet timed out |
| Origin identity | The prefix list covers every CloudFront customer, so on its own it is not enough. nginx also requires the secret `X-Origin-Verify` header that only this distribution sends, and returns **403** otherwise | `403` with no header, `403` with a wrong value, `200` with the right one |
| Administration | Zero-SSH operations: Session Manager and SSM Run Command only; every action is an API call in the audit trail. `sshd` still listens on the host, but nothing can reach port 22 | Security group; listener list |
| Transport | Viewer to CloudFront: TLS 1.2 or newer (`TLSv1.2_2021`), HTTP to HTTPS redirect, HSTS from the managed security-headers policy. CloudFront to origin: HTTPS only, TLS 1.2. nginx: TLS 1.2 and 1.3 | `curl` against the live edge: HSTS and `X-Content-Type-Options` present, HTTP returns 301 |
| Data in transit to the database | PostgreSQL listens on `127.0.0.1` only and the app connects over loopback, so there is no network path to it at all | Listener list on the host |
| Data at rest | EBS encrypted; S3 SSE-S3 on all three buckets; backups encrypted twice (AES-256 with a passphrase, then SSE); SSM `SecureString` | Instance and bucket configuration; backup header check |
| Secrets | In SSM, loaded into tmpfs (`0600`, root-only), never on disk, in git or in the build; admin credentials excluded from the app's environment; fresh values generated for production | `stat` on the files; the app environment has 0 lines for each admin key |
| Database privileges | Owner role for DDL, DML-only app role, `PUBLIC` revoked, SCRAM auth, data checksums | App role attempting `CREATE TABLE` gets `permission denied` |
| Object access | Private buckets, Block Public Access, TLS-only policies, versioning on uploads; the instance role can touch only `uploads/*`, with separate scoped statements for artifacts, backups, SSM, logs and metrics | IAM statements in `01-core.yaml`; an unsigned request to the bucket returns 403 |
| File authorization | Owner-only downloads through short-lived signed URLs; unknown or foreign reports look identical (404); signed-out requests get 401; strict key pattern on every read and write | 13 route tests and a live check with a throwaway user |
| Instance | IMDSv2 required, termination protection, non-root service user, hardened systemd unit, security updates applied at bootstrap | Instance and unit definitions |
| Certificate issuance | The instance role may change only `TXT` records named `_acme-challenge` for the two exact names in this zone, and `kms:Decrypt` only through SSM | IAM condition keys in `01-core.yaml` |
| Supply chain | Release built in a clean Arm container from a frozen lockfile; `put-secrets` and `package-source` refuse to include env files | Build log; script guards |
| Logging hygiene | No request bodies or personal data in application logs; nginx access log off; error text shown to users is filtered | Code and configuration |

**Known limitations (said plainly):**

- Single instance and single-AZ storage: a host failure means roughly an hour of downtime, recovered from the nightly
  dump (up to 24 hours of data loss) or the daily snapshot.
- Secrets that live in tmpfs can be paged to the swap file, which sits on the encrypted root volume. The running app
  process necessarily holds its own runtime secrets in memory.
- No WAF and only baseline Shield Standard; the app rate-limits billing and promo routes in memory, which resets on
  restart and would not span multiple instances.
- Deploys restart the service, so there is a few-second gap (section 6, question 7).
- OS patching is applied once at bootstrap; a scheduled automatic-update job (for example dnf-automatic) is not set up yet, so patching is a manual step until it is.
- The backup passphrase exists in SSM and should also be kept outside the AWS account; the full restore drill has not
  been run yet.

---

## 4. Production challenges and debugging stories

Four main stories in STAR format, then a list of smaller failures. Each is labelled by how it surfaced, because that
matters in an interview: some were caught on paper before they could fail, others failed for real.

### Challenge 1: CloudFront could not verify an `ec2-*.amazonaws.com` origin

*Surfaced: caught during design review and proven before launch, not an outage.*

**Situation.** CloudFront must reach the instance over HTTPS. The obvious origin name is the instance's public DNS
name (`ec2-<ip>.<region>.compute.amazonaws.com`).

**Task.** Keep the CloudFront-to-origin leg encrypted and validated, without an ALB.

**Action.**
- CloudFront checks the origin certificate against the origin's domain name. A public certificate cannot be issued for
  an `amazonaws.com` name you do not own, and ACM certificates cannot be exported on this plan to install on EC2. So
  the AWS-provided name can never pass validation.
- Added a Route 53 record `origin.somacue.abhishekt.dev` (A, pointing at the Elastic IP) and made that the
  CloudFront origin.
- Issued a Let's Encrypt certificate with certbot's Route 53 plugin and a **DNS-01** challenge (no port 80 needed)
  covering **two names**, the origin name and the public name, so either `Host` choice validates. The instance role
  can write only the two `_acme-challenge` TXT records. A systemd timer renews twice a day and reloads nginx.
- nginx rewrites `Host` to the public name toward Next.js, so redirects, cookie scope and the server-action origin
  check always see `somacue.abhishekt.dev`, whatever CloudFront sent.
- Tested before touching public DNS: `curl --resolve somacue.abhishekt.dev:443:<edge IP>` against the distribution.

**Result.** The first requests through CloudFront returned 200 with an `X-Cache: Miss`, HSTS and `nosniff` headers,
and no TLS errors. The origin lock returned 403 for requests without the secret header. The certificate renews on its
own; the design costs nothing.

**Interview takeaway.** SNI and certificate validation are part of the CDN-to-origin contract. Knowing that is what
separates "put CloudFront in front" from a design that works.

### Challenge 2: Avoiding 504s on minutes-long AI workflows without paying for an ALB

*Surfaced: found by reading the code's timeouts against CloudFront's limits before launch.*

**Situation.** Plan generation and rescheduling call an AI provider with 180-second timeouts. CloudFront gives up on a
silent origin after 30 s by default (60 s as set here, 120 s as the account quota). A synchronous design would return
504 on exactly the feature that matters most.

**Task.** Guarantee that no HTTP request approaches the CloudFront limit, keep the actions' safety checks intact, and
add no recurring cost.

**Action.** Converted four server actions into background jobs (full design in section 2.4): start returns a job id
in milliseconds; the real action runs in `after()`; the client polls every 2 s with retry tolerance; the store is
owner-scoped, deduplicated, capped at 6 running jobs, time-boxed to 6 minutes, and swept after 15 minutes. The
existing actions were not rewritten: the job wrapper calls them with the same arguments, so billing limits,
red-flag screening and ownership checks run exactly as before. In parallel, requested the 180-second quota increase as
extra headroom; it is not a dependency.

**Result.** Every request now ends in well under a second (start and poll), independent of the AI provider.
21 new tests cover the store, the start actions, the polling client and the failure paths. The owner used the live
site to sign in and generate a plan after launch. The cost avoided is the 27.89 a month an ALB would add.

**Honest trade-off.** Jobs live in process memory. A restart loses a running job; the poll then reports it unknown
and the screen offers a retry. That is acceptable for one instance and is the first thing to make durable when
traffic grows (section 7).

### Challenge 3: A service control policy blocked `us-east-1` tooling

*Surfaced: failed for real during provisioning.*

**Situation.** CloudFront certificates must be in `us-east-1`, so the plan used CloudFormation there. The first
`create-stack` for the certificate template failed with an explicit deny from an organization service control policy.

**Task.** Get the certificate, the distribution and the DNS records created, and still alarm on edge health, inside
the account's rules.

**Action.**
- Read the policy: in `us-east-1` it allows only a short list of global services (ACM, CloudFront, Route 53, WAF and
  a few more). CloudFormation, SNS and CloudWatch alarms are not on it.
- Created the certificate (`acm request-certificate`, DNS validation record written to the zone) and the distribution
  (`cloudfront create-distribution-with-tags`, a custom cache policy for the image optimizer) through their own APIs.
  The two `us-east-1` templates stay in the repository as documentation of intent, marked as not used.
- Found that CloudWatch alarms cannot be created in `us-east-1` at all here (the attempt, including one pointed at a
  home-Region topic, was denied by the same policy; alarm actions are normally limited to the alarm's own Region anyway).
  So CloudFront's own 5xx metric cannot be alarmed.
- Built a substitute: a one-minute cron on the host calls the **public** address through DNS, CloudFront and the
  certificate, and publishes a `PublicHealthy` metric in the home Region. The `somacue-public-health-failing` alarm
  fires after five bad minutes. It covers everything a user depends on, not just the CDN's error rate.

**Result.** Certificate issued and valid until mid-2027, distribution deployed, aliases live. Public availability is
monitored end to end from inside the allowed Region, at zero cost.

**Interview takeaway.** Read the organization's guard rails before designing, and keep infrastructure code honest:
the repository records exactly which templates were applied and which were not, and why.

### Challenge 4: CPU credit exhaustion on a burstable instance

*Surfaced: failed for real, caught by the alarm that was designed for it.*

**Situation.** `t4g` instances earn CPU credits (24 an hour for `t4g.small`) and spend them above a 20% per-vCPU
baseline. Bootstrap (package installs) and the first Arm build ran in a short window, and the balance fell to
**under 1 credit**. The `somacue-cpu-credits-low` alarm went to ALARM.

**Task.** Decide whether this was a defect, a sizing error or a launch artifact, without paying for protection that
isn't needed.

**Action.**
- Chose `standard` credit mode on purpose. At zero credits the instance is throttled to its baseline; it is never
  billed for surplus. `unlimited` mode would keep full speed but bill surplus CPU, which is the "silent cost leak"
  to avoid on a fixed budget.
- Read the metric: the balance was recovering at roughly 20 credits an hour with the instance idle (the app and
  PostgreSQL were idle, using 529 MB of memory in total).
- Documented the scale triggers instead of reacting: credits staying under 20 under real load, memory over 85% for
  15 minutes, or swap over 50% means move to `t4g.medium` (+15.48 a month) or switch to `unlimited` knowingly.

**Result.** The alarm cleared by itself and all 9 alarms were green at the last check. There was no surprise charge
and no emergency resize, and the behaviour is written down with numbers.

**Interview takeaway.** Burstable instances need a credit alarm and a decision about what happens at zero. Cost
guard rails are part of the architecture.

### Smaller failures that were found and fixed

| What broke | Cause | Fix |
|---|---|---|
| First CodeBuild run failed after 83 s | `next build` imports every route module and the Prisma client requires `DATABASE_URL` at import time; CI had none | A placeholder URL in `buildspec.yml` (nothing connects during a build). The next run passed in 98 s |
| Bootstrap could not fetch its scripts | The instance role lacked `s3:ListBucket`, needed by `aws s3 cp --recursive` | Added a `ListBucket` statement limited to the `scripts/*` prefix, applied as a stack update |
| Smoke-test cleanup left a row behind | `ClinicalReport.patientId` has no foreign key to `User`, so deleting a user did not delete their reports | Cleaned the test row; recorded as a schema gap for any future account-deletion feature |
| Shell quoting through SSM from PowerShell | Nested quotes in inline commands | Scripts are pushed to S3 and run on the host; `host.ps1` sends multi-line blocks |
| CLI crashed printing a log line | The Windows console code page could not encode a Unicode character | Forced UTF-8 for the CLI's output |
| "Verify" output shown for a failing step | A pipe to `tail` hid a script's exit status | Run scripts to a log file, print the exit code, then the sanitized tail |

---

## 5. Resume-ready impact bullets

Copy-paste ready. Each is tied to something in this repository.

**Backend Engineer**
- Re-architected multi-minute AI server actions into non-blocking background jobs (`after()` execution, job-id
  response in milliseconds, 2 s client polling with retry tolerance, owner-scoped state, duplicate-job collapsing,
  concurrency cap of 6), keeping every request under CloudFront's response-timeout limit and avoiding a USD 27.89/month
  load balancer; covered by 21 new tests.
- Replaced Azure Blob Storage with S3 behind a strict key-pattern validator and an owner-authorized download route that
  issues 5-minute pre-signed URLs (404 on foreign resources to avoid existence leaks), and tightened the allow-list that
  protects the AI file loader's server-side reads.

**Cloud / DevOps Engineer**
- Cut hosting cost 48% versus a managed-database design and 68% versus a load-balancer design (USD 22.90 vs 43.88 and
  71.77 a month, priced from the AWS Price List API) by consolidating app and PostgreSQL 18 onto one Graviton
  instance, with no NAT Gateway, ALB or RDS.
- Defined 40 resources across two CloudFormation stacks (VPC, S3, IAM, Route 53, CodeBuild, EC2, DLM, 9 alarms) and built
  a no-SSH delivery pipeline: Arm CodeBuild (98 s) to S3 to SSM Run Command, with atomic symlink releases, a 40-try
  health gate and automatic rollback.
- Implemented zero-trust edge access: security group limited to the CloudFront managed prefix list, a secret
  origin-verify header enforced in nginx (403 otherwise), end-to-end TLS with an ACM viewer certificate and a certbot
  DNS-01 origin certificate scoped by IAM condition keys to two `_acme-challenge` TXT names.

**Full-Stack SDE-1**
- Shipped a Next.js 16 production deployment end to end: standalone output built on Arm, systemd-managed service with
  a 1.2 GB memory cap, `/api/health` database probe, and a signed-in file-download flow, with 921 tests across 65 files
  passing and 58 files changed across the two migration commits.
- Diagnosed and fixed real launch failures (CI build requiring a runtime database URL, missing IAM list permission,
  CPU-credit exhaustion, an organization policy denying `us-east-1` CloudFormation) and documented each root cause.

**AI Applied Engineer**
- Made LLM-backed clinical workflows (triage quiz, plan generation, rescheduling, daily feedback) reliable behind a CDN
  by decoupling them from the request lifecycle while preserving server-side plan limits, red-flag screening and
  ownership checks, and by filtering error text so provider or database internals never reach users.

**Cross-cutting (security and reliability)**
- Hardened a health-data app on a single host: secrets injected from SSM into a root-only tmpfs at service start
  (admin credentials withheld from the app), a DML-only PostgreSQL role verified to fail on DDL, encrypted EBS and S3,
  and nightly AES-256 `pg_dump` backups to S3 with a 30-day lifecycle and a tested decrypt path.
- Instrumented production with 9 CloudWatch alarms (including an end-to-end public-address probe built around a
  Region restriction), a USD 35 monthly budget with forecast alerts, and Cost Anomaly Detection.

---

## 6. System design and cloud interview Q&A

Twelve questions an interviewer is likely to ask after reading this on a resume, with answers grounded in the design.

**1. Why run the app and the database on the same instance? What are you giving up?**
For a launch with no users, one small host is the cheapest design that supports a pooled Prisma connection, long
AI calls and a real PostgreSQL 18. RDS would add USD 21.01 a month, more than the instance itself. The price is
a shared failure domain (one host loses both), no automatic standby, no point-in-time recovery, and shared RAM.
I accepted that explicitly and bought back what I could: encrypted nightly dumps (RPO up to 24 h), daily snapshots,
an auto-recover alarm, a documented rebuild (about 45 minutes), and a clean path to RDS (question 12).

**2. Your background jobs are in memory. Why not SQS or Redis, and when does that stop working?**
The job needs three things: a handle the browser can poll, ownership checks and cleanup. With one process, a `Map` gives
that for free and adds no service, no cost and no new failure mode. It stops working when (a) a restart losing a
running job becomes unacceptable, (b) there is more than one instance (a poll could land on a node that doesn't
have the job), or (c) concurrency needs exceed the cap of 6. The upgrade is incremental: first a jobs table in
PostgreSQL (the data is already there, and a worker can use `SKIP LOCKED`), then SQS or a Redis-backed queue if
throughput requires it. The `startJob`/`pollJob` boundary was kept narrow so the store can be swapped without
touching the actions.

**3. How is PostgreSQL tuned for a 2 GiB machine that also runs Node?**
Budget first: the app is capped at 1200 MB by systemd, PostgreSQL gets roughly 350 MB, nginx and the agents the rest,
with a 2 GiB swap file as a safety margin. `shared_buffers = 256MB` (about 14% of the 1.8 GiB visible),
`effective_cache_size = 768MB` to tell the planner about the OS cache, `work_mem = 4MB` because it multiplies per
sort per connection, `max_connections = 40` because Prisma's pool is small and each backend costs memory,
`wal_compression` to cut I/O on gp3, data checksums and `scram-sha-256`. Measured idle: PostgreSQL 58 MB, app 235 MB.

**4. How do you stop people from bypassing CloudFront and hitting the instance?**
Two independent locks. The security group admits only the CloudFront origin-facing managed prefix list on 443, so the
internet cannot connect. But that list is shared by all CloudFront customers, so any other distribution could point
at my origin. The second lock is a secret header, `X-Origin-Verify`, that my distribution adds and nginx
requires (403 otherwise). I tested no header, a wrong header and the right header. The header value is rotated by
updating SSM and the distribution's origin setting.

**5. How do secrets get into the process without touching disk?**
`ExecStartPre` runs a root script that reads `/somacue/prod/*` from SSM with decryption (permitted by the instance
role, and `kms:Decrypt` only via SSM) and writes `/run/somacue/env` on a tmpfs with mode 0600. systemd loads it as
the service's `EnvironmentFile`. Nothing is baked into the image, the release or git. Admin secrets (owner DB
password, backup passphrase, origin header) are filtered out of the app's file. Caveats worth saying: tmpfs can be
swapped (the swap file is on the encrypted volume), and the process itself holds its secrets in memory.

**6. How does a deploy work, and how do you roll back?**
CodeBuild produces `release.tgz`; SSM Run Command runs `deploy.sh`, which extracts into a new release directory,
runs `prisma migrate deploy` as the owner role, flips a `current` symlink atomically (`ln -sfn` then `mv -T`),
restarts the unit and polls `/api/health` (which does `SELECT 1`) up to 40 times at 2-second intervals. If it
never goes healthy, the script repoints the symlink at the previous release and restarts. Rollback is safe because
each release must work with the previous schema.

**7. Is that zero-downtime?**
No, and I would not claim it. The restart leaves a gap of a few seconds, which CloudFront and the polling client
mask for most requests. True zero-downtime needs two app processes or instances behind something that drains
connections (nginx upstream with two Node processes on different ports, or an ALB with a target group), plus
expand/contract migrations. The roadmap gets there with the load balancer stage.

**8. What are your RPO and RTO, and have you tested a restore?**
RPO is up to 24 hours (the nightly dump) with daily EBS snapshots as a second copy. A bad release rolls back
automatically in about two minutes (an 80-second health gate plus a restart). Rebuilding the host from CloudFormation,
the bootstrap scripts and a restore is estimated at about 45 minutes; that figure has not been drilled. I have verified that a dump decrypts and lists correctly (17 table-data entries) and that the object is
encrypted; I have not yet run a full restore into a scratch database, and I list that as an open item. For a tighter
RPO the answer is RDS point-in-time recovery or WAL archiving to S3.

**9. Why CloudFront in front, and why not an ALB?**
CloudFront gives free TLS termination with an ACM certificate, caching of 38 MB of static assets near users, and
DDoS absorption, all inside an always-free allowance. An ALB would add 27.89 a month to solve two problems I could
solve otherwise: certificate trust to the origin (certbot DNS-01 plus a dedicated origin name) and long requests
(background jobs). I would add an ALB when I run more than one instance.

**10. A presigned URL leaks. What is the blast radius?**
One object, for at most 5 minutes. The URL is minted per request after an ownership check, carries
`Cache-Control: no-store`, and the bucket is private with Block Public Access, so there is no standing URL. Keys are
random UUIDs, and the route returns 404 for anything the caller does not own, so ids cannot be enumerated. If I
needed tighter control I would shorten the lifetime, add a source-IP condition at signing time, or stream the file
through the app and drop presigning entirely.

**11. How do you control cost on a burstable instance, and what would make you leave `standard` mode?**
`standard` mode cannot bill surplus credits; at zero it throttles. I watch the credit balance with an alarm at 20,
plus memory and swap alarms. I would move to `t4g.medium` (+15.48 a month) if credits stay low under real load,
and consider `unlimited` only if I accept variable cost for consistent speed. The budget (USD 35, with 50%, 80%
and forecast alerts) and anomaly detection are the backstop.

**12. Traffic grows tenfold. What do you change first, and in what order?**
Measure first: memory, swap, credit and database latency alarms tell me which constraint binds. Then, cheapest first:
vertical to `t4g.medium`; move the database to RDS (and then Multi-AZ) so the app can be disposable; make jobs
durable (Postgres jobs table, then a queue); put an ALB and an Auto Scaling group behind CloudFront; move shared
state (rate limits) off process memory. Section 7 lays this out with triggers and approximate costs.

---

## 7. Scaling roadmap: from 0 users to 10,000+ users

The point of staying lean is that every step below is cheap to take later because the seams are already in the
right places: the job store has a narrow interface, the app is stateless apart from that store and the in-memory rate
limiters, files and secrets are already outside the host, and releases are immutable directories.

| Stage | Trigger (what I would watch) | Change | Added cost (approx.) |
|---|---|---|---|
| **0. Launch (now)** | 0 to a few hundred users | One `t4g.small`: app, nginx, PostgreSQL 18.7; S3; CloudFront; nightly dumps | about USD 22.90 total |
| **1. Vertical** | memory over 85% for 15 minutes, swap over 50%, or CPU credits under 20 under real load | `t4g.medium` (or `unlimited` credits, knowing the surplus is billed). One CloudFormation parameter | +15.48 |
| **2. Database off the box** | database contention, a need for point-in-time recovery, or plans to run a second app node | RDS PostgreSQL (`db.t4g.micro`, then Multi-AZ). Dump and restore, flip `DATABASE_URL`, keep `somacue_owner` and `somacue_app` as roles | +21.01 single-AZ; roughly double for Multi-AZ |
| **3. Durable jobs** | a restart-lost job matters, or more than 6 concurrent AI jobs | A `jobs` table in PostgreSQL with `FOR UPDATE SKIP LOCKED` workers first; SQS (or BullMQ on ElastiCache) when throughput needs a real queue. Keep the `startJob` and `pollJob` interface | small |
| **4. Horizontal** | more than one app node needed, or zero-downtime deploys required | Application Load Balancer + Auto Scaling group across two Availability Zones, CloudFront's origin becomes the ALB (also removes the origin-timeout concern), move rate limits and promo throttles to a shared store, `ELB` health checks on the group | ALB about +27.89 plus extra instances |
| **5. Scale and polish** | 10,000+ users, global audience, abuse | AWS WAF with managed rules and rate-based rules on CloudFront; static assets to their own S3 origin; read replica or RDS Proxy for connection pooling; OpenTelemetry tracing; AI request quotas and per-user rate limits; reserved capacity once the baseline is stable | varies |

**What does not change:** the CloudFront edge, the S3 layout and signed-URL route, the SSM secret model, the
CloudFormation approach, and the deploy flow (the build is the same; the last step changes from one SSM command to a
rolling instance refresh).

**Things I would deliberately not do early:** Kubernetes or ECS (extra control plane for one container), multi-region
(this account is limited to one Region anyway, and it does not fit the product's stage), or paying for managed rotation
before there are secrets worth rotating on a schedule.

---

*Sources of truth for every figure above: [`AWS_DEPLOYMENT_PLAN.md`](AWS_DEPLOYMENT_PLAN.md), `infra/aws/cfn/*.yaml`,
`infra/aws/instance/*`, `infra/aws/*.ps1`, `buildspec.yml`, `apps/web/lib/storage/s3.ts`,
`apps/web/lib/jobs/*`, `apps/web/actions/aiJobs.ts`, `apps/web/app/api/files/[reportId]/[index]/route.ts`,
`apps/web/app/api/health/route.ts`, and the git history on `main`.*
