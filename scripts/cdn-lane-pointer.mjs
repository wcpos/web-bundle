import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

// The CDN account owns the release delivery resources.
const ACCOUNT_ID = 'd9df0d95f1cee465811e977842e5063a';
// cdn-pointers is shared with the monorepo publisher and CDN Worker.
const NAMESPACE_ID = '0ddbce1d02ad40f5868c1e14cfd5b3f2';
// Verify the public endpoint that plugin loaders actually use.
const MANIFEST_ORIGIN = 'https://cdn.wcpos.com';
// KV propagation can take 60 seconds; allow 90 seconds for visibility.
const VISIBILITY_DEADLINE_MS = 90_000;

export function parseTag(tag) {
	const parsed = typeof tag === 'string' && tag.match(
		/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
	);
	if (!parsed || parsed[0] !== tag || parsed[4]?.split('.').some((part) => /^0\d+$/.test(part))) {
		throw new Error('Invalid release tag; expected vX.Y.N or vX.Y.N-prerelease');
	}
	return { lane: `${parsed[1]}.${parsed[2]}`, version: tag.slice(1), prerelease: Boolean(parsed[4]) };
}

export function nextPointer(old, build_id, tag, now) {
	return {
		current: build_id,
		previous: old?.current === build_id ? (old.previous ?? null) : (old?.current ?? null),
		rolled_back_from: null,
		killed: old?.killed ?? false,
		message: old?.message ?? null,
		updated_at: now.toISOString(),
		updated_by: `web-bundle tag ${tag}`,
	};
}

export async function run({ tag, commit, fetch = globalThis.fetch }) {
	const { lane, version } = parseTag(tag);
	if (!commit) throw new Error('A web-bundle commit is required');
	const token = process.env.CLOUDFLARE_CDN_TOKEN;
	if (!token) throw new Error('CLOUDFLARE_CDN_TOKEN is required');
	const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/`;
	const kv = async (key, value) => {
		const method = value === undefined ? 'GET' : 'PUT';
		console.log(`${method} ${key}`);
		const response = await fetch(base + encodeURIComponent(key), {
			method,
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			...(method === 'PUT' ? { body: JSON.stringify(value) } : {}),
		});
		if (method === 'GET' && response.status === 404) return null;
		if (!response.ok) throw new Error(`KV ${method} ${key} failed: HTTP ${response.status}`);
		const result = await response.json();
		if (method === 'PUT' && result.success === false) throw new Error(`KV PUT ${key} failed`);
		return result;
	};
	const missingBuild = () => new Error(
		`no CDN build recorded for web-bundle commit ${commit}; the monorepo publish's cdn job did not run for it (R2 or the CDN secrets missing?) — re-run publish-web-bundle for that monorepo SHA, then re-run this workflow`
	);
	const ref = await kv(`ref:${commit}`);
	if (!ref?.build_id) throw missingBuild();
	const { build_id } = ref;
	const index = await kv(`index:${lane}`);
	const entry = index?.find((item) => item.build_id === build_id);
	if (!entry) throw missingBuild();
	const old = await kv(`lane:${lane}`);
	await kv(`lane:${lane}`, nextPointer(old, build_id, tag, new Date()));
	await kv(`ref:${tag}`, { build_id });
	await kv(`ref:${version}`, { build_id });

	const deadline = Date.now() + VISIBILITY_DEADLINE_MS;
	for (const ref of [lane, tag]) {
		const url = new URL('/manifest', MANIFEST_ORIGIN);
		url.search = new URLSearchParams({ ref, plugin: version, worker: entry.worker_rxdb_version });
		let delay = 1_000;
		let verified = false;
		while (Date.now() < deadline) {
			console.log(`Verify manifest ref=${ref}`);
			try {
				const response = await fetch(url, {
					signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
				});
				if (response.ok && (await response.json()).build_id === build_id) {
					verified = true;
					break;
				}
			} catch {
				// An unavailable manifest is not evidence that the release is visible.
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)));
			delay = Math.min(delay * 2, 10_000);
		}
		if (!verified) throw new Error(`Manifest verification failed for ${ref}: expected ${build_id} within 90 seconds`);
		console.log(`Verified manifest ref=${ref} build_id=${build_id}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		const { values } = parseArgs({ options: { tag: { type: 'string' }, commit: { type: 'string' } } });
		await run({ tag: values.tag, commit: values.commit });
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
