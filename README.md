<div align="center">
  <h1><a href="https://wcpos.com">WooCommerce POS</a> Web Bundle</h1>
  <p>The pre-built JavaScript bundle of the WCPOS web app — distributed via the jsDelivr CDN.</p>
  <p>
    <a href="https://github.com/wcpos/web-bundle/tags">
      <img src="https://img.shields.io/github/v/tag/wcpos/web-bundle?sort=semver&label=version" alt="Latest version" />
    </a>
    <a href="https://www.jsdelivr.com/package/gh/wcpos/web-bundle">
      <img src="https://img.shields.io/jsdelivr/gh/hm/wcpos/web-bundle?label=jsDelivr%20hits%2Fmonth" alt="jsDelivr hits" />
    </a>
    <a href="#-license">
      <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
    </a>
    <a href="https://wcpos.com/discord">
      <img src="https://img.shields.io/discord/711884517081612298?color=%237289DA&label=WCPOS&logo=discord&logoColor=white" alt="Discord Chat" />
    </a>
  </p>
  <p>
    <a href="#-about"><b>About</b></a>
    &ensp;&mdash;&ensp;
    <a href="#-how-its-consumed"><b>How it's consumed</b></a>
    &ensp;&mdash;&ensp;
    <a href="#-how-its-built"><b>How it's built</b></a>
    &ensp;&mdash;&ensp;
    <a href="#-local-testing"><b>Local testing</b></a>
  </p>
</div>

## 💡 About

This repository holds the **pre-built web export of the WooCommerce POS app** (the React Native + Expo / Metro web build), versioned with git tags and served straight from the [jsDelivr](https://www.jsdelivr.com/) CDN. The [WCPOS WordPress plugin](https://github.com/wcpos/woocommerce-pos) loads this bundle to render the POS inside WordPress.

> This is a **distribution repository**, not app source. The application source lives in the [WCPOS monorepo](https://github.com/wcpos/monorepo) under `apps/main`; the contents of [`build/`](./build) are generated from there and committed here. Don't hand-edit `build/`.

## 📦 How it's consumed

jsDelivr serves any tagged path in this repo. The consumer first fetches [`build/metadata.json`](./build/metadata.json) to discover the content-hashed entry bundle and CSS filenames, then loads them:

```
https://cdn.jsdelivr.net/gh/wcpos/web-bundle@<version>/build/metadata.json
https://cdn.jsdelivr.net/gh/wcpos/web-bundle@<version>/build/_expo/static/js/web/entry-<hash>.js
```

Pinning to a git tag (e.g. `@v1.9.0`) gives a stable, immutable URL.

The bundle is **path-portable**: every internal asset and chunk URL resolves against a runtime global rather than a baked-in origin, so the same build works from jsDelivr, a local dev server, or inside Electron. The consumer sets:

- `window.cdnBaseUrl` — the base every `/_expo/…` and `/assets/…` URL is prefixed with.
- `window.baseUrl` — the app's base URL.

## 🗂 Contents

```
build/                 # the distributed bundle (committed)
  index.html           #   Expo app shell
  metadata.json        #   manifest: hashed entry-bundle + CSS filenames (read by the WP plugin)
  opfs.worker.js       #   OPFS storage worker (web)
  _expo/static/        #   content-hashed JS chunks + CSS
  assets/              #   fonts and images
scripts/
  build.js             # the build pipeline (run from the monorepo — see below)
  dev-server.js        # zero-dependency static server for local testing (port 4567)
  serve-colors.js      # serves color-palette.html (port 3001)
tests/                 # node:test unit tests for the build pipeline
color-palette.html     # standalone design-system / colour-token reference page
```

> The legacy `build/indexeddb.worker.js` is intentionally **git-ignored but preserved** on disk across rebuilds (the build script carries it forward), so older clients mid-migration keep working.

## 🏗 How it's built

[`scripts/build.js`](./scripts/build.js) is the producer, and it runs **from the monorepo's `apps/web` directory** (it resolves the app at `../main`). In outline it:

1. runs `expo export --platform web` against `apps/main` with a unique base-URL placeholder,
2. prepends Metro's runtime + common chunks into the single `entry-*.js` (so the plugin only has to load one file),
3. rewrites the placeholder paths to the `window.cdnBaseUrl` / `window.baseUrl` runtime globals, and
4. regenerates `metadata.json` from the freshly-hashed filenames.

In practice you don't run this by hand: the monorepo's **`publish-web-bundle`** workflow builds `apps/web` and publishes the result to this repo for jsDelivr.

## 🧪 Local testing

To serve the committed bundle locally and point the app at it:

```bash
pnpm dev        # serves build/ at http://localhost:4567/build (CORS-enabled, no-cache)
```

Then set `window.cdnBaseUrl = "http://localhost:4567/build"` in the app.

```bash
pnpm colors     # opens the colour-palette reference at http://localhost:3001
node --test tests/*.test.js   # run the build-pipeline unit tests
```

## 🌿 Branches

This repo follows a two-trunk model (see [`AGENTS.md`](./AGENTS.md)):

- **`main`** — the stable, released line (patch releases ship from here).
- **`next`** — the in-development line for the next minor/major.

Feature work targets `next`; patches target `main`.

## 🔗 Links

- 🌐 Website — [wcpos.com](https://wcpos.com)
- 📦 App source (monorepo) — [github.com/wcpos/monorepo](https://github.com/wcpos/monorepo)
- 🔌 WordPress plugin (the consumer) — [github.com/wcpos/woocommerce-pos](https://github.com/wcpos/woocommerce-pos)
- 📡 jsDelivr package — [jsdelivr.com/package/gh/wcpos/web-bundle](https://www.jsdelivr.com/package/gh/wcpos/web-bundle)
- 💬 Discord — [wcpos.com/discord](https://wcpos.com/discord)

## 📄 License

MIT © Paul Kilmurray
