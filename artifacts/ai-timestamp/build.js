import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { build as esbuild } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const out  = path.join(root, 'dist', 'public');

// Clean output directory
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(out, 'src'), { recursive: true });

// ── Minify JS ──────────────────────────────────────────────
console.log('Minifying JS…');
await esbuild({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: false,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(out, 'src/main.js'),
  logLevel: 'silent',
});
const jsIn  = fs.statSync(path.join(root, 'src/main.js')).size;
const jsOut = fs.statSync(path.join(out, 'src/main.js')).size;
console.log(`  JS: ${(jsIn/1024).toFixed(1)}KB → ${(jsOut/1024).toFixed(1)}KB (${Math.round((1-jsOut/jsIn)*100)}% smaller)`);

// ── Minify CSS ─────────────────────────────────────────────
console.log('Minifying CSS…');
await esbuild({
  entryPoints: [path.join(root, 'src/style.css')],
  bundle: false,
  minify: true,
  outfile: path.join(out, 'src/style.css'),
  logLevel: 'silent',
});
const cssIn  = fs.statSync(path.join(root, 'src/style.css')).size;
const cssOut = fs.statSync(path.join(out, 'src/style.css')).size;
console.log(`  CSS: ${(cssIn/1024).toFixed(1)}KB → ${(cssOut/1024).toFixed(1)}KB (${Math.round((1-cssOut/cssIn)*100)}% smaller)`);

// ── Process HTML pages — async font loading ────────────────
const HTML_PAGES = [
  'index.html', 'login.html', 'admin-login.html',
  'dashboard.html', 'admin.html', 'pricing.html',
  'privacy.html', 'terms.html', 'contact.html',
];

const FONT_ASYNC_SNIPPET = `  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"></noscript>`;

// Patterns to strip — we'll replace with async snippet
const FONT_PATTERNS = [
  /<link[^>]*preconnect[^>]*googleapis[^>]*>\s*/g,
  /<link[^>]*preconnect[^>]*gstatic[^>]*>\s*/g,
  /<link[^>]*fonts\.googleapis\.com[^>]*>\s*/g,
];

// Client-side router injected into index.html for static deployments.
// Uses synchronous XHR so document.open/write/close runs BEFORE any deferred
// scripts execute — preventing "already declared" JS scope conflicts.
const ROUTER_SNIPPET = `<script>(function(){var m={'/login':'/login.html','/admin-login':'/admin-login.html','/dashboard':'/dashboard.html','/admin':'/admin.html','/pricing':'/pricing.html','/privacy':'/privacy.html','/terms':'/terms.html','/contact':'/contact.html'};var p=window.location.pathname.replace(/\\/+$/,'');for(var k in m){if(p===k||p.startsWith(k+'/')){var x=new XMLHttpRequest();x.open('GET',m[k],false);x.send();if(x.status===200){document.open('text/html');document.write(x.responseText);document.close();}return;}}})();</script>`;

let htmlProcessed = 0;
for (const page of HTML_PAGES) {
  const src = path.join(root, page);
  if (!fs.existsSync(src)) continue;

  let html = fs.readFileSync(src, 'utf8');

  // Remove existing Google Font link tags
  for (const pat of FONT_PATTERNS) html = html.replace(pat, '');

  // Inject async font loading before </head>
  if (html.includes('</head>')) {
    html = html.replace('</head>', `${FONT_ASYNC_SNIPPET}\n</head>`);
  }

  // Inject <base href="/"> so relative paths resolve correctly regardless of
  // which URL the page is served at (important for static deployment routing)
  if (html.includes('<head>') && !html.includes('<base ')) {
    html = html.replace('<head>', '<head>\n  <base href="/">');
  }

  // Inject client-side router into index.html only (the catch-all target)
  if (page === 'index.html') {
    html = html.replace('<head>', `<head>\n${ROUTER_SNIPPET}`);
  }

  // Clean up excess blank lines
  html = html.replace(/\n{3,}/g, '\n\n');

  fs.writeFileSync(path.join(out, page), html);
  htmlProcessed++;
}

// ── public/ contents (favicon, images, etc.) ─────────────
const pub = path.join(root, 'public');
if (fs.existsSync(pub)) {
  fs.cpSync(pub, out, { recursive: true });
}

console.log(`Build done → dist/public (${htmlProcessed} HTML, JS+CSS minified)`);
