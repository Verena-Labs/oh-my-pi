# Downstream fork policy

`Verena-Labs/oh-my-pi` is the canonical source fork of
[`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi). It carries the shared Pi engine behavior used by consuming
distributions. It does not publish npm packages, executable archives, container images, Homebrew formulae, or other
consumer artifacts.

## Released line

- `main` is the single released downstream line.
- Changes reach `main` through focused pull requests. Do not commit release work directly to `main`.
- Release tags are immutable, annotated source tags named `pi-v<upstream>-r<revision>`.
- The first downstream release based on an upstream version is `r1`. Downstream-only revisions increment `r`; moving
  to a new upstream version resets it to `r1`.
- A release tag identifies source only. Packaging, installation, platform support, and artifact checks belong to each
  consuming distribution.

The current recorded upstream and downstream release are in
[`automation/upstream-sync.json`](automation/upstream-sync.json). [`PI_VENDOR.md`](PI_VENDOR.md) is its generated,
human-readable provenance view.

## Upstream synchronization

Every upstream update preserves the exact upstream tag in Git history:

1. Fetch the desired upstream release tag from `https://github.com/can1357/oh-my-pi.git`, and resolve its exact commit.
2. Create `sync/upstream-v<version>` from current `main`.
3. Merge the exact upstream tag with a real merge commit. Do not rebase the downstream line, replay the original
   pi-dotfiles patches, or squash the upstream merge.
4. Resolve conflicts semantically, keeping the downstream feature matrix and acceptance contract true.
5. Run the shared checks, then record the merged tag and commit:

   ```sh
   bun run downstream:check
   bun run downstream:test
   bun run downstream:update:record -- --upstream-tag vX.Y.Z --upstream-commit <40-hex-commit>
   ```

6. Commit the regenerated provenance, rerun the checks, and open a pull request to `main`. Merge the pull request with
   a merge commit so the upstream merge remains reachable from `main`.
7. After the accepted commit is on `main`, create and push its next immutable source tag:

   ```sh
   git tag -a pi-vX.Y.Z-r1 <accepted-main-commit> -m "Pi downstream vX.Y.Z revision 1"
   git push origin pi-vX.Y.Z-r1
   ```

For another downstream release on the same upstream commit, use a focused branch and run the same `record` command.
The recorder increments the revision deterministically. Never move, replace, or delete a published `pi-v*` tag; fix a
bad release with the next revision instead.

## Automation boundaries

`node scripts/upstream-sync.mjs check` validates the recorded policy, generated provenance, and local Git ancestry. It
does not fetch, merge, commit, tag, push, or publish. `record` only updates the local record and generated provenance;
the maintainer still reviews and commits those changes explicitly.

The initial import was deliberately one verified baseline commit. The old pi-dotfiles patch stack is recorded only as
one-time equivalence evidence and is not an ongoing update mechanism.
