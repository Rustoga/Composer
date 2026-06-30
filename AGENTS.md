# AGENTS.md

## Setup commands
- Install deps: `pnpm install`
- Start dev server: `pnpm dev`
- Run tests: `pnpm test`

## Code style
- TypeScript strict mode
- Single quotes, no semicolons
- Use functional patterns where possible

## Working rules for agents
- Prefer extending existing files and patterns before creating new abstractions.
- Keep changes small, reviewable, and aligned with current architecture.
- Validate behavior with tests or focused runtime checks after changes.
- Avoid committing secrets or environment-specific credentials.
