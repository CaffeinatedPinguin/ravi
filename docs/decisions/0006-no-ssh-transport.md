# 0006 — No per-repository SSH transport

- Status: accepted
- Date: 2026-11-17
- Superseded-by: none

## Context

The wizard asked every repository for a transport: "SSH — use my SSH keys" or "HTTPS — use a token".
SSH only ever moved git objects. Pull requests, threads, comments and sending a review go through the
forge API, and that API always needs a token. Offering SSH as an alternative therefore suggested that
SSH alone was enough to review a repository, which it is not, and it added a step that most users got
wrong once.

## Decision

ravi has no per-repository transport setting at all:

- Remote repositories are cloned over HTTPS; the token is injected into the git child process through
  `GIT_CONFIG_*`, never through argv or a file.
- A local folder uses whatever remote the user's own git has. An `origin` over SSH keeps working
  through the user's own keys, exactly as plain `git` does: ravi neither configures nor blocks it.
- The repository wizard's second step is just "Token". It explains that pull requests and comments
  need the forge API token while git uses the user's own credentials, and the token stays optional
  because a repository without a forge remote needs none.

## Consequences

- The wizard is shorter and no longer asks a question that could not be honoured for the forge API.
- A `transport` value in an existing `repos.json` is ignored: the schema strips unknown keys, so the
  file keeps loading and the field disappears on the next write.
- An SSH `origin` of a local folder keeps working. Ravi injects an HTTPS token header there only for
  its own fetches; git ignores it for SSH and uses the user's keys.
- Pasting an SSH-form URL (`git@host:owner/name`, `ssh://…`) still names the same repository; the URL
  parsing in `src/server/forges/remote.ts` stays.

## Links

- `src/shared/api.ts`
- `src/server/git/clone.ts`
- `src/server/store/repos.ts`
