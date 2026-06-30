---
name: security-testing
description: Run practical security checks for this repository including input validation, dependency hygiene, API hardening, and safe secret handling. Use when adding features, reviewing API changes, or preparing releases.
disable-model-invocation: true
---

# Security Testing

## Quick Checklist
- [ ] Validate and sanitize request input.
- [ ] Ensure error responses do not leak internals.
- [ ] Check auth/token usage paths for accidental exposure.
- [ ] Review third-party dependency risk.
- [ ] Confirm no secrets committed in tracked files.

## API Hardening
- Enforce strict parameter parsing and default-deny unknown inputs.
- Use explicit allowlists for query/filter fields.
- Cap pagination and expensive operations.
- Return deterministic error objects.

## Secret Hygiene
- Keep secrets in environment variables or repository secrets only.
- Never store real tokens in examples, fixtures, or docs.
- Scan staged files for common secret patterns before commit.

## Dependency Hygiene
- Prefer maintained libraries with active updates.
- Remove unused packages quickly.
- Periodically run package audit and patch high-risk issues.

## Release Gate
Before deploy/merge:
1. Run tests.
2. Review API diffs for input/output changes.
3. Confirm no `.env` or credential files are staged.
