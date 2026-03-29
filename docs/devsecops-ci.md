# DevSecOps CI/CD

This repository now includes two GitHub Actions workflows:

- `Security Gate` runs on pull requests targeting `main`.
- `Security Baseline` runs on pushes to `main`, on manual dispatch, and every Monday at `03:23 UTC`.

## What the pipeline enforces

- `build`: `npm ci` and `npm run build`
- `sast`: Semgrep CE with a curated blocking ruleset for `api/` and `lib/server/`
- `sca`: Trivy filesystem dependency scanning with a blocking threshold of `CRITICAL`
- `secrets`: Gitleaks across the full git history

Every job writes a short step summary and uploads its scan output as a workflow artifact.

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

## GitHub CLI notes

`gh` is available from Homebrew when `/opt/homebrew/bin` is on `PATH`.

Useful follow-up commands:

```bash
PATH="/opt/homebrew/bin:$PATH" gh run list --workflow "Security Gate"
PATH="/opt/homebrew/bin:$PATH" gh run list --workflow "Security Baseline"
PATH="/opt/homebrew/bin:$PATH" gh pr checks
```
