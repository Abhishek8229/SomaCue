# SomaCue on AWS: approved architecture and execution plan

Version 2, approved. Supersedes the first draft (RDS, 22 migrated files, optional ALB fallback).
Target: `https://somacue.abhishekt.dev`. Region `ap-southeast-2` (Sydney). Account: the owner's AWS account (Free Plan). Account, resource and distribution ids are deliberately not recorded in this public repository: the scripts look them up (`aws sts get-caller-identity`, resources tagged `Name=somacue`).
Guidance level: medium. Branch: `aws-migration`.

Execution status is tracked in section 12. Facts below come from the read-only audit done on 2026-11-23
(repo, live AWS account, DNS, Neon, AWS Price List API). Items marked **(est.)** are estimates.

---

## 1. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Compute | One EC2 `t4g.small` (Arm64, Amazon Linux 2023, CPU credits `standard`, 20 GiB encrypted gp3, 2 GiB swap, Elastic IP) in a dedicated VPC `10.20.0.0/16` |
| 2 | Database | **PostgreSQL 18 on the same instance**, bound to `127.0.0.1:5432`, `shared_buffers=256MB`. No RDS. |
| 3 | Front door | CloudFront + free ACM certificate (us-east-1). **No ALB, no NAT Gateway.** |
| 4 | Origin TLS | nginx on `:443` with a certbot (DNS-01 through Route 53) certificate. nginx rejects requests without the secret `X-Origin-Verify` header. |
| 5 | Long AI calls | The AI actions become background jobs: the request that starts one returns at once and the browser polls. Every HTTP request ends well under 60 s. A CloudFront origin-timeout quota request (180 s) is filed as extra headroom. |
| 6 | Files | S3 only (private bucket, SSE-S3, versioned, Block Public Access). Authenticated `/api/files/[reportId]/[index]` returns 5-minute pre-signed URLs. Azure code and variables removed. |
| 7 | Data | **Clean launch.** No data is copied from Neon or Azure. `prisma migrate deploy` runs on an empty database: 0 users, 0 reports. |
| 8 | DNS | Route 53 public zone for `somacue.abhishekt.dev`, delegated from name.com with 4 NS records. Apex `abhishekt.dev` (GitHub Pages) is untouched. |
| 9 | Secrets | SSM Parameter Store SecureStrings under `/somacue/prod/`, written to `/run/somacue/env` (tmpfs, mode 0600) at service start. |
| 10 | CI/CD | CodeBuild (ARM) builds `release.tgz` into S3. SSM Run Command runs `deploy.sh` on the instance with a health check and automatic rollback. |
| 11 | Alerts | SNS to the owner's alert address (the required `AlertEmail` stack parameter, never stored in the repository), a USD 35 monthly budget (50 %, 80 %, 100 % forecast), Cost Anomaly Detection, free CloudWatch alarms. |

## 2. Architecture

```
Browser ──HTTPS──► CloudFront (ACM cert, somacue.abhishekt.dev)
                      │ HTTPS to origin.somacue.abhishekt.dev (Elastic IP), header X-Origin-Verify
                      ▼
      VPC 10.20.0.0/16, public subnet, security group: 443 from the CloudFront prefix list only
      ┌──────────────────────────── EC2 t4g.small ─────────────────────────────┐
      │ nginx :443 ─► Next.js standalone (systemd `somacue`, 127.0.0.1:3100)     │
      │                        │                                                 │
      │                        └─► PostgreSQL 18 on 127.0.0.1:5432 (role somacue_app)
      │ cron: nightly pg_dump | gzip | openssl ─► S3 backups bucket (30 days)    │
      │ CloudWatch agent (memory, swap, disk), health-check cron                 │
      └───────────────┬───────────────────────────────────────────────────────┘
                      └─ S3 gateway endpoint ─► S3 uploads bucket (private)
SSM Parameter Store   Route 53 zone   CodeBuild + S3 artifacts   SNS + Budgets + CloudWatch
```

