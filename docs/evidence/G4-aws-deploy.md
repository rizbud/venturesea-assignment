# G4 evidence: live AWS deploy (2026-10-02)

Deployed by GitHub Actions (**Deploy → Run workflow**, OIDC, no AWS keys in
GitHub) with `REVIEW=true`, the short-lived review configuration in
[`deployment/aws/README.md`](../../deployment/aws/README.md#review-deployment-reviewtrue).
Region `ap-southeast-3` (Jakarta).

| Surface       | URL                                         |
| ------------- | ------------------------------------------- |
| Dashboard     | https://ledgerlab.rizbud.com                |
| Ledger API    | https://ledgerlab-api.rizbud.com/health     |
| Reporting API | https://ledgerlab-reports.rizbud.com/health |

Successful runs: [36993204462](https://github.com/rizbud/venturesea-assignment/actions/runs/36993204462)
(first full deploy), [36995035996](https://github.com/rizbud/venturesea-assignment/actions/runs/36995035996)
(update with the Service Connect security group fix, below).

## State after the deploy

```
# aws ecs describe-services: service, desired, running, rollout
ledgerapi     2  2  COMPLETED
web           2  2  COMPLETED
reportingapi  2  2  COMPLETED

# aws ecs describe-tasks: one task of each service per availability zone
ledgerapi     ap-southeast-3a  RUNNING  HEALTHY
ledgerapi     ap-southeast-3b  RUNNING  HEALTHY
reportingapi  ap-southeast-3a  RUNNING  HEALTHY
reportingapi  ap-southeast-3b  RUNNING  HEALTHY
web           ap-southeast-3a  RUNNING  UNKNOWN   # no container health check; ALB checks /healthz
web           ap-southeast-3b  RUNNING  UNKNOWN

# ALB target groups: every target healthy (3 groups × 2 targets)

# aws rds describe-db-instances
postgres 16.13  db.t4g.small  MultiAZ=False (review)  encrypted  private  backups 7 days  available
```

Through Cloudflare:

```
$ curl -s https://ledgerlab-api.rizbud.com/health
{"status":"ok","service":"ledger-api","version":"0.1.0","uptimeSeconds":1947,"repository":"postgres"}

$ curl -s https://ledgerlab-reports.rizbud.com/health
{"status":"ok","service":"reporting-api","version":"0.1.0","uptimeSeconds":121,"repository":"upstream:ledger-api"}

$ curl -s 'https://ledgerlab-reports.rizbud.com/api/reports/dashboard?asOf=2026-10-02'
{"data":{"asOf":"2026-10-02","totalAssetsMinor":710000,"totalLiabilitiesMinor":80000,
 "totalEquityMinor":630000,...,"cashMinor":530000,"accountCount":7,"entryCount":5,"balanced":true}}

$ curl -sk --max-time 8 https://<alb-dns-name>/health     # straight to AWS, bypassing Cloudflare
(no connection: the ALB security group admits Cloudflare's ranges only)
```

The dashboard shows the position "In balance" (assets $7,100 = liabilities $800
\+ equity $6,300) and the five demo entries. Demo data was loaded through the
public API from the repository's seed dataset (`packages/shared` seed), so it
passed the same validation and database triggers as any entry.

## Review configuration vs production

`REVIEW=true` changes three things and nothing else: one `t4g.micro` NAT
instance instead of a NAT gateway, single-AZ RDS without deletion protection,
and a 0.25 vCPU ledger task. Services, 2 tasks each, private subnets, the
Cloudflare-only ALB and the secrets are identical. Go-live: delete the `REVIEW`
variable and run Deploy again. The stack tests assert both configurations.

## What the real deploy found (none visible in the local or LocalStack rehearsals)

| Symptom                                                     | Root cause                                                                                                                                                                 | Fix                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Not authorized to perform sts:AssumeRoleWithWebIdentity`   | GitHub sends this repository's OIDC subject in the immutable form `repo:owner@id/name@id:…`                                                                                | `githubRepository` in `infra/aws/cdk.json` uses that form (`455c5e3`)                                                                       |
| Deploy role denied `ecr:DescribeRepositories`               | `deploy.sh` reads the registry host from ECR; the role lacked the action                                                                                                   | Added, scoped to the three repositories (`0adaea5`)                                                                                         |
| `deploy.sh: Permission denied`                              | A Windows commit dropped the executable bit                                                                                                                                | The workflow runs it through `bash` (`9ef8db2`)                                                                                             |
| Stack creation: "ECS Service Linked Role is not ready"      | First ECS use in a fresh account                                                                                                                                           | Retry once the role existed; the rollback had failed on an RDS instance still creating, so the stack was deleted and redeployed             |
| Migration task: Secrets Manager "context deadline exceeded" | The `t4g.nano` NAT instance ran out of memory in its setup script (`dnf install` killed), so private subnets had no egress                                                 | `t4g.micro`, AL2023 minimal image (a new image forces replacement; user data runs once) and a fail-fast setup script (`39f902f`, `7c43264`) |
| `deploy.sh` would migrate before fixing the stack           | It treated "stack exists" as "first deploy finished"                                                                                                                       | The stack outputs `TasksPerService`; while it is 0 the first-deploy path runs again (`39f902f`)                                             |
| Reports panel failed (browser said CORS)                    | Really a 504: reporting reaches ledger task to task over Service Connect, and the ledger security group admitted only the ALB. LocalStack does not enforce security groups | Ingress reporting → ledger on 4001, with a stack test (`e0a618f`)                                                                           |

## Still open

- CloudWatch alarms and an external uptime monitor on both `/health` URLs.
- RDS point-in-time restore drill on this stack (the local drill is in
  [G9-restore-drill.md](G9-restore-drill.md)).
- Tear down after the review: `cdk destroy LedgerLab` as in the runbook, then
  delete the final snapshot and the ECR images.
