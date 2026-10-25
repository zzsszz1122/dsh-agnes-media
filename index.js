/**
 * Host half of `dsh-agnes-media`.
 *
 * The panel only submits a task and then reads history; every task runs in this
 * process, so closing the page, switching panels, or reloading the app never
 * loses a generation. Two wire facts drive the design:
 *
 *   - the harness LLM route speaks `POST /v1/chat/completions`, while the free
 *     Agnes models live on `POST /v1/videos` (submit + poll) and
 *     `POST /v1/images/generations`;
 *   - the upstream queue answers 429/5xx while it is busy, so every call retries
 *     with backoff instead of failing the task.
 *
 * Results are downloaded once and stored under `<DSH home>/agnes-media`, so the
 * history survives a Host restart and the browser never receives the API key.
 */

import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const VERSION = '0.2.0'

const DEFAULTS = {
  baseURL: 'https://api.agnes-ai.cn/v1',
  apiKeyEnv: 'AGNES_API_KEY',
  videoModel: 'agnes-video-2.5-flash',
  imageModel: 'agnes-image-2.5-flash',
}

const ROUTE_PREFIX = '/agnes-media/api'
const IMAGE_SIZES = new Set([
  '1024x1024',
  '1024x768',
  '768x1024',
  '1280x720',
  '720x1280',
  '1536x1536',
  '2048x2048',
])
const VIDEO_SIZES = new Set(['720P', '1080P'])
const VIDEO_SECONDS = new Set(['4', '5', '6', '8', '10', '12'])
const MAX_PROMPT = 4000
const HISTORY_LIMIT = 80
const MAX_MEDIA_BYTES = 512 * 1024 * 1024
const TASK_DEADLINE_MS = 40 * 60 * 1000
const POLL_INTERVAL_MS = 6000

class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message)
    this.status = status
    this.upstreamStatus = options.upstreamStatus
    this.transient =
      options.transient ??
      (typeof options.upstreamStatus === 'number' &&
        (options.upstreamStatus === 429 || options.upstreamStatus >= 500))
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function normalizeModel(value) {
  return String(value || '')
    .trim()
    .replace(/_/g, '-')
}

function buildUrl(baseURL, endpoint) {
  const base = String(baseURL || DEFAULTS.baseURL).replace(/\/+$/, '')
  const suffix = '/' + String(endpoint || '').replace(/^\/+/, '')
  const baseVersion = base.match(/\/(v\d+[a-z0-9]*)$/i)
  const endpointVersion = suffix.match(/^\/(v\d+[a-z0-9]*)(\/|$)/i)
  if (baseVersion && endpointVersion) {
    return base.slice(0, base.length - baseVersion[0].length) + suffix
  }
  return base + suffix
}

function mimeToExtension(mime, kind) {
  const value = String(mime || '').toLowerCase()
  if (value.includes('webp')) return 'webp'
  if (value.includes('gif')) return 'gif'
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg'
  if (value.includes('quicktime')) return 'mov'
  if (value.includes('webm')) return 'webm'
  if (value.includes('mp4')) return 'mp4'
  if (value.includes('png')) return 'png'
  return kind === 'video' ? 'mp4' : 'png'
}

