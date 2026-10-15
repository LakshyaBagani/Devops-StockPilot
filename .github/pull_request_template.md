<!--
The PR title becomes the merge commit message on main. Write it as a conventional commit:
feat(api): ..., test(api): ..., feat(ui): ..., ci: ..., build: ..., infra(aws): ..., feat(helm): ..., docs: ...
Never "update", "fix" or "test" on its own.
-->

## What & why


## How I verified
<!-- The commands you ran and their key output. -->


## Rubric / evidence
<!-- The module (M1-M10), any docs/evidence/<file>.png added, and its README evidence-index row. -->


## Checklist
- [ ] `make test` green
- [ ] `make lint` clean (ruff check, ruff format --check; eslint; shellcheck)
- [ ] `alembic check` clean if models or migrations changed
- [ ] `helm lint` and `terraform fmt -check` / `validate` if helm/ or terraform/ changed
- [ ] `make scan` (strict) shows 0 HIGH/CRITICAL if a Dockerfile, `requirements*.txt` or `package-lock.json` changed; any HIGH/CRITICAL, unfixed included, fails the gate
- [ ] No .env, tfvars, kubeconfig or keys staged; `gitleaks git --redact -v .` is clean
- [ ] No code or names from the course reference project
- [ ] README/docs updated
- [ ] Evidence screenshot added when a rubric item works for the first time

Evidence PRs (PR-A, PR-B) stay open as drafts and are never merged.
