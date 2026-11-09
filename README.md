# Production Web App on AWS: EC2 · RDS · ECR · Nginx · HTTPS · CI/CD

> A containerized Node.js application running on **AWS EC2** with an **Amazon RDS PostgreSQL** database, served over **HTTPS** by **Nginx**, and released through a **GitHub Actions** pipeline with security scanning, manual approval, **keyless deployments via AWS Systems Manager** and **automatic rollback**.

**Live demo:** `https://<your-domain>.duckdns.org` *(the environment is torn down between practice sessions to avoid cost)*

---

## Table of Contents

1. [Overview]
2. [Architecture]
3. [Tech Stack]
4. [Key Features]
5. [AWS Infrastructure]
6. [CI/CD Pipeline]
7. [Project Structure]
8. [Application Endpoints
9. [Setup Guide]
10. [Deployment Workflow]
11. [Rollback](#rollback)
12. [Monitoring & Backups]
13. [Security](#security)
14. [Troubleshooting]
15. [Cost & Cleanup]
16. [Future Improvements
17. [What I Learned]
18. [Author]

---

## Overview

| Item | Details |
|---|---|
| **Goal** | Run a database-backed web application on AWS the way production teams do: secure networking, managed database, private image registry, automated and reversible releases |
| **Application** | Node.js (Express) app that records visits in PostgreSQL and exposes health/readiness endpoints |
| **Compute** | Amazon EC2 (Ubuntu 24.04, t3.micro) running Docker |
| **Database** | Amazon RDS for PostgreSQL (private, encrypted, SSL-only connections) |
| **Registry** | Amazon ECR (private, scan on push, lifecycle policy) |
| **Delivery** | GitHub Actions → ECR → manual approval → AWS Systems Manager → EC2 |
| **Access to server** | AWS Session Manager (no SSH, port 22 closed, no key pairs) |
| **Infrastructure** | Built manually in the AWS Console (security groups, IAM roles, RDS, ECR, EC2, CloudWatch,
```

**Design principles**

- **Single public entry point:** only Nginx accepts internet traffic (80/443). The app is internal; the database is private.
- **Security group chaining:** the database accepts connections only from members of the web server's security group, not from IP addresses.
- **Stateless application, stateful database:** containers can be replaced at any time; all data lives in RDS.
- **No long-lived credentials:** GitHub uses OIDC; the server uses an IAM role. No access keys or SSH keys exist.
- **Immutable, traceable releases:** every image is tagged with its Git commit ID.

---

## Tech Stack

| Category | Technology |
|---|---|
| Application | Node.js 20, Express, node-postgres (`pg`) |
| Database | Amazon RDS for PostgreSQL |
| Containers | Docker (multi-stage build), Docker Compose |
| Web server / proxy | Nginx 1.27 |
| TLS certificates | Let's Encrypt (Certbot), DuckDNS domain |
| Cloud | AWS EC2, RDS, ECR, IAM, Systems Manager, CloudWatch, SNS |
| CI/CD | GitHub Actions, GitHub Environments, branch protection |
| Quality & security | hadolint, shellcheck, `node --test`, `npm audit`, Trivy, Dependabot |

---

## Key Features

**Infrastructure**
- Private RDS PostgreSQL with encryption at rest, SSL in transit, and automated backups
- Security groups with least-privilege rules and security-group-to-security-group access
- IAM roles instead of access keys for both the server and the pipeline
- Server access through Session Manager: no open SSH port

**Application & containers**
- Liveness (`/health`) and readiness (`/ready`) endpoints
- Multi-stage Docker image running as a non-root user with a built-in health check
- Database schema created automatically on startup; connection retries if RDS is not ready yet
- Graceful shutdown that closes database connections cleanly

**Web layer**
- HTTPS with automatic certificate renewal and HTTP → HTTPS redirect
- HSTS and security headers, gzip compression, API rate limiting

**Delivery**
- Pull requests must pass lint, tests and a container security scan before merging
- Only scanned images are pushed to ECR
- Manual approval gate for production (GitHub Environment)
- Deployment through AWS Systems Manager with output streamed back to GitHub
- **Automatic rollback** to the last healthy version if the readiness check fails
- One-click **Rollback** workflow for any previous version
- Weekly dependency updates via Dependabot

**Operations**
- CloudWatch alarms (EC2 CPU, RDS free storage) with email alerts through SNS
- Manual RDS snapshots before risky changes
- Full audit trail: SSM command history and GitHub deployment history

---

## AWS Infrastructure

All resources were created manually in the AWS Console.

| Resource | Name | Key configuration |
|---|---|---|
| Security group | `webapp-web-sg` | Inbound: HTTP 80, HTTPS 443 from anywhere. No SSH |
| Security group | `webapp-db-sg` | Inbound: PostgreSQL 5432 **only from `webapp-web-sg`** |
| IAM role | `webapp-ec2-role` | `AmazonEC2ContainerRegistryReadOnly`, `AmazonSSMManagedInstanceCore` |
| IAM OIDC provider | `token.actions.githubusercontent.com` | Audience `sts.amazonaws.com` |
| IAM role | `webapp-github-actions-role` | Trust: this repo's `main` branch and `production` environment only. Permissions: push to one ECR repo; SSM commands only on instances tagged `Project=streamlined-deployment` |
| RDS | `webapp-db` | PostgreSQL, db.t4g.micro, 20 GB gp3, Single-AZ, **public access: No**, encrypted, backups: 1 day |
| ECR | `streamlined-webapp` | Private, scan on push, lifecycle: keep last 20 images |
| EC2 | `streamlined-server` | Ubuntu 24.04, t3.micro, 20 GB gp3, tag `Project=streamlined-deployment`, no key pair |
| SNS | `webapp-alerts` | Email subscription |
| CloudWatch | `webapp-server-high-cpu`, `webapp-db-low-storage` | CPU > 80% for 10 min; free storage < 2 GB |

---

## CI/CD Pipeline

| Stage | Pull request | Push to `main` | What it does |
|---|:-:|:-:|---|
| **lint** | ✅ | ✅ | hadolint (Dockerfile) and shellcheck (scripts) |
| **test** | ✅ | ✅ | `npm ci`, unit tests with a fake database, `npm audit` |
| **build** | ✅ | ✅ | Builds the image and scans it with **Trivy** (fails on fixable CRITICAL issues) |
| **push** | — | ✅ | Pushes the scanned image to ECR as `:<commit-id>` and `:latest` |
| **approval** | — | ✅ | Waits for a reviewer to approve the `production` environment |
| **deploy** | — | ✅ | Runs `deploy.sh <tag>` on EC2 via **AWS Systems Manager** |
| **smoke test** | — | ✅ | Calls `/ready` and `/api/info` from the public internet |

The `main` branch is protected: changes arrive only through pull requests whose `lint`, `test` and `build` checks have passed.

---

## Project Structure

```
streamlined-deployment/
├── app/
│   ├── app.js                    # Express routes: /health, /ready, /api/info, /api/visits
│   ├── db.js                     # RDS connection pool (SSL) + table creation
│   ├── server.js                 # Startup, database retries, graceful shutdown
│   ├── public/index.html         # Web page (visit counter, DB status, version)
│   ├── test/app.test.js          # Unit tests using a fake database
│   ├── package.json / package-lock.json
│   ├── Dockerfile                # Multi-stage, non-root, HEALTHCHECK
│   └── .dockerignore
├── nginx/
│   ├── nginx.conf                # Global settings: gzip, rate limiting, logging
│   ├── conf.d/app.conf           # HTTP config (before the certificate exists)
│   └── templates/https.conf.template  # HTTPS config with security headers
├── scripts/
│   ├── deploy.sh                 # Runs on EC2: deploy, readiness check, auto-rollback
│   └── ssm-deploy.sh             # Runs in GitHub Actions: sends the deploy via SSM
├── .github/
│   ├── workflows/ci-cd.yml       # Main pipeline
│   ├── workflows/rollback.yml    # Manual rollback workflow
│   └── dependabot.yml            # Weekly dependency updates
├── docker-compose.yml            # app + nginx + certbot
├── .env.example                  # Server settings template (real .env never committed)
├── .gitignore
└── .gitattributes
```

---

## Application Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Web page showing visit count, database status and version |
| `/health` | GET | **Liveness:** the process is running (no database check) |
| `/ready` | GET | **Readiness:** the database is reachable (`200` or `503`) |
| `/api/info` | GET | Version (commit ID), container ID, environment |
| `/api/visits` | POST | Stores a visit in RDS and returns the total |

---

## Setup Guide

### 1. AWS Console
1. Create security groups `webapp-web-sg` (80/443) and `webapp-db-sg` (5432 from `webapp-web-sg`).
2. Create IAM role `webapp-ec2-role` (EC2 use case) with ECR read-only and SSM core policies.
3. Create RDS PostgreSQL `webapp-db`: public access **No**, security group `webapp-db-sg`, initial database `webapp`.
4. Create ECR repository `streamlined-webapp` with a lifecycle rule (keep 20 images).
5. Add the GitHub OIDC identity provider and create `webapp-github-actions-role` (web identity) with the trust and inline policies described above.
6. Launch EC2 `streamlined-server` with tag `Project=streamlined-deployment`, security group `webapp-web-sg`, instance profile `webapp-ec2-role`, and no key pair.
7. Point a DuckDNS subdomain to the instance's public IP.

### 2. GitHub
- **Variables:** `AWS_ROLE_ARN`, `EC2_INSTANCE_ID`, `DOMAIN` (no secrets are needed)
- **Environment:** `production` with required reviewers
- **Branch protection on `main`:** require pull requests and the `lint`, `test`, `build` checks

### 3. Server (via Session Manager)
```bash
sudo -iu ubuntu
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu
# install AWS CLI v2 and postgresql-client, add swap, then log in again
git clone https://github.com/hzeeshanhaider80-crypto/streamlined-deployment.git
cd streamlined-deployment
mkdir -p certs && curl -fsSL -o certs/rds-global-bundle.pem \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
cp .env.example .env && nano .env && chmod 600 .env
```

### 4. HTTPS (once)
```bash
set -a; source .env; set +a
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
  -d "$DOMAIN" --email "$CERTBOT_EMAIL" --agree-tos --no-eff-email --non-interactive
sed "s/__DOMAIN__/$DOMAIN/g" nginx/templates/https.conf.template > nginx/conf.d/app.conf
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
```

---

## Deployment Workflow

```bash
git checkout -b feature/my-change
# ...edit code...
git commit -am "feat: my change"
git push -u origin feature/my-change
gh pr create --fill          # checks run automatically
gh pr merge --squash         # after checks pass
```
Then approve the **production** deployment in GitHub Actions. The pipeline deploys, verifies readiness, and runs a smoke test.

---

## Rollback

| Method | How |
|---|---|
| **Automatic** | `deploy.sh` restores the last healthy version if `/ready` fails after a deploy |
| **Rollback button** | GitHub → Actions → **Rollback** → enter an older 7-character commit ID → approve |
| **Emergency** | On the server: `bash scripts/deploy.sh <older-tag>` |
| **Code revert** | `git revert <commit>` → PR → merge → approve |

---

## Monitoring & Backups

- **CloudWatch alarms:** EC2 CPU > 80% (10 minutes) and RDS free storage < 2 GB → SNS email.
- **Alarm test:** `stress-ng --cpu 2 --timeout 900s` on the server triggers the CPU alert.
- **Backups:** automated daily RDS backups (1-day retention) plus manual snapshots before risky changes.
- **Audit trail:** Systems Manager → Run Command history; GitHub → Environments → production history.

---

## Security

| Area | Measure |
|---|---|
| Network | Only 80/443 open on EC2; RDS private and reachable only from the web security group |
| Access | Session Manager instead of SSH; no key pairs |
| Credentials | OIDC for GitHub, IAM role for EC2, no access keys stored anywhere |
| Least privilege | Pipeline can push to one ECR repo and run commands only on tagged instances |
| Data | RDS encryption at rest, SSL with certificate verification in transit |
| Containers | Non-root user, minimal Alpine base image, Trivy scanning, Dependabot updates |
| Secrets on server | `.env` with `chmod 600`, excluded from Git |
| Web | HTTPS only, HSTS, security headers, rate limiting, hidden server version |
| Pipeline | Input validation in the rollback workflow, protected `main` branch, manual approval |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App/psql times out connecting to RDS | Security group rules | `webapp-db-sg` must allow 5432 from `webapp-web-sg` |
| Page shows "Database: unreachable" | Wrong `.env` values or missing CA bundle | `docker compose logs app`; check `DB_*` values and `certs/` |
| `AccessDenied ... ssm:SendCommand` | Missing instance tag | Add `Project=streamlined-deployment` to the EC2 instance |
| `Could not assume role` | Trust policy mismatch | Check the repo name and `AWS_ROLE_ARN` |
| Deploy job red but site works | Automatic rollback succeeded | Read the deploy log for the failed version's error |
| Certbot `unauthorized` | Domain not pointing to the server | Update the DuckDNS IP; make sure port 80 is open |
| Site down after stop/start | Public IP changed | Update DuckDNS |

---

## Cost & Cleanup

Runs within the AWS Free Tier/credits for practice (EC2 t3.micro, RDS db.t4g.micro, 20 GB storage each); otherwise roughly **$0.03/hour**.

**Teardown order:** CloudWatch alarms and SNS topic → terminate EC2 → delete RDS (no final snapshot, no retained backups) → delete snapshots → delete ECR repository → delete security groups (`webapp-db-sg` first) → delete IAM roles.

---

## Future Improvements

- [ ] Infrastructure as Code with **Terraform** (VPC with private subnets, all resources)
- [ ] Database credentials in **AWS Secrets Manager** with automatic rotation
- [ ] **Application Load Balancer** + **Auto Scaling Group** across two Availability Zones
- [ ] **RDS Multi-AZ** and deletion protection
- [ ] **Staging environment** with automatic deploys and promotion to production
- [ ] Centralized logs and dashboards (CloudWatch Logs or Prometheus + Grafana + Loki)
- [ ] Zero-downtime blue-green deployments
- [ ] Database migrations tool (e.g. node-pg-migrate)

---

## What I Learned

- Designing AWS networking with security groups that reference each other
- Running a private, encrypted RDS database and connecting to it securely over SSL
- Using IAM roles, instance profiles and OIDC instead of long-lived credentials
- Managing servers without SSH using AWS Systems Manager
- Building a multi-stage Docker image and running a multi-container stack with Compose
- Serving HTTPS with Nginx and automatically renewed Let's Encrypt certificates
- Building a CI/CD pipeline with linting, testing, security scanning, approvals and smoke tests
- Designing safe releases: readiness checks, automatic rollback and a manual rollback workflow
- Monitoring with CloudWatch alarms and SNS, and protecting data with RDS snapshots

---

## Author

**Zeeshan Haider**: Junior DevOps Engineer
AWS · Linux · Docker · Nginx · CI/CD · PostgreSQL

GitHub: [github.com/hzeeshanhaider80-crypto](https://github.com/hzeeshanhaider80-crypto)

*Part of my hands-on DevOps project portfolio (Project 4 of 10).*