Why the origin has its own name: CloudFront validates the origin certificate against the origin's domain name.
An `ec2-….amazonaws.com` name cannot match a certificate for `somacue.abhishekt.dev`, so Route 53 also holds
`origin.somacue.abhishekt.dev` (an A record for the Elastic IP) and the certificate covers both names. nginx sets
`Host: somacue.abhishekt.dev` toward Next.js, so redirects, cookies and server-action origin checks use the public name.

## 3. Cost (USD a month, `ap-southeast-2`, 730 h)

Prices read from the AWS Price List API on 2026-11-23.

| Item | Basis | USD |
|---|---|---|
| EC2 `t4g.small` | 0.0212 per hour | 15.48 |
| EBS gp3 20 GiB | 0.096 per GiB | 1.92 |
| Public IPv4 (Elastic IP) | 0.005 per hour | 3.65 |
| S3 (uploads + 30 days of dumps, under 3 GiB) and requests | 0.025 per GiB **(est.)** | 0.25 |
| Route 53 hosted zone and queries | 0.50 per zone **(est.)** | 0.60 |
| EBS snapshots (daily, 7 kept, incremental) | **(est.)** | 0.50 |
| CodeBuild ARM builds (10 a month) | **(est.)** | 0.50 |
| CloudFront, ACM, SSM Parameter Store, KMS managed keys, CloudWatch free tier, SNS email, Budgets, Cost Anomaly Detection | free allowances | 0.00 |
| **Total** | | **about 22.90** |

Credits: USD 139.99, expiring 2027-05-21 (about 6 months at this rate). **Not used:** RDS, ALB, NAT Gateway,
interface endpoints, WAF, Secrets Manager.

Trade-offs of this layout, accepted by the owner:
- One host holds the app and the database. A lost disk is recovered from the nightly dump (RPO up to 24 h) or the
  daily EBS snapshot. There is no point-in-time recovery and no standby.
- 2 GiB of RAM is shared by Node (limit 1200 MB), PostgreSQL (about 350 MB), nginx and agents. A 2 GiB swap file
  covers peaks. The memory alarm is the trigger to move to `t4g.medium` (+USD 15.50).

## 4. Security and IAM

- VPC: one public subnet, no NAT, an S3 gateway endpoint. Security group inbound: TCP 443 from
  `com.amazonaws.global.cloudfront.origin-facing`. No port 22, no port 80. Access is Session Manager only.
- Instance: IMDSv2 required, encrypted EBS, termination protection, non-root `somacue` user, hardened systemd unit.
- PostgreSQL: listens on localhost only; `somacue_owner` (migrations, DDL) and `somacue_app` (DML only) roles;
  `postgres` superuser reachable only through the local socket.
- Instance role `somacue-instance`: SSM core, S3 read/write on `uploads/*` of the uploads bucket, put on the backups
  bucket, read on `releases/*` of the artifacts bucket, `ssm:GetParameter` on `/somacue/prod/*`, Route 53 TXT changes
  for `_acme-challenge` names in this zone only, CloudWatch agent writes.
- CodeBuild role: read the source object, write `releases/*`, write its own logs.
- S3: Block Public Access, TLS-only bucket policies, SSE-S3, versioning on uploads, lifecycle rules.
- Secrets never touch git or disk. `X-Origin-Verify`, `SESSION_SECRET` and database passwords are generated fresh.

## 5. Code changes (branch `aws-migration`)

