# dsh-agnes-media · Agnes Studio

**Generate images and videos from a DeepSeek Harness sidebar panel. Tasks run in the Host process, so closing the page never loses a generation.**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%E2%89%A50.2.1--rc.3-4B6BFB)](https://github.com/deepseek-ai)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)

[中文说明](README.md)

![Agnes Studio panel](docs/panel.jpg)

---

## Install

**From the plugin market** (recommended)

DeepSeek Harness → **Settings → Plugin Market** → search `dsh-agnes-media` → install.

**From GitHub**

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

## Features

**Background tasks that survive navigation**

- Submitting returns a task immediately; the Host submits upstream and polls progress every 6 seconds.
- `429` / `5xx` from a busy upstream are retried with backoff, and the panel shows the retry count.
- Switching panels, reloading, or closing the tab does not interrupt a task. After a Host restart, `queued` / `running` tasks resume polling automatically.
- A task waits at most **40 minutes** (`TASK_DEADLINE_MS`); timeouts are recorded as failures and can be resubmitted.

**Generation**

| | Parameters |
|---|---|
| Image | 7 sizes: `1024×1024`, `1024×768`, `768×1024`, `1280×720`, `720×1280`, `1536×1536`, `2048×2048` |
| Video | `720P` / `1080P`; duration `4 / 5 / 6 / 8 / 10 / 12` seconds |
| Common | Prompts up to 4000 characters, fixed seed for reproducibility |

**Interface**

- A dedicated sidebar entry with four tabs: **Video / Image / Canvas / Drama**.
- Preview, download (Host route supports `Range` seeking), open in a new tab, copy link.
- Key status and endpoint in the header, with setup guidance when unset.
- A persistent history rail with per-item delete.

**Canvas and drama mode (0.3.0)**

- **Canvas**: node graph with drag layout, wheel zoom, background pan, and sequence edges. Press **Connect** on a node, then click the target node to chain tail frame → first frame; the graph autosaves.
- **Drama mode**: linear episode/scene/shot editing with a shot list, prompt/duration/camera editor, continuity notes, and a timeline with total duration. **Generate all** runs shots in order; failures stop at the current shot and **Continue from selected** resumes without rerunning finished shots.
- **Tail → head**: after a shot completes, the Host extracts its last frame with ffmpeg and submits the next shot as `mode: keyframe` with a base64 `first_frame`. Requires ffmpeg on the machine, or `AGNES_FFMPEG` / `config.ffmpegPath`. Without it the canvas warns and downstream shots are marked blocked rather than silently degraded.
- **Context assembly**: global style + character/scene bible + continuity note + shot prompt + camera + negative prompt, composed by the Host.

**Local storage**

- Results and index live in `<DSH home>/agnes-media/` (`history.json` plus `media/`).
- Projects live in `agnes-media/projects/<projectId>/`: `project.json`, `shots/*.json`, `canvas.json`, `assets/frames/`.
- The newest **80** history entries are kept; older ones are pruned with their files. A single result file may be up to 512MB.
- Nothing is uploaded to a third party.

---

## How it differs from `LittleBeaverStudio/agnes-media`

Same models, same host, different interaction model. The two can coexist:

| | This plugin | `LittleBeaverStudio/agnes-media` |
|---|---|---|
| Driven by | **A person** filling the sidebar panel | **The model** calling `generate_image` / `generate_video` tools in a conversation |
| Task lifetime | Runs in the Host, survives closing the page | Completes within the conversation request |
| History | On disk, 80 entries, reopenable | None |
| Output | Local files with preview and download | A result link |
| Multi-image reference | Not supported yet | `reference_image_urls` |

In short: **want the model to draw for you mid-conversation, use that one; want to iterate by hand until it is right, use this one.**

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
```

---

## Host API

| Method | Path | Purpose |
|---|---|---|
| GET | `/agnes-media/api/status` | Key status, endpoint, model names |
| GET | `/agnes-media/api/history` | History with status, progress, retry notes |
| GET | `/agnes-media/api/task/:id` | One task state |
| POST | `/agnes-media/api/image` | Create a background image task |
| POST | `/agnes-media/api/video` | Create a background video task |
| POST | `/agnes-media/api/history/delete` | Delete one entry and its file |
| GET | `/agnes-media/api/media/:id?download=1` | Result file, supports `HEAD` and `Range` |

All routes sit under the `/agnes-media/api` prefix and are served by the Host process; an authenticated DSH Web session is required.

---

## Compatibility

- Tested against DeepSeek Harness **0.2.1-rc.3**; the minimum is declared with `engines.dsh`.
- Node.js **≥ 20** (global `fetch`, `AbortSignal.timeout`).
- The client uses only the host-provided `react` plus the `slots` / `locale` services, ships no front-end dependencies, and has zero runtime dependencies.

---

## Security

- The API key is resolved per request in the Host through the DSH credential seam; the browser never sees it in plaintext.
- The proxy accepts a fixed request shape, and `/media/:id` only serves files this plugin generated and recorded in its history — it cannot read arbitrary paths.
- Results stay on this machine and are not uploaded anywhere.
- This is an unofficial third-party plugin, not affiliated with Agnes or DeepSeek.

---

## Troubleshooting

**No sidebar icon**
Confirm `dsh-agnes-media` is enabled under **Settings → Plugins**. Host-side changes require a DSH restart.

**"API key not configured"**
Set `AGNES_API_KEY` for the `agnes` provider under **Settings → Models**; the panel header shows key readiness.

**A task stays queued**
The upstream queue is busy. The plugin backs off and retries on `429` / `5xx` and shows the retry count. Past 40 minutes the task is marked failed and can be resubmitted.

**Code changes have no effect**
`client.js` is front-end — refresh the page. `index.js` is Host-side — restart DSH.

---

## Limitations

- Text-to-image and text-to-video (`mode: text`) are stable. Chained generation
  uses `mode: keyframe` with a base64 first frame; the real two-shot end-to-end
  check is still pending upstream queue availability (the payload is implemented
  and covered by a mocked test).
- A chain runs sequentially; one chain per project at a time.
- A task waits at most 40 minutes.
- History keeps the newest 80 entries; older records are deleted with their files.
- Canvas has no marquee selection or grouping yet.

---

## License

[MIT](LICENSE) · Unofficial plugin, not affiliated with Agnes or DeepSeek.
