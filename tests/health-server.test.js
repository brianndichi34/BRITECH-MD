'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { startHealthServer } = require('../lib/health-server');

test('health server serves deployment probes on the configured port', async () => {
  const logs = [];
  const server = startHealthServer({ port: 0, logger: { info: entry => logs.push(entry), error: assert.fail } });
  assert.ok(server);
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, service: 'BRITECH-NB' });
    assert.equal(logs.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('health server is disabled when PORT is not a valid host port', () => {
  assert.equal(startHealthServer({ port: '', logger: { info() {}, error() {} } }), null);
  assert.equal(startHealthServer({ port: 'not-a-port', logger: { info() {}, error() {} } }), null);
});
