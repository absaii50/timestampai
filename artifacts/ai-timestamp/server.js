import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT);
const BASE_PATH = (process.env.BASE_PATH || '/').replace(/\/+$/, '');

// In production the build outputs to dist/public; in dev serve source directly
const IS_PROD = process.env.NODE_ENV === 'production';
const STATIC_DIR = IS_PROD ? path.join(__dirname, 'dist', 'public') : __dirname;

if (!PORT || isNaN(PORT)) {
  console.error('PORT environment variable is required');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.webp': 'image/webp',
};

// Extensions that benefit from gzip
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg']);

// Cache headers — in dev mode all assets use no-cache so changes are picked up
// immediately; in production JS/CSS are served with long-lived headers.
const CACHE_HEADERS = {
  html:      'no-cache',
  asset:     IS_PROD ? 'public, max-age=31536000, immutable' : 'no-cache',
  font:      'public, max-age=31536000, immutable',
  image:     'public, max-age=86400',
};

function getCacheControl(ext) {
  if (ext === '.html') return CACHE_HEADERS.html;
  if (ext === '.woff' || ext === '.woff2' || ext === '.ttf') return CACHE_HEADERS.font;
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp' || ext === '.ico') return CACHE_HEADERS.image;
  return CACHE_HEADERS.asset;
}

// In-memory gzip cache for frequently served assets
const gzipCache = new Map();

function sendFile(req, res, data, contentType, ext) {
  const etag = `"${crypto.createHash('md5').update(data).digest('hex').slice(0,16)}"`;
  const cacheControl = getCacheControl(ext);

  // Conditional request — 304 Not Modified
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
    res.end();
    return;
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';
  const canGzip = COMPRESSIBLE.has(ext) && acceptEncoding.includes('gzip');

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    ETag: etag,
    Vary: 'Accept-Encoding',
  };

  if (!canGzip) {
    headers['Content-Length'] = Buffer.byteLength(data);
    res.writeHead(200, headers);
    res.end(data);
    return;
  }

  // Serve gzip from cache or compress now
  if (gzipCache.has(etag)) {
    const gz = gzipCache.get(etag);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(200, headers);
    res.end(gz);
    return;
  }

  zlib.gzip(data, { level: 6 }, (err, gz) => {
    if (err) {
      headers['Content-Length'] = Buffer.byteLength(data);
      res.writeHead(200, headers);
      res.end(data);
      return;
    }
    gzipCache.set(etag, gz);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(200, headers);
    res.end(gz);
  });
}

// Clean URL → HTML file mapping
const CLEAN_ROUTES = {
  '/admin':              'admin.html',
  '/admin/overview':     'admin.html',
  '/admin/jobs':         'admin.html',
  '/admin/users':        'admin.html',
  '/admin/payments':     'admin.html',
  '/admin/credits':      'admin.html',
  '/admin/activity':     'admin.html',
  '/admin/payment-setup': 'admin.html',
  '/admin/api-settings':  'admin.html',
  '/admin/email-settings':'admin.html',
  '/admin-login':            'admin-login.html',
  '/login':                  'login.html',
  '/dashboard':              'dashboard.html',
  '/dashboard/generate':     'dashboard.html',
  '/dashboard/history':      'dashboard.html',
  '/dashboard/stats':        'dashboard.html',
  '/dashboard/pricing':      'dashboard.html',
  '/dashboard/settings':     'dashboard.html',
  '/pricing':            'pricing.html',
  '/privacy':            'privacy.html',
  '/terms':              'terms.html',
  '/contact':            'contact.html',
};

function serveHtml(filePath, req, res) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const base = BASE_PATH ? BASE_PATH.replace(/\/+$/, '') + '/' : '/';
    const inject = `<base href="${base}">\n  <link rel="icon" href="/favicon.svg" type="image/svg+xml">`;
    const html = data.replace('<head>', `<head>\n  ${inject}`);
    sendFile(req, res, html, 'text/html; charset=utf-8', '.html');
  });
}

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];

  // Strip base path prefix
  if (BASE_PATH && urlPath.startsWith(BASE_PATH + '/')) {
    urlPath = urlPath.slice(BASE_PATH.length) || '/';
  } else if (urlPath === BASE_PATH || urlPath === BASE_PATH + '/') {
    urlPath = '/';
  }

  if (urlPath === '' || urlPath === '/') urlPath = '/index.html';

  // Clean URL routing
  if (CLEAN_ROUTES[urlPath]) {
    serveHtml(path.join(STATIC_DIR, CLEAN_ROUTES[urlPath]), req, res);
    return;
  }

  const ext = path.extname(urlPath).toLowerCase();

  const candidates = [
    path.join(STATIC_DIR, urlPath),
    path.join(STATIC_DIR, 'public', urlPath),
  ];

  // No extension → SPA fallback → index.html
  if (!ext) {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    fs.readFile(indexPath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      sendFile(req, res, data, 'text/html; charset=utf-8', '.html');
    });
    return;
  }

  const contentType = MIME[ext] || 'application/octet-stream';

  function tryNext(i) {
    if (i >= candidates.length) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    fs.readFile(candidates[i], (err, data) => {
      if (err) { tryNext(i + 1); return; }
      sendFile(req, res, data, contentType, ext);
    });
  }

  tryNext(0);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TimestampAI static server → http://0.0.0.0:${PORT}${BASE_PATH || '/'}`);
});
