function publishPairingCode(code) {
  // Keep the one-time code out of stdout / Actions logs.
  fs.writeFileSync(path.join(path.dirname(sessionDir), 'PAIRING_CODE.txt'), code + '\n', { mode: 0o600 });
  if (ciMode) {
    // GitHub renders this as a run annotation while the pairing step is still active.
    // This makes the code available before the generator's wait-for-link step completes.
    console.log('::notice title=BRITECH MD pairing code::' + code);
  }
  if (summaryPath) {
    fs.appendFileSync(summaryPath,
      '\n## BRITECH MD pairing code\n\n' +
      '> Use this code immediately in WhatsApp → Linked devices → Link with phone number instead.\n\n' +
      '`' + code + '`\n\n' +
      'This is a one-time code. Do not share screenshots or workflow access.\n');
  }
  if (!ciMode) console.log('Pairing code generated. Check the pairing-code display file; it is not printed in terminal logs.');
}