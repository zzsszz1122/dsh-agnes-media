# Changelog

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
