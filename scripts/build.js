#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Assume the script is run from the apps/web directory
const ROOT_DIR = process.cwd();
const MAIN_APP_DIR = path.join(ROOT_DIR, '..', 'main');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const WEB_BUILD_DIR = path.join(MAIN_APP_DIR, 'web-build');

function log(message) {
	console.log(`[build] ${message}`);
}

function ensureDirectoryExists(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		log(`Created directory: ${dir}`);
	}
}

function cleanDirectory(dir) {
	if (fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
		log(`Cleaned directory: ${dir}`);
	}
}

function copyDirectory(src, dest) {
	execSync(`cp -r "${src}"/* "${dest}"/`, { stdio: 'inherit' });
	log(`Copied files from ${src} to ${dest}`);
}

function findBundleFiles(buildDir) {
	const staticCssDir = path.join(buildDir, '_expo', 'static', 'css');
	const staticJsDir = path.join(buildDir, '_expo', 'static', 'js', 'web');

	let entryFile = null;
	let cssFile = null;
	const bundles = [];

	if (fs.existsSync(staticJsDir)) {
		const jsFiles = fs.readdirSync(staticJsDir).filter((file) => file.endsWith('.js'));

		// Boot chunks must load before the entry bundle (order matters):
		// 1. __expo-metro-runtime — defines the __d module system
		// 2. __common — shared modules
		const runtimeFile = jsFiles.find((file) => file.startsWith('__expo-metro-runtime-'));
		const commonFile = jsFiles.find((file) => file.startsWith('__common-'));
		entryFile = jsFiles.find((file) => file.startsWith('entry-'));

		// Runtime and entry are required; common is optional
		const missing = [];
		if (!runtimeFile) missing.push('__expo-metro-runtime-*.js');
		if (!entryFile) missing.push('entry-*.js');
		if (missing.length > 0) {
			throw new Error(`Required Metro chunks missing from build output: ${missing.join(', ')}`);
		}

		bundles.push(`_expo/static/js/web/${runtimeFile}`);
		if (commonFile) bundles.push(`_expo/static/js/web/${commonFile}`);
		bundles.push(`_expo/static/js/web/${entryFile}`);
	}

	// Find the main CSS file
	if (fs.existsSync(staticCssDir)) {
		const cssFiles = fs.readdirSync(staticCssDir).filter((file) => file.endsWith('.css'));
		if (cssFiles.length > 0) {
			cssFile = cssFiles.find((file) => file.startsWith('web-')) || cssFiles[0];
		}
	}

	return { entryFile, bundles, cssFile };
}

