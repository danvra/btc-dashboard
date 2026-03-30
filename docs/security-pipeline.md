# Security Pipeline

This document captures the current security pipeline design for the repository, centered on OSV-Scanner for SCA and a tighter GitHub Actions workflow for a public npm-based application.

## Current State

The current pipeline has four security jobs:

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
- findings are emitted as SARIF, uploaded into GitHub Code Scanning, and retained as workflow artifacts

The active implementation now reflects the OSV migration described below.

GitHub Code Scanning now has a single workflow source of truth:

- `Security Baseline` uploads SARIF on pull requests and on `main`
- `Security Gate` is intentionally kept non-SARIF and acts as the fast PR build gate

This avoids GitHub Code Scanning configuration drift between PR-only and mainline-only workflow files.

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
  - `Security Baseline` uses OSV's reusable PR scan workflow
  - fail only when the PR introduces new vulnerabilities relative to `main`
- Mainline workflow:
  - `Security Baseline` uses OSV's reusable scheduled/full scan workflow
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

Instead, the baseline workflow:

- reinstall the latest Semgrep CE package
- run `semgrep scan --config auto`
- emit SARIF for GitHub Code Scanning and retain the SARIF report as a workflow artifact

The local `.semgrep/critical.yml` and `.semgrep/audit.yml` files are retained only as future tuning candidates and are not part of the active merge gate.

## Target Pipeline Design

### Pull Request Gate

PRs now use two workflow roles:

- `Security Gate`
  - `build`
  - `npm ci`
  - `npm audit signatures`
  - `npm run build`
- `Security Baseline`
  - `sast`
  - `sca`
  - `secrets`
  - all SARIF uploads to GitHub Code Scanning

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

The target reporting model is:

- GitHub required checks gate PR merges
- GitHub Code Scanning stores SARIF-based findings for:
  - Semgrep
  - OSV-Scanner
  - Gitleaks
- workflow artifacts retain raw scanner outputs for auditability and troubleshooting
- `npm audit signatures` stays in the build lane as a supply-chain integrity guard

## Result

The repository now has a security pipeline that is:

- healthier than the old Trivy-based setup
- aligned with a public GitHub repository and GitHub Code Scanning
- focused on the actual shipped dependency graph
- strict on newly introduced vulnerabilities
- supplemented with npm package signature verification
