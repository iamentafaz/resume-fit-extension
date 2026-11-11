# Fit Check — JD vs resume (local LLM)

A browser extension that reads the job posting on the page you're viewing and scores it against your resume, using a local LLM. Nothing leaves your machine.

## Install (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `resume-fit-extension` folder.
4. Pin the extension so it's visible in the toolbar.

## One-time setup

**1. Add your resume.** Click the extension icon → Resume tab → paste your resume as plain text → Save.

**2. Point it at your local LLM.** Click the extension icon → Settings tab:
- Pick **Ollama** or **OpenAI-compatible** (LM Studio, llama.cpp server) depending on what you run.
- Set the endpoint (defaults: `http://localhost:11434/api/chat` for Ollama, `http://localhost:1234/v1/chat/completions` for LM Studio/llama.cpp).
- Set the model name exactly as your server expects it (e.g. `llama3`, `mistral`, whatever you've pulled/loaded).
- Click **Test connection**.

**3. Allow the extension through CORS.** Local LLM servers reject cross-origin requests by default — you need to explicitly allow `chrome-extension://*` origins once:

- **Ollama**: set the `OLLAMA_ORIGINS` environment variable before starting the server, e.g. on macOS/Linux:
  ```
  OLLAMA_ORIGINS="chrome-extension://*" ollama serve
  ```
  On Windows, set it as a system environment variable and restart Ollama.
- **LM Studio**: in the local server settings, enable CORS / allow all origins.
- **llama.cpp server**: start with `--cors` (or equivalent flag for your build) to allow browser requests.

If "Test connection" fails after this, double check the server is actually running and the port matches.

## Using it

1. Open a job posting in a tab.
2. Click the extension icon → **Analyze this page**.
3. Read the score, matched strengths, gaps, and tailoring suggestions.

The extension first looks for structured `JobPosting` data most job boards embed in the page; if that's not found, it falls back to the largest content block, or to whatever text you've manually selected before clicking Analyze (useful on sites with unusual layouts).

## Notes

- Everything is stored locally via `chrome.storage.local` — your resume, settings, and analysis history never leave your machine except in the local request to your own LLM server.
- Local models can be less reliable than hosted frontier models at producing strict JSON. If analysis fails with a parsing error, try a different model or re-run.
