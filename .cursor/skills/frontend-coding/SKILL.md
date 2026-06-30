---
name: frontend-coding
description: Build and refine frontend UI in this repository using existing patterns, responsive layouts, and accessible interactions. Use when editing pages, components, CSS, or client-side behavior.
disable-model-invocation: true
---

# Frontend Coding

## Goals
- Keep visual identity consistent with current `Syncopate` + `Inter` style
- Prefer enhancing existing sections/components over full rewrites
- Preserve mobile-first behavior and keyboard accessibility

## Workflow
1. Read the target page/component and nearby styles first.
2. Reuse existing classes, spacing scale, and section structure.
3. Implement smallest safe change that solves the request.
4. Verify responsive layout at common breakpoints.
5. Check for regressions in links, media embeds, and navigation anchors.

## Design Rules
- Use clear hierarchy: hero -> section badge -> content cards -> CTA.
- Keep decorative effects subtle (opacity overlays, small hover effects).
- Avoid introducing new UI libraries unless required.
- For media-heavy sections, use lazy loading where possible.

## Accessibility Rules
- Include descriptive `alt` text for meaningful images.
- Keep semantic landmarks (`header`, `main`, `section`, `footer`).
- Preserve visible focus states on interactive elements.
- Do not rely on color alone for meaning.

## Performance Rules
- Reuse local assets before adding new external dependencies.
- Prefer static HTML/CSS for simple sections.
- Keep inline scripts minimal and scoped.
