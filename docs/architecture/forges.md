# Forge layer

ravi talks to GitHub and GitLab through one strategy interface. The UI and the review logic ask a
forge what it can do (`capabilities`) and never which forge it is, so a new host is one strategy file
plus one registry entry.

## Files

| Path | Owns |
|---|---|
| `src/shared/forge.ts` | Forge-neutral model: `RepoRef`, `PullRequest`, `Thread`, `DraftOperation`, `SubmitResult`, `ForgeStatus` |
| `src/server/forges/forge.ts` | The `Forge` interface, `ForgeHost` and the factory type |
| `src/server/forges/registry.ts` | Known hosts, auth headers, `forgeFor` facade and `forgeStatus` |
| `src/server/forges/env.ts` | Token file reader with cache and explicit reload |
| `src/server/forges/env-write.ts` | The only writer of `.env`: line editor, atomic 0600 replace, cache reload |
| `src/server/forges/http.ts` | Authenticated JSON client: timeouts, no redirects, pagination, ETag cache, `ForgeError` |
| `src/server/forges/remote.ts` | `origin` URL parsing and `detectRepoRef` |
| `src/server/forges/github.ts`, `gitlab.ts` | One strategy per host: URLs, capabilities and network calls |
| `src/server/forges/testing.ts` | `fakeFetch`: route-keyed fake `fetch` that records calls |
| `src/server/forges/contract.ts` | `describeForgeContract`: the suite every strategy must pass |
| `src/server/api/forges.ts` | `GET /api/forges`, `POST /api/forges/reload`, `GET /api/repos/:id/remote` |

## Rules

- Tokens live only in `~/.ravi/.env`; Settings → Accounts and the repository connection step write
  them there, `process.env` is never read, and a missing file means no tokens.
- A token is attached by the registry's auth callback on every request and is never stored on the
  strategy object, logged, returned by a route or serialised into `ForgeStatus`. Routes expose only
  `hasToken` and a four-character `tokenHint`.
- The HTTP client refuses redirects (`redirect: 'manual'`) because a redirect could carry the token
  to another host, rejects absolute and `..` paths, and follows `Link: rel="next"` only on the API
  origin. Every request has a 20 s timeout.
- `ForgeError` carries the status, the forge's message (with auth header values scrubbed) and, when
  the forge sent one, `retryAfterSeconds`.
- Nothing is written to a forge except through `Forge.submit`; the submit contract reports one failed
  operation in its `SubmitResult` instead of throwing, so the caller can retry only that draft.

## Adding a forge

1. Add the kind to `ForgeKind` in `src/shared/forge.ts`.
2. Create `src/server/forges/<kind>.ts` exporting a factory that builds the `Forge` object and
   declares its `capabilities`.
3. Add a `ForgeHost` entry to `HOSTS` in `registry.ts` (host, kind, API URL, web URL, token variable
   and auth headers) and map the kind to the factory in `FACTORIES`.
4. Run `describeForgeContract` for the new strategy, supplying network fixtures once the methods are
   implemented.
5. Add the token variable to the user documentation for `~/.ravi/.env`.

## Tests

Strategies never call the real network. `fakeFetch(routes)` answers only known `METHOD url` keys,
fails the test on anything else and records method, URL, headers and body for assertions.
`describeForgeContract` covers the offline refs and URLs for every strategy and, when network
fixtures are supplied, pagination, origin isolation, token presence and per-operation submit
failures.
