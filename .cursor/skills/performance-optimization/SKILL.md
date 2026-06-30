---
name: performance-optimization
description: Optimize frontend and backend performance in this repository by reducing payload size, improving render paths, and minimizing expensive runtime work. Use when pages feel slow or APIs become heavy.
disable-model-invocation: true
---

# Performance Optimization

## Frontend
- Prefer compressed/local media assets.
- Lazy-load non-critical images/iframes.
- Keep hero and above-the-fold content lightweight.
- Reduce repeated inline style/script blocks where possible.

## Backend/API
- Avoid repeated expensive fetch/scrape work per request.
- Normalize and cache transformed results where practical.
- Limit response payload fields to what clients need.

## Measurement
1. Identify slow path first (render, network, transform).
2. Apply one change at a time.
3. Re-check with realistic sample data.

## Guardrails
- Do not sacrifice correctness for minor speed wins.
- Keep changes readable and maintainable.
