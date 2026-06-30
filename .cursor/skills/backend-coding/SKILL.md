---
name: backend-coding
description: Implement and maintain backend logic for APIs and services in this repository with TypeScript strictness, predictable contracts, and testable architecture. Use when editing API routes, services, or data pipelines.
disable-model-invocation: true
---

# Backend Coding

## Goals
- Keep API behavior explicit and stable.
- Normalize data at service layer boundaries.
- Favor composable pure functions for transformation logic.

## Workflow
1. Identify the contract first (inputs, outputs, errors).
2. Reuse existing service modules before adding new ones.
3. Keep route handlers thin; move logic to `services/`.
4. Add focused tests for new behavior or edge cases.
5. Validate with `pnpm test` after changes.

## Implementation Rules
- Use TypeScript types/interfaces for request and response shapes.
- Validate external data before returning it.
- Return consistent HTTP status codes and JSON structures.
- Keep source-specific scraping/parsing isolated from API handlers.

## Reliability Rules
- Fail safely with clear error messages.
- Avoid hidden mutable shared state.
- Guard against undefined/null external fields.
- Keep date/time handling explicit and normalized.

## Security Rules
- Treat all external input as untrusted.
- Do not log secrets or tokens.
- Keep dependencies minimal and up to date through package manager.
