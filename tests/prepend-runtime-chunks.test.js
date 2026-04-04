const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

function loadPrependRuntimeChunks() {
	const buildScriptPath = path.join(__dirname, '..', 'scripts', 'build.js');
	const scriptSource = fs.readFileSync(buildScriptPath, 'utf8');
	const sourceWithoutEntrypoint = scriptSource.replace(
		/\n\/\/ Run the build[\s\S]*$/,
		'\nmodule.exports = { prependRuntimeChunks };\n'
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

	return sandbox.module.exports.prependRuntimeChunks;
}

test('keeps source chunks when merged entry write fails', () => {
	const prependRuntimeChunks = loadPrependRuntimeChunks();
	const tempBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepend-runtime-test-'));
	const staticJsDir = path.join(tempBuildDir, '_expo', 'static', 'js', 'web');

	fs.mkdirSync(staticJsDir, { recursive: true });

	const runtimePath = path.join(staticJsDir, '__expo-metro-runtime-a.js');
	const commonPath = path.join(staticJsDir, '__common-b.js');
	const entryPath = path.join(staticJsDir, 'entry-c.js');

	fs.writeFileSync(runtimePath, 'runtime();\n', 'utf8');
	fs.writeFileSync(commonPath, 'common();\n', 'utf8');
	fs.writeFileSync(entryPath, 'entry();\n', 'utf8');

	const originalWriteFileSync = fs.writeFileSync;
	let writeAttempted = false;

	try {
		fs.writeFileSync = () => {
			writeAttempted = true;
			throw new Error('simulated write failure');
		};

		assert.throws(() => {
			prependRuntimeChunks(tempBuildDir);
		}, /simulated write failure/);
		assert.equal(writeAttempted, true);

		assert.equal(fs.existsSync(runtimePath), true);
		assert.equal(fs.existsSync(commonPath), true);
		assert.equal(fs.readFileSync(entryPath, 'utf8'), 'entry();\n');
	} finally {
		fs.writeFileSync = originalWriteFileSync;
		fs.rmSync(tempBuildDir, { recursive: true, force: true });
	}
});

test('cleans temp entry file when rename fails', () => {
	const prependRuntimeChunks = loadPrependRuntimeChunks();
	const tempBuildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepend-runtime-test-'));
	const staticJsDir = path.join(tempBuildDir, '_expo', 'static', 'js', 'web');

	fs.mkdirSync(staticJsDir, { recursive: true });

	const runtimePath = path.join(staticJsDir, '__expo-metro-runtime-a.js');
	const commonPath = path.join(staticJsDir, '__common-b.js');
	const entryPath = path.join(staticJsDir, 'entry-c.js');

	fs.writeFileSync(runtimePath, 'runtime();\n', 'utf8');
	fs.writeFileSync(commonPath, 'common();\n', 'utf8');
	fs.writeFileSync(entryPath, 'entry();\n', 'utf8');

	const originalRenameSync = fs.renameSync;

	try {
		fs.renameSync = () => {
			throw new Error('simulated rename failure');
		};

		assert.throws(() => {
			prependRuntimeChunks(tempBuildDir);
		}, /simulated rename failure/);

		assert.equal(fs.existsSync(runtimePath), true);
		assert.equal(fs.existsSync(commonPath), true);
		assert.equal(fs.readFileSync(entryPath, 'utf8'), 'entry();\n');
		const tempEntryFiles = fs
			.readdirSync(staticJsDir)
			.filter((fileName) => fileName.startsWith('entry-c.js.tmp-'));
		assert.equal(tempEntryFiles.length, 0);
	} finally {
		fs.renameSync = originalRenameSync;
		fs.rmSync(tempBuildDir, { recursive: true, force: true });
	}
});
