# Architecture Decision Records

This file contains the project decision history in order. ADR-003 is the accepted architecture and supersedes earlier decisions where they conflict.

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

---

# ADR-002: Browser extension with local-LLM backend (supersedes delivery/backend parts of ADR-001)

**Status:** Proposed
**Date:** 2026-07-01
**Deciders:** Mir Ali (sole user/builder)
**Supersedes:** ADR-001's "Architecture Sketch" (delivery shape) and its implicit assumption of a hosted/subscription LLM API

## Context

ADR-001 settled the evaluation *logic* (LLM-based semantic comparison beats keyword matching) but left delivery shape open. The requirement has now narrowed further: Mir wants to open a job posting in his browser, trigger an analysis in place, and have it compared against his resume — without paying for a subscription LLM API. He already has a local LLM set up on his machine and wants to use that as the inference backend.

This changes two things from ADR-001: (1) the tool becomes a browser extension rather than a CLI/local web page, and (2) the LLM call goes to a local inference server instead of a cloud API. The evaluation prompt/report design from ADR-001 carries over unchanged.

## Decision

Build a Manifest V3 browser extension (Chrome/Edge/Brave — all share the same extension platform) that:
- Extracts the job description from the currently open tab on demand (icon click), not automatically on every page.
- Sends the JD + a locally-stored resume to a local LLM server over `http://localhost:<port>` using an OpenAI-compatible chat completions API (the de facto standard exposed by Ollama, LM Studio, and llama.cpp's server mode).
- Renders the fit report (score, matches, gaps, suggestions) in the extension popup or side panel.
- Stores the resume text and backend settings (endpoint URL, model name) locally via `chrome.storage.local` — nothing leaves the machine.

## Options Considered

### Option A: Manifest V3 extension, on-demand extraction via `activeTab` (recommended)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Cost | None (local inference, no API fees) |
| Privacy | Strong — no host_permissions for arbitrary sites; script only runs on the tab Mir explicitly triggers it on |
| Robustness across job sites | Good if paired with schema.org extraction (see below) |

**Pros:** No scary "read and change all your data on all websites" permission prompt; matches the actual usage pattern (open a JD, click the icon, get an answer); simplest to review and maintain.
**Cons:** Requires a click each time — no passive/automatic detection of job postings.

### Option B: Manifest V3 extension, auto-run on known job-board domains

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium-high |
| Cost | None |
| Privacy | Weaker — needs `host_permissions` for LinkedIn/Indeed/Greenhouse/Lever/etc., and breaks on any site not in the list |
| Robustness | Fragile — every job board redesign or new site requires an update |

**Pros:** Feels automatic — could show a badge as soon as a JD is detected.
**Cons:** Maintenance burden of a domain allowlist, broader permissions than needed for a single-user tool, and it still doesn't remove the need to click "analyze" to actually run inference.

### Option C: Userscript (Tampermonkey/Violentmonkey) instead of a full extension

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | None |
| Privacy | Depends on manager, generally fine |
| Distribution | Requires Mir to already have a userscript manager installed |

**Pros:** Fastest to prototype — a single `.user.js` file, no manifest/store packaging.
**Cons:** Weaker UI (no real popup, just injected DOM or `alert`-style output), clunkier resume storage/settings management, less pleasant long-term.

## Trade-off Analysis

Option A is the right fit: it mirrors how Mir actually intends to use this (open a posting, decide in the moment whether to check fit) rather than trying to passively watch every tab. It also keeps the permission footprint minimal, which matters for a tool being loaded unpacked/locally rather than reviewed by a store. Option B's "automatic" feel isn't worth the domain-maintenance tax for a single user. Option C is a reasonable *prototype* step if Mir wants something running in an afternoon, but a real popup UI is worth the extra setup for anything used regularly — this can be a fallback rather than the primary path.

For the local LLM connection: standardize on the OpenAI-compatible chat-completions shape (`POST /v1/chat/completions` or Ollama's native `/api/chat`) with a configurable base URL and model name in the extension's settings, rather than hardcoding one runtime. This makes the extension work whether Mir is running Ollama, LM Studio, or llama.cpp's server, and survives him switching later.

## Architecture

1. **Trigger**: Mir clicks the extension icon while on a job posting page. `activeTab` permission lets the extension inject a content script into just that tab, on demand.
2. **JD extraction** (content script, in order of preference):
   - Look for `<script type="application/ld+json">` containing a `JobPosting` schema — most major job boards (LinkedIn, Indeed, Greenhouse, Lever, most ATS-hosted pages) embed this, and it gives clean structured fields (title, description, qualifications) instead of scraping visible text.
   - Fallback: grab the largest `<article>`/`<main>` text block on the page.
   - Fallback: let Mir highlight text on the page and click "use selection" if extraction misses.
3. **Resume storage**: on first run, Mir pastes/uploads his resume once; stored as plain text in `chrome.storage.local`. Re-used for every analysis until he updates it.
4. **Inference call**: background service worker sends `{resume, jd}` into the same structured prompt from ADR-001, POSTed to the configured local endpoint (default suggestion: `http://localhost:11434/api/chat` for Ollama, editable in settings).
5. **Output**: popup renders the structured result (score, matches, gaps, tailoring suggestions); optionally logged to local storage as history per posting URL.
6. **No network calls beyond localhost** — this is the whole point of going local, and worth enforcing (no accidental telemetry, no fallback to a cloud API).

## Consequences

- Easier: zero ongoing API cost, JD analysis happens right where Mir is already looking at the posting, resume never leaves his machine.
- Harder: local LLM servers block cross-origin requests by default — Ollama needs `OLLAMA_ORIGINS` set to allow the extension's origin (`chrome-extension://<extension-id>`), or the request will be silently rejected by CORS. This needs to be a documented one-time setup step, not discovered by surprise.
- Harder: JD extraction quality depends on the page. Sites without JobPosting schema (some internal career pages, PDFs-as-postings, screenshots) will need the manual-selection fallback.
- Harder: local model quality/speed is whatever Mir's hardware and chosen model can do — the report's usefulness is bounded by the model, not just the prompt. Worth testing the prompt against 2-3 candidate local models before settling.
- To revisit: if Mir later wants this on mobile or wants to share it, the local-only architecture (activeTab, localhost calls, local storage) would need to change.

## Action Items

1. [ ] Confirm which local LLM runtime is running (Ollama vs LM Studio vs llama.cpp server) and its default port, so the extension's default settings match.
2. [ ] Set the CORS allowlist on the local LLM server to permit the extension's origin (e.g. `OLLAMA_ORIGINS=chrome-extension://*` for Ollama).
3. [ ] Build the JSON-LD `JobPosting` extractor with the manual-selection fallback.
4. [ ] Build the settings UI (endpoint URL, model name, resume text) and the results popup.
5. [ ] Test the ADR-001 evaluation prompt against the chosen local model and tune for its context window/output format reliability (local models are often less reliable at strict JSON than hosted frontier models — may need a more forgiving parser or a retry-on-malformed-output step).

---

# ADR-003: Final system architecture — resume fit-check browser extension

**Status:** Accepted
**Date:** 2026-07-01
**Deciders:** Mir Ali (sole user/builder)
**Consolidates:** ADR-001 (evaluation logic) and ADR-002 (delivery shape + local LLM backend). This is the accepted architecture; ADR-001 and ADR-002 are retained earlier in this file as the record of how each decision was reached.

## Context

Final requirement: a personal, single-user browser extension that reads the job description on the page currently open, compares it against a locally-stored resume using a locally-hosted LLM (no subscription API), and presents the result through a polished popup UI — not just a raw text dump.

## Decision

Ship a Manifest V3 extension, `resume-fit-extension/`, with the following shape:

```
resume-fit-extension/
├── manifest.json      MV3 manifest — activeTab + scripting + storage permissions,
│                       host_permissions scoped to localhost/127.0.0.1 only
├── background.js       Service worker: orchestrates JD extraction, prompt building,
│                       the local LLM call, response parsing, and history storage
├── popup.html           Popup UI shell: tabs (Analyze / Resume / Settings)
├── popup.css            Visual design: score gauge, verdict pill, match/gap/suggestion lists
├── popup.js             Popup behavior: tab switching, rendering results, save/test handlers
├── icons/               16/48/128px extension icons
├── vendor/               Bundled PDF.js module and worker for local PDF text extraction
└── README.md            Install steps and the CORS setup local LLM servers require
```

No content script file is shipped separately — JD extraction runs as an on-demand function injected via `chrome.scripting.executeScript`, scoped to the single tab the user is looking at when they click Analyze. No build step, no bundler, no remote code — plain HTML/CSS/JS throughout, which is both the simplest option for a single-user tool and a requirement of Manifest V3's content security policy (extensions can't load code from a CDN at runtime).

## How it works end to end

1. **Trigger** — user opens a job posting, clicks the extension icon, clicks "Analyze this page." No permission prompt beyond the one-time install, because `activeTab` only grants access to the tab the user is actively interacting with.
2. **Extraction** (`background.js`, run in page context) — tries, in order: (a) `JobPosting` schema.org JSON-LD embedded in the page (used by LinkedIn, Indeed, Greenhouse, Lever, and most ATS-hosted postings), (b) the user's current text selection if one is active, (c) the largest `<main>`/`<article>` block on the page as a last resort.
3. **Resume + settings lookup** — pulled from `chrome.storage.local`, set once by the user in the Resume and Settings tabs and reused for every analysis.
4. **Inference call** — `background.js` POSTs a structured prompt (system instructions + JD + resume, from ADR-001) to the user's local LLM endpoint. Two request shapes are supported behind one settings toggle: Ollama's native `/api/chat`, or the OpenAI-compatible `/v1/chat/completions` shape used by LM Studio and llama.cpp's server mode — so switching local runtimes later is a settings change, not a code change.
5. **Parsing** — the model is instructed to return only a JSON object (`score`, `verdict`, `matches`, `gaps`, `suggestions`); a fallback regex extraction handles models that wrap JSON in stray commentary despite instructions, since local models are less reliable at strict-format adherence than hosted frontier models.
6. **Rendering** (`popup.js`) — the result renders as a colored circular score gauge (green ≥75, amber 50–74, red <50), a verdict pill, and three labeled lists (matched strengths, gaps, tailoring suggestions). Results are cached per tab URL in `chrome.storage.local`, so reopening the popup on a posting already analyzed shows the prior result instantly without re-running inference.
7. **Everything stays local** — `host_permissions` are scoped to `localhost`/`127.0.0.1` only; there is no code path that sends the JD or resume anywhere else.

## Key design choices carried forward

- **Evaluation logic (ADR-001):** LLM-based semantic comparison, not keyword/ATS-style scoring — a single structured prompt does the reasoning that keyword overlap can't.
- **Delivery shape (ADR-002):** `activeTab`-triggered extraction over auto-running on a domain allowlist — matches actual usage (deliberate, one posting at a time) and keeps the permission footprint minimal.
- **Backend (ADR-002):** local LLM over a subscription API, via an OpenAI-compatible or Ollama-native call behind a settings toggle, so the extension isn't locked to one runtime.

## New in this iteration

- **Popup UI, not a bare result dump:** three-tab layout (Analyze/Resume/Settings), an SVG score gauge with color-coded severity, chip/pill styling for the verdict, and structured lists for matches/gaps/suggestions rather than a wall of text.
- **Per-tab result caching:** switching back to a previously analyzed posting shows the cached result immediately.
- **Dual API-shape support:** one toggle switches the request/response parsing between Ollama and OpenAI-compatible servers, covering the common local runtimes without extra code paths per tool.
- **Manual-selection fallback:** if JSON-LD extraction and the heuristic both miss (unusual page layouts, some internal career sites), the user can highlight the JD text on the page before clicking Analyze.

## Known limitations / consequences

- **PDF text extraction is local and text-based.** Selectable text is extracted with the bundled PDF.js library before it is saved as resume text. Scanned PDFs still require OCR, and DOCX parsing is not built in.
- **CORS is a one-time manual setup step**, not something the extension can configure for the user — local LLM servers default to rejecting browser-origin requests, and the README documents the fix per runtime (e.g. `OLLAMA_ORIGINS`).
- **Output quality is bounded by the local model.** The prompt asks for strict JSON; smaller/quantized local models may occasionally deviate, which the fallback JSON extraction mitigates but doesn't fully eliminate.
- **No packaging/store distribution** — this is loaded unpacked via developer mode, appropriate for a personal tool; publishing to the Chrome Web Store would require additional review-readiness work not needed here.

## Action items (remaining)

1. [ ] Load the extension unpacked and confirm end-to-end analysis against a real job posting.
2. [ ] Set the CORS allowlist on whichever local LLM server is in use (see README).
3. [ ] Try 2-3 local models against the evaluation prompt and pick the one with the most reliable JSON output and best judgment quality.
4. [ ] Optional follow-up: add a lightweight history view (list of past analyses) if per-tab caching alone isn't enough to track applications over time.
