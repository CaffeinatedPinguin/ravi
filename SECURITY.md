# Security Policy

> [!CAUTION]
> **Reports go through GitHub Security Advisories.** The project owner checks the advisories page
> and does not run a separate security mailbox. Open a private advisory here:
> <https://github.com/CaffeinatedPinguin/ravi/security/advisories/new>.

## Reporting a Vulnerability

1. Create a security advisory with the steps to reproduce, the expected and actual behaviour, and
   the version you ran.
2. If you want to signal that a report exists without disclosing anything, open a normal issue that
   says only that a security problem was found and that a private advisory is already open. Keep it
   free of details.

**PS:** Do not use the public issue tracker for the report itself and do not discuss it in public.

## Will be closed without explanation

- Descriptions written by an LLM instead of a human report.
- Reports about an upstream dependency unless a proof of concept shows the upstream issue actually
  affects ravi.
- Output from security scanners without an attached proof of concept.
- SSRF reports.

## Do you accept other 3rd-party bug bounty platforms?

No. Reports are accepted only through GitHub Security Advisories.

## Supported Versions

Only the latest release is supported. Older versions do not receive fixes.