function replaceChunkReferences(buildDir) {
	const staticJsDir = path.join(buildDir, '_expo', 'static', 'js', 'web');
	const UNIQUE_BASEURL_PLACEHOLDER = process.env.WCPOS_BASEURL_PLACEHOLDER;

	log(`Replacing chunk references with configurable CDN URLs`);

	if (!UNIQUE_BASEURL_PLACEHOLDER) {
		log('No baseUrl placeholder found, skipping chunk reference replacement');
		return;
	}

	if (!fs.existsSync(staticJsDir)) {
		log('No JavaScript files found to process');
		return;
	}

	const jsFiles = fs.readdirSync(staticJsDir).filter((file) => file.endsWith('.js'));
	let totalReplacements = 0;
	const escapedPlaceholder = UNIQUE_BASEURL_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	for (const file of jsFiles) {
		const filePath = path.join(staticJsDir, file);
		let content = fs.readFileSync(filePath, 'utf8');
		const originalContent = content;

		// Replace placeholder + /_expo paths with window.cdnBaseUrl + /_expo
		content = content.replace(
			new RegExp(`"${escapedPlaceholder}\\/_expo`, 'g'),
			`(window.cdnBaseUrl||"")+"/_expo`
		);

		// Replace placeholder + /assets paths with window.cdnBaseUrl + /assets
		content = content.replace(
			new RegExp(`"${escapedPlaceholder}\\/assets`, 'g'),
			`(window.cdnBaseUrl||"")+"/assets`
		);

		// Also handle the old pattern (without placeholder prefix) in case it still exists
		// Use negative lookbehind to avoid matching quotes that follow a '+' (already processed by placeholder patterns)
		content = content.replace(
			/(?<!\+)"\/_expo\/static\/js\/web\//g,
			`(window.cdnBaseUrl||"")+"/_expo/static/js/web/`
		);

		if (content !== originalContent) {
			fs.writeFileSync(filePath, content);

			// Count all types of replacements
			const placeholderExpoReplacements = (
				originalContent.match(new RegExp(`"${escapedPlaceholder}\\/_expo`, 'g')) || []
			).length;
			const placeholderAssetsReplacements = (
				originalContent.match(new RegExp(`"${escapedPlaceholder}\\/assets`, 'g')) || []
			).length;
			const oldPatternReplacements = (originalContent.match(/"\/_expo\/static\/js\/web\//g) || [])
				.length;

			const fileReplacements =
				placeholderExpoReplacements + placeholderAssetsReplacements + oldPatternReplacements;
			totalReplacements += fileReplacements;

			log(
				`Updated ${file}: ${placeholderExpoReplacements} _expo, ${placeholderAssetsReplacements} assets, ${oldPatternReplacements} old pattern references replaced`
			);
		}
	}

	log(`Total chunk references replaced: ${totalReplacements}`);
}

function replaceBaseUrlReferences(buildDir) {
	const staticJsDir = path.join(buildDir, '_expo', 'static', 'js', 'web');
	const UNIQUE_BASEURL_PLACEHOLDER = process.env.WCPOS_BASEURL_PLACEHOLDER;

	log(`Replacing baseUrl references with configurable window.baseUrl`);

	if (!UNIQUE_BASEURL_PLACEHOLDER) {
		log('No baseUrl placeholder found, skipping baseUrl replacement');
		return;
	}

	if (!fs.existsSync(staticJsDir)) {
		log('No JavaScript files found to process');
		return;
	}

	const jsFiles = fs.readdirSync(staticJsDir).filter((file) => file.endsWith('.js'));
	let totalReplacements = 0;

	for (const file of jsFiles) {
		const filePath = path.join(staticJsDir, file);
		let content = fs.readFileSync(filePath, 'utf8');

		// Replace the unique placeholder with window.baseUrl variable
		const originalContent = content;
		const escapedPlaceholder = UNIQUE_BASEURL_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		content = content.replace(new RegExp(`"${escapedPlaceholder}"`, 'g'), `(window.baseUrl||"")`);

		if (content !== originalContent) {
			fs.writeFileSync(filePath, content);
			const replacements = (originalContent.match(new RegExp(`"${escapedPlaceholder}"`, 'g')) || [])
				.length;
			totalReplacements += replacements;
			log(`Updated ${file}: ${replacements} baseUrl references replaced with configurable baseUrl`);
		}
	}

	log(`Total baseUrl references replaced: ${totalReplacements}`);
}

/**
 * Prepend the Metro runtime and common chunks into the entry bundle.
 *
 * Metro splits the output into __expo-metro-runtime, __common, and entry files.
 * The runtime defines `__d` (the module system) and must execute before any
 * chunk that calls `__d(...)`. Since the WP plugin loads a single bundle file
 * from metadata.json, we concatenate them in the correct order.
 */
function prependRuntimeChunks(buildDir) {
	const staticJsDir = path.join(buildDir, '_expo', 'static', 'js', 'web');
	if (!fs.existsSync(staticJsDir)) return;

	const jsFiles = fs.readdirSync(staticJsDir).filter((f) => f.endsWith('.js'));
	const runtimeFile = jsFiles.find((f) => f.startsWith('__expo-metro-runtime-'));
	const commonFile = jsFiles.find((f) => f.startsWith('__common-'));
	const entryFile = jsFiles.find((f) => f.startsWith('entry-'));

	if (!entryFile) {
		log('No entry file found, skipping runtime prepend');
		return;
	}

	const chunks = [runtimeFile, commonFile].filter(Boolean);
	if (chunks.length === 0) {
		log('No runtime/common chunks found, skipping prepend');
		return;
	}

	const entryPath = path.join(staticJsDir, entryFile);
	const entryContent = fs.readFileSync(entryPath, 'utf8');

	const chunkContents = chunks.map((chunkName) => {
		const chunkPath = path.join(staticJsDir, chunkName);
		return {
			name: chunkName,
			path: chunkPath,
			content: fs.readFileSync(chunkPath, 'utf8'),
		};
	});

	const prependContent = chunkContents.map((chunk) => chunk.content).join('\n');
	const mergedEntryContent = prependContent + '\n' + entryContent;
	const tempEntryPath = `${entryPath}.tmp-${process.pid}-${Date.now()}`;

	try {
		fs.writeFileSync(tempEntryPath, mergedEntryContent, 'utf8');
		fs.renameSync(tempEntryPath, entryPath);
	} catch (error) {
		if (fs.existsSync(tempEntryPath)) {
			fs.rmSync(tempEntryPath, { force: true });
		}
		throw error;
	}

	for (const chunk of chunkContents) {
		fs.unlinkSync(chunk.path);
		log(`Prepended and removed ${chunk.name}`);
	}
	log(`Prepended ${chunks.length} runtime chunk(s) into ${entryFile}`);
}

function generateMetadata(buildDir) {
	const { entryFile, bundles, cssFile } = findBundleFiles(buildDir);

	const metadata = {
		version: 1,
		bundler: 'metro',
		fileMetadata: {
			web: {},
		},
	};

	if (bundles.length > 0) {
		metadata.fileMetadata.web.bundles = bundles;
	}

	if (cssFile) {
		metadata.fileMetadata.web.css = `_expo/static/css/${cssFile}`;
	}

	const metadataPath = path.join(buildDir, 'metadata.json');
	fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
	log(`Generated metadata.json with ${bundles.length} bundles, css: ${cssFile}`);

	return metadata;
}

async function build() {
	try {
		log('Starting build process...');

		// Generate unique placeholder for baseUrl replacement (with leading slash for Expo)
		const timestamp = Date.now();
		const randomId = Math.random().toString(36).substring(2, 15);
		const UNIQUE_BASEURL_PLACEHOLDER = `/__WCPOS_BASEURL_PLACEHOLDER_${timestamp}_${randomId}__`;

		log(`Generated unique baseUrl placeholder: ${UNIQUE_BASEURL_PLACEHOLDER}`);

		// Clean and create build directory
		cleanDirectory(BUILD_DIR);
		ensureDirectoryExists(BUILD_DIR);

		// Clean any previous web-build in main app
		cleanDirectory(WEB_BUILD_DIR);

		// Clean .expo directory to prevent stale atlas.jsonl files
		const expoDir = path.join(MAIN_APP_DIR, '.expo');
		cleanDirectory(expoDir);

		// Check if Atlas should be enabled (opt-in via environment variable)
		const enableAtlas = process.env.ENABLE_EXPO_ATLAS === 'true';

		if (enableAtlas) {
			log('Running expo export with Atlas enabled (ENABLE_EXPO_ATLAS=true)...');
		} else {
			log('Running expo export (Atlas disabled by default due to stability issues)...');
			log('To enable Atlas, set ENABLE_EXPO_ATLAS=true environment variable');
		}

		// Run expo export from the main app directory with environment variables
		process.chdir(MAIN_APP_DIR);

		// Set environment variables for the expo export command
		const env = {
			...process.env,
			WCPOS_BASEURL_PLACEHOLDER: UNIQUE_BASEURL_PLACEHOLDER,
		};

		// Only enable Atlas if explicitly requested
		if (enableAtlas) {
			env.EXPO_UNSTABLE_ATLAS = 'true';
			env.DEBUG = 'expo:atlas*';
			log('Environment variables set:');
			log(`EXPO_UNSTABLE_ATLAS: ${env.EXPO_UNSTABLE_ATLAS}`);
			log(`DEBUG: ${env.DEBUG}`);
		}

		try {
			execSync('npx expo export --output-dir ./web-build --platform=web', {
				stdio: 'inherit',
				env: env,
			});
		} catch (error) {
			log(`Expo export failed: ${error.message}`);
			throw error;
		}

		// Check if Atlas files were generated and copy them
		log('Checking for Atlas output files...');
		const atlasFiles = [
			'.expo/atlas.jsonl',
			'atlas.jsonl',
			'_expo/atlas.jsonl',
			'web-build/atlas.jsonl',
		];
		let atlasFound = false;
		const foundAtlasFiles = [];

		for (const atlasFile of atlasFiles) {
			const atlasPath = path.join(MAIN_APP_DIR, atlasFile);
			if (fs.existsSync(atlasPath)) {
				log(`✓ Atlas file found: ${atlasPath}`);
				atlasFound = true;
				foundAtlasFiles.push(atlasPath);
			}
		}

		if (!atlasFound) {
			log('⚠️  No Atlas files found in expected locations');
			log('Atlas may not have been properly generated');
		}

		// Return to web app directory
		process.chdir(ROOT_DIR);

		log('Copying build files...');
		// Copy built files to our build directory
		copyDirectory(WEB_BUILD_DIR, BUILD_DIR);

		log('Prepending runtime chunks...');
		// Merge runtime and common chunks into entry bundle
		prependRuntimeChunks(BUILD_DIR);

		// Copy Atlas files if found
		if (foundAtlasFiles.length > 0) {
			log('Copying Atlas files...');
			for (const atlasFile of foundAtlasFiles) {
				const fileName = path.basename(atlasFile);
				const destPath = path.join(BUILD_DIR, fileName);
				try {
					fs.copyFileSync(atlasFile, destPath);
					log(`✓ Copied Atlas file: ${fileName} → ${destPath}`);
				} catch (error) {
					log(`Failed to copy Atlas file ${fileName}: ${error.message}`);
				}
			}
		}

		log('Processing chunk references...');
		// Set the placeholder in environment for both replacement functions
		process.env.WCPOS_BASEURL_PLACEHOLDER = UNIQUE_BASEURL_PLACEHOLDER;
		// Replace chunk references with CDN URLs
		replaceChunkReferences(BUILD_DIR);

		log('Processing baseUrl references...');
		// Replace baseUrl placeholder with configurable window.baseUrl
		replaceBaseUrlReferences(BUILD_DIR);

		log('Generating metadata...');
		// Generate metadata file
		const metadata = generateMetadata(BUILD_DIR);

		log('Build completed successfully!');
		log(`Files available in: ${BUILD_DIR}`);
		log(`Bundles: ${(metadata.fileMetadata.web.bundles || []).join(', ') || 'not found'}`);
		log(`CSS: ${metadata.fileMetadata.web.css || 'not found'}`);
	} catch (error) {
		console.error('[build] Error:', error.message);
		process.exit(1);
	}
}

// Run the build
build();
