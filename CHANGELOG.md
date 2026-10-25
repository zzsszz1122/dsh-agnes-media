# Changelog

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
