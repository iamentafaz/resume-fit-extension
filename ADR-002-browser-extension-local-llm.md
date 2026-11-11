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
