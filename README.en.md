# dsh-agnes-media · Agnes Studio

A DeepSeek Harness Web UI plugin that adds a **sidebar entry** for generating images and
videos with the free Agnes models `agnes-image-2.5-flash` and `agnes-video-2.5-flash`.

[中文说明](README.md)

![Agnes Studio panel](docs/panel.jpg)

## Why it exists

The harness routes model calls through `POST /v1/chat/completions`, while the free Agnes
models live on their own endpoints:

- images: `POST /v1/images/generations`
- videos: `POST /v1/videos`, then poll `GET /v1/videos/{id}`

This plugin calls those endpoints from the Host process (so the API key never reaches the
browser) and exposes the result as a sidebar panel.

## Background tasks and durable history

Every generation runs in the Host process; the panel only submits tasks and reads history.

- Submitting returns immediately; the Host submits upstream, polls progress, and retries
  429/5xx responses with backoff.
- Switching panels, reloading the page, or closing it does not stop a task.
- Results and the history index live in `<DSH home>/agnes-media/` (`history.json` plus
  `media/`), keeping the newest 80 entries.
- After a Host restart, interrupted `queued` / `running` tasks resume automatically.

The panel shows the queue stage, progress, and retry notices; finished items stay in the
history rail and can be reopened with one click.

## Key and models

The plugin reads the credential reference of the `agnes` provider created in
**Settings → Models** (`apiKeyEnv: AGNES_API_KEY`) and defaults to the models declared
there:

- video: `agnes-video-2.5-flash`
- image: `agnes-image-2.5-flash`

Underscores in model names are normalized to hyphens
(`agnes_video_2.5_flash` → `agnes-video-2.5-flash`). The endpoint defaults to
`https://api.agnes-ai.cn/v1`; `baseURL`, `apiKeyEnv`, `videoModel`, and `imageModel` can be
overridden on the plugin row's `config`.

## UI

- A new sidebar entry opens the main panel.
- **Video / Image** tabs, prompt examples, resolution, duration (4–12 s), seed.
- Preview, download (served by the Host with `Range` support), open in a new tab, copy link.
- Key status and endpoint shown in the header, with setup guidance when unset.
- A persistent history rail with per-item delete.

## Host API

| Method | Path | Purpose |
|---|---|---|
| GET | `/agnes-media/api/status` | Key status, endpoint, model names |
| GET | `/agnes-media/api/history` | History with status, progress, retry notes |
| GET | `/agnes-media/api/task/:id` | One task state |
| POST | `/agnes-media/api/image` | Create a background image task |
| POST | `/agnes-media/api/video` | Create a background video task |
| POST | `/agnes-media/api/history/delete` | Delete one entry and its file |
| GET | `/agnes-media/api/media/:id?download=1` | Result file with `Range` |

## Install

Local directory (development):

```bash
dsh plugin add /absolute/path/to/dsh-agnes-media
```

From GitHub (after publishing):

```bash
dsh plugin add github:YOUR-GITHUB-NAME/dsh-agnes-media
```

From npm (after publishing):

```bash
dsh plugin add dsh-agnes-media
```

Then confirm the `dsh-agnes-media` row is enabled in Settings → Plugins. Client changes
take effect on page refresh; Host changes need a DSH restart (or a Plugin Manager
recomposition).

## Compatibility

- Tested against DeepSeek Harness **0.2.1-rc.3**; the minimum is declared with `engines.dsh`.
- Node.js ≥ 20 (global `fetch`, `AbortSignal.timeout`).
- The client uses the host-provided `react` plus the `slots` and `locale` services and
  ships no front-end dependencies.

## Security

- The API key is resolved per request in the Host through the DSH credential seam; the
  browser never sees it.
- The proxy accepts a fixed request shape and only serves files this plugin generated and
  recorded in its history, so `/media/:id` cannot read arbitrary paths.
- Results stay on this machine under `<DSH home>/agnes-media/`.
- This is an unofficial third-party plugin, not affiliated with Agnes or DeepSeek.

## Limitations

- Text-to-image and text-to-video (`mode: text`) only; image-conditioned video needs a
  publicly reachable reference image and is not exposed yet.
- A task waits at most 40 minutes; timeouts are recorded as failures and can be resubmitted.
- History keeps the newest 80 entries; older files are deleted.

## License

[MIT](LICENSE).
