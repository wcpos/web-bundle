const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../scripts/cdn-lane-pointer.mjs');
const buildId = '0123456789abcdef';
const commit = 'a'.repeat(40);
const now = new Date('2026-10-17T12:00:00Z');
const missingBuild = `no CDN build recorded for web-bundle commit ${commit}; the monorepo publish's cdn job did not run for it (R2 or the CDN secrets missing?) — re-run publish-web-bundle for that monorepo SHA, then re-run this workflow`;

test('parseTag separates stable and prerelease versions into their release lane', async () => {
	const { parseTag } = await load();
	assert.deepEqual(parseTag('v2.0.1'), { lane: '2.0', version: '2.0.1', prerelease: false });
	assert.deepEqual(parseTag('v12.34.5-beta.2'), {
		lane: '12.34', version: '12.34.5-beta.2', prerelease: true,
	});
});

test('parseTag rejects non-release tags and malformed versions', async () => {
	const { parseTag } = await load();
	for (const tag of ['next', '2.0.1', 'v2.0', 'v2.0.1-', 'v2.0.1-beta..2',
		'v2.0.1+meta', 'v02.0.1', 'v2.0.1-beta.01', 'v2.0.1\n', '', null]) {
		assert.throws(() => parseTag(tag), /Invalid release tag/);
	}
});

test('nextPointer creates the first pointer with explicit empty state', async () => {
	const { nextPointer } = await load();
	assert.deepEqual(nextPointer(null, buildId, 'v2.0.1', now), {
		current: buildId, previous: null, rolled_back_from: null, killed: false,
		message: null, updated_at: '2026-10-17T12:00:00.000Z', updated_by: 'web-bundle tag v2.0.1',
	});
});

test('nextPointer keeps previous on re-tag and rotates it for a new build', async () => {
	const { nextPointer } = await load();
	const old = Object.freeze({ current: buildId, previous: 'older' });
	assert.equal(nextPointer(old, buildId, 'v2.0.2', now).previous, 'older');
	const next = nextPointer(old, 'new', 'v2.0.2', now);
	assert.equal(next.current, 'new');
	assert.equal(next.previous, buildId);
});

test('nextPointer preserves kill state and message but clears rollback history', async () => {
	const { nextPointer } = await load();
	const old = Object.freeze({ current: 'old', killed: true, message: 'Stop loading', rolled_back_from: 'bad' });
	const next = nextPointer(old, buildId, 'v2.0.1', now);
	assert.equal(next.killed, true);
	assert.equal(next.message, 'Stop loading');
	assert.equal(next.rolled_back_from, null);
	assert.equal(next.previous, 'old');
});

// Only the external HTTP boundary is faked; assertions inspect run's requests and writes.
function recordingFetch({ tag = 'v2.0.1', missing, failure, manifest } = {}) {
	const requests = [];
	const polls = new Map();
	const entry = {
		build_id: buildId, worker_rxdb_version: '17.4.0', prerelease: tag.includes('-'),
		app_version: tag.slice(1), built_at: '2026-10-17T09:00:00Z',
	};
	const fetch = async (input, options = {}) => {
		const url = new URL(input);
		const method = options.method || 'GET';
		requests.push({ url, method, ...options });
		if (url.origin === 'https://cdn.wcpos.com') {
			const ref = url.searchParams.get('ref');
			const count = (polls.get(ref) || 0) + 1;
			polls.set(ref, count);
			return manifest ? manifest(ref, count) : Response.json({ build_id: count === 1 ? 'old' : buildId });
		}
		assert.equal(url.origin, 'https://api.cloudflare.com');
		const prefix = '/client/v4/accounts/d9df0d95f1cee465811e977842e5063a/storage/kv/namespaces/0ddbce1d02ad40f5868c1e14cfd5b3f2/values/';
		assert.ok(url.pathname.startsWith(prefix));
		const key = decodeURIComponent(url.pathname.slice(prefix.length));
		if (failure === `${method} ${key}`) return new Response(null, { status: 403 });
		if (method === 'PUT') return Response.json({ success: true });
		if (missing === key || key === 'lane:2.0') return new Response(null, { status: 404 });
		if (key === `ref:${commit}`) return Response.json({ build_id: buildId });
		if (key === 'index:2.0') return Response.json(missing === 'entry' ? [] : [entry]);
		assert.fail(`Unexpected KV read: ${key}`);
	};
	return { fetch, requests, polls };
}

