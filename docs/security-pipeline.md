# Security Pipeline

This document captures the current security pipeline design for the repository, centered on OSV-Scanner for SCA and a tighter GitHub Actions workflow for a public npm-based application.

## Current State

The current pipeline has four jobs:

- `build`
- `sast`
- `sca`
- `secrets`

The original SCA job was not healthy:

- it references `aquasecurity/trivy-action@0.33.1`, which GitHub cannot currently resolve in our workflow runs
- that tag is also part of the March 2026 `trivy-action` compromise set described by Aqua

The current SAST job now uses a simplified and more reliable configuration:

- Semgrep CE is reinstalled fresh in CI
- Semgrep runs with the maintained default ruleset via `--config auto`
- findings are uploaded as a JSON artifact for later triage

The active implementation now reflects the OSV migration described below.

## Decision Summary

For this repository, the chosen open-source SCA tool is `OSV-Scanner`, using Google's official reusable GitHub Actions workflows.

Why this is the primary choice:

- this repo is a source-first npm application with a committed `package-lock.json`
- OSV-Scanner officially supports `package-lock.json`, `pnpm-lock.yaml`, and `yarn.lock`
- the GitHub Action has a clean split between:
  - PR scanning that reports only newly introduced vulnerabilities
  - scheduled or push-based full scans for the default branch
- it integrates with GitHub Code Scanning via SARIF, which is now useful because the repository is public
- it is a better fit for this project than a broader filesystem or container-oriented scanner

Recommended immutable references:

- OSV-Scanner Action release: `v2.3.5`
- OSV-Scanner Action commit SHA: `c51854704019a247608d928f370c98740469d4b5`
- OSV-Scanner CLI release: `v2.3.5`
- OSV-Scanner CLI commit SHA: `30bcc134e23fbc35731021ee43ec433c483715d7`

Key source references:

