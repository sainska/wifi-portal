const test = require('node:test');
const assert = require('node:assert/strict');

const network = require('../src/services/network');
const { selectPreferredHost } = require('../src/services/bind');

test('evaluateConnectionState marks an ARP-present device as connected', () => {
  const result = network.evaluateConnectionState({
    ip: '192.168.43.153',
    mac: 'aa:bb:cc:dd:ee:ff',
    arpEntries: [{ ip: '192.168.43.153', mac: 'AA:BB:CC:DD:EE:FF', type: 'dynamic' }],
  });

  assert.equal(result.isConnected, true);
  assert.equal(result.source, 'arp');
});

test('evaluateConnectionState returns disconnected when no matching ARP entry exists', () => {
  const result = network.evaluateConnectionState({
    ip: '192.168.43.153',
    mac: 'aa:bb:cc:dd:ee:ff',
    arpEntries: [{ ip: '192.168.43.152', mac: '11:22:33:44:55:66', type: 'dynamic' }],
  });

  assert.equal(result.isConnected, false);
  assert.equal(result.source, 'arp');
});

test('selectPreferredHost prefers the hotspot-style address when available', () => {
  const host = selectPreferredHost(['192.168.0.100', '192.168.137.1', '10.0.0.5'], ['192.168.137.', '192.168.0.', '10.0.0.', '172.16.']);
  assert.equal(host, '192.168.137.1');
});
