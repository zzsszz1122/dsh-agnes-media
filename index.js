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

import { composePrompt, seedFor } from './lib/context.js'
import { createFrames } from './lib/frames.js'
import { createProjects } from './lib/projects.js'

const VERSION = '0.3.1'

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

async function upstreamRetry(settings, key, endpoint, options, taskId, update, deadline, shouldStop) {
  let attempt = 0
  for (;;) {
    if (shouldStop && shouldStop()) throw new HttpError(409, '任务已取消')
    try {
      return await upstream(settings, key, endpoint, options)
    } catch (error) {
      if (!error || !error.transient) throw error
      if (deadline && Date.now() > deadline) throw error
      if (shouldStop && shouldStop()) throw new HttpError(409, '任务已取消')
      attempt += 1
      const delay = Math.min(30000, 5000 + attempt * 2000)
      if (update) {
        await update(taskId, {
          note: `上游繁忙（${error.upstreamStatus || '网络'}），${Math.ceil(delay / 1000)} 秒后重试（第 ${attempt} 次）`,
        })
      }
      await sleep(delay)
      if (shouldStop && shouldStop()) throw new HttpError(409, '任务已取消')
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
    projectId: item.projectId || undefined,
    shotId: item.shotId || undefined,
    parentTaskId: item.parentTaskId || undefined,
    hasFirstFrame: Boolean(item.firstFrameFile),
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
function createTasks(ctx, settings, store, hooks = {}) {
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
        () => cancelled.has(id),
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
      if (cancelled.has(id) || (error instanceof HttpError && error.status === 409)) {
        await update(id, { status: 'cancelled', stage: '', note: '', error: '已取消' })
        if (typeof hooks.onTaskCancelled === 'function') {
          try {
            await hooks.onTaskCancelled(store.find(id))
          } catch {
            /* keep the cancellation authoritative */
          }
        }
      } else if (!cancelled.has(id)) {
        await update(id, { status: 'failed', error: messageOf(error), note: '' })
      }
    }
  }

  async function videoTask(id) {
    const item = store.find(id)
    if (!item) return
    if (cancelled.has(id)) return
    try {
      const deadline = Date.now() + TASK_DEADLINE_MS
      let videoId = item.videoId
      if (!videoId) {
        if (cancelled.has(id)) return
        await update(id, { status: 'running', stage: 'submit', progress: 3, note: '' })
        const key = await requireKey(ctx, settings)
        const payload = {
          model: item.model,
          prompt: item.prompt,
          mode: item.firstFrameFile ? 'keyframe' : 'text',
          seconds: item.seconds,
          size: item.size,
        }
        if (item.firstFrameFile) {
          if (typeof hooks.frameDataUri !== 'function') {
            throw new HttpError(500, '首帧功能未初始化')
          }
          payload.first_frame = await hooks.frameDataUri(item.firstFrameFile)
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
          () => cancelled.has(id),
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
          if (typeof hooks.onVideoReady === 'function') {
            try {
              await hooks.onVideoReady(store.find(id))
            } catch {
              /* a frame problem must not fail the generation */
            }
          }
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
      if (cancelled.has(id) || (error instanceof HttpError && error.status === 409)) {
        await update(id, { status: 'cancelled', stage: '', note: '', error: '已取消' })
        if (typeof hooks.onVideoCancelled === 'function') {
          try {
            await hooks.onVideoCancelled(store.find(id))
          } catch {
            /* keep the cancellation authoritative */
          }
        }
      } else if (!cancelled.has(id)) {
        await update(id, { status: 'failed', error: messageOf(error), note: '' })
        if (typeof hooks.onVideoFailed === 'function') {
          try {
            await hooks.onVideoFailed(store.find(id), error)
          } catch {
            /* keep the task failure authoritative */
          }
        }
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

async function statusRoute(ctx, settings, res, frames) {
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
    ffmpeg: frames ? Boolean(await frames.available()) : false,
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

function publicShot(shot) {
  if (!shot) return undefined
  const { assetFile, tailFile, ...rest } = shot
  return rest
}

function createHandler(ctx, settings, store, tasks, services) {
  const { projects, frames, startChain, cancelTask, cancelChain } = services

  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (!url.pathname.startsWith(ROUTE_PREFIX)) throw new HttpError(404, '未知接口')
      const rest = url.pathname.slice(ROUTE_PREFIX.length) || '/'
      const method = req.method || 'GET'

      if (method === 'GET' && rest === '/version') {
        sendJson(res, 200, { ok: true, version: VERSION })
        return
      }
      if (method === 'GET' && rest === '/status') {
        await statusRoute(ctx, settings, res, frames)
        return
      }
      if (method === 'GET' && rest === '/history') {
        await historyRoute(res, store)
        return
      }
      if (method === 'POST' && rest === '/image') {
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
      if (method === 'POST' && rest === '/video') {
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
        if (body.projectId) item.projectId = String(body.projectId)
        if (body.shotId) item.shotId = String(body.shotId)
        await store.add(item)
        tasks.start(item.id)
        sendJson(res, 200, { ok: true, item: publicItem(store.find(item.id)) })
        return
      }
      if (method === 'POST' && rest === '/history/delete') {
        await deleteRoute(req, res, store, tasks)
        return
      }

      /* ---------------------------- projects ---------------------------- */

      if (rest === '/projects') {
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, projects: projects.listProjects() })
          return
        }
        if (method === 'POST') {
          const body = await readJson(req)
          const project = await projects.createProject(body)
          sendJson(res, 200, { ok: true, project })
          return
        }
      }

      let match = rest.match(/^\/projects\/([^/]+)$/)
      if (match) {
        const projectId = decodeURIComponent(match[1])
        if (method === 'GET') {
          const project = projects.getProject(projectId)
          if (!project) throw new HttpError(404, '项目不存在')
          sendJson(res, 200, {
            ok: true,
            project,
            shots: projects.listShots(projectId).map(publicShot),
            canvas: projects.getCanvas(projectId),
            ffmpeg: await frames.available(),
          })
          return
        }
        if (method === 'PATCH') {
          const body = await readJson(req)
          const project = await projects.updateProject(projectId, body)
          if (!project) throw new HttpError(404, '项目不存在')
          sendJson(res, 200, { ok: true, project })
          return
        }
        if (method === 'DELETE') {
          const removed = await projects.deleteProject(projectId)
          if (!removed) throw new HttpError(404, '项目不存在')
          sendJson(res, 200, { ok: true })
          return
        }
      }

      match = rest.match(/^\/projects\/([^/]+)\/canvas$/)
      if (match) {
        const projectId = decodeURIComponent(match[1])
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, canvas: projects.getCanvas(projectId) })
          return
        }
        if (method === 'PUT' || method === 'POST') {
          const body = await readJson(req, 8 * 1024 * 1024)
          const canvas = await projects.saveCanvas(projectId, body)
          if (!canvas) throw new HttpError(404, '项目不存在')
          sendJson(res, 200, { ok: true, canvas })
          return
        }
      }

      match = rest.match(/^\/projects\/([^/]+)\/chain\/cancel$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const result = await cancelChain(projectId)
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/chain$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const body = await readJson(req)
        const result = await startChain(projectId, body)
        sendJson(res, 200, { ok: true, ...result })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/timeline$/)
      if (match && method === 'GET') {
        const projectId = decodeURIComponent(match[1])
        const project = projects.getProject(projectId)
        if (!project) throw new HttpError(404, '项目不存在')
        const shots = projects.listShots(projectId)
        const totalDuration = shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0)
        sendJson(res, 200, {
          ok: true,
          projectId,
          totalDuration,
          readyCount: shots.filter((shot) => shot.status === 'ready' && shot.assetUrl).length,
          shots: shots.map((shot) => ({
            id: shot.id,
            index: shot.index,
            prompt: shot.prompt,
            duration: shot.duration,
            status: shot.status,
            assetUrl: shot.assetUrl,
            tailUrl: shot.tailUrl,
          })),
        })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/shots$/)
      if (match) {
        const projectId = decodeURIComponent(match[1])
        if (method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            shots: projects.listShots(projectId).map(publicShot),
          })
          return
        }
        if (method === 'POST') {
          const body = await readJson(req)
          const shot = await projects.createShot(projectId, body)
          if (!shot) throw new HttpError(404, '项目不存在')
          sendJson(res, 200, { ok: true, shot: publicShot(shot) })
          return
        }
      }

      match = rest.match(/^\/projects\/([^/]+)\/shots\/([^/]+)$/)
      if (match) {
        const projectId = decodeURIComponent(match[1])
        const shotId = decodeURIComponent(match[2])
        if (method === 'GET') {
          const shot = projects.getShot(projectId, shotId)
          if (!shot) throw new HttpError(404, '镜头不存在')
          sendJson(res, 200, { ok: true, shot: publicShot(shot) })
          return
        }
        if (method === 'PATCH') {
          const body = await readJson(req)
          const shot = await projects.updateShot(projectId, shotId, body)
          if (!shot) throw new HttpError(404, '镜头不存在')
          sendJson(res, 200, { ok: true, shot: publicShot(shot) })
          return
        }
        if (method === 'DELETE') {
          const removed = await projects.deleteShot(projectId, shotId)
          if (!removed) throw new HttpError(404, '镜头不存在')
          sendJson(res, 200, { ok: true })
          return
        }
      }

      match = rest.match(/^\/projects\/([^/]+)\/shots\/([^/]+)\/first-frame$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const shotId = decodeURIComponent(match[2])
        const shot = projects.getShot(projectId, shotId)
        if (!shot) throw new HttpError(404, '镜头不存在')
        const body = await readJson(req, 24 * 1024 * 1024)
        const dataUri = String(body.dataUri || '')
        const mimeMatch = /^data:image\/(png|jpeg|jpg|webp);base64,/i.exec(dataUri)
        const extension = mimeMatch
          ? mimeMatch[1].toLowerCase() === 'png'
            ? 'png'
            : mimeMatch[1].toLowerCase() === 'webp'
              ? 'webp'
              : 'jpg'
          : 'jpg'
        const relative = `frames/${shotId}-manual.${extension}`
        await frames.saveDataUri(dataUri, projects.assetPath(projectId, relative))
        const updated = await projects.updateShot(projectId, shotId, {
          firstFrame: { source: 'manual', file: relative },
        })
        sendJson(res, 200, {
          ok: true,
          shot: publicShot(updated),
          tailUrl: `${ROUTE_PREFIX}/projects/${projectId}/shots/${shotId}/tail`,
        })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/shots\/([^/]+)\/tail$/)
      if (match && (method === 'GET' || method === 'HEAD')) {
        const projectId = decodeURIComponent(match[1])
        const shotId = decodeURIComponent(match[2])
        const shot = projects.getShot(projectId, shotId)
        if (!shot || !shot.tailFile) throw new HttpError(404, '该镜头还没有尾帧')
        const file = projects.assetPath(projectId, shot.tailFile)
        let info
        try {
          info = await stat(file)
        } catch {
          throw new HttpError(404, '尾帧文件已被清理')
        }
        res.writeHead(200, {
          'content-type': 'image/jpeg',
          'content-length': String(info.size),
          'cache-control': 'private, max-age=31536000, immutable',
        })
        if (method === 'HEAD') {
          res.end()
          return
        }
        const stream = createReadStream(file)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
      }

      match = rest.match(/^\/task\/([^/]+)\/cancel$/)
      if (match && method === 'POST') {
        const item = await cancelTask(decodeURIComponent(match[1]))
        sendJson(res, 200, { ok: true, item: publicItem(item) })
        return
      }

      const taskMatch = rest.match(/^\/task\/([^/]+)$/)
      if (method === 'GET' && taskMatch) {
        await taskRoute(res, store, decodeURIComponent(taskMatch[1]))
        return
      }
      const mediaMatch = rest.match(/^\/media\/([^/]+)$/)
      if ((method === 'GET' || method === 'HEAD') && mediaMatch) {
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

  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const store = createStore()
  const projects = createProjects(path.join(home, 'agnes-media', 'projects'))
  const frames = createFrames({ ffmpegPath: config.ffmpegPath })

  async function onVideoReady(item) {
    if (!item || !item.projectId || !item.shotId) return
    const project = projects.getProject(item.projectId)
    if (!project) return
    await projects.updateShot(item.projectId, item.shotId, {
      status: 'ready',
      taskId: item.id,
      assetFile: item.file,
      assetUrl: `${ROUTE_PREFIX}/media/${item.id}`,
      error: '',
    })
    const tailRelative = `frames/${item.shotId}-tail.jpg`
    const tailPath = projects.assetPath(item.projectId, tailRelative)
    const result = await frames.extractTail(store.mediaPath(item.file), tailPath)
    if (result.ok) {
      await projects.updateShot(item.projectId, item.shotId, {
        tailFile: tailRelative,
        tailUrl: `${ROUTE_PREFIX}/projects/${item.projectId}/shots/${item.shotId}/tail`,
        tailError: '',
      })
    } else {
      await projects.updateShot(item.projectId, item.shotId, { tailError: result.error })
    }
  }

  async function onVideoFailed(item, error) {
    if (!item || !item.projectId || !item.shotId) return
    await projects.updateShot(item.projectId, item.shotId, {
      status: 'failed',
      error: messageOf(error),
    })
  }

  async function onVideoCancelled(item) {
    if (!item || !item.projectId || !item.shotId) return
    await projects.updateShot(item.projectId, item.shotId, { status: 'cancelled', error: '' })
  }

  const tasks = createTasks(ctx, settings, store, {
    frameDataUri: (file) => frames.dataUri(file),
    onVideoReady,
    onVideoFailed,
    onVideoCancelled,
    onTaskCancelled: onVideoCancelled,
  })

  async function cancelTask(taskId) {
    const item = store.find(taskId)
    if (!item) throw new HttpError(404, '任务不存在')
    tasks.cancel(taskId)
    if (item.status === 'queued' || item.status === 'running') {
      await store.update(taskId, { status: 'cancelled', stage: '', note: '', error: '已取消' })
      if (item.projectId && item.shotId) {
        await projects.updateShot(item.projectId, item.shotId, { status: 'cancelled', error: '' })
      }
    }
    return store.find(taskId)
  }

  async function submitVideo(input) {
    const item = {
      id: randomUUID(),
      kind: 'video',
      status: 'queued',
      prompt: input.prompt,
      model: input.model || settings.videoModel,
      size: input.size || '720P',
      seconds: input.seconds || '5',
      progress: 0,
      stage: 'queued',
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (Number.isFinite(Number(input.seed))) item.seed = Number(input.seed)
    if (input.projectId) item.projectId = String(input.projectId)
    if (input.shotId) item.shotId = String(input.shotId)
    if (input.parentTaskId) item.parentTaskId = String(input.parentTaskId)
    if (input.firstFrameFile) item.firstFrameFile = input.firstFrameFile
    await store.add(item)
    tasks.start(item.id)
    return store.find(item.id)
  }

  async function waitForTask(taskId, shouldStop, timeoutMs = TASK_DEADLINE_MS + 10 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (shouldStop && shouldStop()) throw new HttpError(409, '链路已取消')
      const item = store.find(taskId)
      if (!item) throw new HttpError(410, '任务记录丢失')
      if (item.status === 'ready') return item
      if (item.status === 'cancelled') throw new HttpError(409, '任务已取消')
      if (item.status === 'failed') throw new HttpError(502, item.error || '任务失败')
      await sleep(1500)
    }
    throw new HttpError(504, '等待任务完成超时')
  }

  async function waitForShotTail(projectId, shotId) {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const shot = projects.getShot(projectId, shotId)
      if (!shot) return undefined
      if (shot.status === 'failed') return shot
      if (shot.tailFile || shot.tailError) return shot
      await sleep(800)
    }
    return projects.getShot(projectId, shotId)
  }

  const chainLocks = new Set()
  const chainCancelled = new Set()
  const chainCurrentTask = new Map()

  async function cancelChain(projectId) {
    const project = projects.getProject(projectId)
    if (!project) throw new HttpError(404, '项目不存在')
    chainCancelled.add(projectId)
    const taskId = chainCurrentTask.get(projectId)
    if (taskId) await cancelTask(taskId).catch(() => {})
    const currentId = project.chain && project.chain.currentShotId
    if (currentId) {
      const current = projects.getShot(projectId, currentId)
      if (current && (current.status === 'running' || current.status === 'queued')) {
        await projects.updateShot(projectId, currentId, { status: 'cancelled', error: '' })
      }
    }
    await projects.updateProject(projectId, {
      chain: { running: false, currentShotId: null, finishedAt: Date.now(), error: '已取消' },
    })
    return { cancelled: true }
  }

  async function startChain(projectId, body = {}) {
    if (chainLocks.has(projectId)) throw new HttpError(409, '该项目已有链路在执行')
    const project = projects.getProject(projectId)
    if (!project) throw new HttpError(404, '项目不存在')

    const allShots = projects.listShots(projectId)
    let sequence = allShots
    if (Array.isArray(body.shotIds) && body.shotIds.length > 0) {
      const byId = new Map(allShots.map((shot) => [shot.id, shot]))
      sequence = body.shotIds.map((id) => byId.get(String(id))).filter(Boolean)
    } else if (body.from) {
      const index = allShots.findIndex((shot) => shot.id === String(body.from))
      if (index >= 0) sequence = allShots.slice(index)
    }
    if (sequence.length === 0) throw new HttpError(400, '没有可执行的镜头')

    chainLocks.add(projectId)
    chainCancelled.delete(projectId)
    const force = body.force === true

    await projects.updateProject(projectId, {
      chain: { running: true, currentShotId: null, startedAt: Date.now(), finishedAt: null, error: '' },
    })

    ;(async () => {
      try {
        for (let index = 0; index < sequence.length; index += 1) {
          if (chainCancelled.has(projectId)) throw new HttpError(409, '链路已取消')
          const current = projects.getShot(projectId, sequence[index].id)
          if (!current) continue
          if (!force && current.status === 'ready' && current.assetFile) continue

          await projects.updateProject(projectId, {
            chain: { running: true, currentShotId: current.id },
          })
          await projects.updateShot(projectId, current.id, { status: 'running', error: '' })

          const previous = index > 0 ? projects.getShot(projectId, sequence[index - 1].id) : undefined
          let firstFrameFile
          if (current.firstFrame && current.firstFrame.source === 'manual' && current.firstFrame.file) {
            firstFrameFile = projects.assetPath(projectId, current.firstFrame.file)
          } else if (previous && previous.tailFile) {
            firstFrameFile = projects.assetPath(projectId, previous.tailFile)
          } else if (previous && current.firstFrame?.source !== 'none') {
            const reason =
              previous.tailError || '缺少上一镜尾帧（需要 ffmpeg 或为该镜上传首帧）'
            await projects.updateShot(projectId, current.id, { status: 'blocked', error: reason })
            throw new HttpError(409, `镜头 ${current.index} 无法衔接：${reason}`)
          }

          const liveProject = projects.getProject(projectId)
          const prompt = composePrompt({ project: liveProject, shot: current, previousShot: previous })
          const seed = seedFor(liveProject, current, index)
          const task = await submitVideo({
            prompt,
            seconds: String(current.duration || 5),
            size: current.size,
            seed,
            projectId,
            shotId: current.id,
            firstFrameFile,
          })
          chainCurrentTask.set(projectId, task.id)
          await projects.updateShot(projectId, current.id, { taskId: task.id })
          await waitForTask(task.id, () => chainCancelled.has(projectId))
          const settled = await waitForShotTail(projectId, current.id)
          if (settled && settled.status === 'failed') {
            throw new HttpError(502, settled.error || '镜头生成失败')
          }
        }
        await projects.updateProject(projectId, {
          chain: { running: false, currentShotId: null, finishedAt: Date.now(), error: '' },
        })
      } catch (error) {
        await projects.updateProject(projectId, {
          chain: {
            running: false,
            currentShotId: null,
            finishedAt: Date.now(),
            error: messageOf(error),
          },
        })
      } finally {
        chainLocks.delete(projectId)
        chainCurrentTask.delete(projectId)
        chainCancelled.delete(projectId)
      }
    })()

    return { started: true, count: sequence.length }
  }

  const handler = createHandler(ctx, settings, store, tasks, {
    projects,
    frames,
    startChain,
    cancelTask,
    cancelChain,
  })

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
  projects.ready.catch(() => {})
}
