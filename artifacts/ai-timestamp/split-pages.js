/**
 * split-pages.js
 * Reads the monolithic index.html and produces one HTML file per page.
 * Run once: node split-pages.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const lines = src.split('\n');

// ── Page registry ──────────────────────────────────────────────────────────
const PAGES = [
  { id: 'page-home',        file: 'index.html',      bodyPage: 'home',        title: 'TimestampAI \u2014 Free AI YouTube Timestamp & Chapter Generator' },
  { id: 'page-login',       file: 'login.html',      bodyPage: 'login',       title: 'Sign In \u2014 TimestampAI' },
  { id: 'page-admin-login', file: 'admin-login.html',bodyPage: 'admin-login', title: 'Admin Login \u2014 TimestampAI' },
  { id: 'page-user',        file: 'dashboard.html',  bodyPage: 'dashboard',   title: 'Dashboard \u2014 TimestampAI' },
  { id: 'page-admin',       file: 'admin.html',      bodyPage: 'admin',       title: 'Admin Panel \u2014 TimestampAI' },
  { id: 'page-pricing',     file: 'pricing.html',    bodyPage: 'pricing',     title: 'Pricing \u2014 TimestampAI' },
  { id: 'page-privacy',     file: 'privacy.html',    bodyPage: 'privacy',     title: 'Privacy Policy \u2014 TimestampAI' },
  { id: 'page-terms',       file: 'terms.html',      bodyPage: 'terms',       title: 'Terms of Service \u2014 TimestampAI' },
  { id: 'page-contact',     file: 'contact.html',    bodyPage: 'contact',     title: 'Contact \u2014 TimestampAI' },
];

// ── Shared <head> (strip tags we re-inject manually) ──────────────────────
const headStart = src.indexOf('<head>') + '<head>'.length;
const headEnd   = src.indexOf('</head>');
let sharedHead  = src.slice(headStart, headEnd);
// Remove tags we already emit in buildHtml (title, charset, viewport)
sharedHead = sharedHead.replace(/<title>.*?<\/title>/s, '');
sharedHead = sharedHead.replace(/<meta\s+charset[^>]*>\s*/gi, '');
sharedHead = sharedHead.replace(/<meta\s+name="viewport"[^>]*>\s*/gi, '');

// ── Extract inner HTML of each page div ────────────────────────────────────
function extractPageContent(pageId) {
  // Find opening wrapper: <div id="page-xxx" class="page hidden">
  const openTag = new RegExp(`<div id="${pageId}"[^>]*>`);
  const match = src.match(openTag);
  if (!match) return '';

  const startIdx = src.indexOf(match[0]) + match[0].length;

  // Walk forward counting div depth to find matching close
  let depth = 1;
  let i = startIdx;
  while (i < src.length && depth > 0) {
    if (src[i] === '<') {
      if (src.startsWith('<div', i)) depth++;
      else if (src.startsWith('</div', i)) { depth--; if (depth === 0) break; }
    }
    i++;
  }

  return src.slice(startIdx, i).trim();
}

// ── Build a complete HTML document for one page ────────────────────────────
function buildHtml({ file, bodyPage, title }, content) {
  // Relative path prefix for assets (login/admin-login etc. are in root, same as index)
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>${sharedHead}
</head>
<body data-page="${bodyPage}">

${content}

<div id="toast" class="toast hidden"></div>
<script src="./src/main.js" defer></script>
</body>
</html>
`;
}

// ── Generate all pages ─────────────────────────────────────────────────────
for (const page of PAGES) {
  const content = extractPageContent(page.id);
  if (!content) { console.warn(`⚠ No content found for ${page.id}`); continue; }
  const html = buildHtml(page, content);
  fs.writeFileSync(path.join(__dirname, page.file), html, 'utf8');
  console.log(`✓  ${page.file}  (${content.split('\n').length} lines)`);
}

console.log('\nDone — all pages written as separate HTML files.');
