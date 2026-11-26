# GMshield-frontend

Web interface for GMshield, built as a Backend for Frontend. Stack: Next.js (App Router) and React
in TypeScript, on Node.js. The browser talks only to this application; only its server-side code
under `src/server` calls the backend.

## Versions

Checked on 2026-11-13 (Story 1.8's and Story 1.13's additions on 2026-11-16): each is the newest release
at least two weeks old that day (hash-wasm 4.13.0 was nine days old, so 4.12.0). Every dependency is pinned exactly and `package-lock.json` is committed.

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
| tus-js-client (the browser's tus client, Story 1.13) | 4.3.1 | `package.json` |
| hash-wasm (the whole-file SHA-256, Story 1.13) | 4.12.0 | `package.json` |
| react-markdown (an answer's sanitized Markdown, Story 2.4; released 2025-03-07) | 10.1.0 | `package.json` |
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
| `src/app/api/v1/uploads/[[...path]]/route.ts` | the upload relay (Story 1.13): `/api/v1/uploads/**` streamed to the backend (`src/server/backend/upload-relay.ts`) |
| `src/client/upload` | the browser's upload module (Story 1.13): tus-js-client with a checksum per part, the whole-file hash and the completion; `sniff.ts`, the browser's format check (Story 1.14) |
| `src/components/uploads` | the guided upload and the upload tray (Story 1.14): `UploadsProvider`, `UploadDialog`, `UploadTray`, their texts built on the server (`upload-texts.ts`) |
| `src/app/(signed-in)/files/[id]` | a material's page (Story 1.14): its name and state; `pages/[page]`, one page of it under review (Story 1.19) |
| `src/app/api/v1/materials/[id]/pages/[page]/picture/route.ts` | the picture relay (Story 1.19): a page's WebP streamed from the backend (`src/server/backend/picture-relay.ts`) |
| `src/app/(signed-in)/questions`, `src/components/conversation` | the conversation screen (Story 2.4): `Conversation` (composer, turns, live region, empty state) and `AnswerMarkdown` |
| `src/app/api/v1/campaigns/[id]/turns/route.ts`, `src/app/api/v1/turns/[id]/events/route.ts` | the question relay and the turn event stream relay (Story 2.4), over `src/server/conversations.ts`; `src/client/conversation.ts` is the browser's side |
| `src/components/PageView.tsx` | one page of a material (Story 1.19): a picture with its text layer as SVG, or a text page |
| `src/components/QualityReport.tsx`, `MaterialActions.tsx` | a material's quality report and the GM's actions on it (Story 1.20); the Server Action is `src/app/(signed-in)/files/[id]/actions.ts` |
| `src/app/terms`, `src/app/privacy` | the draft terms of use and privacy notice, marked "Rascunho / Draft" |
| `src/components` | the base components, each with its CSS Module: `PillButton` (and `SolidPillButton`), `ConfirmationDialog`, `Notice`, `PreferencesForm`, `UsernameForm`; the page parts every page is built from (`PageHeader.tsx`: `PageHeader`, `PageSubtitle`, `Tabs`, `Card`, `EmptyState`, with `Page.module.css`) |
| `src/components/notifications` | the notifications (usability pass): `NotificationsProvider` (toasts, the flash cookie's reader) and `NotificationCenter` (the bell and its list) |
| `src/components/AccountMenu.tsx`, `useDisclosure.ts` | the account menu in the bar above the page (the account, theme, language, "Sair"), and the open, Esc and press-outside behaviour it shares with the bell and "Exibição" |
| `src/components/Spinner.tsx`, `LinkPending.tsx`, `ErrorScreen.tsx` | a busy button's or link's spinner, and what a page shows when it could not be built (`error.tsx`) |
| `src/components/ItemList.tsx`, `ViewMenu.tsx`, `Thumbnail.tsx`, `MaterialPreview.tsx` | a list's rows as a list or a grid, its "Exibição" menu, a material's first-page thumbnail, and the preview panel |
| `src/flash-cookie.ts`, `src/server/flash.ts` | what a Server Action says once it has succeeded, carried to the next render in `__Host-gmshield-flash` |
| `src/view-cookie.ts` | how each list is shown, remembered in `__Host-gmshield-view` |
| `src/paging.ts`, `src/server/list-page.ts`, `src/components/Pager.tsx` | a list a page at a time: the page arithmetic, the one call that asks the backend for a page and its total, and the pager |
| `src/server/every-page.ts` | a whole list read through the backend's cursor, for what needs every campaign or system |
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
  `/favicon.ico`) and the upload relay (`/api/v1/uploads`, below), which the proxy's matcher skips, carries `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, a `Permissions-Policy` that
  turns off camera, microphone and geolocation, and a Content-Security-Policy that
  allows the site's own origin only, with a new nonce per request for the inline scripts and
  styles of Next.js and `'wasm-unsafe-eval'` on scripts, which allows compiling WebAssembly (the upload's
  whole-file hash, hash-wasm) and no JavaScript eval (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self' https://accounts.google.com`: the sign-in form's post is answered with a
  redirect to Google). POST, PUT, PATCH and DELETE are refused with the 403 problem detail
  `request.cross_origin` unless `Origin` is the site's own origin, or, without `Origin`,
  `Sec-Fetch-Site` is `same-origin`. Behind a proxy that ends TLS, `X-Forwarded-Proto` gives the
  scheme of the site's origin. The proxy also renews the session token (below), and names the
  requested path in the request header `x-gmshield-path` (replacing any value the browser sent),
  which the signed-in layout reads to come back to the same page after a session ends.
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
  `PreferencesForm` (two segmented controls of submit buttons; a press applies that one choice at
  once, since the second usability pass) posts to the Server Action `savePreferences`, which sets the
  cookie of the choice posted. Nothing is stored in the backend yet (Epic 8).
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
    of the backend's grant: what is left of the session's absolute lifetime, which only the backend
    sets (`GMSHIELD_SESSION_ABSOLUTE_TIMEOUT`, 7 days by default; the cookie follows it up to the
    browsers' 400-day cap, and falls back to 7 days for a grant without a lifetime). A value without the suffix (Story
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
    `fetch` (`Sec-Fetch-Dest: empty`), and the browser's speculative loads (`Sec-Purpose: prefetch`,
    also `prefetch;prerender`, or `Purpose: prefetch`), which say `document` but may be dropped. The router may drop such an answer, and a renewed cookie with
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
- **The signed-in shell (Story 1.11).** `/` shows the sign-in screen to a signed-out visitor and
  sends a signed-in one to `/questions`. Every signed-in page lives in the route group
  `src/app/(signed-in)`, whose layout loads the account (`GET /api/v1/me`) and its current campaign
  (`src/server/library.ts`, `GET /api/v1/campaigns/current`) and handles `session.required` and
  `session.renewal_required` as `/` does. The shell (`src/components/Shell.tsx`) is, in page and Tab
  order, the sidebar, the context bar ("system › campaign"; the campaign only under 768px) and the
  main column (centred, at most `--width-reading`), with a slot for one right panel.
  - The sidebar (`Sidebar.tsx`, a client component; its texts come translated from the server): the
    logo and name (a link to `/questions`; until the usability pass of 2026-11-21 it opened a menu with
    the preferences and "Sair", now the account menu in the bar above the page), the current
    campaign, the entries Consultas `/questions`, Criação de Regras `/rules`, Minhas Mesas
    `/campaigns`, Sistemas `/systems`, Personagens `/characters`, Meus Arquivos `/files`, and
    "Adicionar Arquivo" at the bottom, which opens the guided upload (Story 1.14). Each entry's page still to
    be built says what will be there. An entry is marked current (`aria-current="page"`) on its page and on
    every page below it (Story 3.1: Sistemas on `/systems/new` and `/systems/<id>`).
  - From 1280px its collapse control or Ctrl+B / ⌘B closes it to the handle "Abrir menu" and the
    logo mark; the state is kept in `__Host-gmshield-sidebar` (`open` | `closed`, a year, not
    `HttpOnly`: the sidebar writes it, the server reads it so nothing flashes). Under 1280px it always
    starts closed and opens over the main column, as a full-screen sheet under 768px, and closes
    after a choice or on Esc. CSS decides the layout; the component keeps the two states.
  - The sign-in's username step sends the interface's language, which names the new account's first
    system and campaign.
- **Resumable upload (Story 1.13, AD-16).** The browser talks tus 1.0.0 to this site's
  `/api/v1/uploads/**`, never to the backend:
  - The relay (`src/app/api/v1/uploads/[[...path]]/route.ts`, Node runtime, `force-dynamic`) sends the
    request to the same backend path as a stream (`duplex: 'half'`, no timeout on the body; a browser that
    leaves aborts the call) and streams the answer back. Only `Tus-Resumable`, `Upload-Length`,
    `Upload-Metadata`, `Upload-Offset`, `Upload-Checksum`, `Content-Type` and `Content-Length` go out, with
    the service credential, the session cookie's token as `X-Session-Token` and a `traceparent`; only
    `Location`, `Tus-*`, `Upload-*` and `Content-Type` come back, always `no-store`. Only the three upload
    shapes (`/api/v1/uploads`, `/{id}`, `/{id}/completion`) are relayed; anything else is
    `request.not_found`. The proxy's matcher skips these paths, because when the proxy runs Next.js
    holds up to 10 MB of every body in memory; the relay refuses a POST, PUT, PATCH or DELETE from another
    origin itself with the proxy's `isSameOrigin` (403 `request.cross_origin`); a HEAD is not checked, as
    browsers send no `Origin` on a same-origin HEAD and `Sec-Fetch-Site` only to secure origins. Spike (2026-11-16): bodies of 256 MiB, 2 GiB and 6 GiB
    through the relay kept the server's RSS at 180 to 193 MB.
  - The browser module (`src/client/upload`, `startUpload(file, options)`) uses tus-js-client 4.3.1:
    64 MiB parts, `metadata.filename`, the upload URL kept under the file's fingerprint (the hex SHA-256 of
    its name, type, size and date with the endpoint, so the stored key names nothing) for
    `findPreviousUploads` and `resumeFromPreviousUpload`, removed only after the completion answered 201
    (an upload already whole on resume goes straight to its completion), and `retryDelays`
    (a part refused with 409, 423 or 460, or a server failure, is tried again). Its HTTP stack adds
    `Upload-Checksum: sha256 <Base64>` of each part's own bytes (`crypto.subtle.digest`). Meanwhile
    hash-wasm hashes the whole file 16 MiB at a time; once the last part is stored the module posts
    the hash to `<upload>/completion` (tried again after a 5xx or 423) and resolves with `{materialId, versionId, state}`. A failure is
    an `UploadError` with the status and the problem detail, for `errorText`. Story 1.14 adds the
    dialog and the tray.
- **The guided upload and the upload tray (Story 1.14).** Public contract 1.5.0.
  - "Adicionar Arquivo" opens `UploadDialog`: a 560px native `<dialog>` (`--width-upload-dialog`) built like
    `ConfirmationDialog` (`showModal()`, Tab kept inside, Esc closes and is marked handled, focus back to
    "Adicionar Arquivo", or to the handle when the sidebar is closed). Under 1280px it closes the sidebar
    sheet first; it never opens another dialog. "Passo N de 4": the files, what they are (`kind`), where
    they belong (the current campaign, or its system; nothing without a campaign), their language
    (`pt-BR`, `en`, `detect`); then the progress. Each choice is a full-width radio row with its
    explanation. Each file becomes its own material with the same answers, sent one after another as tus
    metadata (`kind`, `language`, `campaign` or `system`).
  - A chosen file is checked in the browser at once (`src/client/upload/sniff.ts`): the backend
    `FormatSniffer`'s rules over the first 4 KiB, and the 2 GiB limit. A refused file is named with its
    reason and the accepted formats, announced at once, and never sent; the server's 415 still counts
    and shows in the progress step.
  - `UploadsProvider` (in the shell, so uploads go on while the GM moves inside the app; a reload loses
    them) runs the uploads and announces through two live regions: each state change and every 10 %
    politely, a refusal at once.
  - `UploadTray`, just above "Adicionar Arquivo": the signed-in layout reads `GET
    /api/v1/materials?state=uploading&state=waiting&state=processing&state=needs_review&state=failed&limit=50`
    (`src/server/materials.ts`) and the tray merges those rows with this tab's live uploads. Each row: the
    name, a link to `/files/{id}` once there is one, a state pill (enviando, aguardando, processando,
    precisa de revisão, pronto, falhou; the colour in a mark beside the word) and a 2px `<progress>` of
    bytes. A row `uploading` with no live upload here reads "Envio interrompido." with its expiry and
    "Retomar", which asks for the same file (another name or size is refused in the row) and resumes
    `/api/v1/uploads/{id}` with `startUpload(file, {resumeUrl})`, which never creates an upload. Past
    `expiresAt`, or for a stored resume entry older than 6 h with no server row, the row says the
    unfinished upload is gone and "Dispensar" clears it.
  - While a row is uploading, waiting or processing and the tab is visible, the tray calls
    `router.refresh()` every 5 s: an RSC fetch, which the proxy never renews a session on, so a forgotten
    tab still reaches the idle end.
  - `/files/[id]`: the material's name and its state pill (`GET /api/v1/materials/{id}`); anything not
    found is the single "Não encontrado." page.
- **Page pictures with a text layer (Story 1.19).** Public contract 1.8.0.
  - The material page links "Ver páginas" to `/files/{id}/pages/1` once the material needs review or is ready.
    `/files/[id]/pages/[page]` reads `GET /api/v1/materials/{id}/pages/{page}?ground=review` (`getPage` in
    `src/server/materials.ts`) and the material's name; it shows the name (back to the material), `PageView` with
    "Página 13 de 364", and "Página anterior" and "Próxima página", hidden at the first and the last page. A page the
    backend does not serve, or a page number that is not one, is the single "Não encontrado." page.
  - `PageView` draws a PDF page as one `<svg viewBox="0 0 width height">` in the picture's pixels: a frame, the
    `<image>`, and one `<text>` per line, placed with SVG attributes only (the Content-Security-Policy allows no style
    attribute): `x` at the box's left, the baseline at 80 % of its height, `font-size` 90 % of it, and `textLength`
    with `lengthAdjust="spacingAndGlyphs"` fitted to its width. The text is transparent by class, so it can be
    selected and copied, a screen reader reads it, and it stays over its words at any zoom. The frame and the page
    number show before the picture arrives. A text page is its text in a `pre-wrap` block. Line and page text are React
    text, never HTML.
  - The picture comes through this site: `GET /api/v1/materials/{id}/pages/{page}/picture?ground=review` is relayed
    by `relayPicture` like the upload relay: the id must be a UUID, the page a number from 1 and the ground a plain
    word, or it answers "not found" without the backend; only the service credential, the session and a
    `traceparent` go to the backend, and the WebP streams back as `image/webp` with `Cache-Control: no-store` and
    `X-Content-Type-Options: nosniff` (`img-src 'self'` allows it). The proxy runs on this GET as on any page.
- **The quality report and the GM's review (Story 1.20).** Public contract 1.9.0.
  - Each material carries `actions`, the subset of `accept`, `reprocess`, `retry` and `discard` the backend allows
    now; the material page shows only those, so the rules stay in the backend.
  - A material that needs review shows its quality report (`GET /api/v1/materials/{id}/report`, `getReport`): three
    large numerals (pages processed = `pages.done`, read by OCR, unreadable) in the title type with their labels in
    the meta type; the warnings written as facts ("3 páginas não puderam ser lidas.", an unknown code left out); the
    unreadable pages as links to their page (a run reads "Páginas 40 a 41" and links to its first page); and the
    outline as a plain list indented by level through classes (`level0` to `level6`, relative to the shallowest),
    never style attributes. A ready material shows the report read-only. The pages read directly, by OCR and still
    waiting are listed while processing only.
  - The actions (`MaterialActions`): "Aceitar" the one solid pill, "Reprocessar páginas com falha" and "Descartar"
    pills; a failed material says why (`failureText`), then "Tentar de novo" (solid) and "Descartar". Each is a native
    button posting to the Server Action `materialAction` (the form's `id` and `action`), which calls
    `POST /api/v1/materials/{id}/{action}` (`actOnMaterial`) and then `refresh()` (`next/cache`), so the page shows the
    state the backend answered and polling resumes while it moves; a refusal comes back through `errorText` as an
    alert under the pills. "Descartar" first opens the 440px `ConfirmationDialog`, which names what goes with its
    count ("Saem as 444 páginas lidas deste arquivo, …"). Every action works from the keyboard.
  - The page route shows a picture page beside a "Texto extraído" column holding its lines' text, or "Nenhum texto
    foi extraído desta página."; an unreadable page whose reading crashed (no picture and no text) says it could not
    be opened, with its number and the page links.
  - The signed-in layout showed a dismissible warning notice "{name} precisa de revisão." linking to the newest
    material that needs review. Since the usability pass of 2026-11-21 that is the bell's: every material that needs
    review or failed is listed under it, and a toast says so when one appears during the visit.
- **Photos as the pages of one material (Story 1.21).** Public contract 1.10.0.
  - The dialog's step count follows its questions. With two or more images chosen (JPG, PNG, WebP, TIFF, BMP or HEIC,
    as the browser's check found them), a step asks "Páginas de um material" (the default) or "Cada imagem é um
    material"; other files in the same pick stay materials of their own. As pages, an order step follows: the
    material's name (a text field, the first page's file name without its extension until the GM edits it; a blank
    name stops the step) and the images as a list, each row with its thumbnail, its page number, its name and
    "Subir"/"Descer". Rows move by native drag events (no library), by those buttons, or by Alt+↑/Alt+↓ on the focused
    row; each move is announced politely ("foto-2.jpg, página 3 de 5") and focus stays on what moved. A thumbnail is
    drawn on a canvas (`createImageBitmap`, upright by EXIF; the policy allows no image source) for JPG, PNG, WebP and
    BMP; HEIC and TIFF show their format's name. Past 500 images or 2 GB in all the step says so with the limit and
    stops there.
  - "Enviar" confirms the order. `UploadsProvider.send({files, sets})` sends the other files as before, then each set:
    the Server Action `createImageSetAction` (`src/app/(signed-in)/image-set-actions.ts`, given to the provider by the
    shell) checks what the browser sent and calls `POST /api/v1/image-sets` (`createImageSet` in
    `src/server/materials.ts`), which answers one upload id per image; each image then goes through the upload relay
    to `/api/v1/uploads/{id}` with `startUpload(file, {resumeUrl})`, one after another, so no other upload is ever
    created. "Cada imagem é um material" and an image chosen alone are each a set of one, named as a file is. The set
    is announced as one (when it starts sending and when its last image is verified); a failed image is said at once.
  - The tray shows a set still uploading as one row (`Material.imageSet` from the server, merged with this tab's
    uploads of its images): the bytes of all its images on one line, then each failed image named with its place and
    reason, with "Substituir" (another image for that place, checked in the browser first; `replaceSetImageAction`,
    `POST /api/v1/image-sets/{id}/images/{position}`, then that file to the new upload) and "Continuar sem ela"
    (`dropSetImageAction`, `DELETE …/images/{position}`, then `refresh()`). Images still missing with no upload in this
    tab read "Envio interrompido: faltam N de M fotos." with "Retomar as fotos", which asks for those files and
    resumes each one matched by its name and size.
- **Ask a question and read the answer as it is written (Story 2.4).** Public contract 1.11.0.
  - `/questions` is the conversation screen. The page (a server component) loads `GET /api/v1/conversations/current`
    (`currentConversation` in `src/server/conversations.ts`: the campaign and `hasSources`) and the newest material
    that needs review, and renders the client `Conversation`. Only the turns asked since the page opened are shown:
    past turns are stored, and listed from Story 3.10.
  - The composer is a 48px pill textarea: Enter sends, Shift+Enter adds a line, and it grows to six lines (its `rows`
    by line count, and `field-sizing: content` where the browser has it; no style attribute). The send button is a
    48px outlined circle with an arrow, spoken "Enviar". The draft is kept per campaign in `localStorage`
    (`gmshield:draft:<campaignId>`, every access in try/catch) and cleared on send. Under 768px the composer stays
    pinned at the bottom (sticky) and answers use the body size.
  - On send the question shows at once in `--color-text-muted` with "Procurando nas fontes…" (no spinner). The browser
    posts it to `POST /api/v1/campaigns/{id}/turns` of this site (`postQuestion`, `src/client/conversation.ts`; the
    only `fetch` outside `src/server`, to a relative `/api/v1/` path, which `test/boundaries.test.ts` allows), whose
    route checks the origin, reads the session cookie and calls the backend through the typed client. Then it opens
    `EventSource` on `/api/v1/turns/{turnId}/events` and closes it on `done` or `error`.
  - The stream relay (`relayTurnEvents`) checks the origin, sends the service credential, the session as
    `X-Session-Token` and a numeric `Last-Event-ID`, uses a raw `fetch` with no time limit, streams the body back
    unbuffered (`no-store`, `nosniff`, `X-Accel-Buffering: no`) and aborts the backend request when the browser leaves.
    `src/proxy.ts`'s matcher skips `/api/v1/turns/{id}/events`.
  - The answer streams in as Markdown (`react-markdown` with `skipHtml`; images dropped; a link shown as "{text}
    ({address})", never an anchor; nothing set as HTML) in `--font-answer-size`, with no bubble, card or avatar, and a
    full-width rule once it ends. An answer whose `language` differs from the interface's gets `lang` and a visible
    "Resposta em inglês" / "Answer in Portuguese". A polite live region says "Respondendo…" at the start and the whole
    answer once at `done`; an `error` event shows its own failure text (Story 2.6, below).
  - With `hasSources` false, a line above the composer says "Esta campanha ainda não tem fontes aceitas." with
    "Enviar um arquivo", which opens the guided upload (`openUpload` of the uploads context, which now holds the
    dialog's open state), and "Revisar {name}" when a material needs review. The composer stays enabled.
- **Sources under every answer (Story 2.5).** Public contract 1.12.0.
  - The `done` event's data is `{silent, references: [{number, materialName, sectionPath: […], page, passageIds: […],
    removed}]}` (`TurnDoneEvent`, `TurnSourceReference`): the backend expands the cited passage ids into numbered
    references when the answer completes, stores them with the turn, and builds the data when it streams `done`, so a
    replay shows `removed` as of then. `parseDone` (`src/client/conversation.ts`) keeps only well-formed references,
    and an answer with none left is silent whatever the event said.
  - The screen keeps each turn's `citation` events (`parseCitation`: a passage id and a code-point offset) and shows
    nothing of them while the answer streams. At `done`, when not silent, each citation whose passage id is in a
    reference becomes a superscript with that reference's number in `--color-accent`, at its code-point offset in the
    Markdown text (`AnswerMarkdown`: each mark travels through the parser as one private-use code point, U+F0000 plus
    the number, which the model's own text never keeps, and a small rehype step turns it into `<sup>`). A citation
    with no matching reference shows nothing. Under the answer and above the closing rule, `References` lists the
    references in label type, one line each: the material's name, the section path joined with " › ", and "p. N"; a
    removed one is struck through, followed by "fonte removida" / "source removed". Story 2.7 opens the others.
  - A silent answer (`silent: true`) replaces whatever streamed with "As fontes não dizem nada sobre isso." / "The
    sources say nothing about this.", in the turn's language (the interface's when it is null): no list, no
    superscript and no language label.
  - The polite region says the finished answer, then the references as a list (or the silent sentence alone).
  - The frontend renders only what it receives: it never builds a reference from a passage id.
- **Stop an answer, and answers that fail clearly (Story 2.6).** Public contract 1.13.0.
  - Stop: while a turn is `sending`, `searching` or `answering`, the send button is Stop (a filled square, labelled
    "Parar" / "Stop"), and Esc anywhere on the conversation screen does the same. Enter sends nothing then, and the
    draft stays. The browser posts `POST /api/v1/turns/{id}/stop` (`stopTurn` in `src/client/conversation.ts`) to the
    relay `src/app/api/v1/turns/[id]/stop/route.ts` (same-origin check, `isId`, session; `stopTurn` in
    `src/server/conversations.ts` through the typed client; 204 or the backend's problem). A stop pressed before the
    turn's id is known is sent as soon as the id arrives.
  - The `done` event carries `stopped` (always present); `silent` is true exactly when the answer was not stopped and
    has no reference. `parseDone` never makes a stopped answer silent. A stopped answer keeps the text received so far,
    its superscripts and references (when it has any), and is marked "Interrompida" / "Stopped" under the text; it is
    never replaced by the silent sentence. The polite region says the answer, then "Interrompida".
  - Lost connection: an `error` with no data while the stream reconnects shows "Conexão perdida. Tentando de novo…" /
    "Connection lost. Trying again…" under the text (also said politely); the next `open` removes it. When the browser
    gives up (`CLOSED`), the page reopens the stream itself from the last event id, waiting 1 s, 2 s, 4 s… up to 15 s.
    The id goes as `?lastEventId=` (`turnEventsUrl(turnId, lastEventId)`), which the events relay forwards as
    `Last-Event-ID` when the header is absent, with the same sequence check. An event whose id is not after the last
    one is ignored, so no text repeats. After 2 minutes without an `open`, the line becomes "Não foi possível
    reconectar." / "Could not reconnect." with "Tentar de novo", which reopens the stream.
  - Failures: an `error` event's code has its own text, said at once by an assertive region (`role="alert"`).
    `model.refused`: "O modelo recusou este pedido. Reformule a pergunta e envie de novo.", the question back in the
    composer when it is empty, no retry. `model.truncated`: the partial text stays, followed by "A resposta foi cortada
    antes do fim." and "Tentar de novo". `model.question_flagged` and `model.source_flagged` act like
    `model.refused`, each with its own text (Story 2.8, below). Any other code (`model.unavailable`,
    `job.provider_unavailable`, `job.attempts_exhausted`, `job.claim_lapsed`, …): "O serviço de IA está indisponível
    agora." with "Tentar de novo". A refusal and an outage hide any partial text. "Tentar de novo" asks the same question again as a new turn,
    in place of the failed one.
- **Open the cited page in the source view (Story 2.7).** Public contract 1.14.0.
  - The line of a reference that is not removed is a button named by its line; a removed one stays struck through and
    opens nothing, and the superscripts stay plain text. Selecting it opens `SourceView`
    (`src/components/SourceView.tsx`) at once with the empty frame and "p. N"; selecting another reference replaces its
    page and its focus target.
  - The page comes from `GET /api/v1/turns/{id}/references/{number}/pages/{page}` (`fetchReferencePage` in
    `src/client/conversation.ts`) through the relay
    `src/app/api/v1/turns/[id]/references/[number]/pages/[page]/route.ts` (same-origin check, `isId` and `isNumber`,
    session; `referencePage` in `src/server/conversations.ts` through the typed client; no-store). Its picture comes
    from `.../picture` through the picture relay (`relayReferencePicture` in `src/server/backend/picture-relay.ts`,
    whose path is its ground). A malformed id or number answers "not found" without reaching the backend. The backend
    checks the turn, its campaign and the reference, and serves the version the reference names.
  - `PageView` takes the picture's address (`pictureSrc`) and `cited`, the reference's passage ids. On a picture page
    each box of a cited passage is an SVG `<rect>` filled with `--color-passage-mark` (a translucent accent in every
    theme), and the lines within a cited box sit in a group named "trecho citado" / "cited passage"; on a text page each
    cited code-point `range` is a `<mark>` in such a group. A page without a cited passage marks nothing.
  - A page that fails to load (404, 401, 5xx, no network: `fetchReferencePage` answers null) shows "Não foi possível
    carregar esta página." / "This page could not be loaded." with "Tentar de novo" / "Try again", which loads the same
    page again. An unreadable page with nothing on it (`picture` and `text` both null) shows `pageView.unopened`.
  - The panel is a non-modal `<dialog>` named by its source line. On open focus goes to its close control; with focus in
    it ← and → move one page, as the footer's controls do (disabled at the first and last page; a control that becomes
    disabled hands focus to the other); with Alt, Ctrl, Meta or Shift the arrows are left to the browser. Esc or the
    close control closes it and focus goes back to the reference; selecting the open reference again reopens it at its
    cited page. The conversation's Esc listener skips a dialog, so that Esc never stops a running answer.
  - The shell's panel slot is `ShellFrame` (`src/components/ShellPanel.tsx`), which the conversation fills from the
    browser with `ShellPanel` (a portal; in place outside a shell). At 1280px and more it is a 560px column and the main
    column narrows, with nothing inert; under 1280px it opens over the main column, which is inert while it is open
    (`data-behind-panel`; `setInertBy` keeps the sidebar's and the panel's inert apart); under 768px it is a full-screen
    sheet.
  - The stand-in backend answers reference 1 with the picture page of Story 1.19 and reference 2, added to its `done`,
    with a text page whose cited range is marked.
- **Text in a material is never an instruction (Story 2.8).** No contract change. `AnswerMarkdown` keeps every link's
  address as written (`urlTransform`, `addressAsText`), so a `javascript:` link shows as "{text} (javascript:…)" like
  any other instead of losing its address; links are still spans, never anchors, and image URLs are dropped. Guards:
  `react/no-danger` is an error in `eslint.config.mjs` for every `js, jsx, mjs, cjs, ts, tsx, mts, cts` file, and
  `test/boundaries.test.ts` fails on `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
  `document.write`, `srcdoc`/`srcDoc`, `parseFromString`, `createContextualFragment` or `setHTMLUnsafe` in any such
  file under `src/`, except the generated backend types (`src/server/backend/generated/`, also outside the lint).
  Tests: a hostile answer (an autolink, a `javascript:` link, an `<iframe>`, a reference-style image, a link) renders
  no `a`, `img`, `iframe` or `script` and nothing with `src` or `href` (`test/conversation.test.tsx`); HTML in a
  material name or section path is text in `References` and the `SourceView` heading (`test/components.test.tsx`).
  A provider's prompt filter has its own `error` codes (codes are opaque to the backend, so no contract change), each
  shown like `model.refused` (the partial text hidden, no "Tentar de novo", the question back in the composer when it
  is empty, said at once): `model.question_flagged` (Azure's jailbreak check flagged the question): "O filtro de
  segurança do provedor de IA bloqueou esta pergunta porque ela parece tentar mudar as instruções do assistente.
  Reformule a pergunta e envie de novo."; `model.source_flagged` (its indirect-attack check flagged a passage): "O
  filtro de segurança do provedor de IA bloqueou esta pergunta porque um trecho das fontes consultadas parece uma
  instrução ao assistente. Revise os arquivos usados como fonte ou reformule a pergunta." English in
  `src/messages/en.json`. Deploy order: this frontend before or with the worker that sends these codes (the change is
  backward compatible; an older frontend shows them as an outage with "Tentar de novo").
- **The indexing notice.** Public contract 1.15.0; the failure line from 1.16.0.
  - The signed-in layout (`src/app/(signed-in)/layout.tsx`) reads `GET /api/v1/conversations/current`
    (`currentConversation`) beside the account, the campaign and the tray. While its `indexing` is `{remaining}`, a
    warning at the top of the main column says "Preparando as fontes para busca: faltam {remaining} trechos" /
    "Preparing your sources for search: {remaining} passages left" (`notice.indexing`), on every signed-in page. The
    backend counts; the frontend only shows the number. A conversation that cannot be loaded (no campaign: 404) shows
    no notice.
  - The notice is the client component `IndexingNotice` (`src/components/IndexingNotice.tsx`), given that first count.
    It has no dismiss control (`Notice`'s `dismissible={false}`) and is not a live region (`live={false}` drops
    `role="status"`), so its changing number is never announced again.
  - It keeps its own count. Polling: while the tab is visible, every 5 s, it reads `indexing` through the same-site
    relay `GET /api/v1/conversations/current` (`src/app/api/v1/conversations/current/route.ts`: same-origin check, the
    session, `no-store`, `nosniff`) with `fetchIndexing` (`src/client/conversation.ts`), each read bounded to 4 s. A new
    number replaces the shown one; null hides the notice and stops polling; a failed (or hung) read keeps the number and
    changes nothing else; after 10 minutes of successful reads without a change polling stops and the line stays; a new
    count from the page (the layout rendered again by another refresh) shows at once and starts polling again. It never
    calls `router.refresh()`, so a page (the questions page's turns) is never re-rendered for it.
  - The number is formatted for the language ("2.000" / "2,000"), and one passage left has its own sentence
    (`notice.indexingOne`: "falta 1 trecho" / "1 passage left").
  - The Shell's notice slot is a list (`notices`), one line each, in this order: a campaign that cannot be loaded
    (danger), then the indexing notice. (A material that needs review was a line here until the usability pass of
    2026-11-21; it is now under the bell.)
  - **Passages that could not be prepared (public contract 1.16.0).** The current conversation also carries
    `indexingFailed`, `{passages, retrying}` or null: the in-scope passages whose index change failed, and whether the
    backend will try one of them again (every 10 minutes, at most 3 times). The layout renders `IndexingNotice` when
    either value is set, and it shows up to two stacked lines, the failure line second, neither dismissible nor live:
    - while a retry remains, a warning: "Não foi possível preparar {count} trechos para busca; nova tentativa em alguns
      minutos." / "Could not prepare {count} passages for search; trying again in a few minutes."
      (`notice.indexingRetrying`, `notice.indexingRetryingOne` for one);
    - after the last retry, an error (`Notice`'s `danger`, the word "Erro" / "Error"): "Não foi possível preparar
      {count} trechos para busca." / "Could not prepare {count} passages for search." (`notice.indexingFailed`,
      `notice.indexingFailedOne`).
    `fetchIndexing` returns both values (`{kind: 'read', remaining, failed}`, each null when there is none, or
    `{kind: 'failed'}`). The notice keeps polling, with the same 5 s and 4 s rules, while anything is pending or a retry
    remains, and stops when only a final failure is left (that line stays) or nothing is (the notice goes). The
    10-minute stall applies only while no failure is retrying; while one is, the notice polls until the state changes
    (at most about 40 minutes over 3 retries).
  - The stand-in backend answers `indexing: null` and `indexingFailed: null` (its sources are indexed), so a test-mode
    shell shows no indexing notice and reads no count.
- **Systems (Story 3.1, part A).** Public contract 1.17.0. "Sistemas" lists, creates and edits the GM's systems;
  deleting one is part B (below).
  - `src/server/library.ts` gains `listSystems`, `getSystem`, `createSystem`, `changeSystem` (`PATCH` with the version
    the form was read at) and `listCampaigns` (a system's campaigns); `listMaterials` takes `system` to list a system's
    materials (attached to it or to one of its campaigns).
  - `/systems`: the title "Sistemas", one solid pill "Novo sistema", and the systems newest first, each row its name
    and edition, opening `/systems/<id>`. Empty, one sentence says what a system holds ("Um sistema reúne as campanhas e
    os materiais de um jogo.") and "Novo sistema" is the only action.
  - Lists (`src/components/ItemList.tsx`, a client component): the server gives the rows of one page, and `Pager`
    under them (and a small one in the toolbar) links to the others (`?page=`). Until the third round of the usability
    pass (2026-11-21) a "Carregar mais" pill added the backend's next page under the rows; see "Third pass" below.
  - `/systems/new` and `/systems/<id>/edit` are pages of the main column with `SystemForm`: Nome (`aria-required`),
    Edição (opcional) and Descrição (opcional), with no `maxLength` (the backend counts code points after trimming:
    120, 60 and 2000; CRLF line breaks are sent as LF), "Criar sistema" or "Salvar" (the screen's one
    solid pill) and "Cancelar". The backend checks every field; each of its field codes (`request.system_name_invalid`,
    `request.system_edition_invalid`, `request.system_description_invalid`, `request.system_name_taken`) comes back as
    text under that field (`role="alert"`, `aria-describedby`), with what was typed kept; any other problem under the
    form. A saved system opens its page. The edit sends every field with the version, so a cleared edition or
    description is removed. A stale version (`request.stale_version`) brings the system's current values and version
    into the form, which says above its fields that the system was changed elsewhere.
  - `/systems/<id>`: the name, the edition ("Edição 5.2.1"), the description with its line breaks, "Editar" (the one
    solid pill) and two tabs as links, campaigns (the default) and materials, chosen by `?tab=` and marked with
    `aria-current="page"`. The campaigns tab lists the system's campaigns in use, each opening its page (Story 3.2); the
    materials tab lists its materials in every state but `superseded` and `discarded`, each with its state pill and
    opening `/files/<id>`. An empty tab says so in one sentence. Another owner's id, an unknown one or a malformed one
    is the single "Não encontrado." page. A new name shows in the list and in the context bar on their next load.
  - The stand-in backend lists the starter system (no edition, no description, version 0) with its one campaign,
    creates "D&D" 5.2.1, and answers an edit with the starter system at version 1.
- **Delete a system (Story 3.1, part B).** Public contract 1.18.0. `src/server/library.ts` gains `systemDeletion`
  (`GET /api/v1/systems/{id}/deletion`: `{campaigns, conversations, materials}`) and `deleteSystem` (`DELETE`, 202 with
  no body, which `call` reads as ok).
  - `/systems/<id>` reads the counts with the tab's list and shows "Excluir", a danger pill next to "Editar"
    (`src/components/SystemActions.tsx`, a client component). It opens the `ConfirmationDialog`: "Excluir este
    sistema?", "Vão junto: 2 campanhas, 3 conversas e 1 material ligado só a ele. Isso não pode ser desfeito." (each
    count with its singular for one and its plural otherwise, zero included; `systems.delete.*` in both catalogues;
    without the counts, it names what goes in words), "Cancelar" and the danger pill "Excluir sistema". Cancelar or Esc
    closes it and focus goes back to "Excluir".
  - "Excluir sistema" posts the id to the Server Action `deleteSystemAction` (`src/app/(signed-in)/systems/actions.ts`),
    which deletes the system and opens `/systems` without it; the backend removes its campaigns, their conversations and
    the materials attached only to it in the background (they leave every list at once, Meus Arquivos included). A
    refusal (`request.not_found` for a system already deleted or another owner's) shows its `errorText` as an alert
    under the pill; a malformed id never reaches the backend. Deleting the system of the only campaign leaves the shell
    with no campaign: the conversation pages show their "no campaign" state, the composer disabled.
  - The stand-in backend counts one campaign, one conversation and no material for the starter system, and answers a
    delete with 202.
- **Campaigns and the campaign switcher (Story 3.2, part A).** Public contract 1.19.0. "Minhas Mesas" lists, creates,
  renames, archives and restores the GM's campaigns, and the switcher makes one current; deleting a campaign is part B
  (below).
  - `src/server/library.ts`: `listCampaigns(token, {system?, archived?, cursor?, limit?})` (every campaign of the
    account, or a system's; the archived ones with `archived: true`), `getCampaign`, `createCampaign` (it becomes the
    current campaign), `changeCampaign` (`{version, name?, archived?}`) and `chooseCampaign` (`PUT
    /api/v1/campaigns/current`). `src/server/conversations.ts`: `campaignConversation` (`{id, questions}`). The current
    campaign is the backend's: nothing about it is kept in the browser.
  - `/campaigns`: the title "Minhas Mesas", one solid pill "Nova campanha", a filter of two links ("Em uso", the default,
    and "Arquivadas", `?archived=true`, marked with `aria-current="page"`), and the campaigns newest first, each row its
    name and its system ("D&D 5.2.1"), opening `/campaigns/<id>`. Empty, one sentence ("Uma campanha reúne as conversas
    e os materiais de uma mesa de jogo." or "Nenhuma campanha arquivada."). The list is paged within its filter
    (`?archived=true&page=2`).
  - `/campaigns/new` (`?system=` chooses the system, as a system's page can link it; otherwise the newest): `CampaignForm`
    with Nome and a `<select>` of the account's systems (the first 50). Saved, the campaign is current and its page
    opens. `request.campaign_name_invalid` and `request.campaign_name_taken` come back under the name, a system gone
    meanwhile (`request.not_found`) under the system. With no system, one sentence ("Uma campanha pertence a um
    sistema, e você ainda não tem nenhum.") and a link to `/systems/new`.
  - `/campaigns/<id>`: the name; "Usar esta campanha" (the one solid pill, only when the campaign is in use and not the
    current one; the current one says "Esta é a campanha atual."), "Renomear" (`/campaigns/<id>/edit`), and "Arquivar"
    or "Restaurar" (reversible, so no confirmation; each posts the version the page was read at, and the page is
    refreshed; a stale version says it changed elsewhere and the refresh shows the current values). Three tabs by
    `?tab=`: overview (the default: name, the system linking to its page, "Arquivada" when archived), scope (the four
    settings in words, read-only until Story 3.6), conversations (the campaign's conversation with its question count
    and "Abrir", which makes the campaign current and opens Consultas; none for an archived campaign, which cannot be
    current; one sentence when there is no conversation). An archived campaign still opens. Another owner's id is the
    single "Não encontrado." page. `/campaigns/<id>/edit` renames on the version; a stale one brings the current name.
  - The switcher (`src/components/CampaignSwitcher.tsx`, a client component, the disclosure pattern `useDisclosure` now shares)
    replaces the static name under the logo and the context bar's campaign link (under 768px the bar still shows the
    campaign name only). Its button is the current campaign's name ("Nenhuma campanha" with none); open, it lists the
    campaigns in use (the first 50, read by the signed-in layout) with their system, the current one marked "atual"
    in words (`aria-current`), then "Ver todas as mesas" and "Nova campanha". Picking one posts it to
    `chooseCampaignAction`, which makes it current and refreshes the page (the conversation, the context bar and the
    switcher act on it); the list closes on success and shows a refusal as an alert otherwise. Esc closes it, gives
    focus back to the button and is marked handled, so the sidebar sheet stays open.
  - Consultas with no campaign (every one archived or gone: `GET /api/v1/conversations/current` is 404) shows the
    composer disabled (`NoCampaignConversation`), the reason above it ("Não há campanha em uso: crie uma para fazer
    perguntas.", which the field names with `aria-describedby`) and a link "Nova campanha" to `/campaigns/new`.
  - "Minhas Mesas" is marked current on `/campaigns` and every page below it. New codes: `request.campaign_name_invalid`
    (`{min}`, `{max}`) and `request.campaign_name_taken`, in both catalogues.
  - The stand-in backend lists the starter campaign with its system, creates "Mesa de quinta", answers a change with the
    starter campaign at version 1 and a choice with the starter campaign, and its conversation holds one question.
- **Delete a campaign (Story 3.2, part B).** Public contract 1.20.0. `src/server/library.ts` gains `campaignDeletion`
  (`GET /api/v1/campaigns/{id}/deletion`: `{conversations, materials}`) and `deleteCampaign` (`DELETE`, 202 with no
  body).
  - `/campaigns/<id>` reads the counts with the campaign and shows "Excluir", a danger pill last in the header, for any
    campaign (in use, current, archived or the last one) (`src/components/CampaignDeleteAction.tsx`, a client
    component). It opens the `ConfirmationDialog`: "Excluir esta campanha?", "Vão junto: 1 conversa e 2 materiais desta
    campanha. Isso não pode ser desfeito." (each count with its singular for one and its plural otherwise, zero
    included; `campaigns.delete.*` in both catalogues; without the counts, it names what goes in words), "Cancelar" and
    the danger pill "Excluir campanha". Cancelar or Esc closes it and focus goes back to "Excluir".
  - "Excluir campanha" posts the id to the Server Action `deleteCampaignAction`
    (`src/app/(signed-in)/campaigns/actions.ts`), which deletes the campaign, revalidates the shared layout (the switcher
    and the context bar no longer show it; the current campaign has fallen back, or there is none and Consultas shows the
    composer disabled) and opens `/campaigns` without it; the backend removes its conversation and its materials in the
    background. A refusal (`request.not_found` for a campaign already deleted or another owner's) shows its `errorText`
    as an alert under the pill; a malformed id never reaches the backend.
  - The stand-in backend counts one conversation and no material for the starter campaign, and answers a delete with
    202.
- **Where a material belongs (Story 3.3).** Public contract 1.21.0. A material belongs to one campaign or to one or
  more systems; the GM can change it, and it applies from the next question. `src/server/materials.ts` gains
  `changeMaterial` (`PATCH /api/v1/materials/{id}` `{version, belonging: {campaign} | {systems}}`) and `FILE_STATES`
  (every state but `discarded`); a material now carries `version`, `size` (absent until known) and `belonging`
  (`{campaign: {id, name, system} | null, systems: [{id, name}]}`). `src/server/library.ts` gains `listAllSystems` and
  `listAllCampaigns` (50 a page, every page, at most 20).
  - The pickers (`src/components/PlacePicker.tsx`, a client component) are three full-width choice rows, each with its
    explanation and its picker: "Uma campanha" (a select of the campaigns in use, in `optgroup`s by system), "Um
    sistema" (a select) and "Vários sistemas" (checkboxes, posted in the systems' order). A row shows only when it has
    something to pick; with no campaign and no system, the one row is "Em nenhum lugar por enquanto". Picking in a row's
    picker chooses that row, and each row keeps its value while another is chosen. An archived campaign is never
    offered (the API still takes one). Texts: `upload.dialog.belonging.*`.
  - The guided upload's "where it belongs" step uses them, fed by the signed-in layout with every campaign in use and
    every system (`Belonging = {campaigns, systems, current}`), the current campaign chosen first. Several systems with
    none ticked cannot go on ("Marque pelo menos um sistema."). A file sends `campaign` or `systems` (comma-separated
    ids) as tus metadata; an image set sends `campaign` or `systems` (an array), which `createImageSetAction` checks (1
    to 100 ids, never with a campaign).
  - `/files` ("Meus Arquivos") is a list page in the shared shape: "Adicionar Arquivo" (`AddFileButton`, the one solid
    pill) opens the guided upload; each row has the material's name, its state pill, then its size, pages and place
    ("1,2 MB · 320 páginas · Campanha X", `files/rows.ts`), and opens `/files/{id}`; the list is paged (`?page=`); an
    empty list says so in one sentence.
  - A material's page shows "Onde pertence" (`src/components/MaterialPlace.tsx`): the place in a sentence and
    "Alterar", which opens the pickers on the current place; a place they cannot show (an archived campaign, a system
    not offered) or no place opens with nothing picked, "Em nenhum lugar" is never offered, and "Salvar" waits for a
    pick. When the campaigns and systems could not be loaded, the reason shows instead of "Alterar". "Salvar" posts to `changePlaceAction`
    (`files/[id]/actions.ts`) on the version the page read, which refreshes the page; the form closes, focus goes back to
    "Alterar" and a polite status says "Vale a partir da próxima pergunta.". A stale save (`request.stale_version`)
    brings the current place and version with the stale line, the form open; any other refusal shows its text with the
    choice kept. The form is posted from `onSubmit` in a transition, not through `action`, so React's reset after an
    action never puts the selects back to their first option while the form stays open.
  - The system page's materials tab names each row's place: "Sistema" (this system alone), "Campanha X", or the names
    of its systems.
  - New code `material.belonging_invalid`, in both catalogues. The stand-in backend's material belongs to the starter
    campaign at version 0, and a change answers it in the starter system at version 1.
- **The usability pass (2026-11-21).** No contract change. Dalton asked for a review of every screen against UI and UX
  practice (hierarchy and contrast, spacing, feedback after actions, one notification system, file previews, view
  options), with the prototype as a starting point and not a limit. DESIGN.md and EXPERIENCE.md were revised with it.
  - **Page structure.** Every signed-in page starts with `PageHeader`: the way back to the list or the item it belongs
    to (a link above the title), the title (the page's one `<h1>`, in the page-title size), muted lines under it, and
    its actions on the right. Under it come `Tabs` (a page's sections on a rule, or a list's filters as chips), cards
    (`Card`, and the cards of the material page) and `EmptyState` (an icon, one sentence, at most one action). The main
    column sets one gutter (32px, 16px on a phone) and one gap between a page's blocks (24px), so no page part carries a
    margin of its own. A bar of a fixed height above the page holds the context bar on the left and the bell on the
    right.
  - **The sidebar.** 296px wide. Entries read from the left, each with an icon; the current one has the active
    background, a heavier weight and a bar on its left edge. The campaign switcher is a bordered box with a chevron
    under its label. Under 768px the handle is a round menu button at the top left, in the bar, and the page keeps its
    whole width; from 768px to 1279px it was still a tab at mid-height on the left edge until the fourth pass (below).
  - **Buttons and fields.** A pill is outlined (`default`), filled with the text colour (`solid`, the one main action),
    outlined in the danger colour (`danger`, a destructive action; the confirmation dialog fills its own) or without an
    outline (`quiet`). Every one has hover, pressed and disabled states. A field is a bordered box in the field colour
    with a 12px radius, never the control colour of a button; an invalid one has a 2px danger edge and its text under it.
  - **Feedback after actions.** A Server Action that succeeds calls `flash(status, text)` (`src/server/flash.ts`) before
    its `redirect` or `refresh`: creating, changing and deleting a system; creating, renaming, archiving, restoring,
    choosing and deleting a campaign; accepting, reprocessing, retrying and discarding a material. The text, already
    translated, goes in `__Host-gmshield-flash` (`Secure`, `SameSite=Lax`, `Path=/`, 30 seconds, not `HttpOnly`: the
    page reads it). It holds a status and at most 300 characters, never an identifier or a secret. A refusal sets
    nothing: the form or the control says it, as before.
  - **Notifications.** `NotificationsProvider` wraps the shell. `useNotifications().notify({ status, message, link })`
    shows a toast at the top of the window, in the middle, and keeps a line in the bell's list for the visit (in
    memory only, 30 at most). A toast goes after 6 seconds (10 for a warning), waits while the pointer or the focus is
    on it, and an error stays until dismissed; three show at most. Each is a live region (`status`, or `alert` for an
    error) with its status as a word beside its icon. After every render and on every change of page the provider reads
    the flash cookie once, tells it and clears it. The uploads tell the end and the failure of an upload the same way
    (`quiet`: their own live region already announces it). The bell (`NotificationCenter`) counts what waits and what is
    new, and its list shows first what waits for the GM (every material that needs review or failed, from the layout),
    then the visit's notifications with their time; opening it marks them seen and takes the toasts away, "Limpar"
    empties the visit's list.
  - **View options.** A list's toolbar holds its filters on the left and "Exibição" (`ViewMenu`) on the right: list or
    grid, comfortable or compact, and for lists with thumbnails, whether they show. A choice applies at once and is
    written to `__Host-gmshield-view` (`files:grid:compact:1|campaigns:…|systems:…`, a year, not `HttpOnly`), which the
    server reads (`currentViews`), so the next render already has it. "Meus Arquivos" filters by state through
    `?state=` (`all`, `ready`, `review`, `progress`, `failed`; `files/filters.ts`): the backend filters, and the page
    links keep the filter. There is no sorting: the backend lists newest first only.
  - **File previews.** A material that needs review or is ready and has pages carries its first page's picture address
    in its row (`previewOf`, `files/rows.ts`): `Thumbnail` shows it (a plain lazy `<img>` from the picture relay, which
    needs the session cookie; the list's icon when there is no picture). "Pré-visualizar" beside the row opens
    `MaterialPreview` in the shell's right panel slot: the material's pages from the first, read one at a time through
    the Server Action `previewPageAction` and shown with `PageView`, with previous and next (← and →), "Abrir arquivo"
    and Esc to close; focus goes back to the control that opened it. The material's own page shows its first page beside
    its facts, with "Ver páginas" under it.
  - **The conversation.** The column is 800px wide at most. With nothing asked yet, the middle of the screen says what
    it is for; the composer stays at the bottom of the window. A question heads its turn in a heavier weight behind a
    bar, and Send is the solid main action.
  - **Second pass, same day**, after Dalton's review of the first: the sidebar did not reach the bottom of a long
    page, the theme and language controls were badly placed, and the upload still had problems.
    - **Sidebar and panel height.** Both were `position: sticky` inside the shell's grid, so they stopped short of the
      window's bottom whenever the document was taller than the grid (in development, Next.js's own indicator adds
      46px under it). They are now `position: fixed`, top to bottom, and the grid keeps their room through two custom
      properties (`--sidebar-track`, set by `.shell:has(> [data-wide='open'])` from 1280px; `--panel-track`, set by
      `data-panel`). The page itself still scrolls.
    - **Account menu.** `AccountMenu` (a round button with the username's initial, at the right end of the bar) holds
      who is signed in, `PreferencesForm` and "Sair". The logo in the sidebar is a link to `/questions`; `LogoMenu` is
      gone. `PreferencesForm` is two segmented controls of submit buttons (`name="theme"` or `name="language"`,
      `aria-pressed` on the current one): a press posts that one choice, which applies at once and leaves the menu
      open; it still works without JavaScript, and there is no "Aplicar". The sign-in screen shows it at its top right
      (`layout="inline"`), outside the card. `useDisclosure` (`src/components/useDisclosure.ts`) is the shared
      open, Esc and press-outside behaviour of the account menu, the bell and "Exibição".
    - **Guided upload.** The files step has a drop area (`data-testid="upload-drop"`: files dragged from the computer
      are added as the button adds them, it lights up while files are over it, and anything else dragged is ignored);
      the chosen files are rows with an icon, what the check said and an icon button "Remover {name}"; the step count
      is also drawn as marks; the actions sit at the dialog's bottom with "Voltar" on the left; a file being sent shows
      its percentage, never under 0 or over 100.
    - **Upload tray.** The layout gives it only the materials in motion (uploading, waiting, processing). One that
      needs review or failed is listed under the bell, not also as "in progress".
    - **Busy states.** `PillButton` takes `pending` (a `Spinner` before its text and `aria-busy`); forms and actions
      pass it while their Server Action runs. `LinkPending` (Next.js's `useLinkStatus`) shows a spinner at the end of
      a sidebar entry and in place of a list row's arrow while the page it leads to is on its way.
    - **Titles, skip link, errors.** The root metadata has a title template ("%s · GMshield"); each section's pages
      are titled after its sidebar entry (`(signed-in)/section-metadata.ts`, a `layout.tsx` in `files`, `systems` and
      `campaigns`, and `generateMetadata` in the single pages). "Pular para o conteúdo" is the shell's first Tab stop
      and leads to `#content`, the main column. `error.tsx` at the root and inside `(signed-in)` renders `ErrorScreen`:
      the page could not be shown, in the interface's language, with "Tentar de novo" (`retry`) and the way home; the
      not-found page is a card with its title and the way home, and still says nothing more.
    - **Material pages.** A page of a material has "Página anterior" and "Próxima página" in its header as well as
      under the page; a material being read shows a progress bar over its page counts.
  - **Third pass, same day**, after Dalton asked to remove unnecessary scrolling and to page what needs it.
    - **The scroll that was not the app's.** In `next dev` every signed-in screen scrolled by 46px: Next.js puts its
      development indicator under the page. `next.config.ts` sets `devIndicators: false` (compile and runtime errors
      still show), so what scrolls in development is what scrolls in production.
    - **Paged lists.** "Meus Arquivos", "Sistemas", "Minhas Mesas" and the two tabs of a system's page show one page
      of rows, 10 unless "Exibição" says 20 or 50 ("Por página"; the size is the fifth field of the view cookie:
      `files:list:comfortable:1:20`). The page is in the address (`?page=3`, with the filter or the tab kept), so it
      can be linked and reloaded, and the pager is links: it works without JavaScript. `Pager`
      (`src/components/Pager.tsx`) under the rows says which rows show ("21–30 de 61"), then "Anterior", the page
      numbers (the first, the last, the current one and its neighbours; `aria-current` on the current one) and
      "Próxima"; at an end the arrow that leads nowhere stays in place, dimmed and not a link. On a phone the numbers
      give way to "Página 3 de 7". A compact pager in the toolbar (the range and the two arrows) turns the page
      without scrolling to the end of the rows. A list of one page shows only its count ("7 itens"). A page past the
      end is the last one; anything that is not a page number is the first (`src/paging.ts`: `pageParam`, `pageOf`,
      `pageWindow`, `pageHref`). "Carregar mais" and its Server Actions (`moreFiles`, `moreSystems`, `moreCampaigns`,
      `moreMaterials`, `moreCampaignsAction`) are gone.
    - **Where the pages come from.** One call a page since public contract 1.22.0: `listPage`
      (`src/server/list-page.ts`) asks the list for `limit` (the page's size) and `offset` (its start; none on the
      first page) and takes the list's `total` from the answer, so the pager numbers the pages without reading the
      list. A page past the end is asked again as the last page; the furthest start is 100,000, the backend's limit.
      Until that contract the screens read a whole list through its cursor to cut a page out of it; `everyPage`
      (`src/server/every-page.ts`) remains for what needs a whole list: the campaigns and systems a material can be
      given, and the campaign switcher.
    - **The quality report.** A book's outline has hundreds of sections and a poor scan dozens of unreadable runs, and
      the material's page listed them all. The outline shows 10 at a time and the unreadable pages 12 runs, each with a
      compact pager beside its heading (`?outline=`, `?unreadable=`; each keeps the other, and turning one does not
      move the page: `scroll={false}`). Indents come from the whole outline. "Onde pertence" is one row while its form
      is closed.
    - **The page view.** The header has "Ir para a página": a number field and "Ir" between the two page links, a
      plain GET form to `/files/{id}/pages?page=N`, which answers with the page's own address (past the last page: the
      last page), so it works without JavaScript. From 901px the picture is as tall as the window leaves and the
      extracted text scrolls within the same height, so the page is seen whole and nothing is turned by scrolling; the
      links under the page remain for one column.
    - **Pages that fit their room.** `PageView` takes `fit`: the SVG then carries a size of its own in the picture's
      shape (attributes, larger than any screen), and two CSS limits (the column's width, `--page-height` set by the
      screen that holds it) bring it down, as for a picture. The page view, the source view and the preview panel use
      it, so a cited passage is in view when the source view opens, with no scroll inside the panel.
    - **The conversation.** A question just asked comes to the top of the window (`scrollIntoView`, without gliding
      under reduced motion), and the newest turn is as tall as the window above the composer, so its answer is written
      in view; only a new turn moves the page, never a piece of the answer. Before, a new question landed under the
      docked composer once the conversation was longer than the window.
    - **One thing scrolls at a time.** The guided upload scrolls its step, not the whole dialog: the title, the step
      count and the actions stay in view with twenty files chosen, and the drop area becomes one row once files are
      chosen. "Vários sistemas" lays its checkboxes in columns (a library of 23 systems made the place form 2,700px
      tall). The bell shows the first five things that wait and one link to the rest ("Mais 7 em Meus Arquivos",
      to the list filtered by state), and still counts them all.
  - **Fourth pass, same day**: a walk through every completed story's screens and states (with the demo backend's
    conversation states, an empty first-day account and long lists), which found two more menus in the wrong place.
    - **The closed sidebar's handle.** From 768px it was a tab at mid-height on the left edge, far from the control
      that closes the sidebar, with the logo mark alone at the top left and a 76px gutter kept for both. At every width
      it is now the round menu button at the top left, in the bar, where the phone already had it; the bar keeps its
      room under 1280px, the page keeps the ordinary gutter, and the mark is not shown while the sidebar is closed.
    - **The campaign switcher in the sidebar.** Its list opened in place and pushed the navigation down, with a
      scroll area inside the sidebar's own. It floats under its button now, as the one in the bar does.
- **Numbered pages from the backend.** Public contract 1.22.0 (the minimum this frontend worked with until 1.23.0): the three
  lists answer `total` and take `offset`. "Meus Arquivos", "Sistemas", "Minhas Mesas" and a system's two tabs ask for
  one page each (`listPage`); nothing a user sees changes, except that a library of any size costs one call a page.
  The stand-in backend's lists carry a `total`. Deploy order: the backend first (its health check fails this frontend
  against a 1.21.0 backend).
- **Replace a material (Story 3.4, part A).** Public contract 1.23.0. A material shows its current version (the newest
  one not discarded); `Material.serving` (`{pages, size}`) is its ready version while a new one is on its way, else
  null. Read a missing `serving` (a backend before 1.23.0) as null.
  - A ready material's page offers two plain pills in `MaterialActions` (`ready`): "Substituir" opens the guided upload
    in replace mode (`openUpload({replace: {materialId, name}})`, through `useOptionalUploads`) and "Reprocessar" posts
    `reprocess` at once, with no confirmation (nothing is removed: the backend reads a new version from the stored
    original while the accepted one keeps serving). "Reprocessar páginas com falha" stays the label while it needs
    review. While `serving` is set, a line under the state says "A versão anterior (N páginas) continua em uso enquanto a
    nova não for aceita." (`material.serving.*`).
  - Replace mode (`UploadsProvider.replace`, `replaceMaterial`): the dialog's title is "Substituir {name}"; it asks for
    one file or one photo set ("Escolha um só arquivo, ou só fotos." otherwise, and "Enviar" waits), several photos go
    through the order step with no name to give, then it sends: a file through tus with the metadata `material` alone,
    a photo set through `createImageSetAction` with `{name, material, images}` (which refuses a kind, language or place
    beside it). There is no kind, place or language step; the material keeps its own. The tray pairs the new version's
    row with the material as for any upload. Closing it gives focus back to "Substituir".
  - New codes `material.version_in_progress` and `material.not_ready`, in both catalogues. The stand-in backend's
    materials carry `serving: null`; an accepted (or moved) one is ready with `actions: ['reprocess']`, and a reprocess
    answers a new version `waiting` with the 444 pages of the accepted one serving.
- **Delete a material, remove a previous version (Story 3.4, part B).** Public contract 1.24.0. `Material.superseded`
  (`[{id, createdAt, pages, size}]`, newest first) names the material's superseded versions; read a missing one (a
  backend before 1.24.0) as none. `src/server/materials.ts` adds `materialDeletion` (`{versions, pages}`),
  `deleteMaterial` and `removeVersion` (both 202, no body).
  - "Excluir" is a danger pill in the material page's `PageHeader` (`MaterialDeleteAction`, after `CampaignDeleteAction`):
    its `ConfirmationDialog` is titled "Excluir «{name}»?", says "Vão junto: {versions} e {pages}, com as imagens e o
    texto extraído. As respostas que citaram este arquivo mostram «fonte removida». Isso não pode ser desfeito." (one and
    other forms, "1 página lida" / "{count} páginas lidas"; the versions alone, with the uploaded file, when no page was
    read; in words when the count cannot be read) and confirms with "Excluir arquivo". `deleteMaterialAction`
    reads the material for its name, deletes it, flashes "Arquivo «{name}» excluído.", revalidates the layout and
    redirects to `/files`.
  - "Versões anteriores" (`SupersededVersions`) is a card in the facts column, after "Onde pertence", shown only when
    `superseded` is not empty: one row per version ("Enviada em {date} · {pages} páginas · {size}", the day in UTC so
    the server and the browser agree), each with a danger pill "Remover" (its spoken name adds the day). One
    `ConfirmationDialog` for every row ("Remover esta versão?", the pages that go, "Remover versão").
    `removeVersionAction` removes it, flashes "Versão anterior removida." and refreshes the page;
    `material.version_not_removable` comes back in words.
  - The stand-in backend answers `superseded: []`, the material's deletion count (`{versions: 1, pages: 444}`) and both
    deletes (202).
- **The campaign's version leads (Story 3.7).** Public contract 1.26.0 (the minimum backend contract too).
  - When the sources disagree, the backend relays a `tier` event (`TurnTierEvent` `{tier, offset}`, tier `campaign`,
    `system` or `other`) where each tier's version of the answer starts: the campaign's first, then each other tier's as
    an alternative. `parseTier` (`src/client/conversation.ts`) keeps only a tier the backend writes at an offset from 0;
    the screen keeps the events like citations (a replayed one is ignored by its sequence) and shows nothing of them
    while the answer streams.
  - At `done`, by the same rule as the superscripts, each one becomes a `TierLabel` pill ("Campanha" / "Sistema" /
    "Outros", "Campaign" / "System" / "Other": the `shell.scope.*` words, in the interface's language) at its offset in
    the Markdown text (`AnswerMarkdown`'s tier marks): moved forward over whitespace so it opens the version's first
    paragraph, before an emphasis or link that starts it, before a code block it opens, after the superscripts of the
    version before it. A pill at or past the end of the text is left out. Since a pill says the sources disagree, a
    marker repeating the tier before it is dropped, and no inline pill is drawn unless two tiers are left. The polite
    region says the same pills, and each reference line after its tier's word.
  - `TurnSourceReference.tier` is optional (none on a reference stored before 1.26.0): `References` draws the pill
    before the line, and none without a tier; `isReference` leaves out a reference with any other tier. A removed source
    keeps its tier.
  - `TierLabel` (`src/components/TierLabel.tsx`): an outlined span, no fill, the meta type, edge and word in
    `--color-text-muted`, `--radius-full`, followed by a visually hidden ": " so a reader never runs the word into the
    text. It is not focusable and has no role of its own, so it is read as its word.
  - The stand-in backend's answer is the campaign's house rule ("Notas da campanha.md", reference 1, the text page)
    under a campaign `tier` event, then the book's rule ("Livro do Jogador.pdf", reference 2, the picture page) under a
    system one; each reference carries its tier.
- **Model knowledge only when I turn it on (Story 3.8).** Public contract 1.27.0 (the minimum backend contract too).
  - The scope controls' model-knowledge switch is enabled (the "Chega em breve" note is gone): a press saves the whole
    settings with it turned, like any switch, and "Vale a partir da próxima pergunta." confirms it.
  - `TurnTierEvent.tier` may be `model` (`TurnTier`, `MODEL_TIER`, `TURN_TIERS` in `src/client/conversation.ts`):
    the model's own knowledge starts there. A reference never carries it (`TIERS` keeps three words).
    `TurnDoneEvent.modelKnowledge` is the turn's frozen switch; `parseDone(data, modelPart)` reads it (true only when
    it is `true`) and does not force a silent answer when the turn had a `model` tier event.
  - The `model` pill reads "Conhecimento do modelo" / "Model knowledge" (`campaigns.scope.modelKnowledge`) and is drawn
    even when it is the only marker (the rule of two tiers is for campaign, system and other only). A reader hears
    "Do conhecimento do modelo, sem fonte." / "From model knowledge, no source." (`conversation.modelSource`, the pill
    itself `aria-hidden`), and the same sentence closes that part as a muted `p` (`AnswerMarkdown`'s `modelEnd`) after
    the top-level block holding its end: before the next tier's pill, or at the answer's end. Neither takes focus.
  - Under a silent answer whose `done.modelKnowledge` is false, a muted line "Ampliar as fontes ou ligar o conhecimento
    do modelo" with a link-style button "Abrir o escopo" ("Widen the sources or turn on model knowledge" / "Open the
    scope"); the polite region says the line after the silent sentence, both in the turn's language. The button opens the context bar's scope
    popover with focus on its first switch through `ScopePopoverProvider` (`src/components/ScopePopoverContext.tsx`,
    provided by `Shell`; `ScopePopover` registers its opener). Without a popover to open, the line shows without the
    button. Under 768px the summary's button is hidden but the popover stays, so it still opens under the bar.
  - The stand-in backend's `done` carries `modelKnowledge: false`.
  - Deploy order: backend → worker → frontend. The worker before this frontend (the old frontend cannot turn the
    switch on, so nothing it can set is ignored), and this frontend last so the switch only turns on once the worker
    honours it.
- **Search the library (Story 3.9).** Public contract 1.28.0 (the minimum backend contract too).
  - **The field.** The context bar holds a search field (`src/components/search/SearchField.tsx`), after where the GM
    is and before the bell. A search runs on Enter only, never while typing: it opens `/search?q=…` (a plain form to
    `/search` without JavaScript). Esc in the field clears it. `/` focuses it when no field, editable text or dialog has
    focus (`focusSearchField` in `search-address.ts`: the first search field that can be seen, so on a phone the
    search page's own). Under 768px the field gives way to a search button that opens `/search`.
  - **The page.** `/search` (`src/app/(signed-in)/search/page.tsx`, `src/components/search/SearchPage.tsx`) has its own
    field at its top at every width, prefilled with the query. With a query and no stored search, it starts one through
    `POST /api/v1/campaigns/{id}/searches` (the relay, `createSearch` in `src/server/conversations.ts`) and replaces the
    address with `&s=<id>`, so a reload and a page turned read the stored search; it then reads
    `GET /api/v1/searches/{id}` (`getSearch`) every 500 ms for up to 30 s, a muted "Procurando nas fontes…" meanwhile.
    A failed search, or one not done in time, says so with "Tentar de novo"; a query the backend refuses is said beside
    the field; another account's search is "Não encontrado.". A stored search of another campaign (the GM switched
    since) is started again for the current one.
  - **The results.** Up to 20, ten a page (`?page=`, the shared `Pager`): the passage's first words, its tier
    (`TierLabel`) and its place as a reference line ("Material, Seção › Sub, p. N"). Selecting one opens `SourceView` in
    the right panel at that page, its passage marked, on the ground of the current scope: `SourceView` takes
    `ground={{kind: 'scope', campaignId, versionId}}` beside its turn ground (`turnId`, unchanged), and reads the page
    from `GET /api/v1/campaigns/{id}/sources/{versionId}/pages/{page}` and its picture from `.../picture` (the relays,
    `scopeSourcePage` and `relayScopePicture`). Closing it (Esc too) gives focus back to the result.
  - **The filters.** Chips for the tiers switched on only (and "Todas"), and a select of the materials switched on in
    them; a change starts a new, narrowed search from page 1 (the backend narrows the scope; the page never hides
    rows). A search that found nothing says so in one sentence naming the scope searched (`scopeTiers`, the tiers part
    of `scopeSummary`, and the filters).
  - Every string is in `search.*` and `shell.search.*`, in pt-BR and en. The stand-in backend records a search (202) and
    reads it done with two results, the campaign's notes (a text page) and the book (a picture page), each page
    answering on the current-scope path.
  - Deploy order: backend → worker → frontend.
- **Delete a conversation (Story 3.10 part B).** Public contract 1.30.0 (the minimum backend contract too).
  - **Where.** An opened conversation's slim top line holds "Excluir" after "Renomear", a danger pill
    (`src/components/conversation/ConversationDeleteAction.tsx`) that opens the shared `ConfirmationDialog`: "Excluir
    esta conversa?", "Vão junto: {n} perguntas e suas respostas. Isso não pode ser desfeito." (one question: "Vai
    junto: 1 pergunta e sua resposta."), and the confirm pill "Excluir conversa"; focus starts on "Cancelar".
  - **The count.** `openedConversationPage` reads `GET /api/v1/conversations/{id}/deletion` (`conversationDeletion` in
    `src/server/conversations.ts`) with the conversation; the dialog adds the questions the backend recorded on the
    page since. A conversation made on the page (its id from its first question), or one whose count could not be read,
    gets the words-only consequence ("Vão junto: as perguntas desta conversa e suas respostas.").
  - **The action.** `deleteConversationAction` (`conversation-actions.ts`) reads the conversation for its name and
    area, calls `DELETE /api/v1/conversations/{id}` (`deleteConversation`, 202), flashes "Conversa «{name}» excluída.",
    revalidates the layout and opens `/{area}`; a refusal is its text under the pill. A malformed id never reaches the
    backend. A deleted conversation's address then shows "Não encontrado.".
  - Every string is in `conversations.delete.*` and `feedback.conversationDeleted`, in pt-BR and en. The stand-in
    backend answers the preview (`{questions: 1}`) and the delete (202, no body).
  - Deploy order: backend → frontend.
- **Dismiss an answer (Story 3.11).** Public contract 1.31.0 (the minimum backend contract too).
  - **Where.** Under the rule of each finished (`done`) or stopped answer, right-aligned, a 28px circle filled with the
    text colour, with an X (`dismiss` in `Icons.tsx`) and a 44px hit area, spoken "Dispensar resposta". None while an
    answer is written, nor on a failed turn; the row leaves room before it for 3.12's bookmark.
  - **The relay.** `src/app/api/v1/turns/[id]/dismissal/route.ts`: `PUT` dismisses, `DELETE` undoes (`dismissTurn` and
    `restoreTurn` in `src/server/conversations.ts`), same-origin only, a malformed id "not found" without reaching the
    backend, no session `session.required`; the backend's 204 or problem goes back as it is. The browser calls it with
    `setDismissal(turnId, 'dismiss' | 'restore')` (`src/client/conversation.ts`).
  - **Dismiss.** The question and answer are replaced at once by "Resposta dispensada." and a "Desfazer" pill, which
    takes focus while the polite region says the line; the PUT is sent. A refused PUT brings the answer back with the
    refusal under its actions (focus on its dismiss button when it was on the pill).
  - **Undo.** "Desfazer" within `UNDO_MS` (10 s) sends the DELETE once the PUT has answered (it never overtakes it), its
    pill pending meanwhile; on 204 the turn shows again where it was, with focus on its dismiss button. A refused DELETE
    keeps the line with the refusal in it until the time ends. The time does not end a line whose undo is under way:
    that undo's answer does (refused after the time, the line goes then).
  - **After `UNDO_MS`** the line goes; focus on its pill moves to the composer. Dismissed turns stay in the component's
    state behind a flag, so the count of questions asked here still works; the delete dialog's count leaves them out,
    and a conversation whose every turn is gone shows its intro again, as a reload would.
  - Strings `conversation.dismiss`, `conversation.dismissed` and `conversation.undo`, and the errors category
    `conversation` with `conversation.turn_running` ("Esta resposta ainda está sendo escrita. Espere ela terminar para
    dispensá-la."), in pt-BR and en.
  - Deploy order: backend → frontend.
- **Bookmark answers and find them again (Story 3.12).** Public contract 1.32.0 (the minimum backend contract too).
  - **The bookmark.** Before dismiss, under each `done` answer that is not silent (none on a silent, stopped, failed or
    running one; a silent answer cannot be saved, and the backend refuses it too): unset, a
    filled 28px circle with an outlined bookmark (`bookmark` in `Icons.tsx`), spoken "Salvar resposta"; set, an
    outlined circle with a filled bookmark (`bookmarkFilled`, drawn filled), spoken "Remover dos itens salvos", with
    `aria-pressed`. A press changes it at once, then sends `setBookmark(turnId, 'save' | 'remove')`
    (`src/client/conversation.ts`) after any change still under way for that turn; a refusal of the latest press puts
    it back and shows its text under the actions (`conversation.turn_not_done`: "Só uma resposta concluída pode ser
    salva."). Each stored turn's `bookmarked` sets it when the conversation opens.
  - **The relays.** `src/app/api/v1/turns/[id]/bookmark/route.ts` (`PUT` saves, `DELETE` removes: `bookmarkTurn`,
    `unbookmarkTurn`) and `src/app/api/v1/saved-answers/route.ts` (`GET`, `savedAnswers` calling the backend's `listSavedAnswers`; `limit` 1–50 and `offset`
    0–100000 checked before the backend, else `request.invalid`), same-origin only, no session `session.required`.
    The browser reads a page with `loadSavedAnswers(offset, limit)`.
  - **The panel.** `src/components/saved/`: `SavedItemsProvider` (beside `ShellFrame`) holds whether it is open, the
    current campaign and a count `savedChanged()` raises after each bookmark change, so the open panel reads its list
    again. `SavedItemsButton` sits in the bar before the bell ("Itens salvos"); Ctrl+Shift+S or ⌘⇧S opens or closes it
    from any signed-in screen, even while a field has focus. `SavedItemsPanel` fills the right slot (`ShellPanel
    kind="saved"`, `data-panel="saved"`): 340px beside the page at 1280px and more, over it (inert behind) under
    1280px, a full-screen sheet under 768px. Focus starts on its close control; Esc or the close control closes it and
    gives focus back to what opened it. Entries newest first, ten a page with a `<Pager compact>` at its foot (the page
    is the panel's own state, not the address): a meta-line (`area › conversation`, led by the campaign when it is not
    the current one), the excerpt clamped to three lines, and "Ir". With none saved, one sentence.
  - **One right panel at a time.** `ShellFrame`'s claim takes the panel's kind and an `onReplaced`: a new claim calls
    the previous holder's, which closes it without giving focus back (the source view, the search page's source view,
    a material preview, or the saved items).
  - **"Ir".** In the current campaign, a link to `/questions/{id}?turn={turnId}` or `/rules/{id}?turn={turnId}`; in
    another, a form whose Server Action `openSavedAnswerAction` (`campaigns/actions.ts`) chooses that campaign, flashes
    "Campanha trocada para «…».", revalidates the layout and redirects there (a refusal shows under the pill). Under
    1280px the panel closes: at once for a link, when the new page arrives for the form. The conversation page passes
    `?turn=` as `focusTurn`: each turn's `<li>` is `turn-<id>`, and that one is scrolled into view instead of the last
    and takes focus (`tabIndex={-1}`, never a keyboard stop); a turn not among those loaded leaves it at the last turn.
  - Strings `conversation.bookmark`, `conversation.unbookmark`, `saved.*` and `errors.codes.conversation.turn_not_done`,
    in pt-BR and en; the new colour pairs (the set bookmark's outline and icon, the meta-line) are in
    `test/contrast.test.ts`. The stand-in backend answers `bookmarked: false` on its stored turn, 204 for a bookmark,
    and two saved answers (one of another campaign).
  - Deploy order: backend → frontend.
- **The core vocabulary in every system (Story 4.1).** Public contract 1.33.0 (the minimum backend contract too).
  - **Two more tabs** on a system's page, after "Materiais": "Registros" and "Propostas de ontologia" (`?tab=records`,
    `?tab=proposals`; any other value is the campaigns tab). Each tab is a link, so each is reached and opened from the
    keyboard.
  - **"Registros"** lists the system's record types through `listRecordTypes` (`src/server/library.ts`, the backend's
    `GET /api/v1/systems/{id}/record-types` with `limit` and `offset`): the eight core types first, in their fixed order.
    A row (`recordTypeRow`, `systems/rows.ts`) is a core type's name in the interface's language
    (`systems.recordTypes.<core>`: Regra, Magia, Item, Criatura, Ficha de personagem, Encontro, Masmorra, Nota; Rule,
    Spell, Item, Creature, Character sheet, Encounter, Dungeon, Note), never its stored name, and its record count
    ("1 registro", "N registros"). A row opens nothing until the records list exists (Story 4.3) and offers no action: a
    core type can be neither renamed nor removed. The list is paged and has its own "Exibição" view (`recordTypes` in
    the view cookie).
  - **"Propostas de ontologia"** reads nothing and says in one sentence that there is nothing to review yet (Story 4.4
    fills it).
  - Strings `systems.page.records`, `.proposals`, `.recordTypeList`, `.noRecordTypes`, `.noProposals`,
    `.recordsOne`, `.recordsOther`, `systems.recordTypes.*`, and the category `errors.categories.ontology` with
    `errors.codes.ontology.core_record_type`, `.record_type_name_invalid` and `.record_type_name_taken`, in pt-BR and
    en. The stand-in backend answers the eight core types, none with records.
  - Deploy order: backend → frontend.
- **Records found by type (Story 4.2 part A).** Public contract 1.34.0 (the minimum backend contract too).
  - The quality report (`QualityReport`) gains, after its warnings, "Registros encontrados": a plain list of each
    record type's name in the interface's language (`CORE_NAMES`, `src/record-types.ts`, shared with the records tab)
    and its count, in the backend's order, or "Nenhum registro." when the version has none. A type this release does not know is left
    out, never shown as its key. The warning `report.records_unread` says how many pages' records could not be read
    (their passages were kept).
  - The records tab's counts come from the backend unchanged: from contract 1.34.0 they are the records of the
    system's accepted versions.
  - Strings `material.report.records`, `.recordsNone`, `material.report.warning.records_unread.{one,other}` and
    `errors.codes.ontology.record_type_in_use`, in pt-BR and en. The stand-in backend's report carries records of three
    types and the unread warning.
  - Deploy order: backend → worker → frontend.
- **Browse records (Story 4.3 part A).** Public contract 1.35.0 (the minimum backend contract too).
  - A row of the system's records tab opens `/systems/{id}/record-types/{typeId}`: the type's name as the title, the
    system's name as the way back to its records tab, and the type's records (`listRecords`) in an `ItemList` with the
    "Exibição" menu (view key `records`) and the pager; each row shows the record's name, with "material, p. N" as the
    detail. An empty type says in one sentence that records come from accepted materials, with no action.
  - A record row opens `/systems/{id}/records/{recordId}` (`getRecord`): the name under its record type (the way back
    to the type's list), its fields as a two-column `<dl>` closed by a rule (none drawn when it has no field), then its
    source references (`RecordReferences`), each a button that opens the source view (`SourceView`, ground
    `{kind: 'record', systemId, recordId}`) at that page in the right panel, the reference's `passageIds` (the record's
    passages on that page) marked as an answer's cited passages are; Esc gives focus back to the reference.
  - Relays: `GET /api/v1/systems/{id}/records/{recordId}/pages/{page}` and `.../picture` (`relayRecordPicture`).
  - Strings `systems.records.*` in pt-BR and en. The stand-in backend answers three records of a type, a record with
    four fields and two references (the first names the passage of its version's text page), and that text page.
  - Deploy order: backend → frontend.
- **Records in library search (Story 4.3 part B).** Public contract 1.36.0 (the minimum backend contract too).
  - A search result has a `kind`. A passage's row is as before; a record's row (`SearchPage`) shows the record's name
    (label weight), its record type as a filled pill (`recordTypeName`, moved from `systems/rows.ts` to
    `src/record-types.ts` with `CORE_KEYS` and `isCoreKey`), its tier and its place line (its first page), and is a link
    to `/search/records/{recordId}` with the search's address (`searchRecordHref`), so its way back is the same search.
    `isResult` (`src/client/search.ts`) checks both kinds; anything else makes the answer none.
  - A type `<select>` sits beside the material select, listing "Todos os tipos" and the eight core types; a choice
    starts a new search from page 1 with `type=<core key>` in the address (`search-address.ts`), sent as `recordType`
    (`startSearch`, the relay `campaigns/[id]/searches`); it combines with the tier chips and the material, and the
    sentence of an empty search names it. The page parses its address with `search-params.ts` (`searchAddressOf`), shared
    with the record page.
  - `/search/records/[recordId]` reads the record from the current campaign (`getCampaignRecord`,
    `GET /api/v1/campaigns/{id}/records/{recordId}`): its name as the title, its record type as the subtitle, its fields
    (`RecordFields`, shared with part A's page) and its references (`RecordReferences`, whose `ground` is now
    `{kind: 'record', systemId, recordId}` or `{kind: 'scope', campaignId}`), each opening the source view on the scope's
    ground with the record's passages marked. The way back is the search's address, labelled "Busca". A record outside
    the scope, or no current campaign, is "Não encontrado."; another failure is a notice under the header.
  - Strings `search.type` and `search.allTypes` in pt-BR and en. The stand-in backend's search leads with the record
    "Fire Bolt" and answers it from the campaign as well.
  - Deploy order: backend → worker → frontend.
- **Records in answers (Story 4.3 part C).** Public contract 1.37.0 (the minimum backend contract too).
  - A reference of the `done` event has a `kind` (`passage` or `record`; one without a kind reads as a place's). A
    record's reference also has `recordId`, `recordType` (a core key), `name` and `fields`, as they were when the answer
    was written (`isReference` checks both kinds, `isRecordReference` tells them apart). A `recordType` this
    interface does not know is kept and shown as its key (`referenceTypeName`), so no reference or number is lost. A `citation` event names a
    `passageId` or a `recordId`, exactly one (`parseCitation`).
  - `marksOf`: a record's citation takes its record entry's number; a passage's citation only a place's reference
    (a record's reference lists its passages too, for the source view).
  - `References`: a record is its own numbered entry: its tier's pill, its name and its type's chip (`coreTypeName`),
    its fields as `RecordFields` without the closing rule (`rule={false}`; names in label type, values in body type),
    then its source line, which alone is a button and opens the source view at the record's first page on the turn's
    ground, its passages marked; the name opens nothing. A removed source's line is struck through and opens nothing,
    and its fields stay. The polite region says "name, type." before the source line. A passage's reference is one line
    as before. No new string.
  - The stand-in backend's answer also cites the Fire Bolt record (reference 3). The demo backend's "magia" question
    answers with a passage and a record.
  - Deploy order: backend → worker → frontend.
- **Ontology proposals and terms (Story 4.4 part A).** Public contract 1.38.0 (the minimum backend contract too).
  - The system page's last tab is "Ontologia" (`?tab=proposals`): "Propostas pendentes", the system's pending proposals
    (`listSystemProposals`, paged on `?page=`), then "Termos aprovados" (`listTerms`, an `ItemList` with its own
    "Exibição" key `terms`, paged on `?terms=`: `ListPaging.field`). Each says in one sentence when it is empty.
  - `ProposalList` (`src/components/ProposalList.tsx`): a row shows the name, its kind, where it comes from ("De
    {material}", "material removido", and the system on a material in several), a term's definition and the examples
    with their pages, then "Aprovar", "Renomear" (an inline bordered field, then "Aprovar como"), "Mesclar" (a select of
    the system's record types or terms of the same kind, `mergeTargets`, then "Mesclar") and "Rejeitar". Every control
    is a button, a field or a select, so the row works from the keyboard; a decided row that held the focus hands it to
    the next row's first pill.
  - `decideProposalAction` (`src/app/(signed-in)/proposal-actions.ts`) posts the decision on the version read
    (`decideProposal`), then `flash()`, `revalidatePath` of the system's and the material's pages and `refresh()`. A
    stale answer shows "Este item mudou em outra aba." with "Ver a versão atual" (a refresh); any other refusal its
    text (`ontology.name_taken`, `ontology.name_invalid`, `ontology.merge_target_invalid` are new texts).
  - A material's page lists its pending proposals after the quality report (`listMaterialProposals`, paged on
    `?proposals=`), with the same decisions; nothing shows while none is pending.
  - The stand-in and the demo backend (`docs/tools/frontend-demo-backend.mjs`) answer proposals and terms.
- **Records of approved types (Story 4.4 part B).** Public contract 1.39.0; the minimum backend contract stays 1.38.0,
  since this release names any key and a backend of 1.38.0 sends core keys only (deploy the frontend before the
  backend).
  - A record type key is any `^[a-z][a-z0-9_]{0,31}$` (`isRecordTypeKey`). No contract field carries a type's name:
    `typeLabel(key, types, t)` (`src/record-types.ts`) names a key by its core translation, else by the name of the
    record type with that key in the list the screen read, else by the key itself.
  - Search: `search/page.tsx` reads the campaign's system's record types (`systemRecordTypes`, every page); the type
    select offers them (the core ones translated, then the approved ones by name; the core keys when unread, and the
    address's own key when it is none of them), and a record result names its key from them. `?type=` takes any key.
  - Answers: the conversation pages read the campaign's system's approved types (`getCampaign`, then
    `systemRecordTypes`) and `References` names a cited record's key from them, for the eye and the screen reader.
  - Quality report: a key that is not core follows the core types under its type's name ("Talento: 3"), read from the
    record types of the material's systems only when the report has such a key; an unknown key shows as itself, never
    left out. `RecordTypeOfRecord.core` may be null (an approved type), and the record page shows its stored name.
  - The stand-in answers the approved type "Talento" in the system's record types, a `talento` search result and a
    report count; the demo backend has it approved with three records (search "ataque", ask about a "talento").
- **Correct a record (Story 4.5 part A).** Public contract 1.40.0 (the minimum backend contract too: a record's
  `version` and the two `PATCH` routes are new; deploy the backend first).
  - `RecordCorrection` (`src/components/RecordCorrection.tsx`), on a system's record page and on a search's record page:
    the record's fields (`RecordFields`, its children) and "Corrigir" under them. "Corrigir" opens a form in their place
    with the `SystemForm` bordered fields: the name, the type (a select of the page's system's record types, core and
    approved, `systemRecordTypes`; the campaign's system on the search page), and each field as a name, a value and
    "Remover campo", then "Adicionar campo", "Salvar" (the solid pill) and "Cancelar". The form takes the focus on the
    name, a new field on its name, and "Corrigir" gets it back when the form closes; every control is a button, a field
    or a select. A row is one column on a phone.
  - `correctRecordAction` (`src/app/(signed-in)/records/actions.ts`) sends the name, type key and fields on the
    version read (`correctRecord`, `correctCampaignRecord`), then `flash()` "Registro corrigido.", `revalidatePath` of
    the systems' and the search's pages and `refresh()`. A stale answer reads the record again and answers `{stale,
    currentVersion}`: the form keeps the GM's edits and says "Este item mudou em outra aba." with "Ver a versão atual"
    (the page read again, the form closed) and "Manter a minha como nova versão" (the GM's edits sent again on the
    current version).
    Another refusal shows under its part: `record.name_invalid`, `record.type_invalid`, `record.fields_invalid`, and
    `record.field_name_invalid` / `record.field_value_invalid` under the field their `index` names. The category
    `record` is new.
  - The stand-in answers both `PATCH` routes with the record at version 1; the demo backend
    (`docs/tools/frontend-demo-backend.mjs`) corrects its records in memory, refuses the limits as the backend does, and
    answers a save on an old version (two tabs) as stale; a name with "outra aba" in it plays another tab saving first.
- **Delete a record (Story 4.5 part B).** Public contract 1.41.0 (the minimum backend contract too: the two `DELETE`
  routes are new; deploy the worker, then the backend, then this frontend).
  - `RecordCorrection` takes `deletion`: "Excluir", a danger `PillButton`, sits beside "Corrigir" on both record pages
    and opens `ConfirmationDialog` as a campaign's delete does ("Excluir «{name}»?", what the delete does, "Excluir
    registro"; "Cancelar" or Esc closes it and the focus goes back to "Excluir", which stays focusable with
    `aria-disabled` while the delete runs). A refusal shows as an alert under the pills.
  - `deleteRecordAction` (`src/app/(signed-in)/records/actions.ts`) sends no version (`deleteRecord`,
    `deleteCampaignRecord`), then `flash()` "Registro excluído.", `revalidatePath('/', 'layout')` and `redirect`: to the
    record type's list on a system's page (the type's id posted with it), back to the search on a search's page (its
    posted address kept only when it is `/search?…`, else `/search`). A `request.not_found` (already deleted in another
    tab) moves the page on the same way, without the toast. Messages `systems.records.delete.*`.
  - The stand-in answers both `DELETE` routes with 204 from the contract; the demo backend deletes its records in
    memory (lists, counts, record pages and search follow) and refuses a record named "Falha ao excluir" with 404.
- **Write an artifact by hand (Story 5.1 part A).** Public contract 1.42.0 (the minimum backend contract too: the
  three artifact routes are new; deploy the backend, then this frontend). `src/server/artifacts.ts` calls them:
  `createArtifact`, `listArtifacts`, `getArtifact`, and `artifactsPage` (a list page with the record types in use).
  - A campaign's page gains the tab "Artefatos" (`?tab=artifacts`, read only on that tab): "Novo artefato" (a solid
    pill), then the campaign's artifacts newest first in `ItemList` (`viewKey="artifacts"`, paged with `listPage` and
    `?page=`), each row the artifact's name and its record type (`typeLabel`: a core type translated, an approved one by
    the name its system gives it), opening its page. The type chips (`Tabs variant="chips"`: "Todos", then each type in
    use with its count, from the list's `types`) narrow it with `?type=`, which the page links keep. An empty campaign
    says so in one sentence with "Novo artefato"; a type with none leads back to all.
  - `/campaigns/[id]/artifacts/new` (`?type=` chooses the type, else a note) is `ArtifactForm`: the record's editable
    body, `RecordFieldsEditor` (the name, the type among the campaign's system's record types, the field rows with
    "Remover campo" and "Adicionar campo"), now shared with `RecordCorrection`, whose behaviour is unchanged; then
    "Conteúdo", a bordered textarea; then "Salvar" and "Cancelar". `createArtifactAction`
    (`campaigns/[id]/artifacts/actions.ts`) reads the post with `valuesOf` (moved with `fieldOf` to
    `records/form-values.ts`, which both actions use), then `flash()` "Artefato salvo.", `revalidatePath('/',
    'layout')` and `redirect` to the artifact's page. A `request.invalid` naming `params.field` shows its own text
    (`artifacts.errors.*`, with its limits) under that part, the focus moved there, with what was typed kept.
  - `/campaigns/[id]/artifacts/[artifactId]`: `PageHeader` (back to the artifacts tab, the type as the subtitle), the
    fields (`RecordFields`), the content as plain text (line breaks kept, never HTML), and "Fontes", which says a
    hand-written artifact has none.
  - "Personagens" (`/characters`) lists the current campaign's character sheets (`?recordType=character_sheet`) the
    same way, with "Nova ficha" (the form with `character_sheet` chosen); with no sheet, one sentence and "Nova ficha";
    with no current campaign, one sentence and a link to the campaigns. Its rows and "Nova ficha" carry
    `from=characters` (the only value taken), so the form's "Cancelar", the artifact page's way back and the page a save
    opens lead back to "Personagens"; otherwise both pages lead back to the artifacts tab, labelled "Artefatos". The
    new-artifact page is titled "Novo artefato" and an artifact's page by its name (`generateMetadata`). The placeholder
    component is gone: no entry page is a placeholder any more.
  - The system's and the campaign's delete dialogs (`SystemActions`, `CampaignDeleteAction`) name the artifacts that go
    with the others, from the deletion counts' new `artifacts` (`systems.delete.*` and `campaigns.delete.*` gain
    `{artifacts}`, `artifactsOne` and `artifactsOther`).
  - Messages `campaigns.page.artifacts`, `artifacts.*`, `characters.*`, `feedback.artifactSaved`. The stand-in
    answers the three routes (two character sheets and an item); the demo backend (`docs/tools/frontend-demo-backend.mjs`)
    keeps artifacts in memory with the backend's checks.
- **Text.** `translator(language)` gives `t(path, params)`, with `{name}` placeholders.
  `errorText(problem, language)` turns a problem detail into text: the code's text, else its
  category's (`request`, `server`, `integrity`, `session`, `service`, `upload`, `ingestion`, `page`, `material`,
  `scope`, `conversation`, `ontology`, `record`), else the generic `server` text; a code is never
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

The usability pass (2026-11-21) added roles and changed a few values, in every theme:
`--color-border` (a quiet separator; the full-contrast `--color-rule` no longer divides lists),
`--color-field-border` and `--color-control-border` (the edge of a field and of a pill, an opaque
colour in every theme), `--color-popover` (the opaque surface of a menu, a toast and a dialog),
`--color-hover` and `--color-pressed` (overlays), and `--color-danger-soft`, `-warning-soft` and
`-success-soft` (the tint behind a state pill and a notice). `--color-surface-active` is now
clearly lighter or darker than the surface it sits on. New sizes: `--font-page-title-*` (28px),
`--font-section-*` (18px), `--radius-field` (12px), `--width-prose`, `--width-form`,
`--width-toast`, `--height-bar` and `--motion-fade`; `--width-sidebar` is 296px and
`--font-nav-size` 16px.

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
  the rules above. From the usability pass it also checks text on the popover, on the hover and
  pressed overlays and on the status tints, each status colour on the canvas and the popover, and
  the edge of a field and of a pill at 3:1 (WCAG 1.4.11) against the canvas, a panel, the popover
  and the field's own fill. That check raised `--illustrated-danger` from `#FF8A80` to `#FF9087`:
  danger text on the bare canvas was 4.41:1 over the backdrop's brightest pixel.
- The backdrop, `src/app/assets/backdrop.webp` (1280x720 pixel art, drawn without smoothing), was
  supplied by Dalton on 2026-11-16: a generated image with no third-party licence. Its brightest
  pixel is near white (`#FFFEE0`), so the scrim is `--illustrated-scrim` at 78% (Story 2.5, up
  from 72%): accent text on the canvas, such as a citation superscript, keeps 4.82:1 over that pixel
  (it was 3.85:1), and the text and the secondary text keep more than before.
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

Deploy order for public contract 1.3.0 (Story 1.11): the backend first (its migration `V4__library.sql`
adds the library tables), then the frontend (its health check fails against a 1.2.0 backend).

Deploy order for public contract 1.4.0 (Story 1.13): the backend first (its migration `V6__materials.sql`
adds the materials tables, and it answers the upload routes), then the frontend (its health check fails
against a 1.3.0 backend).

Deploy order for public contract 1.5.0 (Story 1.14): the backend first (its migration `V7__material_details.sql`
adds the material details and `material_system`, and it answers the materials routes), then the frontend (its
health check fails against a 1.4.0 backend).

From public contract 1.22.0 back to 1.7.0, the entries below go newest first.

Deploy order for public contract 1.22.0 (numbered pages): the backend first (no migration; its three lists answer
`total` and take `offset`), then the frontend (its health check fails against a 1.21.0 backend, and its paged lists ask
for one page each). The worker does not change. A rollback goes the other way.

Deploy order for public contract 1.24.0 (Story 3.4, part B): the backend first (its migration
`V26__material_deletion.sql`, `Material.superseded`, `GET /api/v1/materials/{id}/deletion` and the two deletes), then the
frontend (its health check fails against a 1.23.0 backend, and the material page offers "Excluir" and "Versões
anteriores"). The worker does not change. A rollback goes the other way.

Deploy order for public contract 1.23.0 (Story 3.4, part A): the backend first (a material's replacement through tus
`material` or `ImageSetRequest.material`, the reprocess of a `ready` material, the current version and `serving`; no
migration), then the frontend (its health check fails against a 1.22.0 backend, and the material page offers
"Substituir" and "Reprocessar" and reads `serving`). The worker does not change. A rollback goes the other way, but a
backend rollback below 1.23.0 is not safe once a replacement exists: a 1.22 backend reads a discarded newest
replacement as the material's state, and its refused-format path deletes the whole material, the serving version
included. Nothing guards against it in code (see the backend README).

Deploy order for public contract 1.21.0 (Story 3.3): the backend first (its migration `V25__material_belonging.sql`,
the material's `version`, `size` and `belonging`, and `PATCH /api/v1/materials/{id}`), then the frontend (its health
check fails against a 1.20.0 backend, and "Meus Arquivos", the material page and the guided upload read the new
fields). The worker does not change. A rollback goes the other way.

Deploy order for public contract 1.20.0 (Story 3.2, part B): the backend first (its migration
`V24__campaign_deletion.sql` and the campaign deletion routes), then the frontend (its health check fails against a
1.19.0 backend, and a campaign's page reads the deletion counts). The worker does not change. A rollback goes the other
way.

Deploy order for public contract 1.19.0 (Story 3.2, part A): the backend first (its migration
`V23__campaign_management.sql` and the campaign routes), then the frontend (its health check fails against a 1.18.0
backend, and Minhas Mesas, the campaign pages and the switcher read the new routes). The worker does not change. A
rollback goes the other way.

Deploy order for public contract 1.18.0 (Story 3.1, part B): the backend first (its migration
`V22__system_deletion.sql` and the deletion routes), then the frontend (its health check fails against a 1.17.0
backend, and a system's page reads the deletion counts). The worker does not change. A rollback goes the other way.

Deploy order for public contract 1.17.0 (Story 3.1, part A): the backend first (its migration
`V21__system_details.sql` and the systems routes), then the frontend (its health check fails against a 1.16.0 backend,
and `/systems` reads the new routes). The worker does not change. A rollback goes the other way.

Deploy order for public contract 1.16.0 (indexing at worker start): the backend first (`indexingFailed` on the
current conversation, the recipe route of internal contract 1.12.0, migration `V20__index_change_retries.sql`), then
the frontend (its health check fails against a 1.15.0 backend), then the worker (it states its recipe at every check of
a backend at 1.12.0 or later). The worker and the frontend do not depend on each other here. A rollback goes the other
way.

Deploy order for public contract 1.15.0 (the indexing notice): the backend first (`indexing` on the current
conversation, no migration), then the frontend (its health check fails against a 1.14.0 backend). The worker does not
change. A rollback goes the other way.

Deploy order for public contract 1.14.0 (Story 2.7): the backend first (the reference page and picture routes, no
migration), then the frontend (its health check fails against a 1.13.0 backend). The worker does not change. A
rollback goes the other way.

Deploy order for public contract 1.13.0 (Story 2.6): the backend first (its migration `V19__answer_stop.sql`, the
stop route and `stopped` on `done`), then the worker (internal contract 1.11.0: it obeys the stop and reports an
estimated usage), then the frontend (its health check fails against a 1.12.0 backend). A rollback goes the other way.

Deploy order for public contract 1.12.0 (Story 2.5): the backend first (its migration `V18__turn_references.sql`
and the references on `done`), then the frontend (its health check fails against a 1.11.0 backend). The worker does
not change. A rollback goes the other way: the frontend first, back to the 2.4 release, then the backend.

Deploy order for public contract 1.11.0 (Story 2.4): the backend first (its migration `V17__conversations.sql`, the
conversation routes and the turn event stream), then the worker (internal contract 1.10.0: it answers
`question.answer`), then the frontend (its health check fails against a 1.10.0 backend, and `/questions` reads the
new routes).

Deploy order for public contract 1.10.0 (Story 1.21): the backend first (its migration `V14__image_sets.sql`, the
image set routes and a material's `imageSet`), then the frontend (its health check fails against a 1.9.0 backend, and
the guided upload creates image sets). The worker of the same story (internal contract 1.6.0, pipeline "6") reads the
sets' images.

Deploy order for public contract 1.9.0 (Story 1.20): the backend first (its migration `V13__version_removal.sql`, the
`actions` of a material, the report and the action routes), then the frontend (its health check fails against a 1.8.0
backend, and its material page reads `actions` and the report).

Deploy order for public contract 1.8.0 (Story 1.19): the backend first (its migration `V12__page_views.sql`, and the
page routes), then the frontend (its health check fails against a 1.7.0 backend, and its page route reads the new
routes).

Deploy order for public contract 1.7.0 (Story 1.17): the backend first (a material's `pages` gains the counts by
layer, `text` and `image`, and by outcome, `readDirectly`, `readByOcr` and `unreadable`; no migration), then the
frontend (its health check fails against a 1.6.0 backend, and its tray and material page read the new counts).

## Settings

Read from the environment and checked when the server starts. A refused start writes one log line
that names the settings, never a value, and exits with status 78.
[`.env.example`](.env.example) lists them with an empty secret, for a start by hand (copied to the
git-ignored `.env.local`).

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
