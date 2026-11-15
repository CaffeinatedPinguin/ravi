# Review Markdown format (v1)

Copy, Save and Import all use one self-explaining text format, so a human or an AI that has never
seen ravi can read a review and add a comment in the same shape. The implementation lives in
`src/server/review/markdown.ts`; the model is `src/shared/review.ts`.

## Example

````markdown
# Code review: github.com/acme/api PR #123
ravi-review v1 · base 9f1c2a7 · head a83e0b1 · action: request changes
Format: each "##" section is one comment. "path:line (new|old)" is the line in
the new or old version of the file; the quoted code is context; the comment
is the "> " text. "## PR" = comment on the whole PR, "### reply" = reply.
Add sections in the same form to create new comments.

## Summary
> Overall: looks good, two issues.

## src/auth/login.ts:42-45 (new)
```ts
console.log("token", token)
```
> Token is logged here, remove it.
> ![screenshot](/abs/path/shot.png)

## src/db.ts:10 (old) · id 1234 · alice
> Why was the retry removed?

### reply · id 1240 · bob
> Agreed, please restore it.

## PR
> General PR comment, not tied to a file.
````

The title reads `github.com/<project> PR #<n>` (GitLab: `MR !<n>`; local: `local <repoPath>
(<target>)`). Line 2 carries only the parts that are known: `base`, `head` and `action` are
omitted when absent. Commits are shortened to seven characters.

## Rules

- A `##` section is one comment. The heading is
  `## <path>:<line>[-<endLine>] (new|old)[ · id <id>][ · <author>]`, `## PR`, or `## Summary`.
  Paths may contain spaces and colons; the location is read from the right.
- `new`/`old` names the version of the file the line belongs to; line numbers are 1-based.
- The optional fenced block right after the heading is quoted code context. The fence is longer than
  any run of backticks inside the code. Its language hint comes from the file extension and is
  ignored on import.
- Every body line starts with `> ` (an empty body line is `>`), so a body may contain headings,
  fences and quotes of its own. One level of quoting is removed on import.
- `### reply` attaches to the nearest `##` comment above; it has no location of its own.
- Drafts and published comments are both exported. `id` identifies an existing comment: a draft
  keeps its opaque local `l-…` id and a published one carries the forge id, so an edited export
  updates the same comment on import instead of adding a duplicate. A section without an `id` is a
  new comment. `author` is written when known.
- Import is tolerant: CRLF, trailing spaces, missing blank lines, a missing `>` on an empty body
  line, any `#` count in the title, and unknown header lines are accepted. A section that cannot be
  read is skipped with an error entry that carries its line number. Input over 2 MiB is rejected and
  at most 2000 sections are imported.

## Versioning

The second line starts with `ravi-review v1`. Any incompatible change to this grammar bumps it to
`ravi-review v2`; v1 stays readable by later releases.
