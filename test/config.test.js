import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('parseHosts splits and cleans the free-text field', () => {
  assert.deepEqual(
    parseHosts(' 192.168.1.20,192.168.1.21;\nhttp://dingz-bureau.lan/ 192.168.1.20 '),
    ['192.168.1.20', '192.168.1.21', 'dingz-bureau.lan'],
  );
  assert.deepEqual(parseHosts(undefined), []);
});

test('normalizeConfig applies the defaults and clamps the interval', () => {
  assert.equal(normalizeConfig().refresh_interval, DEFAULT_CONFIG.refresh_interval);
  assert.equal(normalizeConfig({ refresh_interval: '1' }).refresh_interval, 2);
  assert.equal(normalizeConfig({ refresh_interval: 9999 }).refresh_interval, 300);
  assert.equal(normalizeConfig({ udp_discovery: false }).udp_discovery, false);
  assert.equal(normalizeConfig({}).udp_discovery, true);
});
