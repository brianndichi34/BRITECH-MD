'use strict';

const http = require('node:http');

function startHealthServer({ port = process.env.PORT, host = '0.0.0.0', logger = console } = {}) {
  if (port === '' || port === null || port === undefined) return null;
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 0 || numericPort > 65535) return null;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health' || req.url === '/healthz')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, service: 'BRITECH-MD' }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.on('error', error => logger.error?.({ err: error?.message || error }, 'Health server failed'));
  server.listen(numericPort, host, () => logger.info?.({ port: numericPort }, 'Health server is listening.'));
  return server;
}

module.exports = { startHealthServer };
