const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

function loadSyncBuildArtifacts() {
	const buildScriptPath = path.join(__dirname, '..', 'scripts', 'build.js');
	const scriptSource = fs.readFileSync(buildScriptPath, 'utf8');
	const sourceWithoutEntrypoint = scriptSource.replace(
		/\n\/\/ Run the build[\s\S]*$/,
		'\nmodule.exports = { syncBuildArtifacts: typeof syncBuildArtifacts === "undefined" ? undefined : syncBuildArtifacts };\n'
	);
	const sandbox = {
		require,
		module: { exports: {} },
		exports: {},
		__filename: buildScriptPath,
		__dirname: path.dirname(buildScriptPath),
		console,
		process,
	};

	vm.runInNewContext(sourceWithoutEntrypoint, sandbox, { filename: buildScriptPath });

	return sandbox.module.exports.syncBuildArtifacts;
}

test('preserves legacy indexeddb worker while updating opfs worker from fresh export', () => {
	const syncBuildArtifacts = loadSyncBuildArtifacts();
	assert.equal(typeof syncBuildArtifacts, 'function');

	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-build-artifacts-'));
	const sourceDir = path.join(tempRoot, 'web-build');
	const destDir = path.join(tempRoot, 'build');

	fs.mkdirSync(sourceDir, { recursive: true });
	fs.mkdirSync(destDir, { recursive: true });

	fs.writeFileSync(path.join(sourceDir, 'index.html'), 'new index\n', 'utf8');
	fs.writeFileSync(path.join(sourceDir, 'indexeddb.worker.js'), 'new indexeddb worker\n', 'utf8');
	fs.writeFileSync(path.join(sourceDir, 'opfs.worker.js'), 'new opfs worker\n', 'utf8');

	fs.writeFileSync(path.join(destDir, 'index.html'), 'old index\n', 'utf8');
	fs.writeFileSync(path.join(destDir, 'indexeddb.worker.js'), 'legacy indexeddb worker\n', 'utf8');
	fs.writeFileSync(path.join(destDir, 'opfs.worker.js'), 'old opfs worker\n', 'utf8');

	try {
		syncBuildArtifacts(sourceDir, destDir);

		assert.equal(fs.readFileSync(path.join(destDir, 'index.html'), 'utf8'), 'new index\n');
		assert.equal(
			fs.readFileSync(path.join(destDir, 'indexeddb.worker.js'), 'utf8'),
			'legacy indexeddb worker\n'
		);
		assert.equal(fs.readFileSync(path.join(destDir, 'opfs.worker.js'), 'utf8'), 'new opfs worker\n');
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});
