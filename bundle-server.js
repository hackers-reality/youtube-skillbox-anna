// Simple static file server for the YouTube Skillbox Anna App bundle
// Serves bundle/ + SDK stub on port 5180
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5180;
const BUNDLE_DIR = path.resolve('E:/youtube-skillbox-anna/bundle');
const SDK_DIR = path.resolve('E:/youtube-skillbox-anna/static');

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0].split('#')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    });
    res.end();
    return;
  }

  // SDK stub: /static/anna-apps/_sdk/latest/index.js
  const sdkPrefix = '/static/anna-apps/_sdk/latest/';
  if (urlPath.startsWith(sdkPrefix)) {
    const relativePath = urlPath.slice(sdkPrefix.length);
    if (relativePath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    serveFile(path.join(SDK_DIR, 'anna-apps', '_sdk', 'latest', relativePath), res);
    return;
  }

  // Bundle dev route: /anna-apps/youtube-skillbox-anna/dev/* -> bundle/*
  const devPrefix = '/anna-apps/youtube-skillbox-anna/dev/';
  if (urlPath.startsWith(devPrefix)) {
    const relativePath = urlPath.slice(devPrefix.length);
    if (relativePath.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    serveFile(path.join(BUNDLE_DIR, relativePath), res);
    return;
  }

  // Root-level aliases for bundle assets referenced by index.html
  const rootAssets = ['anna-tool-ids.js', 'app.js', 'style.css'];
  if (rootAssets.includes(urlPath.slice(1))) {
    serveFile(path.join(BUNDLE_DIR, urlPath.slice(1)), res);
    return;
  }

  // Root: serve index.html
  if (urlPath === '/' || urlPath === '/index.html') {
    serveFile(path.join(BUNDLE_DIR, 'index.html'), res);
    return;
  }

  // Health check
  if (urlPath === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      app_slug: 'youtube-skillbox-anna',
      view: null,
      bundle_base: '/anna-apps/youtube-skillbox-anna/dev/index.html',
      mobile_bundle_base: '/anna-apps/youtube-skillbox-anna/dev/index.html',
      mobile_declared: false,
      executas: ['tool-dev-youtube-skillbox'],
      watch: true,
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found: ' + req.url);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`YouTube Skillbox bundle server running at http://127.0.0.1:${PORT}/`);
  console.log(`Serving bundle from: ${BUNDLE_DIR}`);
  console.log(`Serving SDK stub from: ${SDK_DIR}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
