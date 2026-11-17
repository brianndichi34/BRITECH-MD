const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  isBadMacError,
  listRecoveryCandidates,
  recoverFromBackup,
  createBadMacRecovery
} = require('../lib/session-recovery');

const creds = JSON.stringify({ registered: true, me: { id: '254700000000:1@s.whatsapp.net' } });
const silentLogger = { warn() {}, error() {} };

async function makeAuth(dir) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'creds.json'), creds);
  await fs.writeFile(path.join(dir, 'pre-key-1.json'), '{}');
}

async function withState(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'britech-session-recovery-'));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('recognizes Baileys Bad MAC and session-cipher decryption messages', () => {
  assert.equal(isBadMacError('Error: Bad MAC'), true);
  assert.equal(isBadMacError({ message: 'No matching sessions found for message' }), true);
  assert.equal(isBadMacError({ err: new Error('Bad MAC') }), true);
  assert.equal(isBadMacError('connection closed normally'), false);
});

test('rotates the active auth folder to a validated backup and preserves it', async () => {
  await withState(async root => {
    const active = path.join(root, 'auth');
    const backup = path.join(root, 'auth.before-restore-1');
    await makeAuth(active);
    await makeAuth(path.join(backup, 'auth'));
    const result = await recoverFromBackup({ sessionDir: active, logger: silentLogger, now: Date.UTC(2026, 0, 2, 3, 4, 5) });

    assert.equal(result.recovered, true);
    assert.equal(result.candidate, 'auth.before-restore-1');
    assert.equal(await fs.readFile(path.join(active, 'creds.json'), 'utf8'), creds);
    assert.match(result.preserved, /auth\.badmac-recovery-/);
    assert.equal(await fs.readFile(path.join(result.preserved, 'creds.json'), 'utf8'), creds);
    assert.deepEqual(await listRecoveryCandidates(root), []);
  });
});

test('does not reuse the same backup after a recovery marker is written', async () => {
  await withState(async root => {
    const active = path.join(root, 'auth');
    await makeAuth(active);
    await makeAuth(path.join(root, 'auth.backup-1', 'auth'));
    const first = await recoverFromBackup({ sessionDir: active, logger: silentLogger });
    assert.equal(first.recovered, true);
    const second = await recoverFromBackup({ sessionDir: active, logger: silentLogger });
    assert.equal(second.recovered, false);
    assert.equal(second.reason, 'no-unused-validated-backup');
  });
});

test('triggers recovery only after the configured number of Bad MAC events', async () => {
  await withState(async root => {
    const active = path.join(root, 'auth');
    await makeAuth(active);
    await makeAuth(path.join(root, 'auth.backup-1', 'auth'));
    let recovered;
    const recovery = createBadMacRecovery({
      sessionDir: active,
      threshold: 3,
      logger: silentLogger,
      onRecovered: result => { recovered = result; }
    });
    assert.equal(recovery.observe('Bad MAC'), false);
    assert.equal(recovery.observe('Bad MAC'), false);
    assert.equal(recovery.observe('Bad MAC'), true);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(recovered.recovered, true);
  });
});
