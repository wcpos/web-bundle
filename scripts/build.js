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

	let bundleFile = null;
	let cssFile = null;

	// Find the main entry bundle file
	if (fs.existsSync(staticJsDir)) {
		const bundleFiles = fs.readdirSync(staticJsDir).filter((file) => file.endsWith('.js'));
		if (bundleFiles.length > 0) {
			// Look for entry file first
			bundleFile = bundleFiles.find((file) => file.startsWith('entry-')) || bundleFiles[0];
		}
	}

	// Find the main CSS file
	if (fs.existsSync(staticCssDir)) {
		const cssFiles = fs.readdirSync(staticCssDir).filter((file) => file.endsWith('.css'));
		if (cssFiles.length > 0) {
			// Look for web file
			cssFile = cssFiles.find((file) => file.startsWith('web-')) || cssFiles[0];
		}
	}

	return { bundleFile, cssFile };
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
		content = content.replace(
			/"\/_expo\/static\/js\/web\//g,
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

function generateMetadata(buildDir) {
	const { bundleFile, cssFile } = findBundleFiles(buildDir);

	const metadata = {
		version: 0,
		bundler: 'metro',
		fileMetadata: {
			web: {},
		},
	};

	if (bundleFile) {
		metadata.fileMetadata.web.bundle = `_expo/static/js/web/${bundleFile}`;
	}

	if (cssFile) {
		metadata.fileMetadata.web.css = `_expo/static/css/${cssFile}`;
	}

	const metadataPath = path.join(buildDir, 'metadata.json');
	fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
	log(`Generated metadata.json with bundle: ${bundleFile}, css: ${cssFile}`);

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
		log(`Bundle: ${metadata.fileMetadata.web.bundle || 'not found'}`);
		log(`CSS: ${metadata.fileMetadata.web.css || 'not found'}`);
	} catch (error) {
		console.error('[build] Error:', error.message);
		process.exit(1);
	}
}

// Run the build
build();
