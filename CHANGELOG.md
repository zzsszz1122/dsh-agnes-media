# Changelog

## 0.7.1

- **API keys are normalized before being sent upstream.** A pasted key carrying a
  trailing newline, wrapping quotes, or an accidental `Bearer `/`token ` prefix
  used to be forwarded verbatim, and upstream answered `HTTP 401：无效的令牌` —
  which reads like a broken key when the key itself is fine. Whitespace is now
  collapsed and trimmed, a pasted scheme is stripped, and one layer of wrapping
  quotes is removed.
- **401/403 errors are self-diagnosing.** The message now names the credential
  source, a non-reversible fingerprint of the token actually sent (first 4 +
  last 4 + length, never the full key), and the upstream URL, so "is the plugin
  using my key?" and "is it pointed at my Agnes host?" can be answered from the
  error alone.
- `GET /status` additionally returns `keyHint` and `keyNeededCleaning`; the panel
  shows the fingerprint as a chip next to the key status and notes when a stored
  token had to be cleaned.
- README gains a 401 troubleshooting section covering the credential resolution
  order (`AGNES_API_KEY` credential → env var → `agnes-api-key` record), a stale
  env var shadowing Settings, and a key that belongs to a different Agnes host
  than the default `https://api.agnes-ai.cn/v1`.

## 0.7.0

- **Drag files from Explorer onto the canvas**: dropping a video or image uploads
  it to `projects/<pid>/assets/imports/` and adds a media node at the drop point.
  Multiple files drop in a column. Video nodes play inline; both kinds can be
  deleted individually.
- New routes: `POST /projects/:id/imports` (base64 upload, 200MB cap, mp4/mov/
  webm/png/jpeg/webp only) and `GET|HEAD /projects/:id/imports/:assetId` with
  HTTP Range support so seeking works on imported clips.
- Imported clips get their duration probed with ffprobe (3s detect timeout, 8s
  probe timeout) purely as a node label — a probe failure never fails the import.
- Canvas fixes found while building this: media nodes now survive a save/reload
  (`saveCanvas` used to coerce every unknown node type back to `shot`), and the
  node merge no longer drops non-shot nodes when shots refresh.

## 0.6.0

- **Durations are multiples of 5 up to 30s** (`5/10/15/20/25/30`) instead of
  `4/5/6/8/10/12`. Invalid values still fall back to 5 instead of failing.
- **Chunked rendering for long shots**: the upstream free model accepts at most
  12s per request, so anything longer is split into *balanced* chunks
  (15→8+7, 20→10+10, 25→9+8+8, 30→10+10+10), each chunk rendered separately and
  the previous chunk's tail frame fed in as the next one's keyframe, then
  concatenated with ffmpeg into a single file. A greedy split used to produce an
  illegal 15s request (12+3 merged back), which silently exceeded the limit.
- **Shot-to-shot frame references**: a shot can name earlier shots
  (`shot.refs`), and when it has no approved still or first frame of its own it
  borrows the referenced shot's approved still / first frame / tail frame as its
  starting image. This is the canvas "reference an earlier clip" path; explicit
  first frames still win. Drama mode exposes it as "参考前面的镜头" pills, and the
  preflight gate counts a reference as a valid lock.
- Character locking fixes carried in this line: reference URLs are edited inline
  (`window.prompt` is inert in the WebView, which is why locking never worked),
  cast auto-binds by character name/alias in the prompt, and the preflight gate
  only blocks shots that actually have a character to lock.

## 0.5.0

- **Cast library**: `project.bible.characters[]` now carries `aliases`, `refs[]`
  (`front`/`side`/`back`/`extra`, each with a local file and an optional public
  HTTPS `url`) and a derived `locked` flag. New routes: `GET/POST /cast`,
  `PATCH/DELETE /cast/:cid`, `POST /cast/:cid/refs`, `PATCH /cast/:cid/refs/:rid`,
  and `GET /cast/:cid/refs/:rid/file`.
- **Reference locking**: `videoTask` prefers `mode: reference` +
  `reference_image_urls` (max 4 public HTTPS images) when the shot's cast has
  them, then falls back to `keyframe` + `first_frame`, then `text`. A 4xx on
  reference mode downgrades exactly once to keyframe/text and records why. Every
  shot stores `lockMode` so the UI can show "unlocked".