| Area | Change |
|---|---|
| Storage | `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` replace `@azure/storage-blob`. `lib/storage/s3.ts` is the only S3 module. References are stored as `s3://bucket/uploads/<uuid>.<ext>`. Production without `UPLOADS_BUCKET` is an error. |
| URL allow-list | `isTrustedUploadUrl` accepts only the configured bucket and the strict `uploads/<uuid>.<ext>` shape (and `/uploads/…` in development). |
| Downloads | `GET /api/files/[reportId]/[index]`: owner only (401, 403, 404), redirects to a 5-minute pre-signed URL. The dashboard links to it. |
| AI generation | `actions/aiJobs.ts`: `startIntakeJob`, `startQuizJob`, `startPainRescheduleJob`, `startFeedbackJob`, `getAiJob`. The work runs inside `after()` (cookies stay available), results are kept in an in-memory store, the client polls every 2 s. Existing actions keep their logic and return shapes. |
| Runtime | `output: "standalone"`, `/api/health` (checks the database), `sharp` declared, `buildspec.yml`. |
| Config | `.env.example` and README: Azure and Neon removed, `UPLOADS_BUCKET` and `AWS_REGION` added. |
| Tests | Storage, URL guard, download route, job store and polling client, plus updates to the tests that mention Azure. |

## 6. Domain, TLS and third-party addresses

1. Create the Route 53 zone `somacue.abhishekt.dev`. **Pause:** add its 4 NS records at name.com (host `somacue`).
2. Verify delegation with `Resolve-DnsName somacue.abhishekt.dev -Type NS -Server 1.1.1.1`.
3. ACM certificate in us-east-1 (DNS validation, record created in the zone). certbot on the instance issues the origin
   certificate for `origin.somacue.abhishekt.dev` and `somacue.abhishekt.dev` (DNS-01, Route 53).
4. CloudFront distribution with alias `somacue.abhishekt.dev`; Route 53 alias A/AAAA records are created last.
5. **Pause:** Google OAuth redirect URI `https://somacue.abhishekt.dev/api/auth/google/callback` and origin
   `https://somacue.abhishekt.dev`; Razorpay webhook `https://somacue.abhishekt.dev/api/billing/webhook`.

CloudFront behaviors: default and `/api/*` uncached, all methods, `AllViewerExceptHostHeader`; `/_next/static/*`,
`/assets/*`, `/models/*` cached; `/_next/image*` cached by query string; HTTPS only, TLS 1.2+, HTTP/2 and 3,
managed security-headers policy.

## 7. Secrets and promo codes

| Parameter (`/somacue/prod/…`) | Source |
|---|---|
| `SESSION_SECRET`, `DB_APP_PASSWORD`, `DB_OWNER_PASSWORD`, `X_ORIGIN_VERIFY`, `BACKUP_PASSPHRASE` | generated fresh |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `PROMO_CODES`, `RAZORPAY_*` | read from local `apps/web/.env` by `infra/aws/put-secrets.ps1`; nothing is printed or committed |
| `NEXT_PUBLIC_APP_URL`, `UPLOADS_BUCKET`, `AWS_REGION` | derived |

Rotation: `SESSION_SECRET` yearly (signs everyone out), database passwords every 90 days (`ALTER ROLE`, update SSM,
restart), third-party keys at go-live and yearly. `PROMO_CODES` changes with `put-parameter --overwrite` and a service
restart, and existing redemptions stay valid. The Neon connection string and the Azure key are no longer used and
should be revoked after launch. `BACKUP_PASSPHRASE` must also be kept somewhere outside the instance: without it a
backup cannot be decrypted.

## 8. Operations

- Deploy: `infra/aws/deploy.ps1` starts CodeBuild from an S3 source zip, waits for `releases/<id>/release.tgz`, then
  sends `deploy.sh` through SSM. `deploy.sh` extracts to `/opt/somacue/releases/<id>`, runs `prisma migrate deploy`,
  switches the `current` symlink, restarts, checks `/api/health` and **rolls back** on failure.
- Backups: 02:30 UTC cron `pg_dump | gzip | openssl aes-256-cbc -pbkdf2` to the backups bucket (30-day lifecycle) plus
  daily EBS snapshots (7 kept). A hook file `/etc/somacue/ping-url` is pinged after each successful dump (placeholder).
