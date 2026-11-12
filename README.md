# Fit Check — JD vs Resume (local LLM)

A privacy-first browser extension that scores how well your resume fits the job posting you're viewing, using a local LLM. Nothing leaves your machine.

## Features

- **Fit scoring** — get a 0-100 score with matched strengths, gaps, and tailoring suggestions
- **Smart JD extraction** — dedicated selectors for LinkedIn, Indeed, Greenhouse, Lever, Workday, Glassdoor, Wellfound, and Ashby, plus JSON-LD and heuristic fallbacks
- **Multiple resumes** — save and switch between named resumes (e.g. one per role type)
- **Resume file upload** — load a `.txt` file or extract selectable text from a `.pdf` locally
- **Analysis history** — revisit past analyses from the History tab; delete individual entries or clear all
- **Copy results** — one-click copy of the analysis as formatted text
- **Streaming responses** — see the LLM output as it generates, instead of waiting for the full response
- **Auto-retry** — if the model returns malformed JSON, the extension sends a follow-up prompt asking it to fix the output
- **Dark mode** — automatically matches your system theme
- **Fully local** — resume, settings, and history stay in `chrome.storage.local`; the only network request is to your own local LLM server

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `resume-fit-extension` folder.
4. Pin the extension so it's visible in the toolbar.

## One-time setup

**1. Add your resume.** Click the extension icon → Resume tab → paste your resume (or upload a `.txt` or text-based `.pdf` file) → Save. PDF text is extracted locally in the extension. Scanned PDFs need OCR and are not supported. You can create multiple resumes with the **+** button and switch between them from the dropdown.

**2. Point it at your local LLM.** Click the extension icon → Settings tab:
- Pick **Ollama** or **OpenAI-compatible** (LM Studio, llama.cpp server) depending on what you run.
- Set the endpoint (defaults: `http://localhost:11434/api/chat` for Ollama, `http://localhost:1234/v1/chat/completions` for LM Studio/llama.cpp).
- Set the model name exactly as your server expects it (e.g. `llama3`, `mistral`, whatever you've pulled/loaded).
- Adjust the **response timeout** if needed — local CPU-only models can be slow on the first call.
- Click **Test connection**.

**3. Allow the extension through CORS.** Local LLM servers reject cross-origin requests by default — you need to explicitly allow `chrome-extension://*` origins once:

- **Ollama**: set the `OLLAMA_ORIGINS` environment variable before starting the server, e.g. on macOS/Linux:
  ```
  OLLAMA_ORIGINS="chrome-extension://*" ollama serve
  ```
  On Windows, set it as a system environment variable and restart Ollama.
- **LM Studio**: in the local server settings, enable CORS / allow all origins.
- **llama.cpp server**: start with `--cors` (or equivalent flag for your build) to allow browser requests.

If "Test connection" fails after this, double-check the server is actually running and the port matches.

## Using it

1. Open a job posting in a tab.
2. Click the extension icon → **Analyze this page**.
3. Read the score, matched strengths, gaps, and tailoring suggestions.
4. Click **Copy** to copy the results as text (useful for cover letters or notes).
5. Switch to the **History** tab any time to revisit past analyses.

### How JD extraction works

The extension tries these strategies in order:

1. **JSON-LD** — structured `JobPosting` schema data embedded in the page (most major job boards use this)
2. **Board-specific selectors** — targeted CSS selectors for LinkedIn, Indeed, Greenhouse, Lever, Workday, Glassdoor, Wellfound, and Ashby
3. **Text selection** — whatever text you've manually selected before clicking Analyze
4. **Heuristic fallback** — the largest `<main>`, `<article>`, or `[role="main"]` content block on the page

If extraction misses the JD on an unusual site, select the text manually and re-run.

## Notes

- Everything is stored locally via `chrome.storage.local` — your resumes, settings, and analysis history never leave your machine except in the local request to your own LLM server.
- Both HTTP and HTTPS localhost endpoints are supported.
- The extension streams responses from your LLM, so you'll see a live preview while waiting.
- If the model returns invalid JSON, the extension automatically retries with a corrective prompt. If it still fails, try a different model or re-run.
- Dark mode activates automatically based on your OS/browser preference.
