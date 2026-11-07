# Agent Instructions

## Review guidelines

Respect documented author intent and check for companion PRs.

- Read the PR body before the diff. If it has sections like "Design
  decisions", "Companion PRs", "Cross-repo", or "Intent", treat them as
  the author's binding statement of design — constraints, not code to
  second-guess. Do not raise a finding that would contradict a documented
  choice.
- Assume work often spans multiple repos in this org. "Missing caller",
  "dead code", and "unused export" findings are often wrong because the
  caller lives in a companion PR. Before flagging dead or missing code,
  check whether the PR description references companion PRs in other
  repos.
- When author intent is unclear, ask a question rather than request a
  change.

## Branch lanes

This repo's branches are publish targets, one per monorepo lane, written by the monorepo's `publish-web-bundle.yml` (`bundle_branch=<branch>`), never by hand:
- **`main`** — the trunk lane (2.0 today); `v2.0.N` tags are cut from its commits.
- **`1.11.x`** — the stable lane; `v1.11.N` tags are cut from its commits. One lane per branch: the publish keeps only the previous build's hashed files, and jsDelivr refuses every file of a tag whose tree exceeds 50 MB (`v2.0.10`, 2026-11-06, when both lanes shared `main`).
- **`next`** — the in-development lane; the branch itself is the `@next` jsDelivr ref.

Code changes (`scripts/`, tests, docs) target `main`. Never commit directly to either trunk — branch off the correct one in a worktree, and target the PR's base at the same lane. **If it isn't clear which lane a task belongs to, ask "main or next?" before branching, pulling (`git pull origin <lane>`), or opening a PR — don't default to `main`.**
