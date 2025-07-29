#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4567;
const BUILD_DIR = path.join(__dirname, '..', 'build');

// MIME types for the files we serve
const MIME_TYPES = {
	'.js': 'application/javascript',
	'.css': 'text/css',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.ttf': 'font/ttf',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
};

function getMimeType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	return MIME_TYPES[ext] || 'application/octet-stream';
}

function log(message) {
	console.log(`[dev-server] ${message}`);
}

const server = http.createServer((req, res) => {
	// Parse URL and remove query parameters
	const urlPath = req.url.split('?')[0];

	// Log the request
	log(`${req.method} ${urlPath}`);

	// Add CORS headers for development
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

	// Handle preflight requests
	if (req.method === 'OPTIONS') {
		res.writeHead(200);
		res.end();
		return;
	}

	// Only handle GET and HEAD requests
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		res.writeHead(405, { 'Content-Type': 'text/plain' });
		res.end('Method Not Allowed');
		return;
	}

	// Construct file path
	let filePath;
	if (urlPath === '/build' || urlPath === '/build/') {
		// Serve metadata.json for /build requests
		filePath = path.join(BUILD_DIR, 'metadata.json');
	} else if (urlPath.startsWith('/build/')) {
		// Remove /build prefix and serve the file
		const relativePath = urlPath.substring('/build/'.length);
		filePath = path.join(BUILD_DIR, relativePath);
	} else {
		// Not a build request
		res.writeHead(404, { 'Content-Type': 'text/plain' });
		res.end('Not Found - This server only serves /build/* paths');
		return;
	}

	// Security check: make sure file is within BUILD_DIR
	const normalizedPath = path.resolve(filePath);
	const normalizedBuildDir = path.resolve(BUILD_DIR);

	if (!normalizedPath.startsWith(normalizedBuildDir)) {
		res.writeHead(403, { 'Content-Type': 'text/plain' });
		res.end('Forbidden - Path traversal not allowed');
		return;
	}

	// Check if file exists and serve it
	fs.stat(filePath, (err, stats) => {
		if (err || !stats.isFile()) {
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end(`File not found: ${urlPath}`);
			return;
		}

		const mimeType = getMimeType(filePath);
		const fileStream = fs.createReadStream(filePath);

		res.writeHead(200, {
			'Content-Type': mimeType,
			'Content-Length': stats.size,
			'Cache-Control': 'no-cache, no-store, must-revalidate', // Disable caching for development
		});

		fileStream.pipe(res);

		fileStream.on('error', (error) => {
			log(`Error serving file ${filePath}: ${error.message}`);
			if (!res.headersSent) {
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.end('Internal Server Error');
			}
		});
	});
});

server.listen(PORT, () => {
	log(`Development server running on http://localhost:${PORT}`);
	log(`Build directory: ${BUILD_DIR}`);
	log('Available endpoints:');
	log(`  GET http://localhost:${PORT}/build                    -> metadata.json`);
	log(`  GET http://localhost:${PORT}/build/metadata.json      -> metadata.json`);
	log(`  GET http://localhost:${PORT}/build/_expo/static/...   -> JS/CSS files`);
	log('');
	log('Set window.cdnBaseUrl = "http://localhost:' + PORT + '/build" in your application');
	log('Press Ctrl+C to stop the server');
});

server.on('error', (error) => {
	if (error.code === 'EADDRINUSE') {
		log(
			`Port ${PORT} is already in use. Try a different port with: PORT=5678 node scripts/dev-server.js`
		);
	} else {
		log(`Server error: ${error.message}`);
	}
	process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
	log('Shutting down development server...');
	server.close(() => {
		log('Development server stopped');
		process.exit(0);
	});
});

process.on('SIGTERM', () => {
	log('Shutting down development server...');
	server.close(() => {
		log('Development server stopped');
		process.exit(0);
	});
});
