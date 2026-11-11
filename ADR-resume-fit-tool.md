# ADR-001: Personal job-description-to-resume fit evaluator

**Status:** Proposed
**Date:** 2026-07-01
**Deciders:** Mir Ali (sole user/builder)

## Context

Mir wants a personal tool that reads a job description and his resume, then tells him whether he's a good fit for that specific role — surfacing matched qualifications, gaps, and (ideally) suggestions for tailoring his resume or application.

This is single-user, self-hosted, low-volume (one JD/resume pair at a time, occasionally batch-checking a handful of postings). No ATS, no hiring pipeline, no other candidates involved — despite the "candidate" language, the candidate being evaluated is Mir himself. This significantly narrows the design: no multi-tenancy, no auth system, no need to optimize for throughput or cost at scale, and no compliance burden around handling third-party PII.

The main open question is how the fit-evaluation logic should work, and how thin the surrounding system needs to be.

## Decision

Build a small, local-first tool: paste/upload a JD and a resume → get back a structured fit report (score + matched skills + gaps + tailoring suggestions), generated via an LLM call rather than keyword-matching logic. No backend service, no database beyond optional local file storage, no ATS integration.

## Options Considered

### Option A: Keyword/rules-based scoring (classic ATS-style)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | Near zero (no API calls) |
| Accuracy | Poor — misses synonyms, seniority context, transferable skills |
| Team familiarity | High (simple string/regex logic) |

**Pros:** Fast, free, fully deterministic, easy to debug.
**Cons:** Produces the same shallow signal that makes ATS keyword-matching notoriously bad — a resume can score high by keyword-stuffing while being a poor fit, or score low despite being a strong fit if phrasing differs. Not useful for genuine self-assessment.

### Option B: LLM-based semantic evaluation

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low-medium (one well-structured prompt + parsing) |
| Cost | Small — a few cents per evaluation at personal-use volume |
| Accuracy | Good — can reason about equivalent skills, seniority fit, and career trajectory, not just string overlap |
| Team familiarity | N/A (single builder) |

**Pros:** Understands context ("led a team of 5" satisfies "management experience" even without that exact phrase), can produce a written rationale and concrete tailoring suggestions, easy to iterate on by editing the prompt rather than rule tables.
**Cons:** Non-deterministic output, requires an API key and network call, small ongoing cost, needs basic prompt-injection hygiene if resume/JD text ever comes from untrusted sources (not a concern here since Mir supplies both).

### Option C: Hybrid — keyword extraction feeding an LLM pass

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | Slightly higher than B (extra processing step) |
| Accuracy | Marginally better structure, not meaningfully better fit judgment |
| Team familiarity | N/A |

**Pros:** Gives a quick deterministic skill checklist alongside the narrative.
**Cons:** Added complexity for a single user doesn't buy much — the LLM can extract and structure skills itself in the same call. This is a reasonable v2 enhancement, not a v1 requirement.

## Trade-off Analysis

The whole point of this tool is judgment quality, not throughput or cost efficiency — at personal-use volume, an LLM call costs pennies and runs in seconds either way. Option A optimizes for the wrong thing (determinism) at the expense of the one thing that matters (does the assessment actually reflect fit). Option C adds complexity without a clear payoff for a single user who can just re-run or refine one prompt.

Option B is the right starting point: one structured LLM call, given both texts, prompted to (1) list matched/strong qualifications, (2) list gaps or risks, (3) give an overall fit rating with reasoning, and (4) suggest 2-3 concrete resume edits or talking points. Keyword extraction (Option C) can be folded in later as a cheap enhancement if the narrative output ever feels too unstructured to skim quickly.

## Architecture Sketch

1. **Input**: paste JD text; upload resume (PDF/DOCX/txt) or paste text.
2. **Parsing**: extract plain text from the resume file (existing PDF/DOCX text extraction, no OCR needed for a personal resume).
3. **Evaluation**: single LLM call with a structured prompt (JD + resume + instructions to return score, matches, gaps, suggestions — ideally as structured JSON for consistent rendering).
4. **Output**: rendered report (score, matches, gaps, suggestions); optionally saved to a local file/folder per job posting so past evaluations can be compared over time.
5. **No auth, no database, no server required** — a local script or a minimal single-page tool is sufficient. A CLI script is the least-effort option; a small local web UI (e.g., a single HTML page or lightweight app) is worth it only if Mir wants to run this repeatedly without touching a terminal.

## Consequences

- Easier: getting a real, nuanced fit assessment instead of a shallow keyword score; low ongoing cost; fast to build (no infra).
- Harder: output is non-deterministic — re-running on the same inputs may phrase things differently (acceptable for this use case, but worth knowing if Mir wants to track fit scores over time as a hard metric).
- To revisit later: if this expands beyond personal use (e.g., helping others, or evaluating multiple candidates against one JD), the "no auth/no multi-tenancy" decision and the single-shot LLM call design would need to be revisited.

## Action Items

1. [ ] Decide delivery shape: CLI script vs. minimal local web page.
2. [ ] Write the evaluation prompt (score rubric, required output fields, format — JSON recommended for reliable rendering).
3. [ ] Build resume text extraction (PDF/DOCX → text).
4. [ ] Build the report renderer (terminal output or simple HTML).
5. [ ] Optional: add a local history log of past evaluations per job posting.
