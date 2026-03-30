# DevSecOps CI/CD

This repository now includes two GitHub Actions workflows:

- `Security Gate` runs on pull requests targeting `main`.
- `Security Baseline` runs on pushes to `main`, on manual dispatch, and every Monday at `03:23 UTC`.

## What the pipeline enforces

- `build`: `npm ci`, `npm audit signatures`, and `npm run build`
- `sast`: Semgrep CE with a curated blocking ruleset for `api/` and `lib/server/`
- `sca`: OSV-Scanner lockfile-based dependency scanning against `package-lock.json`
- `secrets`: Gitleaks across the full git history

The SCA check now uses the official OSV reusable workflows and uploads SARIF into GitHub Code Scanning so dependency findings appear in the repository security UI.

Because the OSV reusable workflows upload SARIF, the caller workflows must grant `actions: read`, `contents: read`, and `security-events: write` at the workflow level.

Every job writes a short step summary, and SAST and secret-scanning continue to upload their scan outputs as workflow artifacts.

For the next iteration of the pipeline, including the planned migration from Trivy SCA to OSV-Scanner, see `docs/security-pipeline.md`.

## One-time GitHub setup

The repository is now public, so branch protection can be used to enforce the pull request checks before merge:

1. Open the repository settings for `danvra/btc-dashboard`.
2. Go to `Settings` -> `Rules` -> `Rulesets` or `Branches`.
3. Protect the `main` branch.
4. Require a pull request before merge.
5. Require status checks and select:
   - `build`
   - `sast`
   - `sca`
   - `secrets`
6. Block direct pushes to `main`.

After the first green run with the new reusable OSV workflow, confirm the exact emitted SCA check name in GitHub. Reusable workflow jobs sometimes render as a compound name such as `sca / osv-scan`, and branch protection should match the actual emitted check.

## GitHub CLI notes

`gh` is available from Homebrew when `/opt/homebrew/bin` is on `PATH`.

Useful follow-up commands:

```bash
PATH="/opt/homebrew/bin:$PATH" gh run list --workflow "Security Gate"
PATH="/opt/homebrew/bin:$PATH" gh run list --workflow "Security Baseline"
PATH="/opt/homebrew/bin:$PATH" gh pr checks
```