- Alarms: EC2 status check failed (auto-recover), `CPUCreditBalance` low, memory, swap and disk from the CloudWatch
  agent, CloudFront 5xx rate, `/api/health` (a minute cron publishes a metric), budget and anomaly emails.
- Restore: `restore-db.sh <s3 key>` decrypts and loads a dump into a fresh database.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Memory pressure on 2 GiB | systemd `MemoryMax=1200M`, swap, memory alarm, one-line resize |
| One host, no standby | backups, snapshots, auto-recover alarm, documented rebuild (about 45 minutes) |
| Background jobs live in process memory | a restart loses running jobs; the client shows a retry message after 5 minutes. Acceptable for one instance |
| In-memory rate limits reset on restart | accepted |
| Free Plan ends 2027-05-21 or when credits run out | upgrade to the Paid Plan before then |
| Gemini key quota (external) | unchanged from today |

## 10. Zero-user launch check

After migrations: `User`, `ClinicalReport`, `Subscription`, `PromoRedemption` row counts are 0.
Smoke tests create a throwaway user and delete it, and a final count confirms 0.

## 11. Out of scope

Data migration from Neon and Azure, RDS, ALB, WAF, multi-AZ, Bedrock, registrar transfer.

## 12. Execution status

Done (2026-11-23):
- [x] Plan approved, branch `aws-migration`, code and tests (65 test files green)
- [x] CloudFront origin-timeout quota increase to 180 s requested (`L-AECE9FA7`, pending; the current 120 s is enough)
- [x] `somacue-core` (VPC, security group, S3 buckets, IAM, SNS, Route 53 zone, CodeBuild), `somacue-compute` (instance, Elastic IP, origin DNS name, 9 alarms, daily EBS snapshots)
- [x] NS delegation at name.com verified on 1.1.1.1 and 8.8.8.8; apex records unchanged
- [x] ACM certificate (us-east-1, DNS-validated) and origin certificate (certbot DNS-01, auto-renewing)
- [x] PostgreSQL 18.7 on the instance (127.0.0.1 only), roles `somacue_owner` / `somacue_app`, 16 migrations applied, 0 rows in every table
- [x] Secrets in SSM under `/somacue/prod/`, loaded into tmpfs at start
- [x] First release built on CodeBuild (ARM), deployed with health check, `/api/health` green
- [x] CloudFront distribution (created through the CloudFront API; find it with `aws cloudfront list-distributions` and the alias `somacue.abhishekt.dev`), alias A/AAAA records, `https://somacue.abhishekt.dev` live
- [x] Budget `somacue-monthly-35` (50 %, 80 %, 100 % forecast), Cost Anomaly Detection, alarms, nightly backup tested and restore-checked
- [x] Live smoke test (throwaway user, deleted): auth, promo (wrong 400, right 200, repeat 409), S3 upload, owner-only 5-minute download links

Waiting on the owner:
- [ ] Google OAuth redirect URI and origin for `https://somacue.abhishekt.dev`
- [ ] Razorpay webhook URL `https://somacue.abhishekt.dev/api/billing/webhook`
- [ ] Confirm the SNS test email

## 13. Account limits found while building

- CloudFormation, SNS and CloudWatch alarms are blocked in `us-east-1` by the account's service control policy. ACM, CloudFront and Route 53 are allowed there, so the certificate and the distribution were created with their own APIs (the templates `03-acm-us-east-1.yaml` and `04-edge-us-east-1.yaml` are kept as reference but were not used).
- Because of that there is no CloudWatch alarm on CloudFront's own 5xx metric. A one-minute probe on the host requests the public address through CloudFront and publishes `SomaCue/PublicHealthy`; the alarm `somacue-public-health-failing` watches it.
- `t4g.small` in `standard` credit mode earns 24 CPU credits an hour. Bootstrap and the first build used them up; the alarm `somacue-cpu-credits-low` shows the balance. If it stays low under real use, move to `t4g.medium` or switch the credit mode to `unlimited` (surplus credits are billed).