- OSV GitHub Action docs: [google.github.io/osv-scanner/github-action](https://google.github.io/osv-scanner/github-action/)
- OSV supported manifests and lockfiles: [google.github.io/osv-scanner/supported-languages-and-lockfiles](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/)
- npm audit signatures: [docs.npmjs.com/cli/v10/commands/npm-audit](https://docs.npmjs.com/cli/v10/commands/npm-audit/)

Required caller workflow permissions for the implemented OSV setup:

- `actions: read`
- `contents: read`
- `security-events: write`

These are required because the reusable workflows upload SARIF into GitHub Code Scanning.

## Concrete Migration Plan

### 1. Replace the current `sca` job with OSV-Scanner

Remove the Trivy-based SCA implementation from:

- `.github/workflows/security-gate.yml`
- `.github/workflows/security-baseline.yml`

Replace it with OSV reusable workflows pinned to the immutable workflow commit `c51854704019a247608d928f370c98740469d4b5`.

Implemented workflow structure:

- PR workflow:
  - use OSV's reusable PR scan workflow
  - fail only when the PR introduces new vulnerabilities relative to `main`
- Mainline workflow:
  - use OSV's reusable scheduled/full scan workflow
  - run on `push` to `main`, `workflow_dispatch`, and weekly schedule
  - fail when any known vulnerability exists in the default branch dependency tree

### 2. Pin OSV immutably

Do not use a mutable tag as the final workflow reference.

Use the resolved commit SHA:

```yaml
uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable-pr.yml@c51854704019a247608d928f370c98740469d4b5
```

and:

```yaml
uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@c51854704019a247608d928f370c98740469d4b5
```

### 3. Scope the scan tightly to the npm lockfile

Because this repository is a single npm app, the scan should target the lockfile explicitly instead of recursively scanning the whole tree by default.

Recommended scan args:

```text
--lockfile=./package-lock.json
```

This keeps the signal focused on the dependency graph that actually ships with the app.

### 4. Upload SARIF to GitHub Code Scanning

Keep `upload-sarif: true` so SCA findings appear in GitHub Security and Code Scanning instead of only inside workflow logs or artifacts.

This is one of the strongest reasons to prefer OSV in this repository now that the repo is public.

### 5. Keep the build-breaking policy

Recommended policy:

- PR workflow: fail when the PR introduces a new vulnerability
- `main` workflow: fail when any vulnerability is present

This is stricter and more developer-friendly than failing every PR for pre-existing vulnerabilities already on `main`.

### 6. Add `npm audit signatures` as a supplemental integrity check

Add a separate blocking step after `npm ci` in the `build` job:

```bash
npm audit signatures
```

Purpose:

- verify registry signatures for downloaded npm packages
- verify provenance attestations when available
- complement SCA by checking package integrity and publisher provenance rather than only known CVEs

This is treated as a supplemental supply-chain integrity control, not the primary SCA engine.

### 7. Keep Semgrep healthy with the default ruleset

The active CI path no longer depends on the repo-local experimental Semgrep rule files.

Instead, both workflows:

- reinstall the latest Semgrep CE package
- run `semgrep scan --config auto`
- upload the resulting JSON report as a workflow artifact

The local `.semgrep/critical.yml` and `.semgrep/audit.yml` files are retained only as future tuning candidates and are not part of the active merge gate.

## Target Pipeline Design

### Pull Request Gate

The PR workflow should contain:

- `build`
  - `npm ci`
  - `npm audit signatures`
  - `npm run build`
- `sast`
  - Semgrep CE reinstalled in CI
  - Semgrep default ruleset via `--config auto`
  - JSON artifact upload for later triage
- `sca`
  - OSV reusable PR scan workflow
  - compare feature branch results against the base branch
  - fail only on newly introduced vulnerabilities
- `secrets`
  - Gitleaks with full git history

Branch protection should continue to require:

- `build`
- `sast`
- `sca / osv-scan`
- `secrets`

Operational note:

- if `enforce_admins` remains disabled, GitHub can still allow direct pushes to `main` that bypass the required checks
- the protection policy should be treated as incomplete until direct-push bypass is disabled or PR-only flow is fully enforced

### Mainline Baseline

The `main` branch workflow should contain:

- `build`
- `sast`
- `sca`
- `secrets`

Differences from PR behavior:

- OSV should run a full lockfile-targeted scan of the dependency tree
- SARIF upload should remain enabled
- schedule should stay weekly in addition to `push` to `main`

### Reporting Model

The pipeline should expose findings in three layers:

1. GitHub check status for pass/fail
2. GitHub step summary for quick triage
3. GitHub Code Scanning SARIF for durable SCA visibility

Artifacts should still be kept for:

- Semgrep JSON
- Gitleaks SARIF
- any optional OSV workflow artifacts produced by the reusable workflows

### Security Hardening Rules

All third-party GitHub Actions should be pinned to full commit SHAs wherever possible.

Priority order:

1. security-sensitive actions that download or execute binaries
2. code checkout and artifact actions
3. convenience actions

The current implementation pins the OSV reusable workflow reference by full SHA. A later hardening pass should also apply SHA pinning to:

- `actions/checkout`
- `actions/setup-node`
- `actions/setup-python`
- `actions/upload-artifact`

## Contender Tools

These are credible open-source SCA tools we may want later, even if they are not the primary tool for this repo today.

### 1. Anchore Grype

Primary sources:

- [anchore/grype](https://github.com/anchore/grype)
- [anchore/scan-action](https://github.com/anchore/scan-action)

Why it is strong:

- mature and very widely used in professional cloud-native environments
- excellent for filesystem, container image, and SBOM scanning
- strong fit if this repo later adds Docker images or broader artifact scanning
- the current `scan-action` release stream is active and its latest release is marked immutable

Why it is not the best primary fit right now:

- broader than we need for a simple npm lockfile-based web app
- not as lockfile-centric or PR-diff-centric as OSV for this exact repository

When it complements OSV:

- when the project adds containers
- when we want SBOM-driven scanning alongside lockfile scanning
- when we want a second opinion from a different vulnerability data and matching pipeline

### 2. OWASP Dependency-Check

Primary sources:

- [dependency-check/DependencyCheck](https://github.com/dependency-check/DependencyCheck)
- [OWASP project page](https://owasp.org/www-project-dependency-check/)

Why it is strong:

- long-established SCA tool with strong enterprise recognition
- supports Node via Node analyzers and Node Audit integration
- includes broader analyzer coverage such as RetireJS-related JavaScript checks

Why it is not the best primary fit right now:

- heavier operational footprint than this repository needs
- Java-based runtime and slower ergonomics for a lightweight GitHub Actions gate
- better suited to polyglot or enterprise environments than a focused Vite/React npm application

When it complements OSV:

- when we want a secondary enterprise-style report
- when the repo becomes more polyglot
- when richer analyzer diversity matters more than CI simplicity

### 3. OWASP dep-scan

Primary sources:

- [owasp-dep-scan/dep-scan](https://github.com/owasp-dep-scan/dep-scan)
- [depscan.readthedocs.io](https://depscan.readthedocs.io)

Why it is interesting:

- more risk-oriented than many basic SCA tools
- can complement SBOM workflows
- includes reachability and risk-audit oriented concepts that may become useful later

Why it is not the best first-line tool here:

- smaller footprint and lower ecosystem adoption than OSV or Grype
- more complexity than we need for a first healthy CI gate

When it complements OSV:

- when we want richer post-detection analysis
- when we begin building broader risk-based prioritization into the platform

## Why OSV Wins for This Repo

OSV is the best primary choice for `btc-dashboard` because:

- it directly matches the repo's artifact of truth: `package-lock.json`
- it supports a clean PR-vs-main workflow model
- it has first-party GitHub Action support from the same project family
- it integrates cleanly with GitHub Code Scanning
- it reduces the operational and supply-chain risk introduced by bringing in an unnecessarily broad scanner for a simple npm application

If this project later expands into containers or multiple deployable artifacts, Grype becomes the most natural complementary tool.

## Future Requirement: Simple ASPM

This repository will also need a simple ASPM layer later.

For now, the pipeline focuses on:

- prevention at PR time
- scheduled baseline scanning
- supply-chain integrity verification

What is still missing is a lightweight application security posture management layer that can answer:

- which findings are still open
- which findings are new versus accepted
- which repos, workflows, and branches are not covered by required controls
- whether branch protection, code scanning, secret scanning, and dependency policies are consistently enabled

That later ASPM phase should be intentionally lightweight at first:

- aggregate findings from GitHub Actions outputs and GitHub Code Scanning
- track policy coverage, not just vulnerability events
- provide a small posture dashboard or summary issue/workflow

Good future ASPM candidates may include:

- GitHub-native posture plus code scanning summaries
- a lightweight self-hosted or open-source posture aggregator
- a custom repo-security scorecard workflow if we want to keep things simple

## Recommended Next Step

The stabilization pass is now implemented. The next operating tasks are:

1. keep branch protection aligned with the emitted check names, especially `sca / osv-scan`
2. triage and remediate the live OSV findings reported against `package-lock.json`
3. tune Semgrep over time if the default ruleset produces too much noise
4. harden the remaining third-party GitHub Actions by pinning them to full commit SHAs
5. add a lightweight ASPM layer so posture and coverage can be tracked across branches and workflows
