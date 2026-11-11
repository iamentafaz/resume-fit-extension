/**
 * Content script — extracts the job description from the active page.
 * Injected programmatically by background.js via chrome.scripting.executeScript.
 */

function extractJDFromPage() {
  // --- 1. Structured data (JSON-LD) ---
  function fromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : data['@graph'] || [data];
        for (const item of items) {
          const type = item['@type'];
          const isJobPosting =
            type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
          if (isJobPosting) {
            const title = item.title || '';
            const desc = item.description || '';
            const plain = String(desc)
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            return { title, text: plain, source: 'json-ld' };
          }
        }
      } catch (e) {
        // not valid JSON-LD, skip
      }
    }
    return null;
  }

  // --- 2. Board-specific selectors ---
  const BOARD_SELECTORS = [
    // LinkedIn
    {
      match: /linkedin\.com/i,
      title: '.job-details-jobs-unified-top-card__job-title, .top-card-layout__title',
      body: '.jobs-description__content, .show-more-less-html__markup, .description__text'
    },
    // Indeed
    {
      match: /indeed\.com/i,
      title: '.jobsearch-JobInfoHeader-title, h1[data-testid="jobsearch-JobInfoHeader-title"]',
      body: '#jobDescriptionText, .jobsearch-JobComponent-description'
    },
    // Greenhouse
    {
      match: /greenhouse\.io|boards\.greenhouse/i,
      title: '.app-title, .heading',
      body: '#content, .job-post-content, #job_description'
    },
    // Lever
    {
      match: /lever\.co|jobs\.lever/i,
      title: '.posting-headline h2',
      body: '.posting-page .section-wrapper, [data-qa="job-description"]'
    },
    // Workday
    {
      match: /myworkdayjobs\.com|workday\.com/i,
      title: 'h2[data-automation-id="jobPostingHeader"]',
      body: '[data-automation-id="jobPostingDescription"], .css-cygeeu'
    },
    // Glassdoor
    {
      match: /glassdoor\.com/i,
      title: '[data-test="job-title"], .css-17x2ixv',
      body: '.jobDescriptionContent, [data-test="jobDescriptionContent"]'
    },
    // AngelList / Wellfound
    {
      match: /wellfound\.com|angel\.co/i,
      title: '.job-listing-header h1',
      body: '.job-listing-details, .description'
    },
    // Ashby
    {
      match: /ashbyhq\.com|jobs\.ashby/i,
      title: 'h1',
      body: '.ashby-job-posting-description, [data-testid="job-description"]'
    }
  ];

  function fromBoardSelector() {
    const url = window.location.href;
    for (const board of BOARD_SELECTORS) {
      if (!board.match.test(url)) continue;
      const bodyEl = document.querySelector(board.body);
      if (!bodyEl) continue;
      const titleEl = document.querySelector(board.title);
      const title = titleEl ? titleEl.innerText.trim() : document.title;
      const text = (bodyEl.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length > 100) {
        return { title, text, source: 'board-selector' };
      }
    }
    return null;
  }

  // --- 3. User text selection ---
  function fromSelection() {
    const selection = window.getSelection ? window.getSelection().toString().trim() : '';
    if (selection.length > 200) {
      return { title: document.title, text: selection, source: 'selection' };
    }
    return null;
  }

  // --- 4. Heuristic fallback ---
  function fromHeuristic() {
    const candidates = Array.from(document.querySelectorAll('main, article, [role="main"]'));
    let best = null;
    let bestLen = 0;
    for (const el of candidates) {
      const len = (el.innerText || '').length;
      if (len > bestLen) {
        bestLen = len;
        best = el;
      }
    }
    const el = best || document.body;
    return {
      title: document.title,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      source: 'heuristic'
    };
  }

  // --- Extraction pipeline: try in order of specificity ---
  const jsonLd = fromJsonLd();
  if (jsonLd && jsonLd.text.length > 200) return jsonLd;

  const board = fromBoardSelector();
  if (board) return board;

  const sel = fromSelection();
  if (sel) return sel;

  return fromHeuristic();
}

// Return the result when injected via executeScript
extractJDFromPage();
