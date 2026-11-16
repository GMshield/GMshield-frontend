# GMshield-frontend

Web interface for GMshield, built as a Backend for Frontend. Stack: Next.js (App Router) and React
in TypeScript, on Node.js. The browser talks only to this application; only its server-side code
under `src/server` calls the backend.

## Versions

Checked on 2026-11-13 (Story 1.8's additions on 2026-11-16): each is the newest release at least
two weeks old that day. Every dependency is pinned exactly and `package-lock.json` is committed.

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
| `src/app/sign-in` | the start of a sign-in (`google/route.ts`), the clearing of an ended session's cookie (`ended/route.ts`), the Server Actions of the username step and sign-out (`actions.ts`), the username page, and the allowlist of outcomes `/` may show (`notice.ts`) |
| `src/app/auth/google/callback/route.ts` | the Route Handler Google redirects to; it relays the redirect to the backend |
| `src/app/session/renew/route.ts` | renews the session token when the backend asks for it (`session.renewal_required`) and goes back to the page |
| `src/app/terms`, `src/app/privacy` | the draft terms of use and privacy notice, marked "Rascunho / Draft" |
| `src/components` | the base components, each with its CSS Module: `PillButton` (and `SolidPillButton`), `ConfirmationDialog`, `Notice`, `PreferencesForm`, `UsernameForm` |
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
  `accept-language`, `content-type`, `traceparent` and `x-session-token`, plus
  `Authorization: Bearer <GMSHIELD_FRONTEND_CREDENTIAL>` (Story 1.10), which comes from the settings
  and never from the incoming request: the backend refuses every `/api/v1` call without it
  (`service.unauthenticated`). It forwards the request's W3C `traceparent`
  with a new span id, or starts a new trace. No browser code calls the backend, and no
  `NEXT_PUBLIC_` variable exists.
- **Proxy.** Every answer except Next.js's static files (`/_next/static`, `/_next/image` and
  `/favicon.ico`, which the proxy's matcher skips) carries `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that
  turns off camera, microphone and geolocation, and a Content-Security-Policy that
  allows the site's own origin only, with a new nonce per request for the inline scripts and
  styles of Next.js (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self' https://accounts.google.com`: the sign-in form's post is answered with a
  redirect to Google). POST, PUT, PATCH and DELETE are refused with the 403 problem detail
  `request.cross_origin` unless `Origin` is the site's own origin, or, without `Origin`,
  `Sec-Fetch-Site` is `same-origin`. Behind a proxy that ends TLS, `X-Forwarded-Proto` gives the
  scheme of the site's origin. The proxy also renews the session token (below).
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
  Browsers keep `__Host-` (`Secure`) cookies only over HTTPS or on localhost: over plain HTTP on
  another host the choice is silently dropped. Production is reached only through the HTTPS tunnel.
- **Sign-in with Google (Story 1.9).** The backend alone talks to Google; the frontend relays.
  - `/` signed out is the sign-in screen: "Continuar com Google" (the one solid pill), links to the
    two drafts, and the preferences form. The pill is a plain form post to `POST /sign-in/google`
    (a Route Handler, so the browser always navigates in full): it asks the backend for an attempt
    (`POST /api/v1/sign-in/google`), keeps the attempt token in `__Host-gmshield-sign-in` (600 s)
    and answers 303 to the authorization URL, only when it is Google's
    (`https://accounts.google.com`) or the frontend's own callback path, `/auth/google/callback?…`.
    That same-origin path is what the backend's test-mode stand-in sends; it is accepted in any mode
    and is harmless, since it only leads back to this site.
  - `GET /auth/google/callback` (a top-level GET, so the `SameSite=Lax` cookie comes along and the
    proxy's same-origin rule, which covers state-changing methods only, lets it through) sends the
    cookie's token with `state`, `code` or `error` to `POST /api/v1/sign-in/google/callback`. A known
    account: the session token goes into `__Host-gmshield-session` and the visitor lands on `/`, or
    on the page an ended session left (below). A first sign-in: `/sign-in/username`. Anything else: `/?signIn=<code>`, the attempt cookie
    cleared. `/` shows only the codes listed in `src/app/sign-in/notice.ts`.
  - `/sign-in/username`: the username and the acceptance of the terms and the privacy notice
    (`UsernameForm`, `useActionState`, which also works without JavaScript). A taken or invalid
    username, or unticked terms, come back under the field; an attempt that is over goes back to
    the sign-in screen.
  - `/` signed in: `GET /api/v1/me` with the session token in `X-Session-Token` gives "Olá,
    <username>", the preferences form and "Sair", whose action calls `DELETE /api/v1/session` and
    clears the cookie. An ended session (`session.required`) goes through `GET /sign-in/ended`,
    which clears the stale session cookie and answers 303 to the sign-in screen with "Sua sessão
    terminou.".
  - Every sign-in cookie is `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and is cleared
    by setting it again with the same attributes and `Max-Age=0`. Nothing logs a token, a code, an
    email address or a username.
- **Sessions that rotate and end (Story 1.10).**
  - `__Host-gmshield-session` holds `<token>.<renew-after in epoch seconds>`, for `expiresInSeconds`
    of the backend's grant (what is left of the session's 7 days). A value without the suffix (Story
    1.9) is due for renewal at once. In the session's last renew-after window the backend grants a
    renew-after equal to what is left, and the cookie never gets one beyond its own life, so the
    last window does not renew on every request.
  - `src/proxy.ts` renews a due token on a document visit (a GET or HEAD with
    `Sec-Fetch-Dest: document`, or with no `Sec-Fetch-Dest` header at all, from an older browser) or
    a Server Action (a POST with `Next-Action`), except on `/sign-in`, `/auth`, `/api/health` and
    `/session/renew`: `POST /api/v1/session/renewal` with the old token. On success the new cookie
    is set on the answer and the request goes on with the new token in its own cookie header, so
    nothing visible changes. `session.already_renewed` (another request renewed first) or a backend
    that does not answer: the request goes on with the token it has. `session.required` on a
    document visit: 303 to `/sign-in/ended?next=<path and query>`.
  - Every other request passes through unchanged: router RSC fetches, prefetches and any other
    `fetch` (`Sec-Fetch-Dest: empty`). The router may drop such an answer, and a renewed cookie with
    it, which would leave a token that turns stale once the overlap ends; its page, route or action
    meets the backend's answer itself. Next.js removes its own router headers (`rsc`,
    `next-router-prefetch`) before the proxy runs, so the proxy goes by `Sec-Fetch-Dest` and
    `Next-Action`, which reach it.
  - Only sign-in and renewal replace a token. When the backend answers `session.renewal_required`
    (the account's seal version rose), `/` sends the browser to `GET /session/renew?next=/`, which
    renews, sets the cookie and goes back; any failure there ends at `/sign-in/ended`.
  - `/sign-in/ended?next=` keeps a safe `next` for an hour in `__Host-gmshield-return`; the next
    sign-in (Google's callback or the username step) lands there and clears it. A `next` that is not
    a path of this site (`//host`, `\`, a scheme, control characters) or that names `/sign-in`,
    `/auth`, `/api` or `/session/renew` becomes `/`.
  - `/terms` and `/privacy` are short drafts in both languages, headed "Rascunho / Draft"; Epic 10
    replaces them.
- **Text.** `translator(language)` gives `t(path, params)`, with `{name}` placeholders.
  `errorText(problem, language)` turns a problem detail into text: the code's text, else its
  category's (`request`, `server`, `integrity`, `session`, `service`), else the generic `server` text; a code is never
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

Deploy order for public contract 1.1.0 (Story 1.9): first fill `GMSHIELD_GOOGLE_CLIENT_ID` and
`GMSHIELD_GOOGLE_CLIENT_SECRET` in `~/gmshield-ci/secrets/backend.env`, then deploy the backend (it
refuses to start without them), then the frontend (its health check fails against a 1.0.0 backend).

Deploy order for public contract 1.2.0 (Story 1.10): first run GMshield-pipeline's
`deploy/data-credentials.sh`, which writes the same `GMSHIELD_FRONTEND_CREDENTIAL` into `backend.env`
and `frontend.env`, then deploy the backend (it refuses to start without the credential, and refuses
every `/api/v1` call of an older frontend), then the frontend (its health check fails against a 1.1.0
backend).

## Settings

Read from the environment and checked when the server starts. A refused start writes one log line
that names the settings, never a value, and exits with status 78.

| Setting | Meaning |
|---|---|
| `GMSHIELD_BACKEND_URL` | the backend's address, `http` or `https` (required outside test mode) |
| `GMSHIELD_FRONTEND_CREDENTIAL` | the service credential sent as `Authorization: Bearer` on every backend call (required outside test mode, secret): 32 to 512 characters of `A-Z a-z 0-9 . _ ~ + / = -`, the same value as the backend's, written by GMshield-pipeline's `deploy/data-credentials.sh` into `frontend.env` |
| `GMSHIELD_MODE` | unset, or `test` |

`GMSHIELD_MODE=test` is set only by the pipeline, never in `.gmshield/pipeline.toml`. It needs no
secret: the service credential is the fixed, public `gmshield-test-mode-frontend-credential-not-a-secret`,
the same as the backend's test mode, and a `GMSHIELD_FRONTEND_CREDENTIAL` beside test mode is refused
(`mode.test_with_production_secret`). The backend is `http://stand-in-backend:8080` unless `GMSHIELD_BACKEND_URL` is set:
the `stand-in-backend` image of this repository, which answers every path of
`contracts/public.json` with a valid example and any other path with a 404 problem detail. For
sign-in, its examples send the browser from "Continuar com Google" to `/auth/google/callback`,
whose relay gets the example `signed_in` answer, and `GET /api/v1/me` answers its example username:
a sign-in that needs no Google and no state. Until
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
GMSHIELD_MODE=test GMSHIELD_BACKEND_URL=http://127.0.0.1:8080 npm run dev   # http://127.0.0.1:3000
```

The images:

```sh
docker build --target test .
docker build --target test-reports --output type=local,dest=out .   # out/junit/, out/lcov.info
docker build --target stand-in-backend -t gmshield-stand-in-backend .
docker build -t gmshield-frontend .
docker run --rm --read-only --tmpfs /tmp --env-file frontend.env gmshield-frontend   # a mode-600 file with GMSHIELD_BACKEND_URL and GMSHIELD_FRONTEND_CREDENTIAL
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
