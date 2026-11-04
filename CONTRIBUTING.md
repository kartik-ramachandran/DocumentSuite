# Contributing

Thanks for helping out. Bug reports, fixes and new features are all welcome. For a large change, please open an issue first so we can agree on the approach.

## Never commit real documents

**Test files must be synthetic.** Don't commit customer documents, or anything else containing personal or confidential data, even temporarily, because Git keeps it in history after it's deleted. The tests generate their own files.

## Setup

You need the [.NET 10 SDK](https://dotnet.microsoft.com/download), [Node.js](https://nodejs.org) 24 or later and Docker.

```bash
# Start the API at http://localhost:8080
docker compose up -d --build

# API tests
dotnet test backend/PdfAI.API.Tests/PdfAI.API.Tests.csproj

# Viewer: build it, then run the browser tests against the React, Vue and Angular demos
cd viewer
npm install
npm run build
npm run build:examples
npx playwright install chromium
npm test
```

The browser tests that need the API are skipped if it isn't running at `localhost:8080`.

## Layout

| Path | Contents |
|---|---|
| `backend/PdfAI.API` | The REST API and MCP server (ASP.NET Core) |
| `backend/PdfAI.API.Tests` | API unit and integration tests |
| `viewer/packages/core` | The framework-independent viewer |
| `viewer/packages/editor` | Optional annotations, form filling and document tools |
| `viewer/packages/react`, `vue`, `angular` | Thin framework wrappers |
| `viewer/examples` | A demo for each framework, also used by the browser tests |
| `viewer/e2e` | Browser tests, which run against all three demos |

## Pull requests

- Add or update tests for any change in behaviour, and make sure all the tests pass.
- Keep framework-specific code in the wrappers. Viewer behaviour belongs in `core` or `editor`, so all three frameworks get it.
- Prefer dependencies with permissive licenses (MIT, BSD, Apache-2.0), and update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when you add one. AGPL dependencies can't be accepted, so avoid MuPDF, pdf2docx and Ghostscript.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).

## Releases and the website

From the `viewer` folder:

| Command | What it does |
|---|---|
| `npm run pack` | Builds the installable package files in `viewer/release`, to attach to a GitHub release |
| `npm run site` | Builds the website and its live demo in `_site` |
| `npm run site:deploy` | Publishes `_site` to the `gh-pages` branch |
| `npm run screenshots` | Retakes the screenshots in `docs/screenshots` |

To publish a new version to npm, raise the version in each package, run `npm run build`, then publish in this order, because the later packages depend on the earlier ones:

```bash
npm publish --access public -w @document-suite/viewer
npm publish --access public -w @document-suite/editor
npm publish --access public -w @document-suite/react
npm publish --access public -w @document-suite/vue
cd packages/angular/dist
npm publish --access public
```
