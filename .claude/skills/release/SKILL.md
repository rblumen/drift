---
name: release
description: Cut a versioned release of the drift portfolio rebalancer. Use this skill whenever the user asks to cut a release, ship a version, publish a new version, tag a release, bump the version, or anything about releasing or versioning the project — even if they don't say "release" explicitly (e.g. "let's ship v0.2", "time to tag this", "mark this as a release").
---

# Release Skill — drift

This skill walks through a complete, safe release process: preflight checks → version decision → changelog + package.json update → build & test verification → commit to a release branch → PR to `main` → merge → tag → GitHub Release.

There's a **mandatory human confirmation checkpoint** before the merge and tag. Everything before it is reversible; everything after it is permanent.

---

## Phase 1: Preflight

Before touching any files, verify the environment is clean and the toolchain is healthy.

1. **Clean working tree** — run `git status --short`. If there are any uncommitted or untracked files, stop and tell the user. A dirty tree means unintended changes could end up in the release.

2. **On the right branch** — confirm you're on `main` and up to date (`git pull`). If not, ask the user before switching. The release will be cut on a dedicated `release/vX.Y.Z` branch created off `main`.

3. **Tests pass** — run `npm test`. If any tests fail, stop. Do not proceed with a failing test suite.

4. **Build passes** — run `npm run build`. If the build fails, stop. Tests passing doesn't guarantee TypeScript and Vite are happy.

Report a clean preflight summary before continuing.

---

## Phase 2: Determine the Version

Read the `[Unreleased]` section of `CHANGELOG.md` and the current version from `package.json`.

Apply [Semantic Versioning](https://semver.org/):
- **Patch** (x.y.**Z**) — only `Fixed` entries, no new features, no breaking changes.
- **Minor** (x.**Y**.0) — `Added` or `Changed` entries present, no breaking changes.
- **Major** (**X**.0.0) — any `Removed` entries that break backward compatibility, or other breaking changes.

For a pre-1.0 project (current major = 0), breaking changes increment the minor version, not the major.

Propose the new version with your reasoning (e.g. "The [Unreleased] section has Added and Fixed entries but no breaking changes → bump minor → **0.2.0**"). Then **pause and ask the user to confirm or override** before proceeding. This is the one decision you shouldn't make unilaterally.

Once the version is confirmed, **immediately check for conflicts** before touching any files:

```
git tag -l vX.Y.Z
git ls-remote --tags origin vX.Y.Z
gh release view vX.Y.Z
```

If a local tag, remote tag, or GitHub Release already exists for `vX.Y.Z`:
- Check what commit the tag points to (`git log -1 --format="%H %ci %s" vX.Y.Z`) and whether a GitHub Release is attached.
- Report the conflict to the user with that context (commit date/message, whether a Release exists) and **stop for their decision** — do not silently move or delete a tag. Options are typically: pick the next version number instead, or confirm the existing tag is stale/accidental and safe to move (only if no GitHub Release is attached — a tag with a published Release is user-facing and should not be touched without explicit say-so).

Only proceed to Phase 3 once the target `vX.Y.Z` is confirmed clear of conflicts.

---

## Phase 3: Update CHANGELOG.md

Follow the [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format exactly.

1. Replace the `## [Unreleased]` heading with `## [X.Y.Z] - YYYY-MM-DD` (today's date).
2. Add a fresh empty `## [Unreleased]` section above it (with no entries yet).
3. Update the comparison links at the bottom of the file:
   - Change the `[Unreleased]` link to compare the new tag to HEAD:
     `[Unreleased]: https://github.com/rblumen/drift/compare/vX.Y.Z...HEAD`
   - Add a new versioned link above it:
     `[X.Y.Z]: https://github.com/rblumen/drift/compare/vPREV...vX.Y.Z`
   - If this is the first versioned release, the `[X.Y.Z]` link should point to the initial commit or the earliest sensible ref.

---

## Phase 4: Update package.json

Set `"version"` to the new version string (e.g. `"0.2.0"`). Nothing else in `package.json` should change.

---

## Phase 5: Confirmation Checkpoint

Before doing anything irreversible, present a summary to the user:

```
Ready to release vX.Y.Z. Here's what will happen:
  • Create branch release/vX.Y.Z off main
  • Commit CHANGELOG.md + package.json to it
  • Open PR: release/vX.Y.Z → main
  • Merge PR (squash) and delete the branch
  • Push tag vX.Y.Z
  • Create GitHub Release
  • Push main → stable (triggers Vercel production deployment)

Proceed? (yes / no)
```

Do not continue until the user explicitly confirms.

---

## Phase 6: Commit to the release branch

Create the release branch off `main` and stage only `CHANGELOG.md` and `package.json`:

```
git checkout -b release/vX.Y.Z
git add CHANGELOG.md package.json
git commit -m "chore(release): vX.Y.Z"
git push -u origin release/vX.Y.Z
```

---

## Phase 7: PR release/vX.Y.Z → main, then merge

Create the PR using `gh`:

```
gh pr create \
  --base main \
  --head release/vX.Y.Z \
  --title "Release vX.Y.Z" \
  --body "<paste the vX.Y.Z changelog section here as the PR body>"
```

Then merge it:

```
gh pr merge --squash --delete-branch
```

---

## Phase 8: Tag and push

Switch to `main` and pull to get the merged commit, then tag:

```
git checkout main
git pull origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

---

## Phase 9: GitHub Release

Create a GitHub Release attached to the new tag, using the changelog section as release notes:

```
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes "<the vX.Y.Z section from CHANGELOG.md>" \
  --target main
```

---

## Phase 10: Promote stable

Fast-forward the `stable` branch to the release commit. This is what triggers the Vercel production deployment.

```
git push origin main:stable
```

If `stable` doesn't exist yet (first release), this command creates it. Vercel must be configured to deploy production from `stable` for this to take effect.

---

## Phase 11: Return to main

```
git checkout main
git pull origin main
```

Report the release URL (from `gh release create` output) and a brief summary of what shipped.

---

## Guardrails

- Never force-push to `main`.
- Never skip the confirmation checkpoint (Phase 5).
- Never tag before the PR is merged.
- Never move or delete an existing tag, or touch a tag with a published GitHub Release attached, without explicit user confirmation.
- If anything fails after Phase 6 (i.e., after the commit), tell the user exactly where things stopped and what needs to be done manually — don't try to silently retry destructive steps.
