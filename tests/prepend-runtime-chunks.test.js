const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

function loadBuildFunctions() {
	const buildScriptPath = path.join(__dirname, '..', 'scripts', 'build.js');
	const scriptSource = fs.readFileSync(buildScriptPath, 'utf8');
	const sourceWithoutEntrypoint = scriptSource.replace(
		/\n\/\/ Run the build[\s\S]*$/,
		'\nmodule.exports = { prependRuntimeChunks, extractSourceMaps: typeof extractSourceMaps === "undefined" ? undefined : extractSourceMaps, stripSourceMapComments: typeof stripSourceMapComments === "undefined" ? undefined : stripSourceMapComments };\n'
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

	return sandbox.module.exports;
}

test('keeps source chunks when merged entry write fails', () => {
	const { prependRuntimeChunks } = loadBuildFunctions();
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
	const { prependRuntimeChunks } = loadBuildFunctions();
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

// Offsets must include the join newline, even when a chunk already ends in one.
test('composes runtime, common and entry maps at their concatenated line offsets', (t) => {
	const { prependRuntimeChunks } = loadBuildFunctions();
	const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'index-map-test-'));
	t.after(() => fs.rmSync(buildDir, { recursive: true, force: true }));
	const jsDir = path.join(buildDir, '_expo', 'static', 'js', 'web');
	fs.mkdirSync(jsDir, { recursive: true });
	const names = ['__expo-metro-runtime-a.js', '__common-b.js', 'entry-c.js'];
	const contents = [
		'runtime();\n//# sourceMappingURL=runtime.js.map\n',
		'common();\ncommon2();',
		'entry();',
	];
	const maps = names.map((name) => ({
		version: 3,
		sources: [name + '.tsx'],
		sourcesContent: ['original();'],
		names: [],
		mappings: 'AAAA',
	}));
	for (const [i, name] of names.entries()) {
		fs.writeFileSync(path.join(jsDir, name), contents[i]);
		fs.writeFileSync(path.join(jsDir, name + '.map'), JSON.stringify(maps[i]));
	}

	prependRuntimeChunks(buildDir);

	const result = JSON.parse(fs.readFileSync(path.join(jsDir, 'entry-c.js.map'), 'utf8'));
	assert.equal(result.version, 3);
	assert.deepEqual(
		result.sections.map((section) => section.offset),
		[
			{ line: 0, column: 0 },
			{ line: 3, column: 0 },
			{ line: 5, column: 0 },
		]
	);
	assert.deepEqual(
		result.sections.map((section) => section.map),
		maps
	);
	assert.equal(fs.readFileSync(path.join(jsDir, 'entry-c.js'), 'utf8'), contents.join('\n'));
	assert.deepEqual(fs.readdirSync(jsDir).sort(), ['entry-c.js', 'entry-c.js.map']);
});

test('separates maps and removes map comments from every shipped JS without shifting lines', (t) => {
	const { extractSourceMaps, stripSourceMapComments } = loadBuildFunctions();
	assert.equal(typeof extractSourceMaps, 'function');
	assert.equal(typeof stripSourceMapComments, 'function');
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-map-test-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const buildDir = path.join(root, 'build');
	const mapsDir = path.join(root, 'web-build-maps');
	fs.mkdirSync(path.join(buildDir, '_expo', 'web'), { recursive: true });
	const files = ['worker.js', '_expo/web/entry.js'];
	const content =
		'runtime();\n//# sourceMappingURL=runtime.js.map\nentry();\n//# sourceMappingURL=entry.js.map\n//# debugId=metro-id';
	for (const file of files) {
		fs.writeFileSync(path.join(buildDir, file), content);
		fs.writeFileSync(path.join(buildDir, file + '.map'), '{"version":3}');
	}

	extractSourceMaps(buildDir, mapsDir);
	stripSourceMapComments(buildDir);

	for (const file of files) {
		const shipped = fs.readFileSync(path.join(buildDir, file), 'utf8');
		assert.doesNotMatch(shipped, /sourceMappingURL|debugId/);
		assert.equal(shipped, 'runtime();\n\nentry();\n\n');
		assert.equal(fs.existsSync(path.join(buildDir, file + '.map')), false);
		assert.equal(fs.readFileSync(path.join(mapsDir, file + '.map'), 'utf8'), '{"version":3}');
	}
});
