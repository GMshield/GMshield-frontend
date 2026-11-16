# GMshield-frontend

Web interface for GMshield, built as a Backend for Frontend. Stack: Next.js (App Router) and React
in TypeScript, on Node.js. The browser talks only to this application; only its server-side code
under `src/server` calls the backend.

## Versions

Checked on 2026-11-13 (Story 1.8's additions on 2026-11-16): each is the newest release at least
two weeks old that day. Every
dependency is pinned exactly and `package-lock.json` is committed.

| What | Version | Where it is set |
|---|---|---|
| Node.js | 26.13.0 LTS | `package.json` (`engines`), `Dockerfile` |
| Next.js | 16.4.3 | `package.json` |
| React and React DOM | 19.2.9 | `package.json` |
| TypeScript | 7.0.2 | `package.json` |
| Vitest and its V8 coverage | 5.0.5 | `package.json` |
| openapi-typescript (type generator) | 7.13.0 | `package.json` |
| openapi-fetch (typed client) | 0.17.0 | `package.json` |
| TypeScript 6 companion (`@typescript/typescript6`) | 6.0.2 | `package.json` |
| ESLint, with `eslint-config-next` | 10.14.0, 16.4.3 | `package.json` |
| DM Sans, `@fontsource-variable/dm-sans` (OFL-1.1) | 5.3.0 | `package.json` |
| jsdom (component tests) | 30.1.3 | `package.json` |
| Testing Library: react, dom, user-event | 16.3.3, 10.4.2, 14.6.8 | `package.json` |
| sharp (measures the backdrop in `test/contrast.test.ts` only) | 0.35.5 | `package.json` |
| Build and runtime image | `node:26.13.0-alpine3.24`, pinned by digest | `Dockerfile` |

## Structure

| Path | Holds |
|---|---|
| `src/app` | pages and route handlers (App Router); `not-found.tsx` is the single not-found page |
| `src/app/styles/tokens.css` | the design tokens: primitives, and the roles of each theme |
| `src/app/globals.css` | base styles, the focus ring, reduced motion, the illustrated backdrop under its scrim |
| `src/app/assets` | images bundled into `/_next/static`: `backdrop.webp`, the illustrated theme's backdrop |
| `src/app/preferences-action.ts` | the Server Action that stores theme and language |
| `src/components` | the base components, each with its CSS Module: `PillButton` (and `SolidPillButton`), `ConfirmationDialog`, `Notice`, `PreferencesForm` |
| `src/preferences.ts` | the preference cookies: names, allowlists, reading them for a request |
| `src/server` | server-only code: settings, logs, trace context, the backend client, the contract check. Every module starts with `import 'server-only'`, so `next build` fails when a client component imports one |
| `src/server/backend` | the typed backend client; `generated/` holds the generated types (not committed) |
| `src/messages` | every user-facing string, `pt-BR.json` and `en.json`, keyed by screen |
| `src/proxy.ts` | runs before every request (Next.js Proxy) |
| `src/instrumentation.ts` | the start-up check of the settings |
| `contracts/public.json` | the frontend's copy of the backend's public OpenAPI document |
| `stand-in-backend/` | a tiny Node server that answers the contract with examples, for test mode |
| `test/` | Vitest tests |

Next.js finds `proxy.ts` and `instrumentation.ts` only next to `app/`, so with the `src/` layout
they sit in `src/`.

- **Backend calls.** `src/server/backend/client.ts` builds a new client for every request, never
  caches (`cache: 'no-store'`), gives up after 2 seconds, and sends only `accept`,
  `accept-language`, `content-type` and `traceparent`. It forwards the request's W3C `traceparent`
  with a new span id, or starts a new trace. No browser code calls the backend, and no
  `NEXT_PUBLIC_` variable exists.
- **Proxy.** Every answer except Next.js's static files (`/_next/static`, `/_next/image` and
  `/favicon.ico`, which the proxy's matcher skips) carries `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that
  turns off camera, microphone and geolocation, and a Content-Security-Policy that
  allows the site's own origin only, with a new nonce per request for the inline scripts and
  styles of Next.js (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`). POST, PUT, PATCH and DELETE are refused with the 403 problem detail
  `request.cross_origin` unless `Origin` is the site's own origin, or, without `Origin`,
  `Sec-Fetch-Site` is `same-origin`. Behind a proxy that ends TLS, `X-Forwarded-Proto` gives the
  scheme of the site's origin.
- **Health.** `GET /api/health` answers 200 `{"status":"UP"}` only when the backend's
  `/api/v1/version` is at least `MINIMUM_BACKEND_CONTRACT_VERSION` (`src/server/contract.ts`), and
  503 `{"status":"DOWN"}` otherwise or when the backend does not answer within 2 seconds.
- **Logs.** One JSON object per line with `timestamp`, `level`, `traceId`, `unit` and `event`,
  then ids, numbers, versions or error types: never content, never a secret.
- **Preferences.** Theme and language are kept before sign-in in two cookies,
  `__Host-gmshield-theme` (`illustrated`, `dark`, `light`) and `__Host-gmshield-lang` (`pt-BR`,
  `en`), both `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, for one year. The root layout reads
  them on every request and renders `<html lang data-theme>`, so no client script runs and the
  wrong theme never flashes. A value off the allowlist is ignored: the theme falls back to
  `illustrated` and the language to the browser's `Accept-Language` (Portuguese by default).
  `PreferencesForm` (two radio groups and "Aplicar") posts to the Server Action
  `savePreferences`, which sets both cookies. Nothing is stored in the backend yet (Epic 8).
- **Text.** `translator(language)` gives `t(path, params)`, with `{name}` placeholders.
  `errorText(problem, language)` turns a problem detail into text: the code's text, else its
  category's (`request`, `server`, `integrity`), else the generic `server` text; a code is never
  shown. `notFoundFor(problem)` (`src/app/not-found.tsx`) renders "Não encontrado." for
  `request.not_found` and for any 403, so another owner's item looks like a missing one.

## Design tokens and themes

`src/app/styles/tokens.css` turns DESIGN.md into CSS custom properties. Primitives keep the
sampled values under DESIGN.md's names (`--dark-canvas`, `--light-accent`, ...). Each theme maps
them to the same roles under `:root[data-theme='illustrated' | 'dark' | 'light']`:
`--color-canvas`, `--color-surface`, `--color-text`, `--color-text-muted`, `--color-accent`, the
status colours, the pill roles (`--color-control`, `--color-control-border`, `--color-solid`,
`--color-on-solid`), `--color-scrim`, `--color-dim` and more. Beside them: `--font-<role>-size`,
`-weight` and `-line-height`, `--space-*` (with `--space-touch-target: 44px`), `--radius-*`,
`--width-*` and `--motion-slide` (0ms under `prefers-reduced-motion`).

- Components use roles only, from CSS files (global CSS and CSS Modules): the CSP blocks `style`
  attributes. No hex value or primitive appears outside `tokens.css`.
- No shadows, and the accent is never a fill: it draws the focus ring
  (`:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`) and marks.
- Every control has a hit area of at least 44px.
- The illustrated theme draws a uniform scrim over the backdrop, with glass surfaces that blur
  where the browser supports `backdrop-filter` (and are more opaque where it does not). The
  scrim's strength is set by the brightest pixel of the whole backdrop, so text keeps 4.5:1 at
  every width and crop.
- `test/contrast.test.ts` parses `tokens.css` and checks every text pair, the status colours on
  the surface and the pill pairs at 4.5:1 or better in each theme, and, with sharp, the brightest
  backdrop pixel under the scrim and under the glass. It also checks that the stylesheets keep
  the rules above.
- The backdrop, `src/app/assets/backdrop.webp` (1280x720 pixel art, drawn without smoothing), was
  supplied by Dalton on 2026-11-16: a generated image with no third-party licence. Its brightest
  pixel is near white (`#FFFEE0`), so the scrim is `--illustrated-scrim` at 72%: 8.0:1 for the
  text and 5.2:1 for the secondary text over that pixel.
- DM Sans is bundled from `@fontsource-variable/dm-sans` into `/_next/static`; nothing loads from
  another host.

## Backend types

The request and response types come from `contracts/public.json`, generated by
`openapi-typescript` into `src/server/backend/generated/public.d.ts` on every `build`, `test` and
`typecheck` (`npm run generate:types`). They are never edited or written by hand, and are not
committed. `openapi-fetch` is the typed client.

`openapi-typescript` needs the TypeScript compiler API, which TypeScript 7 does not have. The
script runs it with `scripts/use-typescript6.mjs`, which resolves `typescript` to the TypeScript 6
companion `@typescript/typescript6` for that process only; ESLint's TypeScript parser runs the same
way (`npm run lint`). The project itself compiles with TypeScript 7. `package.json` overrides
openapi-typescript's `typescript` peer range (`^5.x`) so that npm accepts the install.

### Refresh `contracts/public.json`

The file is a copy of `GMshield-backend/openapi/public.json`. When the backend's public contract
changes:

```sh
cp ../GMshield-backend/openapi/public.json contracts/public.json
npm test && npm run build
```

When the frontend needs something the new version added, raise `MINIMUM_BACKEND_CONTRACT_VERSION`
in `src/server/contract.ts` in the same change.

## Settings

Read from the environment and checked when the server starts. A refused start writes one log line
that names the settings, never a value, and exits with status 78.

| Setting | Meaning |
|---|---|
| `GMSHIELD_BACKEND_URL` | the backend's address, `http` or `https` (required outside test mode) |
| `GMSHIELD_MODE` | unset, or `test` |

`GMSHIELD_MODE=test` is set only by the pipeline, never in `.gmshield/pipeline.toml`. It needs no
secret, and the backend is `http://stand-in-backend:8080` unless `GMSHIELD_BACKEND_URL` is set:
the `stand-in-backend` image of this repository, which answers every path of
`contracts/public.json` with a valid example and any other path with a 404 problem detail. Until
Story 1.4 makes the pipeline start the frontend in test mode beside it, the pipeline starts the
frontend without `GMSHIELD_MODE` or `GMSHIELD_BACKEND_URL`, so the start is refused (exit 78) and
the staging stage fails, as the backend's does.

## Build and run

With Node.js 26.13.0:

```sh
npm ci
npm test               # Vitest (components in jsdom), including the build guard: a real `next build`
                       # of a scratch copy, then its server, fetched with each theme cookie
npm run lint
npm run typecheck
npm run build          # .next/standalone
```

To work on the whole application, use the shared development setup in
`GMshield-backend/dev` (`dev/start`), which starts the frontend after the backend. For a
frontend-only loop beside the stand-in backend:

```sh
npm run stand-in-backend &                                   # http://127.0.0.1:8080
GMSHIELD_BACKEND_URL=http://127.0.0.1:8080 npm run dev       # http://127.0.0.1:3000
```

The images:

```sh
docker build --target test .
docker build --target test-reports --output type=local,dest=out .   # out/junit/, out/lcov.info
docker build --target stand-in-backend -t gmshield-stand-in-backend .
docker build -t gmshield-frontend .
docker run --rm --read-only --tmpfs /tmp -e GMSHIELD_BACKEND_URL=http://backend:8080 gmshield-frontend
```

The production image runs `node server.js` from the standalone output as UID 10001 and writes
nothing outside `/tmp`, so its root filesystem can be read-only.

## Branches and delivery

| Branch | What happens on push |
|---|---|
| `develop` | roberto-server runs unit tests, secret scan, SAST, SCA/SBOM/IaC, image scan and an active DAST scan; the quality gate decides whether this code may go to `main`. |
| `main` | Only code that already passed on `develop` is accepted. roberto-server builds and publishes the production image, deploys it, runs a passive DAST scan, and rolls back on failure. |

Work on feature branches, merge into `develop`, then open a pull request from `develop` to `main`.
Reports for every run are kept by the pipeline; see [GMshield-pipeline](https://github.com/GMshield/GMshield-pipeline).

## Pipeline contract

In production (Story 1.6) the frontend publishes no host port and joins the internal networks
`gmshield-edge` and `gmshield-app` only, so it has no internet; it reaches the backend over HTTP at
`http://gmshield-backend:8080` (`GMSHIELD_BACKEND_URL` in `~/gmshield-ci/secrets/frontend.env`). It
runs as 10001 with a read-only root filesystem and every capability dropped.

The pipeline reads [`.gmshield/pipeline.toml`](.gmshield/pipeline.toml) and builds the multi-stage
`Dockerfile`: `test` runs the lint, type check, unit tests and `next build`; `test-reports` holds
the JUnit results and `lcov.info`; `stand-in-backend` is the test-mode backend; the production
image is the last stage. The health check is `GET /api/health`.