- **Script import binds cast**: parsed shots are matched against character names
  and aliases (pure substring, no guessing) and written to
  `shot.context.characters`.
- **Storyboard before video**: `POST /shots/:sid/storyboard` renders a still with
  the image model from the same composed prompt; `/approve` promotes it to
  `firstFrame` and `/reject` moves it to `storyboard/rejected/`. New statuses:
  `storyboard`, `pending-review`, `approved`.
- **Preflight gate**: `startChain` refuses to start when a shot has no approved
  still, no usable previous tail frame, and no locked character. It returns HTTP
  422 with a `blockers[]` list (`shotId`, `index`, `reason`) that the panel shows
  directly. Pass `skipPreflight: true` to override.
- **Per-shot isolation**: a failing shot no longer aborts the whole chain; it is
  marked `failed`, recorded in `chain.failures`, and the run continues.
- Drama mode gains three sub-tabs: **Shots / Cast / Storyboard**, with a cast
  editor (three-view upload slots, alias/look editing, public-URL prompt, lock
  badge), a still grid with per-shot approve/reject/rerender, and per-shot cast
  binding pills.

## 0.4.0

- Cancel everywhere: `POST /task/:id/cancel` and `POST /projects/:id/chain/cancel`
  stop the backoff/poll loops in the Host; new `cancelled` status, with a cancel
  button on the single-shot pages, per node in the canvas, per row in drama mode,
  plus a chain-level cancel while a run is in flight.
- Drama mode gains **script import** (`POST /projects/:id/script/parse`): a plain
  text script with `第X集 / EP / 场… / 1.` markers is split into episode/scene/shot
  drafts deterministically, with no LLM call, and hand-editable.
- Drama mode gains **episode assembly** (`POST /projects/:id/assemble`): finished
  shots are normalized and concatenated with ffmpeg into one downloadable mp4;
  audio is mapped only when every clip carries it, and the result streams from
  `/projects/:id/episode/<file>`.
- Canvas stability: the wheel listener is now a non-passive native handler
  (`preventDefault`) so zooming cannot scroll the page and blank the graph; node
  coordinates and zoom are guarded against `NaN`; an error boundary wraps the
  panel so a view throw shows an inline message instead of a black screen; nested
  buttons were replaced with `span[role=button]` for valid DOM.

## 0.3.0

- Add projects/shots/canvas persistence under `<DSH home>/agnes-media/projects/`
  (`project.json`, `shots/*.json`, `canvas.json`, `assets/frames/`).
- Add a sequential chain runner: topological order, single concurrency, resume
  from a shot, per-project lock, and project-level chain state.
- Compose prompts from style, character/scene bible, continuity note, shot
  prompt, camera, and negative prompt; seed by project policy.
- Extract each finished shot's tail frame with ffmpeg and submit the next shot
  as `mode: keyframe` with a base64 `first_frame`; expose the tail over HTTP and
  accept manual first-frame uploads.
- Add the Canvas tab: draggable nodes, wheel zoom, pan, SVG sequence edges,
  click-to-connect, autosave, and per-node run/continue actions.
- Add the Drama tab: shot list, prompt/duration/camera/continuity editor,
  timeline with total duration, generate-all, and continue-from-selected.
- Extend `/status` with ffmpeg availability and add project/shot/canvas/chain/
  timeline routes.

## 0.2.0

- Move generation into the Host: tasks keep running after the page closes, the
  panel is switched, or the app reloads; interrupted tasks resume on Host start.
- Persist history and media under `<DSH home>/agnes-media/` (last 80 entries).
- Retry 429/429-from-queue and 5xx with backoff, showing the retry count in the
  panel; a task waits up to 40 minutes instead of failing on the first 503.
- Serve results with `HEAD` and `Range` support for seeking and downloads.
- Keep the primary action visible on themes whose brand tokens resolve to
  `transparent`.

## 0.1.0

- First working version: sidebar entry, image and video tabs, direct calls to
  `POST /v1/images/generations` and `POST /v1/videos` through the Host, with the
  key resolved from the `agnes` provider credential reference.
