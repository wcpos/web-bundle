#!/usr/bin/env node
/* eslint-env node */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

const PORT = 3001;
const COLOR_PALETTE_PATH = path.join(__dirname, '..', 'color-palette.html');

// Simple static server for the color palette
const server = http.createServer(async (req, res) => {
	try {
		const html = await fs.readFile(COLOR_PALETTE_PATH, 'utf-8');
		res.writeHead(200, { 'Content-Type': 'text/html' });
		res.end(html);
	} catch (error) {
		console.error('Error serving color palette:', error);
		res.writeHead(500);
		res.end('Internal server error');
	}
});

server.listen(PORT, () => {
	const url = `http://localhost:${PORT}`;
	console.log(`\n🎨 Color Palette Server running at ${url}\n`);
	console.log('Press Ctrl+C to stop\n');

	// Try to open the browser automatically
	const platform = process.platform;
	const openCommand = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';

	exec(`${openCommand} ${url}`, (error) => {
		if (error) {
			console.log('Could not open browser automatically. Please open manually.');
		}
	});
});
