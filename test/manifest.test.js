// Consistency between gladys-assistant-integration.json and the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { DINGZ_UDP_PORT } from '../src/model.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('versions agree between package.json, the manifest and the image tag', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('every config_schema default mirrors DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} missing from DEFAULT_CONFIG`);
    assert.deepEqual(field.default, DEFAULT_CONFIG[field.key], `default of ${field.key}`);
  }
});

test('every manifest action has a handler in index.js', () => {
  for (const action of manifest.actions) {
    assert.ok(
      indexSource.includes(`onAction('${action.key}'`),
      `no handler for action ${action.key}`,
    );
  }
});

test('the UDP discovery port is declared', () => {
  const entry = manifest.network_discovery.find((e) => e.type === 'udp-broadcast');
  assert.ok(entry?.ports.includes(DINGZ_UDP_PORT));
});

test('texts are bilingual and the catalog description fits', () => {
  for (const lang of ['en', 'fr']) {
    const text = manifest.description[lang];
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} is ${text.length} chars`,
    );
  }
  const fields = [
    ...manifest.config_schema,
    ...manifest.actions,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
  ];
  for (const field of fields) {
    for (const key of ['label', 'description', 'placeholder']) {
      if (field[key] !== undefined) {
        assert.ok(field[key].en && field[key].fr, `${field.key}.${key} must be bilingual`);
      }
    }
  }
});