function withToken(t) {
	const original = process.env.CLOUDFLARE_CDN_TOKEN;
	process.env.CLOUDFLARE_CDN_TOKEN = 'test-token';
	t.after(() => {
		if (original === undefined) delete process.env.CLOUDFLARE_CDN_TOKEN;
		else process.env.CLOUDFLARE_CDN_TOKEN = original;
	});
}

for (const tag of ['v2.0.1', 'v2.0.1-beta.2']) {
	test(`run publishes ${tag} and waits for lane and exact-tag visibility`, async (t) => {
		withToken(t);
		const { run } = await load();
		const fake = recordingFetch({ tag });
		await run({ tag, commit, fetch: fake.fetch });
		const kv = fake.requests.filter(({ url }) => url.origin === 'https://api.cloudflare.com');
		assert.deepEqual(kv.map(({ url, method }) => [method, decodeURIComponent(url.pathname.split('/').pop())]), [
			['GET', `ref:${commit}`], ['GET', 'index:2.0'], ['GET', 'lane:2.0'],
			['PUT', 'lane:2.0'], ['PUT', `ref:${tag}`], ['PUT', `ref:${tag.slice(1)}`],
		]);
		for (const request of kv) assert.equal(new Headers(request.headers).get('Authorization'), 'Bearer test-token');
		const pointer = JSON.parse(kv[3].body);
		assert.ok(Number.isFinite(Date.parse(pointer.updated_at)));
		assert.deepEqual({ ...pointer, updated_at: 'ISO' }, {
			current: buildId, previous: null, rolled_back_from: null, killed: false, message: null,
			updated_at: 'ISO', updated_by: `web-bundle tag ${tag}`,
		});
		for (const request of kv.slice(4)) assert.deepEqual(JSON.parse(request.body), { build_id: buildId });
		assert.deepEqual([...fake.polls], [['2.0', 2], [tag, 2]]);
		for (const request of fake.requests.slice(6)) {
			assert.equal(request.url.pathname, '/manifest');
			assert.equal(request.url.searchParams.get('plugin'), tag.slice(1));
			assert.equal(request.url.searchParams.get('worker'), '17.4.0');
			assert.equal(new Headers(request.headers).has('Authorization'), false);
		}
	});
}

for (const missing of [`ref:${commit}`, 'index:2.0', 'entry']) {
	test(`run fails without writes when ${missing} is missing`, async (t) => {
		withToken(t);
		const { run } = await load();
		const fake = recordingFetch({ missing });
		await assert.rejects(run({ tag: 'v2.0.1', commit, fetch: fake.fetch }), { message: missingBuild });
		assert.ok(fake.requests.every(({ method }) => method === 'GET'));
	});
}

test('run stops on KV failure instead of continuing to aliases or verification', async (t) => {
	withToken(t);
	const { run } = await load();
	const fake = recordingFetch({ failure: 'PUT lane:2.0' });
	await assert.rejects(run({ tag: 'v2.0.1', commit, fetch: fake.fetch }), /PUT lane:2.0.*403/);
	assert.equal(fake.requests.length, 4);
});

for (const failedRef of ['2.0', 'v2.0.1']) {
	test(`run fails loudly when ${failedRef} never verifies before the deadline`, async (t) => {
		withToken(t);
		const { run } = await load();
		let clock = 0;
		t.mock.method(Date, 'now', () => clock);
		const fake = recordingFetch({ manifest: (ref) => {
			if (ref !== failedRef) return Response.json({ build_id: buildId });
			clock = 90_001;
			return Response.json({ build_id: 'wrong' });
		} });
		await assert.rejects(run({ tag: 'v2.0.1', commit, fetch: fake.fetch }), /Manifest verification failed/);
		assert.equal(fake.polls.get(failedRef), 1);
	});
}
