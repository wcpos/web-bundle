const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const modulePromise = import('../scripts/promote-lane-pointer.mjs');
const build = '0123456789abcdef';
const entry = { build_id: build, app_version: '2.0.0', worker_rxdb_version: '16.0.0', prerelease: false };
const empty = { current: null, previous: null, rolled_back_from: null, killed: false, message: null, updated_at: null, updated_by: null };
function fixture(overrides = {}) {
  const calls = [];
  let time = new Date('2026-11-02T12:00:00.000Z');
  const values = { 'ref:abc': { build_id: build }, 'index:2.0': [entry], 'lane:2.0': null, ...overrides };
  const options = { tag: 'v2.0.0', commit: 'abc', token: 'test-token', now: () => time,
    fetch: async (url, init) => {
      calls.push({ url: String(url), ...init });
      if (String(url).startsWith('https://cdn.wcpos.com/manifest?')) {
        assert.equal(init.headers?.Authorization, undefined);
        if (values.timeout) time = new Date(time.getTime() + 90000);
        return new Response(JSON.stringify(values.manifest ?? { build_id: build, bundle_base: 'https://cdn.wcpos.com/bundles/' + build }));
      }
      assert.equal(init.headers.Authorization, 'Bearer test-token');
      assert.ok(String(url).startsWith('https://api.cloudflare.com/client/v4/accounts/d9df0d95f1cee465811e977842e5063a/storage/kv/namespaces/0ddbce1d02ad40f5868c1e14cfd5b3f2/values/'));
      if (init.method === 'PUT') return new Response('');
      const value = values[decodeURIComponent(String(url).split('/').pop())];
      return new Response(JSON.stringify(value), { status: value == null ? 404 : 200 });
    } };
  return { options, calls, writes: () => calls.filter(call => call.method === 'PUT') };
}
test('lane parsing accepts releases and prereleases, rejects other tags with usage/exit 2', async () => {
  const { parseLane } = await modulePromise;
  for (const [tag, lane] of [['v2.0.0', '2.0'], ['v1.11.14', '1.11'], ['v2.0.0-beta.1', '2.0']]) assert.equal(parseLane(tag), lane);
  for (const tag of ['2.0.0', 'v2.0', 'next', 'v2.0.0-', 'v2.0.0-beta..1', 'v02.0.0']) {
    assert.throws(() => parseLane(tag), error => error.exitCode === 2 && /Usage:/.test(error.message));
  }
  const cli = spawnSync(process.execPath, ['scripts/promote-lane-pointer.mjs', '--tag', 'bad', '--commit', 'abc']);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr.toString(), /Usage:/);
});
test('missing ref refuses promotion', async () => {
  const { promoteLanePointer } = await modulePromise;
  for (const ref of [null, {}]) {
    const f = fixture({ 'ref:abc': ref });
    await assert.rejects(promoteLanePointer(f.options), /no build recorded for abc; publish it first/);
    assert.equal(f.writes().length, 0);
  }
});
test('build must appear in the lane index', async () => {
  const f = fixture({ 'index:2.0': [] });
  await assert.rejects((await modulePromise).promoteLanePointer(f.options), /not in index:2.0/);
  assert.equal(f.writes().length, 0);
});
test('killed lane refuses even when build is already current', async () => {
  const f = fixture({ 'lane:2.0': { ...empty, current: build, killed: true } });
  await assert.rejects((await modulePromise).promoteLanePointer(f.options), /lane 2.0 is killed; unkill it in the admin page before promoting/);
  assert.equal(f.writes().length, 0);
});
test('idempotent rerun neither writes nor polls', async () => {
  const f = fixture({ 'lane:2.0': { ...empty, current: build } });
  await (await modulePromise).promoteLanePointer(f.options);
  assert.equal(f.calls.length, 3);
  assert.equal(f.writes().length, 0);
});
test('writes exact pointer, preserving previous when current is null, and verifies prereleases', async () => {
  for (const old of [null, { ...empty, current: 'old', previous: 'older', rolled_back_from: 'bad', message: 'keep' }, { ...empty, previous: 'older' }]) {
    const f = fixture({ 'lane:2.0': old, 'index:2.0': [{ ...entry, prerelease: true }] });
    await (await modulePromise).promoteLanePointer(f.options);
    assert.equal(f.writes().length, 1);
    assert.equal(decodeURIComponent(new URL(f.writes()[0].url).pathname.split('/').pop()), 'lane:2.0');
    assert.equal(f.writes()[0].headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(f.writes()[0].body), { ...(old ?? empty), current: build,
      previous: old?.current ?? old?.previous ?? null, rolled_back_from: null,
      updated_at: '2026-11-02T12:00:00.000Z', updated_by: 'web-bundle tag v2.0.0' });
    const query = new URL(f.calls.at(-1).url).searchParams;
    assert.deepEqual(Object.fromEntries(query), { ref: '2.0', plugin: '2.0.0-beta.0', worker: '16.0.0' });
  }
});
test('dry run returns would-be pointer without writing or polling', async () => {
  const f = fixture();
  const pointer = await (await modulePromise).promoteLanePointer({ ...f.options, dryRun: true });
  assert.equal(pointer.current, build);
  assert.equal(f.calls.length, 3);
  assert.equal(f.writes().length, 0);
});
test('verify timeout names the last manifest answer', async () => {
  const f = fixture({ timeout: true, manifest: { error: 'no_compatible_bundle' } });
  await assert.rejects((await modulePromise).promoteLanePointer(f.options), /timed out.*no_compatible_bundle/);
  assert.equal(f.writes().length, 1);
});
test('verification polls after 5 seconds, handles HTTP errors, and uses the stable plugin version', async t => {
  const f = fixture();
  const fetch = f.options.fetch;
  let polls = 0;
  const waits = [];
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => { waits.push(delay); callback(); });
  f.options.fetch = async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).includes('/manifest?') && ++polls === 1) return new Response('{"error":"no_compatible_bundle"}', { status: 404 });
    return response;
  };
  await (await modulePromise).promoteLanePointer(f.options);
  assert.equal(polls, 2);
  assert.deepEqual(waits, [5000]);
  assert.equal(new URL(f.calls.at(-1).url).searchParams.get('plugin'), '2.0.0');
});
test('KV HTTP failure stops without retry or write', async () => {
  const f = fixture();
  let requests = 0;
  f.options.fetch = async () => { requests++; return new Response('denied', { status: 403 }); };
  await assert.rejects((await modulePromise).promoteLanePointer(f.options), /HTTP 403: denied/);
  assert.equal(requests, 1);
  assert.equal(f.writes().length, 0);
});
