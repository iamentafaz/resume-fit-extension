# ADR-003: Final system architecture — resume fit-check browser extension

**Status:** Accepted
**Date:** 2026-07-01
**Deciders:** Mir Ali (sole user/builder)
**Consolidates:** ADR-001 (evaluation logic) and ADR-002 (delivery shape + local LLM backend). This document is the single reference for the built system; ADR-001 and ADR-002 remain as the record of how each decision was reached.

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

- **Resume input is plain text only.** No PDF/DOCX parsing is built in — the user pastes resume text once during setup. Acceptable for a single, rarely-changing resume; would need a parser library if this needed to accept resume files directly.
- **CORS is a one-time manual setup step**, not something the extension can configure for the user — local LLM servers default to rejecting browser-origin requests, and the README documents the fix per runtime (e.g. `OLLAMA_ORIGINS`).
- **Output quality is bounded by the local model.** The prompt asks for strict JSON; smaller/quantized local models may occasionally deviate, which the fallback JSON extraction mitigates but doesn't fully eliminate.
- **No packaging/store distribution** — this is loaded unpacked via developer mode, appropriate for a personal tool; publishing to the Chrome Web Store would require additional review-readiness work not needed here.

## Action items (remaining)

1. [ ] Load the extension unpacked and confirm end-to-end analysis against a real job posting.
2. [ ] Set the CORS allowlist on whichever local LLM server is in use (see README).
3. [ ] Try 2-3 local models against the evaluation prompt and pick the one with the most reliable JSON output and best judgment quality.
4. [ ] Optional follow-up: add a lightweight history view (list of past analyses) if per-tab caching alone isn't enough to track applications over time.
