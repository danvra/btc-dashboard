# DevSecOps CI/CD

This repository now includes two GitHub Actions workflows:

- `Security Gate` runs on pull requests targeting `main`.
- `Security Baseline` runs on pushes to `main`, on manual dispatch, and every Monday at `03:23 UTC`.

## What the pipeline enforces

- `build`: `npm ci`, `npm audit signatures`, and `npm run build`
- `sast`: Semgrep CE reinstalled fresh in CI and run with Semgrep's default ruleset (`--config auto`)
- `sca`: OSV-Scanner lockfile-based dependency scanning against `package-lock.json`
- `secrets`: Gitleaks across the full git history

The security checks now use GitHub Code Scanning as the shared findings backend:

- OSV uploads SCA SARIF through the official reusable workflows
- Semgrep emits SARIF and uploads it into GitHub Code Scanning
- Gitleaks emits SARIF and uploads it into GitHub Code Scanning

Because the OSV reusable workflows upload SARIF, the caller workflows must grant `actions: read`, `contents: read`, and `security-events: write` at the workflow level.

Every job writes a short step summary, and SAST and secret-scanning continue to upload their SARIF outputs as workflow artifacts.

The active SAST path now avoids the repo-local experimental Semgrep rules and instead uses Semgrep's maintained default ruleset. The local `.semgrep/*.yml` files are retained for later tuning work, but they are not part of the active CI gate.

For the current design and migration rationale, see `docs/security-pipeline.md`.

## One-time GitHub setup

The repository is now public, so branch protection can be used to enforce the pull request checks before merge:

1. Open the repository settings for `danvra/btc-dashboard`.
2. Go to `Settings` -> `Rules` -> `Rulesets` or `Branches`.
3. Protect the `main` branch.
4. Require a pull request before merge.
5. Require status checks and select:
   - `build`
   - `sast`
   - `sca / osv-scan`
   - `secrets`
6. Block direct pushes to `main`.

## GitHub CLI notes

`gh` is available from Homebrew when `/opt/homebrew/bin` is on `PATH`.

Useful follow-up commands:

```bash
PATH="/opt/homebrew/bin:$PATH" gh run list --workflow "Security Gate"
PATH="/opt/homebrew/bin:$PATH" gh run list --workflow "Security Baseline"
PATH="/opt/homebrew/bin:$PATH" gh pr checks
```