function sendJson(res, status, value) {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

async function readJson(req, limit = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

function cleanPrompt(value) {
  const prompt = String(value || '').trim()
  if (!prompt) throw new HttpError(400, '提示词不能为空')
  if (prompt.length > MAX_PROMPT) throw new HttpError(400, '提示词过长')
  return prompt
}

async function resolveKey(ctx, settings) {
  const ref = settings.apiKeyEnv
  try {
    const resolved = await ctx.credentials.resolve(ref)
    if (resolved) {
      const value = typeof resolved === 'string' ? resolved : resolved.value
      if (value) {
        return {
          value,
          source:
            typeof resolved === 'string' ? 'credentials' : resolved.source || 'credentials',
        }
      }
    }
  } catch {
    /* fall through to the ambient environment and record half */
  }
  if (process.env[ref]) return { value: process.env[ref], source: 'env' }
  try {
    const record = await ctx.credentials.readRecord('agnes-api-key')
    if (record && record.kind === 'api-key' && record.key) {
      return { value: record.key, source: 'credentials' }
    }
  } catch {
    /* not configured through the record half */
  }
  return undefined
}

async function requireKey(ctx, settings) {
  const key = await resolveKey(ctx, settings)
  if (!key) {
    throw new HttpError(
      400,
      `未找到 Agnes API Key：请先在「设置 → 模型」里为 agnes 配置 ${settings.apiKeyEnv}，或在 DSH 凭据中新增 ${settings.apiKeyEnv}。`,
    )
  }
  return key
}

function extractUpstreamError(data, fallback) {
  if (!data || typeof data !== 'object') return fallback
  const error = data.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && error.message) return String(error.message)
  if (typeof data.message === 'string') return data.message
  if (typeof data.detail === 'string') return data.detail
  return fallback
}

async function upstream(settings, key, endpoint, options = {}) {
  const url = buildUrl(settings.baseURL, endpoint)
  const timeoutMs = options.timeoutMs ?? 120000
  let response
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        authorization: `Bearer ${key.value}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new HttpError(504, `上游请求超时（${Math.round(timeoutMs / 1000)} 秒）`, {
        transient: true,
      })
    }
    throw new HttpError(502, `无法连接 ${url}：${messageOf(error)}`, { transient: true })
  }
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text.slice(0, 4000) }
  }
  if (!response.ok) {
    const detail = extractUpstreamError(data, text.slice(0, 300))
    throw new HttpError(502, `上游 HTTP ${response.status}：${detail || '无错误详情'}`, {
      upstreamStatus: response.status,
    })
  }
  return data
}

async function upstreamRetry(settings, key, endpoint, options, taskId, update, deadline) {
  let attempt = 0
  for (;;) {
    try {
      return await upstream(settings, key, endpoint, options)
    } catch (error) {
      if (!error || !error.transient) throw error
      if (deadline && Date.now() > deadline) throw error
      attempt += 1
      const delay = Math.min(30000, 5000 + attempt * 2000)
      if (update) {
        await update(taskId, {
          note: `上游繁忙（${error.upstreamStatus || '网络'}），${Math.ceil(delay / 1000)} 秒后重试（第 ${attempt} 次）`,
        })
      }
      await sleep(delay)
      if (update) await update(taskId, { note: '' })
    }
  }
}

async function downloadMedia(kind, url) {
  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(300000) })
  } catch (error) {
    throw new HttpError(502, `下载生成结果失败：${messageOf(error)}`, { transient: true })
  }
  if (!response.ok) {
    throw new HttpError(502, `下载生成结果失败 HTTP ${response.status}`, {
      upstreamStatus: response.status,
    })
  }
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_MEDIA_BYTES) throw new HttpError(502, '生成结果文件过大')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_MEDIA_BYTES) throw new HttpError(502, '生成结果文件过大')
  const mime = (response.headers.get('content-type') || (kind === 'video' ? 'video/mp4' : 'image/png'))
    .split(';')[0]
    .trim()
  return { buffer, mime, extension: mimeToExtension(mime, kind) }
}

function publicItem(item) {
  if (!item) return undefined
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    prompt: item.prompt,
    model: item.model,
    size: item.size,
    seconds: item.seconds,
    progress: Number(item.progress || 0),
    stage: item.stage || '',
    note: item.note || '',
    error: item.error || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    url: item.file ? `${ROUTE_PREFIX}/media/${item.id}` : undefined,
    upstream: item.upstream || undefined,
  }
}

/** Durable history: one JSON index plus the downloaded media files. */
function createStore() {
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const root = path.join(home, 'agnes-media')
  const mediaDir = path.join(root, 'media')
  const indexFile = path.join(root, 'history.json')
  let items = []
  let chain = Promise.resolve()

  const ready = (async () => {
    await mkdir(mediaDir, { recursive: true })
    try {
      const raw = await readFile(indexFile, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed.items)) items = parsed.items
    } catch {
      items = []
    }
    for (const item of items) {
      if (item.status === 'queued' || item.status === 'running') {
        item.status = item.videoId ? 'running' : 'queued'
        item.note = ''
      }
    }
  })()

  function persist() {
    chain = chain
      .then(async () => {
        await mkdir(root, { recursive: true })
        const tmp = `${indexFile}.tmp`
        await writeFile(tmp, JSON.stringify({ version: 1, items }, null, 2), 'utf8')
        await rename(tmp, indexFile)
      })
      .catch(() => {})
    return chain
  }

  async function prune() {
    while (items.length > HISTORY_LIMIT) {
      const dropped = items.pop()
      if (dropped && dropped.file) {
        unlink(path.join(mediaDir, dropped.file)).catch(() => {})
      }
    }
  }

  return {
    ready,
    mediaPath: (file) => path.join(mediaDir, file),
    list: () => items.map((item) => ({ ...item })),
    find: (id) => items.find((item) => item.id === id),
    async add(item) {
      await ready
      items.unshift(item)
      await prune()
      await persist()
      return item
    },
    async update(id, patch) {
      await ready
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) return undefined
      items[index] = { ...items[index], ...patch, updatedAt: Date.now() }
      await persist()
      return items[index]
    },
    async remove(id) {
      await ready
      const index = items.findIndex((item) => item.id === id)
      if (index < 0) return false
      const [dropped] = items.splice(index, 1)
      if (dropped && dropped.file) {
        unlink(path.join(mediaDir, dropped.file)).catch(() => {})
      }
      await persist()
      return true
    },
  }
}

/** Background task runner owned by the Host, independent of any browser page. */
function createTasks(ctx, settings, store) {
  const running = new Set()
  const cancelled = new Set()

  const update = (id, patch) => store.update(id, patch)

  async function imageTask(id) {
    const item = store.find(id)
    if (!item) return
    await update(id, { status: 'running', stage: 'image', progress: 5, note: '' })
    try {
      const deadline = Date.now() + TASK_DEADLINE_MS
      const key = await requireKey(ctx, settings)
      const payload = {
        model: item.model,
        prompt: item.prompt,
        size: item.size,
        extra_body: { response_format: 'url' },
      }
      if (typeof item.seed === 'number') payload.seed = item.seed
      const data = await upstreamRetry(
        settings,
        key,
        '/images/generations',
        { method: 'POST', body: payload, timeoutMs: 180000 },
        id,
        update,
        deadline,
      )
      const url = String(data?.data?.[0]?.url || data?.url || '')
      if (!url) throw new HttpError(502, '图片接口没有返回图片地址', { transient: true })
      if (cancelled.has(id)) return
      const media = await downloadMedia('image', url)
      if (cancelled.has(id)) return
      const file = `${id}.${media.extension}`
      await writeFile(store.mediaPath(file), media.buffer)
      await update(id, {
        status: 'ready',
        file,
        mime: media.mime,
        upstream: url,
        progress: 100,
        stage: '',
        note: '',
      })
    } catch (error) {
      if (!cancelled.has(id)) {
        await update(id, { status: 'failed', error: messageOf(error), note: '' })
      }
    }
  }

  async function videoTask(id) {
    const item = store.find(id)
    if (!item) return
    try {
      const deadline = Date.now() + TASK_DEADLINE_MS
      let videoId = item.videoId
      if (!videoId) {
        await update(id, { status: 'running', stage: 'submit', progress: 3, note: '' })
        const key = await requireKey(ctx, settings)
        const payload = {
          model: item.model,
          prompt: item.prompt,
          mode: 'text',
          seconds: item.seconds,
          size: item.size,
        }
        if (typeof item.seed === 'number') payload.seed = item.seed
        const data = await upstreamRetry(
          settings,
          key,
          '/videos',
          { method: 'POST', body: payload, timeoutMs: 120000 },
          id,
          update,
          deadline,
        )
        videoId = String(data?.video_id || data?.id || data?.task_id || '')
        if (!videoId) throw new HttpError(502, '视频接口没有返回任务 ID', { transient: true })
        if (cancelled.has(id)) return
        await update(id, { status: 'running', stage: 'queue', videoId, progress: 5 })
      } else {
        await update(id, { status: 'running', stage: 'queue' })
      }

      while (Date.now() < deadline) {
        if (cancelled.has(id)) return
        await sleep(POLL_INTERVAL_MS)
        if (cancelled.has(id)) return
        let state
        try {
          const key = await requireKey(ctx, settings)
          state = await upstream(settings, key, `/videos/${encodeURIComponent(videoId)}`, {
            timeoutMs: 60000,
          })
        } catch (error) {
          if (error && error.transient) {
            await update(id, {
              note: `上游繁忙（${error.upstreamStatus || '网络'}），正在重试…`,
            })
            continue
          }
          throw error
        }
        const status = String(state?.status || '')
        const progress = Number(state?.progress || 0)
        if (status === 'failed') {
          throw new HttpError(502, extractUpstreamError(state, '视频生成失败'))
        }
        if (status === 'completed') {
          const url = String(state?.metadata?.url || state?.url || '')
          if (!url) throw new HttpError(502, '视频已完成但没有返回地址', { transient: true })
          await update(id, { stage: 'download', progress: 96, note: '' })
          const media = await downloadMedia('video', url)
          if (cancelled.has(id)) return
          const file = `${id}.${media.extension}`
          await writeFile(store.mediaPath(file), media.buffer)
          await update(id, {
            status: 'ready',
            file,
            mime: media.mime,
            upstream: url,
            progress: 100,
            stage: '',
            note: '',
          })
          return
        }
        await update(id, {
          status: 'running',
          stage: status === 'queued' ? 'queue' : 'render',
          progress: progress || 0,
          note: '',
        })
      }
      throw new HttpError(504, '视频生成超时（超过 40 分钟）')
    } catch (error) {
      if (!cancelled.has(id)) {
        await update(id, { status: 'failed', error: messageOf(error), note: '' })
      }
    }
  }

  function start(id) {
    if (running.has(id)) return
    const item = store.find(id)
    if (!item) return
    running.add(id)
    const task = item.kind === 'video' ? videoTask(id) : imageTask(id)
    Promise.resolve(task)
      .catch(() => {})
      .finally(() => running.delete(id))
  }

  function resume() {
    for (const item of store.list()) {
      if (item.status === 'queued' || item.status === 'running') start(item.id)
    }
  }

  function cancel(id) {
    cancelled.add(id)
  }

  return { start, resume, cancel }
}

async function statusRoute(ctx, settings, res) {
  const key = await resolveKey(ctx, settings)
  sendJson(res, 200, {
    ok: true,
    version: VERSION,
    configured: Boolean(key),
    source: key ? key.source : null,
    apiKeyEnv: settings.apiKeyEnv,
    baseURL: settings.baseURL,
    videoModel: settings.videoModel,
    imageModel: settings.imageModel,
    platformURL: 'https://platform.agnes-ai.cn',
  })
}

async function historyRoute(res, store) {
  sendJson(res, 200, { ok: true, items: store.list().map(publicItem) })
}

async function taskRoute(res, store, id) {
  const item = store.find(id)
  if (!item) throw new HttpError(404, '任务不存在或已被删除')
  sendJson(res, 200, { ok: true, item: publicItem(item) })
}

async function deleteRoute(req, res, store, tasks) {
  const body = await readJson(req)
  const id = String(body.id || '')
  if (!id) throw new HttpError(400, '缺少任务 id')
  tasks.cancel(id)
  const removed = await store.remove(id)
  if (!removed) throw new HttpError(404, '任务不存在')
  sendJson(res, 200, { ok: true })
}

async function mediaRoute(req, res, store, id, download) {
  const headOnly = req.method === 'HEAD'
  const item = store.find(id)
  if (!item || !item.file) throw new HttpError(404, '生成结果不存在或已被清理')
  const file = store.mediaPath(item.file)
  let info
  try {
    info = await stat(file)
  } catch {
    throw new HttpError(404, '生成结果文件已被清理')
  }
  const headers = {
    'content-type': item.mime || (item.kind === 'video' ? 'video/mp4' : 'image/png'),
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
  }
  if (download) {
    const extension = item.file.includes('.') ? item.file.slice(item.file.lastIndexOf('.') + 1) : 'bin'
    headers['content-disposition'] = `attachment; filename="agnes-${item.kind}-${id.slice(0, 8)}.${extension}"`
  }

  const range = req.headers.range
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range))
    if (!match) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` })
      res.end()
      return
    }
    const start = match[1] === '' ? undefined : Number(match[1])
    const end = match[2] === '' ? undefined : Number(match[2])
    let from = start ?? Math.max(0, info.size - (end ?? 0))
    let to = end ?? info.size - 1
    if (Number.isNaN(from) || Number.isNaN(to) || from > to || from >= info.size) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` })
      res.end()
      return
    }
    to = Math.min(to, info.size - 1)
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${from}-${to}/${info.size}`,
      'content-length': String(to - from + 1),
    })
    if (headOnly) {
      res.end()
      return
    }
    const stream = createReadStream(file, { start: from, end: to })
    stream.on('error', () => res.destroy())
    stream.pipe(res)
    return
  }

  res.writeHead(200, { ...headers, 'content-length': String(info.size) })
  if (headOnly) {
    res.end()
    return
  }
  const stream = createReadStream(file)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}

