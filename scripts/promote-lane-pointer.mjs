import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const KV = 'https://api.cloudflare.com/client/v4/accounts/d9df0d95f1cee465811e977842e5063a/storage/kv/namespaces/0ddbce1d02ad40f5868c1e14cfd5b3f2/values/';
const USAGE = 'Usage: node scripts/promote-lane-pointer.mjs --tag v<X.Y>.<N> --commit <sha> [--dry-run]';
export function parseLane(tag) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(tag ?? '');
  if (!match) throw Object.assign(new Error(USAGE), { exitCode: 2 });
  return `${match[1]}.${match[2]}`;
}
export async function promoteLanePointer({ tag, commit, token, fetch = globalThis.fetch, now = () => new Date(), dryRun = false }) {
  const lane = parseLane(tag);
  if (!commit) throw Object.assign(new Error(USAGE), { exitCode: 2 });
  if (!token) throw new Error('CLOUDFLARE_CDN_TOKEN is required');
  async function request(url, options = {}) {
    const kv = url.startsWith(KV);
    const response = await fetch(url, { ...options, headers: kv ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {} });
    if (kv && !options.method && response.status === 404) return null;
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body}`);
    return body ? JSON.parse(body) : null;
  }
  console.log(`Read ref:${commit}`);
  const ref = await request(KV + encodeURIComponent(`ref:${commit}`));
  if (!ref?.build_id) throw new Error(`no build recorded for ${commit}; publish it first`);
  const build = ref.build_id;
  console.log(`Read index:${lane}`);
  const index = await request(KV + encodeURIComponent(`index:${lane}`));
  const entry = index?.find(item => item.build_id === build);
  if (!entry) throw new Error(`build ${build} not in index:${lane}`);
  console.log(`Read lane:${lane}`);
  const key = KV + encodeURIComponent(`lane:${lane}`);
  const old = await request(key) ?? { current: null, previous: null, rolled_back_from: null, killed: false, message: null, updated_at: null, updated_by: null };
  if (old.killed) throw new Error(`lane ${lane} is killed; unkill it in the admin page before promoting`);
  if (old.current === build) { console.log('already current'); return old; }
  // index:<lane> is newest first; a tag for an older build never moves the pointer backwards
  // (the admin page owns rollbacks).
  const currentPosition = index.findIndex(item => item.build_id === old.current);
  if (currentPosition >= 0 && index.indexOf(entry) > currentPosition) {
    throw new Error(`build ${build} is older than the current ${old.current} on lane ${lane}; the admin page owns backward moves`);
  }
  const pointer = { ...old, current: build, previous: old.current ?? old.previous, rolled_back_from: null,
    updated_at: now().toISOString(), updated_by: `web-bundle tag ${tag}` };
  if (dryRun) { console.log(`Dry run: ${JSON.stringify(pointer)}`); return pointer; }
  console.log(`Write lane:${lane} -> ${build}`);
  await request(key, { method: 'PUT', body: JSON.stringify(pointer) });
  const query = new URLSearchParams({ ref: lane, plugin: entry.app_version + (entry.prerelease ? '-beta.0' : ''), worker: entry.worker_rxdb_version });
  const deadline = +now() + 90000;
  let last;
  do {
    try {
      last = await request(`https://cdn.wcpos.com/manifest?${query}`, { signal: AbortSignal.timeout(Math.max(1, deadline - +now())) });
      console.log(`Verify: ${JSON.stringify(last)}`);
      if (last?.build_id === build) { console.log(`Verified ${last.build_id} ${last.bundle_base}`); return pointer; }
    } catch (error) { last = error.message; console.log(`Verify: ${last}`); }
    const remaining = deadline - +now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, remaining)));
  } while (+now() < deadline);
  throw new Error(`verify timed out for ${build}; last manifest answer: ${JSON.stringify(last)}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let values;
    try {
      ({ values } = parseArgs({ options: { tag: { type: 'string' }, commit: { type: 'string' }, 'dry-run': { type: 'boolean' } } }));
    } catch { throw Object.assign(new Error(USAGE), { exitCode: 2 }); }
    await promoteLanePointer({ tag: values.tag, commit: values.commit, token: process.env.CLOUDFLARE_CDN_TOKEN, dryRun: values['dry-run'] });
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 1; }
}
