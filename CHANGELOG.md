# Changelog

## 1.0.1

- **A key pasted with a YAML separator no longer 401s.** The credential store is
  YAML; a flow-style entry can leave its comma glued to the value (`sk-…,`). The
  Host's own parser drops it, but any reader that hands back the raw line made the
  plugin send the comma as part of the token, and the upstream answered a bare
  「无效的令牌」. `normalizeApiKey()` now strips a trailing `,` / `;` in addition to
  whitespace, zero-width characters, a pasted `Bearer ` prefix and wrapping quotes.
- Verified against the live gateway: the stored key resolves to 51 characters and
  `GET /v1/models` answers 200; the raw line including the comma answers 401.
- This release also rolls up the 1.0 line: the composer entry (0.8.0), a reference
  mode that actually reaches the renderer on `images` (0.9.0), and the
  首帧/参考 picker that appears when a single image is uploaded (0.9.1).

## 0.9.1

- **A single upload is no longer silently made the first frame.** It arrives as
  待选 and the composer shows an inline chooser: 首帧 / 参考, each with what it
  actually does (首帧 locks the opening framing, pose and light for the first
  instant; 参考 conditions the whole clip's face, palette, props and style
  without deciding the opening frame), plus a one-line summary of the
  difference.
- Nothing is submitted while a role is undecided — the submit is refused with a
  hint instead of guessing. Multi-file drops keep the previous rule (first is
  the frame, the rest are references), and the tag on any thumbnail reopens the
  chooser at any time.
- Choosing a role switches 首帧模式 / 参考模式 back to 全能模式 when the current
  mode would otherwise ignore the choice, so the picker always wins over a mode
  that overrides it.

## 0.9.0

- **参考模式修好了，它此前从未生效。** 插件一直把参考图发在
  `reference_image_urls` 上，而该网关把它判为「不是允许的请求字段」直接 400；
  代码随后的降级分支又把它悄悄换成 keyframe/text，于是「锁脸」在日志里只剩一行
  提示。参考图现在发在 `images`（实测为合法字段），并保留降级路径。
- **主界面可以真正把素材当参考图用。** 每个素材带角色标签：第一张默认 `首帧`，
  其余默认 `参考`，点标签即可互换（同时只有一个首帧）。「创作模式」新增
  **参考模式**：全部素材作参考图、不占首帧；全能模式按角色分工；首帧模式只认首帧；
  纯文本忽略素材。
- **`@` 变成素材选择器。** 之前只会插入第一个素材的引用词；现在弹出素材列表，
  序号与缩略图一致，插入 `@图片N` 到光标处。
- 三种参考图输入都能走通：`referenceUrls`（公网 HTTPS，渲染端可自行抓取）、
  `referenceTaskIds`（历史图，宿主优先复用其结果产物在 Agnes CDN 上的公开 URL，
  没有才复制本地文件）、`referenceFrames`（本地上传的 data URI）。单条请求上限 4 张。
- **降级不再静默。** 上游拒绝参考图时，`referenceDropped` 会写进任务记录，结果卡上
  显示「上游未接受参考图，本条已按降级模式生成：<原因>」；没被拒绝时则在结果卡显示
  「参考 × N」。
- 未改动的页签（生图 / 画布 / 短剧）渲染结果与上一版逐字节一致；路由测试从 18 项
  增加到 28 项，界面自检从 14 项增加到 23 项。

## 0.8.1

- **Fixed `视图出错：Cannot read properties of null (reading 'originX')`.** Canvas
  panning read `panRef.current` *inside* the `setViewport` updater. That updater
  runs later, during React's render pass, and `onAreaUp` had already set the ref
  to `null` — so any pan whose `pointerup` landed before React flushed the move
  threw during render and the error boundary replaced the entire panel. The origin
  is now snapshotted before the update is scheduled.
- **The view error boundary can recover in place.** It renders a 重新加载视图
  button instead of leaving the panel blank until a full page refresh.

## 0.8.0

- **The 生视频 tab is now a composer, not a form.** It follows the reference
  layout: a centred title, one large rounded input, and a toolbar of chips —
  `+` (add reference), 视频生成, the model, 全能模式, duration, resolution, `@`,
  and a teal submit button. The result preview and the history rail moved below
  the composer instead of sitting beside it.
- **The reference travels as a first frame.** `+ → 本地上传` sends the picked
  image as a data URI; `+ → 从资产库添加` reuses an image already in the history
  (`firstFrameTaskId`). The Host writes it to `<task>-firstframe.*` and submits
  upstream with `mode: "keyframe"`, then deletes the scratch file when the task
  finishes. Four references at most; the first one is the frame.
- **The entry submits to `POST /v1/video`, not a chat route.** `/v1/video` is the
  canonical path and replaces `/v1/chat/completions` for everything this entry
  does; `/video` remains as an alias of the same handler so scripts and older
  panels keep working. The path is configurable (`config.videoPath`, upstream via
  `config.videoUpstreamPath`) and advertised in `GET /status`, and the panel
  falls back to `/video` when talking to a Host that predates this release.
- 全能模式 / 首帧模式 / 纯文本 decide whether the reference is used at all:
  Versatile uses it when present, First-frame refuses to submit without one, and
  Text-only ignores it.
- The image, canvas and drama tabs are untouched. `test-harness/ui.mjs` renders
  each tab to HTML and the three of them are byte-identical before and after
  this release; `--checks` walks the composer end to end (menu, library pick,
  submit payload, mode switch), and `test-harness/route.mjs` pins the route
  contract, including that `/v1/chat/completions` is a 404 on the panel.

## 0.7.2

- **Delete shots from the drama shot list.** Right-clicking a row in 短剧模式 →
  镜头 opens a small menu; the first click arms "再点一次确认删除" and the second
  one deletes. Deleting a shot also drops its canvas edges. Previously there was
  no way to remove a shot from this view at all.
- **Delete a project.** The project toolbar (canvas and drama) gains a 删除项目
  button that removes the project directory with all its shots, cast and assets.
  It arms on the first click and **disarms itself after 4 seconds**, because a
  destructive button left armed would let an unrelated later click wipe a project.
- Both confirmations are in-app: `window.confirm` is inert in this WebView, the
  same reason the cast URL editor had to stop using `window.prompt`.
- The backend already supported `DELETE /projects/:id` and `/shots/:sid`; this
  release adds the missing entry points (`delete.mjs` covers cascade cleanup,
  the 404 on a second delete, and that other projects stay usable).

## 0.7.1

- **API keys are normalized before being sent upstream.** A pasted key carrying a
  trailing newline, wrapping quotes, an accidental `Bearer `/`token ` prefix, or
  an invisible zero-width character used to be forwarded verbatim, and upstream
  answered `HTTP 401：无效的令牌` — which reads like a broken key when the key
  itself is fine. Whitespace and zero-width characters are now removed outright
  (a token never contains them), and a pasted scheme or one layer of wrapping
  quotes is stripped first, in whichever order they arrived.
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
