# dsh-agnes-media · Agnes Studio

**Generate images and videos from a DeepSeek Harness sidebar panel, and chain a whole episode shot by shot. Tasks run in the Host process, so closing the page never loses a generation.**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%E2%89%A50.2.1--rc.3-4B6BFB)](https://github.com/deepseek-ai)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)

[中文说明](README.md)

![Agnes Studio panel](docs/panel.jpg)

---

## Install

**From the plugin market** (recommended)

DeepSeek Harness → **Settings → Plugin Market** → search `dsh-agnes-media` → install.

**From npm**

```bash
dsh plugin add dsh-agnes-media
```

**From GitHub** (tracks the latest commits)

```bash
dsh plugin add github:zzsszz1122/dsh-agnes-media
```

> On the desktop app, install from the app's own **Settings → Plugins**. The CLI will not modify the desktop profile while the app is running.

Then confirm the `dsh-agnes-media` row is enabled under **Settings → Plugins**; an **Agnes Studio** icon appears in the sidebar.

---

## Why it exists

The harness routes model calls through `POST /v1/chat/completions`, while the Agnes media models live on their own endpoints:

| Capability | Endpoint |
|---|---|
| Image | `POST /v1/images/generations` |
| Video | `POST /v1/videos` to submit, then poll `GET /v1/videos/{id}` |

Those endpoints are outside the chat protocol. This plugin calls them from the **Host process** and stores results on disk, so the browser never receives the API key.

---

## Interface

One sidebar entry with four tabs:

| Tab | Purpose |
|---|---|
| **Video** | Prompt, resolution, duration, seed for a single clip |
| **Image** | Prompt, size, seed for a single still |
| **Canvas** | Node graph: drag to arrange, wheel to zoom, drag empty space to pan, autosaves; videos and images can be **dragged straight in from Explorer** as media nodes |
| **Drama** | Three sub-tabs: **Shots** (storyboard table and prompt editing), **Cast** (character reference images and lock status), **Storyboard review** (grid review of an episode's stills) |

Results support preview, download (the Host route serves `Range`), open in a new tab, and copy link; a persistent history rail keeps finished items and allows per-item delete.

---

## Features

### Background tasks that survive navigation

- Submitting returns a task immediately; the Host submits upstream and polls progress every 6 seconds.
- `429` / `5xx` from a busy upstream are retried with backoff, and the panel shows the retry count.
- Switching panels, reloading, or closing the tab does not interrupt a task. After a Host restart, `queued` / `running` tasks resume polling.
- A task waits at most **40 minutes** (`TASK_DEADLINE_MS`); timeouts are recorded as failures and can be resubmitted.
- Every surface has a cancel entry, and cancelling really stops the poll and backoff loops inside the Host.

### Generation

| | Parameters |
|---|---|
| Image | 7 sizes: `1024×1024`, `1024×768`, `768×1024`, `1280×720`, `720×1280`, `1536×1536`, `2048×2048` |
| Video | `720P` / `1080P`; duration `4 / 5 / 6 / 8 / 10 / 12` seconds |
| Common | Prompts up to 4000 characters, fixed seed for reproducibility |

### Drama mode

- **Episode / scene / shot** linear editing: shot list plus prompt, duration and camera editing, with a timeline total.
- **Script import**: paste a plain text script with `第X集`, `EP`, `场…` or `1.` markers and it is split deterministically into episode / scene / shot drafts. No LLM call; every draft stays editable in the table.
- **Generate all**: runs sequentially with single concurrency and a per-project lock, can resume from any shot, and never re-runs shots that are already done.
- **Episode assembly**: finished shots are normalized and concatenated with ffmpeg into one mp4 (audio is mapped only when every clip carries it), previewed and downloadable in the panel.
- **Failure isolation**: a failed shot is marked and recorded in `chain.failures` without tearing down the rest of the run.

### Long durations and canvas media

- **Durations**: choose 5 / 10 / 15 / 20 / 25 / 30 seconds (multiples of 5). Upstream accepts at most 12 seconds per request, so a longer shot is split into **balanced** chunks (15→8+7, 20→10+10, 30→10+10+10); each chunk's tail frame feeds the next chunk's keyframe, and the pieces are concatenated with ffmpeg into one continuous file.
- **Imported media**: drop a video or image from Explorer onto the canvas and it is stored under `projects/<pid>/assets/imports/` as a media node. Videos play inline, with `Range` support so seeking works.

### Character consistency

The costliest failure in short-form drama is a character whose face changes between shots. Three layers push back, applied by priority:

**1. Cast library (three-view references)**

Each character has a name, aliases, a look description, and up to four reference kinds: `front`, `side`, `back`, `extra`. References are stored inside the project directory, and each can carry a **public HTTPS URL** — only public URLs can be consumed by the upstream reference mode.

![Cast tab: three-view references and lock status](docs/screenshot-cast.png)

The screenshot above is **Drama → Cast**: the front view is uploaded, side and back are still empty, and the card reads "not locked" because no public URL has been set yet.

**2. Reference-mode locking**

The video request picks a mode by priority:

| Priority | Condition | Request |
|---|---|---|
| 1 | A character in this shot has a public reference URL | `mode: reference` + `reference_image_urls` (up to 4) |
| 2 | The shot has a first frame | `mode: keyframe` + `first_frame` (base64) |
| 3 | Neither | `mode: text` |

Every shot records `lockMode`; when it is not locked the UI says so instead of degrading silently. If reference mode is rejected with a 4xx (usually an unreachable URL), the plugin drops the references, retries once, and writes the reason into the task note.

**Which characters are in a shot**: those explicitly selected on the shot, plus any matched by name or alias inside the prompt.

**3. Stills before video**

Each shot can generate a still first (seconds, cheap) and be reviewed in **Storyboard review** — approve, reject, regenerate. **An approved still becomes that shot's first frame**, and only then is the expensive video generated. A wrong face surfaces at the still stage, where the cost differs by an order of magnitude.

**Preflight gate**

Before a chain starts, every shot is checked:

- **Only shots that actually need locking are blocked** — a shot whose cast resolves to nobody (pure scenery) is never blocked.
- Any one of these lets it through: a public reference URL, an approved still, or the previous shot's tail frame.
- If none apply, the chain refuses to start and names the shot: "shot N needs to lock <name>'s face, but that character has no public reference image yet".

To force a run anyway, pass `skipPreflight`.

### Tail-frame chaining

After a shot finishes, the Host extracts its last frame with ffmpeg and submits the next shot as `mode: keyframe` with a base64 `first_frame`. This needs ffmpeg locally (via `PATH`, `AGNES_FFMPEG`, or the plugin row's `config.ffmpegPath`). When it is missing the UI says so, and downstream shots are marked blocked rather than silently degrading.

> **Canvas edges are annotations.** Connections between nodes visualise "who follows whom"; the actual run order comes from the storyboard table (the shot array). Redrawing an edge does not change generation order or chaining.

---

## Local storage

- Results and index: `<DSH home>/agnes-media/` (`history.json` plus `media/`).
- Project data: `agnes-media/projects/<projectId>/`
  - `project.json` (including `bible` style / characters / scenes and `chain` state)
  - `shots/*.json`, `canvas.json`
  - `assets/frames/` (first and tail frames), `assets/cast/<character>/` (three views), `assets/storyboard/` (stills)
- The newest **80** history entries are kept; older ones are pruned with their files. A single result file may be up to 512MB.
- Nothing is uploaded to a third party.

---

## How it differs from `LittleBeaverStudio/agnes-media`

Same models, same host, different interaction model. The two can coexist:

| | This plugin | `LittleBeaverStudio/agnes-media` |
|---|---|---|
| Driven by | **A person** working the sidebar panel | **The model** calling `generate_image` / `generate_video` tools in a conversation |
| Task lifetime | Runs in the Host, survives closing the page | Completes within the conversation request |
| History | On disk, 80 entries, reopenable | None |
| Storyboard and assembly | Drama mode, script import, ffmpeg assembly | None |
| Face locking | Cast three-views, `reference` mode, still review | `reference_image_urls` tool argument |
| Output | Local files with preview and download | A result link |

In short: **want the model to draw for you mid-conversation, use that one; want to assemble an episode around one face, use this one.**

---

## Configuration

The plugin reads the credential reference of the `agnes` provider created in **Settings → Models** (default `apiKeyEnv: AGNES_API_KEY`) and defaults to the models declared there:

- video: `agnes-video-2.5-flash`
- image: `agnes-image-2.5-flash`

Underscores in model names are normalized to hyphens (`agnes_video_2.5_flash` → `agnes-video-2.5-flash`).

The endpoint defaults to `https://api.agnes-ai.cn/v1`. Override it on the plugin row's `config`:

```yaml
- id: dsh-agnes-media
  config:
    baseURL: https://api.agnes-ai.cn/v1
    apiKeyEnv: AGNES_API_KEY
    videoModel: agnes-video-2.5-flash
    imageModel: agnes-image-2.5-flash
    ffmpegPath: '' # optional; falls back to AGNES_FFMPEG, then PATH
```

---

## Host API

All routes sit under the `/agnes-media/api` prefix and are served by the Host process; an authenticated DSH Web session is required.

**Tasks and history**

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | Key status, endpoint, model names, ffmpeg availability |
| GET | `/history` | History with status, progress, retry notes |
| GET | `/task/:id` | One task state |
| POST | `/task/:id/cancel` | Cancel one task |
| POST | `/image` | Create an image task |
| POST | `/video` | Create a video task |
| POST | `/history/delete` | Delete one entry and its file |
| GET | `/media/:id?download=1` | Result file, supports `HEAD` and `Range` |

**Projects, shots, canvas**

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/projects` | List / create projects |
| GET/PATCH/DELETE | `/projects/:id` | Project detail / update / delete |
| GET · PUT | `/projects/:id/canvas` | Read / save canvas nodes, edges, viewport |
| GET/POST | `/projects/:id/shots` | List / create shots |
| PATCH/DELETE | `/projects/:id/shots/:sid` | Update / delete a shot |
| POST | `/projects/:id/shots/:sid/first-frame` | Upload a manual first frame (base64) |
| GET | `/projects/:id/shots/:sid/tail` | Read that shot's tail frame (jpg) |
| GET | `/projects/:id/timeline` | Timeline and total duration |

**Chain, script, assembly**

| Method | Path | Purpose |
|---|---|---|
| POST | `/projects/:id/chain` | Run in order (`{shotIds?, from?, force?, skipPreflight?}`) |
| POST | `/projects/:id/chain/cancel` | Cancel the chain and its current task |
| POST | `/projects/:id/script/parse` | Parse a script into shots (`{text, replace?}`) |
| POST | `/projects/:id/assemble` | Concatenate the episode with ffmpeg |
| GET | `/projects/:id/episode/:file?download=1` | Preview / download the assembled mp4 |
| POST | `/projects/:id/imports` | Upload canvas media (base64, mp4/mov/webm/png/jpeg/webp, 200MB cap) |
| GET/HEAD | `/projects/:id/imports/:assetId` | Serve imported media with `Range` support |

**Cast and stills**

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/projects/:id/cast` | List / create characters |
| PATCH/DELETE | `/projects/:id/cast/:cid` | Rename / aliases / look / delete |
| POST | `/projects/:id/cast/:cid/refs` | Upload a reference (base64 + `kind`) |
| PATCH | `/projects/:id/cast/:cid/refs/:rid` | Set the reference's public URL (required for reference mode) |
| GET | `/projects/:id/cast/:cid/refs/:rid/file` | Read a reference image |
| POST | `/projects/:id/shots/:sid/storyboard` | Generate that shot's still |
| GET | `/projects/:id/shots/:sid/storyboard` | Read the still |
| POST | `/projects/:id/shots/:sid/approve` | Approve the still → becomes the first frame |
| POST | `/projects/:id/shots/:sid/reject` | Reject the still |

---

## Compatibility

- Tested against DeepSeek Harness **0.2.1-rc.3**; the minimum is declared with `engines.dsh`.
- Node.js **≥ 20** (global `fetch`, `AbortSignal.timeout`).
- **ffmpeg** is used for tail-frame extraction and episode assembly; without it, stills, single generations and editing are unaffected.
- The client uses only the host-provided `react` plus the `slots` / `locale` services, ships no front-end dependencies, and has zero runtime dependencies.

---

## Security

- The API key is resolved per request in the Host through the DSH credential seam; the browser never sees it in plaintext.
- The proxy accepts a fixed request shape, and `/media/:id` only serves files this plugin generated and recorded in its history — it cannot read arbitrary paths.
- Three-views, stills and results stay on this machine; only the **public URLs you enter explicitly** are sent upstream, as part of the reference-mode request.
- This is an unofficial third-party plugin, not affiliated with Agnes or DeepSeek.

---

## Troubleshooting

**No sidebar icon**
Confirm `dsh-agnes-media` is enabled under **Settings → Plugins**. Host-side changes require a DSH restart.

**"API key not configured"**
Set `AGNES_API_KEY` for the `agnes` provider under **Settings → Models**.

**A task stays queued**
The upstream queue is busy. The plugin backs off and retries on `429` / `5xx` and shows the retry count; past 40 minutes the task is marked failed and can be resubmitted.

**Code changes have no effect**
`client.js` is front-end — refresh the page. `index.js` and `lib/` are Host-side — restart DSH.

**"ffmpeg is missing"**
Install ffmpeg and put it on `PATH`, or set `AGNES_FFMPEG`, or set `ffmpegPath` on the plugin row's `config`. Restart DSH afterwards — the Host resolves the binary once per process.

**The face still drifts, or the UI says "not locked"**
Reference mode only accepts **public HTTPS** image URLs; local files are never submitted. Fill in a reachable URL for the character's references, or switch to stills-before-video and fix the face at the still stage.

**The chain refuses to start**
The gate found a shot that needs face locking but has no public reference, no approved still and no previous tail frame. Fill the gap, or pass `skipPreflight` to run anyway.

**Reference mode was downgraded**
Upstream rejected the reference images (usually an unreachable URL). The task note records the reason and the shot falls back to first frame or text.

---

## Limitations

- **Reference mode needs public HTTPS images**: local three-views live only in the project directory and cannot be consumed without hosting; whether a data URI is accepted has not been verified.
- Chains run sequentially (single concurrency), and a project allows one chain at a time.
- A task waits at most 40 minutes; history keeps the newest 80 entries and deletes older files.
- Canvas edges are annotations and do not drive execution order; the canvas has no marquee selection, multi-select or grouping yet.
- Script parsing is rule-based: unusual formats (for example an unnumbered run of dialogue) need tidying in the storyboard table after import.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for per-version changes.

---

## License

[MIT](LICENSE) · Unofficial plugin, not affiliated with Agnes or DeepSeek.
