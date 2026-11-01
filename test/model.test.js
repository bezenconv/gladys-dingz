import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES as CAT } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  buildDevice,
  buildLayout,
  commandFor,
  isMoving,
  normalizeMac,
  parseAnnouncement,
  parseExternalId,
  stateToValues,
} from '../src/model.js';
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

test('normalizeMac accepts the usual notations', () => {
  assert.equal(normalizeMac('f0:08:d1:c2:f9:c4'), fx.MAC);
  assert.equal(normalizeMac('F0-08-D1-C2-F9-C4'), fx.MAC);
  assert.equal(normalizeMac('nope'), null);
});

test('parseAnnouncement decodes a dingz announcement and rejects garbage', () => {
  const parsed = parseAnnouncement(Buffer.from(fx.announcement(), 'base64'));
  assert.deepEqual(parsed, { mac: fx.MAC, typeCode: 108, isDingz: true });
  assert.equal(
    parseAnnouncement(Buffer.from(fx.announcement(fx.MAC, 107), 'base64')).isDingz,
    false,
  );
  assert.equal(parseAnnouncement(Buffer.from('short')), null);
});

test('the layout skips inactive and motor-driven outputs', () => {
  const layout = buildLayout(info);
  assert.deepEqual(
    layout.outputs.map((o) => [o.index, o.kind, o.dimmable]),
    [
      [0, 'light', true],
      [1, 'light', false],
    ],
  );
  assert.equal(layout.blinds.length, 1);
  assert.ok(layout.hasMotion && layout.hasTemperature && layout.hasIlluminance && layout.hasPower);
});

test('a non-light output becomes a switch', () => {
  const layout = buildLayout({
    ...info,
    outputs: [{ active: true, type: 'power_socket' }],
  });
  assert.equal(layout.outputs[0].kind, 'switch');
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, {
    ...info,
    outputs: [{ active: true, type: 'fan', name: 'VMC' }],
  });
  const feature = device.features.find((f) => f.external_id.endsWith(':output-0'));
  assert.equal(feature.category, CAT.SWITCH);
  assert.equal(feature.name, 'VMC');
});

test('buildDevice names the device and the features after the dingz configuration', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, info);
  assert.equal(device.name, 'Rez – Salon');
  assert.equal(device.should_poll, false);
  const keys = device.features.map((f) => f.external_id.split(':').pop());
  assert.deepEqual(keys, [
    'output-0',
    'output-0-brightness',
    'output-1',
    'blind-0-state',
    'blind-0-position',
    'blind-0-lamella',
    'temperature',
    'illuminance',
    'motion',
    'power-0',
    'power-1',
  ]);
  assert.equal(device.features[0].name, 'Plafonnier');
  assert.equal(device.features[2].name, 'Output 2');
  assert.equal(device.features[3].name, 'Store séjour');
  assert.deepEqual(
    device.params.find((p) => p.name === 'IP_ADDRESS'),
    { name: 'IP_ADDRESS', value: fx.HOST },
  );
});

test('Gladys accepts the discovery payload', async () => {
  const gladys = createFakeGladys();
  await gladys.publishDiscoveredDevices([buildDevice(gladys, info)]);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
});

test('parseExternalId round-trips device and feature ids', () => {
  const gladys = createFakeGladys();
  const ids = gladys.externalIds('dingz', fx.MAC);
  assert.deepEqual(parseExternalId(gladys, ids.device), { mac: fx.MAC, featureKey: null });
  assert.deepEqual(parseExternalId(gladys, ids.feature('blind-0-position')), {
    mac: fx.MAC,
    featureKey: 'blind-0-position',
  });
  assert.equal(parseExternalId(gladys, 'ext:other:thing'), null);
});

test('stateToValues translates the dingz state', () => {
  const values = stateToValues(fx.state);
  assert.equal(values['output-0'], 1);
  assert.equal(values['output-0-brightness'], 63);
  assert.equal(values['output-1'], 0);
  assert.equal(values['output-1-brightness'], undefined, 'an off light keeps its last brightness');
  assert.equal(values['blind-0-state'], 0);
  assert.equal(values['blind-0-position'], 40);
  assert.equal(values['blind-0-lamella'], 75);
  assert.equal(values.temperature, 21.5);
  assert.equal(values.illuminance, 312);
  assert.equal(values.motion, 0);
  assert.equal(values['power-0'], 12.3);
});

test('a moving blind maps to the Gladys cover states', () => {
  const moving = { blinds: [{ moving: 'down', position: 30 }] };
  assert.equal(stateToValues(moving)['blind-0-state'], -1);
  assert.equal(stateToValues({ blinds: [{ moving: 'up' }] })['blind-0-state'], 1);
  assert.equal(isMoving(moving), true);
  assert.equal(isMoving(fx.state), false);
});

test('commandFor translates the Gladys commands', () => {
  assert.deepEqual(commandFor('output-1', 1), { kind: 'dimmer', index: 1, action: 'on' });
  assert.deepEqual(commandFor('output-1', 0), { kind: 'dimmer', index: 1, action: 'off' });
  assert.deepEqual(commandFor('output-0-brightness', 42.4), {
    kind: 'dimmer',
    index: 0,
    action: 'on',
    value: 42,
  });
  assert.deepEqual(commandFor('output-0-brightness', 0), {
    kind: 'dimmer',
    index: 0,
    action: 'off',
  });
  assert.deepEqual(commandFor('blind-0-state', 1), { kind: 'shade-move', index: 0, action: 'up' });
  assert.deepEqual(commandFor('blind-0-state', -1), {
    kind: 'shade-move',
    index: 0,
    action: 'down',
  });
  assert.deepEqual(commandFor('blind-0-state', 0), {
    kind: 'shade-move',
    index: 0,
    action: 'stop',
  });
  assert.deepEqual(commandFor('blind-0-position', 150), {
    kind: 'shade-position',
    index: 0,
    blind: 100,
  });
  assert.deepEqual(commandFor('blind-0-lamella', 30), {
    kind: 'shade-position',
    index: 0,
    lamella: 30,
  });
  assert.throws(() => commandFor('temperature', 20));
  assert.throws(() => commandFor('blind-0-state', 5));
  assert.throws(() => commandFor('output-0', 'abc'));
});
