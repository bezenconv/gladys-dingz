import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DingzIntegration } from '../src/app.js';
import { DingzClient } from '../src/client.js';
import { HostStore } from '../src/store.js';
import { buildDevice } from '../src/model.js';
import * as fx from './helpers/fixtures.js';

const info = {
  mac: fx.MAC,
  host: fx.HOST,
  device: fx.deviceResponse[fx.MAC],
  system: fx.systemConfig,
  outputs: fx.outputConfig.outputs,
  blinds: fx.blindConfig.blinds,
  state: fx.state,
};

/** A created Gladys device, as the host API serves it. */
function createdDevice(gladys, { withHost = true } = {}) {
  const device = buildDevice(gladys, { ...info, host: withHost ? fx.HOST : undefined });
  return { ...device, id: 'dev-1', selector: 'rez-salon' };
}

async function setup({ routes, config = {}, scanResults, created = true, withHost = true } = {}) {
  const probe = createFakeGladys();
  const devices = created ? [createdDevice(probe, { withHost })] : [];
  const gladys = createFakeGladys({ devices, config, scanResults });
  await gladys.getDevices();
  const { fetch, calls } = createFakeFetch(routes);
  const client = new DingzClient({ fetch, gapMs: 0, timeoutMs: 1000 });
  const app = new DingzIntegration(gladys, { client, store: new HostStore(null) });
  app.setConfig(config);
  return { gladys, app, calls };
}

const { createFakeFetch } = fx;

test('scan finds dingz through their UDP announcements', async () => {
  const { gladys, app } = await setup({
    created: false,
    scanResults: {
      'udp-broadcast': [
        { source_ip: fx.HOST, source_port: 7979, payload_base64: fx.announcement() },
      ],
    },
  });
  const { found } = await app.scan();
  assert.equal(found.length, 1);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Rez – Salon');
  assert.equal(app.store.get(fx.MAC), fx.HOST);
});

test('scan ignores other myStrom devices and uses the configured addresses', async () => {
  const { gladys, app } = await setup({
    created: false,
    config: { hosts: `${fx.HOST}, 192.168.4.99`, udp_discovery: true },
    scanResults: {
      'udp-broadcast': [
        {
          source_ip: '192.168.4.77',
          source_port: 7979,
          payload_base64: fx.announcement('AABBCCDDEEFF', 107),
        },
      ],
    },
    routes: { [fx.HOST]: fx.defaultRoutes() },
  });
  const { found, failed } = await app.scan();
  assert.deepEqual(
    found.map((f) => f.host),
    [fx.HOST],
  );
  assert.deepEqual(
    failed.map((f) => f.host),
    ['192.168.4.99'],
  );
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('the refresh publishes the states of the created features only, then only the changes', async () => {
  const { gladys, app } = await setup();
  await app.refreshAll();
  const ids = gladys.externalIds('dingz', fx.MAC);
  assert.equal(gladys.fake.lastState(ids.feature('output-0-brightness')), 63);
  assert.equal(gladys.fake.lastState(ids.feature('blind-0-position')), 40);
  assert.equal(gladys.fake.lastState(ids.feature('temperature')), 21.5);
  const published = gladys.fake.states.length;
  assert.ok(published > 0);
  assert.ok(gladys.fake.states.every((s) => s.device_feature_external_id.startsWith(ids.device)));
  await app.refreshAll();
  assert.equal(gladys.fake.states.length, published, 'nothing changed, nothing re-sent');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an unreachable dingz is reported in the connection status', async () => {
  const { gladys, app } = await setup({ routes: {} });
  app.lastRescan = Date.now(); // no rescan in this test
  await app.refreshAll();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /injoignable/);
});

test('commands reach the right dingz endpoints', async () => {
  const { gladys, app, calls } = await setup();
  const device = gladys.devices[0];
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

  await app.setValue(device, feature('output-0-brightness'), 42);
  await app.setValue(device, feature('output-1'), 0);
  await app.setValue(device, feature('blind-0-state'), -1);
  await app.setValue(device, feature('blind-0-position'), 80);
  await app.setValue(device, feature('blind-0-lamella'), 20);

  const posts = calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.query]);
  assert.deepEqual(posts, [
    ['/api/v1/dimmer/0/on', { value: '42' }],
    ['/api/v1/dimmer/1/off', {}],
    ['/api/v1/shade/0/down', {}],
    ['/api/v1/shade/0', { blind: '80' }],
    ['/api/v1/shade/0', { lamella: '20' }],
  ]);
  for (const follower of app.followers.values()) await follower;
});

test('a command to a sensor is refused', async () => {
  const { gladys, app } = await setup();
  const device = gladys.devices[0];
  const temperature = device.features.find((f) => f.external_id.endsWith(':temperature'));
  await assert.rejects(app.setValue(device, temperature, 20), /cannot be controlled/);
});

test('identify blinks the LED and restores it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { gladys, app, calls } = await setup();
  const run = app.identify(gladys.devices[0].external_id);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(500);
  }
  const message = await run;
  assert.match(message.fr, /clignoté/);
  const ledBodies = calls.filter((c) => c.path === '/api/v1/led/set').map((c) => c.body);
  assert.equal(ledBodies.length, 7);
  assert.equal(ledBodies[0], 'action=on&color=FF0000&mode=rgb');
  assert.equal(ledBodies.at(-1), 'action=on&color=FFFFFF&mode=rgb');
});

test('the address comes from the device params when the address book is empty', async () => {
  const { app } = await setup();
  const [entry] = app.createdDevices();
  assert.equal(app.hostOf(entry.mac, entry.device), fx.HOST);
});
