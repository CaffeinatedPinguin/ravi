# revu docs index

One line per document: `file — what it owns — read when`.

| File | Owns | Read when |
|---|---|---|
| [docs/architecture/overview.md](architecture/overview.md) | Runtime model, module layout, data folder, security model | Starting any change |
| [docs/architecture/forges.md](architecture/forges.md) | Forge strategy, host registry, token and HTTP rules, adding a forge | Changing or adding a forge integration |
| [docs/decisions/0001-stack-and-distribution.md](decisions/0001-stack-and-distribution.md) | Node + single-file bundle, dependency policy | Changing packaging, runtime or dependencies |
| [docs/specs/SPEC.md](specs/SPEC.md) | Product scope and the phase checklist | Planning or finishing a phase |
| [docs/specs/review-format.md](specs/review-format.md) | Comment model and the self-explaining Markdown v1 exchange format | Reading, writing or versioning a review export |

## Rules

- One line per file; no nested lists, no status.
- Point at the owner of a fact; do not repeat the fact here.
- Every link resolves in a fresh clone.