function createHandler(ctx, settings, store, tasks) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(ROUTE_PREFIX)) throw new HttpError(404, '未知接口')
      const rest = url.pathname.slice(ROUTE_PREFIX.length) || '/'

      if (req.method === 'GET' && rest === '/version') {
        sendJson(res, 200, { ok: true, version: VERSION })
        return
      }
      if (req.method === 'GET' && rest === '/status') {
        await statusRoute(ctx, settings, res)
        return
      }
      if (req.method === 'GET' && rest === '/history') {
        await historyRoute(res, store)
        return
      }
      if (req.method === 'POST' && rest === '/image') {
        await store.ready
        const body = await readJson(req)
        const prompt = cleanPrompt(body.prompt)
        const model = normalizeModel(body.model) || settings.imageModel
        const requestedSize = String(body.size || '').trim()
        const size = IMAGE_SIZES.has(requestedSize) ? requestedSize : '1024x1024'
        const seed = Number(body.seed)
        const item = {
          id: randomUUID(),
          kind: 'image',
          status: 'queued',
          prompt,
          model,
          size,
          progress: 0,
          stage: 'queued',
          note: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        if (Number.isFinite(seed)) item.seed = seed
        await store.add(item)
        tasks.start(item.id)
        sendJson(res, 200, { ok: true, item: publicItem(store.find(item.id)) })
        return
      }
      if (req.method === 'POST' && rest === '/video') {
        await store.ready
        const body = await readJson(req)
        const prompt = cleanPrompt(body.prompt)
        const model = normalizeModel(body.model) || settings.videoModel
        const requestedSize = String(body.size || '').trim()
        const size = VIDEO_SIZES.has(requestedSize) ? requestedSize : '720P'
        const requestedSeconds = String(body.seconds || '').trim()
        const seconds = VIDEO_SECONDS.has(requestedSeconds) ? requestedSeconds : '5'
        const seed = Number(body.seed)
        const item = {
          id: randomUUID(),
          kind: 'video',
          status: 'queued',
          prompt,
          model,
          size,
          seconds,
          progress: 0,
          stage: 'queued',
          note: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        if (Number.isFinite(seed)) item.seed = seed
        await store.add(item)
        tasks.start(item.id)
        sendJson(res, 200, { ok: true, item: publicItem(store.find(item.id)) })
        return
      }
      if (req.method === 'POST' && rest === '/history/delete') {
        await deleteRoute(req, res, store, tasks)
        return
      }
      const taskMatch = rest.match(/^\/task\/([^/]+)$/)
      if (req.method === 'GET' && taskMatch) {
        await taskRoute(res, store, decodeURIComponent(taskMatch[1]))
        return
      }
      const mediaMatch = rest.match(/^\/media\/([^/]+)$/)
      if ((req.method === 'GET' || req.method === 'HEAD') && mediaMatch) {
        await mediaRoute(
          req,
          res,
          store,
          decodeURIComponent(mediaMatch[1]),
          url.searchParams.get('download') === '1',
        )
        return
      }
      throw new HttpError(404, '未知接口')
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      sendJson(res, status, { ok: false, error: messageOf(error) })
    }
  }
}

export const inject = ['webServer', 'credentials']

export function apply(ctx, config = {}) {
  const settings = {
    baseURL: String(config.baseURL || DEFAULTS.baseURL),
    apiKeyEnv: String(config.apiKeyEnv || DEFAULTS.apiKeyEnv),
    videoModel: normalizeModel(config.videoModel) || DEFAULTS.videoModel,
    imageModel: normalizeModel(config.imageModel) || DEFAULTS.imageModel,
  }
  const store = createStore()
  const tasks = createTasks(ctx, settings, store)
  const handler = createHandler(ctx, settings, store, tasks)

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler,
      }),
    'dsh-agnes-media: routes',
  )

  store.ready
    .then(() => tasks.resume())
    .catch(() => {})
}
