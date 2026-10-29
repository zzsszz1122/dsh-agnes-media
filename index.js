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
 * The panel side is deliberately *not* routed through the chat route: the
 * composer entry submits to `POST <prefix>/v1/video` (`config.videoPath`), which
 * owns the video task lifecycle end to end. `/video` remains as the pre-0.8
 * alias of the same handler so older clients and scripts keep working.
 *
 * Results are downloaded once and stored under `<DSH home>/agnes-media`, so the
 * history survives a Host restart and the browser never receives the API key.
 */

import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { composePrompt, seedFor } from './lib/context.js'
import { createFrames } from './lib/frames.js'
import { createProjects } from './lib/projects.js'
import { createAssemble } from './lib/assemble.js'
import { bindCharactersToShots, parseScript } from './lib/script.js'

const VERSION = '0.7.2'

const DEFAULTS = {
  baseURL: 'https://api.agnes-ai.cn/v1',
  apiKeyEnv: 'AGNES_API_KEY',
  videoModel: 'agnes-video-2.5-flash',
  imageModel: 'agnes-image-2.5-flash',
  // Panel route of the composer entry, not the upstream path. The entry talks
  // to a video task route; it never goes through `/v1/chat/completions`.
  videoPath: 'v1/video',
  // Upstream path the task route ultimately calls (`<baseURL>/videos`).
  videoUpstreamPath: '/videos',
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
// Duration is a multiple of 5 up to 30s; the upstream free model tops out at 12s
// per request, so anything longer is stitched from chunks (see videoTask).
const VIDEO_SECONDS = new Set(['5', '10', '15', '20', '25', '30'])
const CHUNK_SECONDS = 12
const MAX_SECONDS = 30
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

/** Panel-relative route: no leading/trailing slash, kept verbatim otherwise. */
function normalizeRoute(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
}

/** Upstream path always starts with a single slash. */
function normalizeUpstreamPath(value) {
  const path = normalizeRoute(value)
  return path ? `/${path}` : ''
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

/**
 * Clean an API key before it is sent upstream.
 *
 * A pasted key very often carries a trailing newline, wrapping quotes, an
 * accidental `Bearer ` prefix, or an invisible zero-width character picked up
 * from a terminal or a web console. Upstream answers all of those with HTTP 401
 * "无效的令牌", which reads like a broken key when the key itself is fine — so the
 * token is normalized here instead of being sent verbatim.
 *
 * A token never contains whitespace, so everything whitespace-like is removed
 * outright rather than collapsed: collapsing a mid-string newline into a space
 * would leave a still-invalid key.
 */
function normalizeApiKey(value) {
  let key = String(value ?? '').trim()
  // Peel a pasted scheme and one layer of wrapping quotes, in whichever order
  // they arrived ("Bearer sk-x", "\"Bearer sk-x\"", "Bearer \"sk-x\"").
  for (let round = 0; round < 3; round += 1) {
    const before = key
    key = key.replace(/^(Bearer|token)\s+/i, '')
    const quoted = /^(['"])([\s\S]*)\1$/.exec(key)
    if (quoted) key = quoted[2].trim()
    if (key === before) break
  }
  // Strip every whitespace and zero-width character that survived.
  return key.replace(/[\s\u200B-\u200D\uFEFF]+/g, '')
}

/** A safe, non-reversible hint about which secret is actually in use. */
function keyFingerprint(value) {
  const key = String(value || '')
  if (key.length < 12) return `长度 ${key.length}`
  return `${key.slice(0, 4)}…${key.slice(-4)}（长度 ${key.length}）`
}

async function resolveKey(ctx, settings) {
  const ref = settings.apiKeyEnv
  try {
    const resolved = await ctx.credentials.resolve(ref)
    if (resolved) {
      const raw = typeof resolved === 'string' ? resolved : resolved.value
      const value = normalizeApiKey(raw)
      if (value) {
        return {
          value,
          dirty: value !== String(raw ?? ''),
          source:
            typeof resolved === 'string' ? 'credentials' : resolved.source || 'credentials',
        }
      }
    }
  } catch {
    /* fall through to the ambient environment and record half */
  }
  if (process.env[ref]) {
    const value = normalizeApiKey(process.env[ref])
    if (value) return { value, dirty: value !== String(process.env[ref]), source: 'env' }
  }
  try {
    const record = await ctx.credentials.readRecord('agnes-api-key')
    if (record && record.kind === 'api-key' && record.key) {
      const value = normalizeApiKey(record.key)
      if (value) {
        return { value, dirty: value !== String(record.key), source: 'credentials' }
      }
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
    // An auth rejection is almost always "the token we sent is not the one you
    // think", so say exactly which token and which host were involved.
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(
        response.status === 401 ? 502 : 502,
        `上游 HTTP ${response.status}：${detail || '无错误详情'}。` +
          `已发送的令牌来源 ${key.source || '未知'}、${keyFingerprint(key.value)}，` +
          `上游地址 ${url}。请确认这个令牌属于该地址对应的 Agnes 账号，` +
          `并且没有被复制进多余的空格、换行或引号。`,
        { upstreamStatus: response.status, auth: true },
      )
    }
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

  /**
   * The composer's uploaded first frame is scratch, not history: it sits in the
   * media dir under the task id and is dropped once the task is terminal.
   * Shot-driven tasks point at project assets instead, whose names never match
   * `${id}-firstframe.*`, so they are left alone.
   */
  function dropFirstFrame(id) {
    for (const extension of ['png', 'jpg', 'jpeg', 'webp']) {
      unlink(store.mediaPath(`${id}-firstframe.${extension}`)).catch(() => {})
    }
  }

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
      if (typeof hooks.onImageReady === 'function') {
        try {
          await hooks.onImageReady(store.find(id))
        } catch {
          /* keep the generation authoritative */
        }
      }
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
        if (typeof hooks.onImageFailed === 'function') {
          try {
            await hooks.onImageFailed(store.find(id), error)
          } catch {
            /* keep the failure authoritative */
          }
        }
      }
    }
  }

  /**
   * Split a duration into upstream-sized chunks (max `CHUNK_SECONDS` each).
   *
   * The split is balanced rather than greedy: 15s becomes 8+7, not 12+3. A 3s
   * tail reads as a glitch, and merging it back would produce an illegal 15s
   * request — which is exactly what a greedy split silently did before.
   */
  function planChunks(totalSeconds) {
    const total = Math.max(5, Math.min(MAX_SECONDS, Number(totalSeconds) || 5))
    if (total <= CHUNK_SECONDS) return [total]
    const count = Math.ceil(total / CHUNK_SECONDS)
    const base = Math.floor(total / count)
    const chunks = Array.from({ length: count }, () => base)
    let remainder = total - base * count
    for (let index = 0; index < chunks.length && remainder > 0; index += 1) {
      chunks[index] += 1
      remainder -= 1
    }
    return chunks
  }

  /**
   * Long shots: render each chunk as its own upstream request, feed the previous
   * chunk's tail frame into the next as its keyframe, then concatenate.
   *
   * This keeps continuity across the seam (the next chunk literally starts on the
   * frame the previous one ended on) and it is the only way to exceed the
   * upstream's 12s limit without a different model.
   */
  async function videoTaskChunked(id) {
    const item = store.find(id)
    if (!item) return
    const chunks = planChunks(item.seconds)
    const chunkFiles = []
    try {
      const deadline = Date.now() + TASK_DEADLINE_MS
      const key = await requireKey(ctx, settings)
      let carryFrame = item.firstFrameFile
      let referenceUrls = Array.isArray(item.referenceUrls) ? item.referenceUrls.slice(0, 4) : []

      for (let index = 0; index < chunks.length; index += 1) {
        if (cancelled.has(id)) return
        if (Date.now() > deadline) throw new HttpError(504, '视频生成超时（超过 40 分钟）')
        const seconds = chunks[index]
        await update(id, {
          status: 'running',
          stage: 'submit',
          note: `第 ${index + 1}/${chunks.length} 段（${seconds}秒）`,
          progress: Math.round((index / chunks.length) * 90),
        })
        const chunkPrompt =
          index === 0 ? item.prompt : `${item.prompt}\n【续接】从上一段的最后一帧继续，动作与光线保持连贯。`
        const payload = {
          model: item.model,
          prompt: chunkPrompt,
          mode: carryFrame ? 'keyframe' : 'text',
          seconds: String(seconds),
          size: item.size,
        }
        if (index === 0 && referenceUrls.length > 0) {
          payload.mode = 'reference'
          payload.reference_image_urls = referenceUrls
        }
        if (carryFrame) {
          if (typeof hooks.frameDataUri !== 'function') {
            throw new HttpError(500, '首帧功能未初始化')
          }
          payload.first_frame = await hooks.frameDataUri(carryFrame)
        }
        if (typeof item.seed === 'number') payload.seed = item.seed + index

        const submitted = await upstreamRetry(
          settings,
          key,
          settings.videoUpstreamPath,
          { method: 'POST', body: payload, timeoutMs: 120000 },
          id,
          update,
          deadline,
          () => cancelled.has(id),
        )
        const chunkVideoId = String(submitted?.video_id || submitted?.id || submitted?.task_id || '')
        if (!chunkVideoId) throw new HttpError(502, '视频接口没有返回任务 ID', { transient: true })

        let doneUrl = ''
        while (Date.now() < deadline) {
          if (cancelled.has(id)) return
          await sleep(POLL_INTERVAL_MS)
          if (cancelled.has(id)) return
          let state
          try {
            const statusPath = `${settings.videoUpstreamPath}/${encodeURIComponent(chunkVideoId)}`
            state = await upstream(settings, key, statusPath, { timeoutMs: 60000 })
          } catch (error) {
            if (error && error.transient) continue
            throw error
          }
          const status = String(state?.status || '')
          if (status === 'failed') {
            throw new HttpError(502, extractUpstreamError(state, '视频生成失败'))
          }
          if (status === 'completed') {
            doneUrl = String(state?.metadata?.url || state?.url || '')
            break
          }
        }
        if (!doneUrl) throw new HttpError(504, '分段视频生成超时')

        const media = await downloadMedia('video', doneUrl)
        if (cancelled.has(id)) return
        const chunkFile = `${id}-part${index + 1}.${media.extension}`
        await writeFile(store.mediaPath(chunkFile), media.buffer)
        chunkFiles.push(store.mediaPath(chunkFile))

        // Carry the seam forward: the next chunk starts on this frame.
        if (index < chunks.length - 1) {
          const seam = store.mediaPath(`${id}-seam${index + 1}.jpg`)
          const frame = await hooks.extractTail(chunkFiles[chunkFiles.length - 1], seam)
          carryFrame = frame.ok ? seam : undefined
          referenceUrls = []
        }
        await update(id, {
          progress: Math.round(((index + 1) / chunks.length) * 90),
          note: `已完成 ${index + 1}/${chunks.length} 段`,
        })
      }

      await update(id, { stage: 'download', progress: 94, note: '正在拼接分段' })
      const joined = store.mediaPath(`${id}.mp4`)
      const result = await hooks.concat(chunkFiles, joined)
      if (!result.ok) throw new HttpError(502, result.error)
      await update(id, {
        status: 'ready',
        file: `${id}.mp4`,
        mime: 'video/mp4',
        upstream: '',
        progress: 100,
        stage: '',
        note: '',
        parts: chunkFiles.length,
      })
      for (const part of chunkFiles) unlink(part).catch(() => {})
      dropFirstFrame(id)
      if (typeof hooks.onVideoReady === 'function') {
        try {
          await hooks.onVideoReady(store.find(id))
        } catch {
          /* a frame problem must not fail the generation */
        }
      }
    } catch (error) {
      for (const part of chunkFiles) unlink(part).catch(() => {})
      dropFirstFrame(id)
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
            /* keep the failure authoritative */
          }
        }
      }
    }
  }

  async function videoTask(id) {
    const item = store.find(id)
    if (!item) return
    if (cancelled.has(id)) return
    // The free upstream model tops out at 12s per request. Anything longer is
    // generated as chained chunks and stitched, so a 30s shot is still one file.
    const plannedSeconds = Number(item.seconds) || 5
    if (plannedSeconds > CHUNK_SECONDS) {
      return videoTaskChunked(id)
    }
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
        // Reference mode wins when the shot's cast has public HTTPS images:
        // it locks identity, which a keyframe alone cannot do.
        if (Array.isArray(item.referenceUrls) && item.referenceUrls.length > 0) {
          payload.mode = 'reference'
          payload.reference_image_urls = item.referenceUrls.slice(0, 4)
        }
        if (item.firstFrameFile) {
          if (typeof hooks.frameDataUri !== 'function') {
            throw new HttpError(500, '首帧功能未初始化')
          }
          payload.first_frame = await hooks.frameDataUri(item.firstFrameFile)
        }
        if (typeof item.seed === 'number') payload.seed = item.seed
        let data
        try {
          data = await upstreamRetry(
            settings,
            key,
            settings.videoUpstreamPath,
            { method: 'POST', body: payload, timeoutMs: 120000 },
            id,
            update,
            deadline,
            () => cancelled.has(id),
          )
        } catch (error) {
          // A 4xx on reference mode is a capability/URL problem, not congestion:
          // drop the reference images and retry exactly once, recording why.
          const rejected = error instanceof HttpError && !error.transient
          if (!rejected || payload.mode !== 'reference') throw error
          delete payload.reference_image_urls
          payload.mode = item.firstFrameFile ? 'keyframe' : 'text'
          await update(id, {
            note: `参考模式被拒绝（${error.message.slice(0, 120)}），已降级为 ${payload.mode}`,
          })
          data = await upstreamRetry(
            settings,
            key,
            settings.videoUpstreamPath,
            { method: 'POST', body: payload, timeoutMs: 120000 },
            id,
            update,
            deadline,
            () => cancelled.has(id),
          )
        }
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
          state = await upstream(
            settings,
            key,
            `${settings.videoUpstreamPath}/${encodeURIComponent(videoId)}`,
            { timeoutMs: 60000 },
          )
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
          dropFirstFrame(id)
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
      dropFirstFrame(id)
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
    // Lets a user confirm which secret is really in use, without ever printing it.
    keyHint: key ? keyFingerprint(key.value) : null,
    keyNeededCleaning: key ? Boolean(key.dirty) : false,
    apiKeyEnv: settings.apiKeyEnv,
    baseURL: settings.baseURL,
    videoModel: settings.videoModel,
    imageModel: settings.imageModel,
    // What the composer entry submits to, so the panel never hard-codes it:
    // `${ROUTE_PREFIX}${videoPath}`. Not a chat route by construction.
    videoPath: `/${settings.videoPath}`,
    videoUpstreamPath: settings.videoUpstreamPath,
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

/**
 * Submit one video task from the panel.
 *
 * Shared by `/v1/video` (canonical) and `/video` (alias) so the two can never
 * drift apart. An optional composite reference travels as `firstFrame` (a data
 * URI straight from the browser's file picker) or `firstFrameTaskId` (an image
 * already in the history), and either one becomes the upstream keyframe.
 */
async function videoSubmitRoute(req, res, { store, tasks, frames, settings }) {
  await store.ready
  const body = await readJson(req, 32 * 1024 * 1024)
  const prompt = cleanPrompt(body.prompt)
  const model = normalizeModel(body.model) || settings.videoModel
  const requestedSize = String(body.size || '').trim()
  const size = VIDEO_SIZES.has(requestedSize) ? requestedSize : '720P'
  const requestedSeconds = String(body.seconds || '').trim()
  const seconds = VIDEO_SECONDS.has(requestedSeconds) ? requestedSeconds : '5'
  const seed = Number(body.seed)
  const id = randomUUID()
  const item = {
    id,
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
  // Resolved before `store.add` + `tasks.start`, so the runner can never observe
  // a task that claims a keyframe but has no file yet.
  const firstFrame = await resolveFirstFrame(body, id, { store, frames })
  if (firstFrame) item.firstFrameFile = firstFrame
  await store.add(item)
  tasks.start(item.id)
  sendJson(res, 200, { ok: true, item: publicItem(store.find(item.id)) })
}

/**
 * Turn the composer's attachment into a local first-frame file.
 *
 * Local uploads arrive as a data URI because the panel never has a public URL;
 * "add from library" arrives as a task id, and its downloaded file is copied so
 * a later history prune cannot pull the frame out from under a running task.
 */
async function resolveFirstFrame(body, id, { store, frames }) {
  const dataUri = typeof body.firstFrame === 'string' ? body.firstFrame.trim() : ''
  if (dataUri) {
    const match = /^data:image\/(png|jpeg|jpg|webp);base64,/i.exec(dataUri)
    if (!match) throw new HttpError(400, '首帧图片格式不支持（仅支持 png / jpeg / webp）')
    const raw = match[1].toLowerCase()
    const extension = raw === 'png' ? 'png' : raw === 'webp' ? 'webp' : 'jpg'
    const target = store.mediaPath(`${id}-firstframe.${extension}`)
    try {
      await frames.saveDataUri(dataUri, target)
    } catch (error) {
      throw new HttpError(400, messageOf(error))
    }
    return target
  }
  const sourceId = String(body.firstFrameTaskId || '').trim()
  if (!sourceId) return ''
  const source = store.find(sourceId)
  if (!source || !source.file) throw new HttpError(404, '资产库里找不到这张图片')
  if (source.kind !== 'image') throw new HttpError(400, '只有图片可以当作首帧')
  const extension = path.extname(source.file).toLowerCase() || '.png'
  const target = store.mediaPath(`${id}-firstframe${extension.startsWith('.') ? extension : `.${extension}`}`)
  await copyFile(store.mediaPath(source.file), target)
  return target
}

function publicShot(shot) {
  if (!shot) return undefined
  const { assetFile, tailFile, storyboardFile, ...rest } = shot
  return { ...rest, hasStoryboard: Boolean(storyboardFile) }
}

function createHandler(ctx, settings, store, tasks, services) {
  const {
    projects,
    frames,
    startChain,
    cancelTask,
    cancelChain,
    assemble,
    parseScript,
    submitImage,
  } = services

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
      if (method === 'POST' && (rest === `/${settings.videoPath}` || rest === '/video')) {
        // `/v1/video` is the canonical path for the composer entry;
        // `/video` is the pre-0.8 alias of the very same handler.
        await videoSubmitRoute(req, res, { store, tasks, frames, settings })
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

      match = rest.match(/^\/projects\/([^/]+)\/cast$/)
      if (match) {
        const projectId = decodeURIComponent(match[1])
        if (method === 'GET') {
          sendJson(res, 200, { ok: true, cast: projects.listCast(projectId) })
          return
        }
        if (method === 'POST') {
          const body = await readJson(req)
          const character = await projects.createCast(projectId, body)
          if (!character) throw new HttpError(404, '项目不存在')
          sendJson(res, 200, { ok: true, character })
          return
        }
      }

      match = rest.match(/^\/projects\/([^/]+)\/cast\/([^/]+)$/)
      if (match) {
        const projectId = decodeURIComponent(match[1])
        const characterId = decodeURIComponent(match[2])
        if (method === 'PATCH') {
          const body = await readJson(req)
          const character = await projects.updateCast(projectId, characterId, body)
          if (!character) throw new HttpError(404, '角色不存在')
          sendJson(res, 200, { ok: true, character })
          return
        }
        if (method === 'DELETE') {
          const removed = await projects.deleteCast(projectId, characterId)
          if (!removed) throw new HttpError(404, '角色不存在')
          sendJson(res, 200, { ok: true })
          return
        }
      }

      match = rest.match(/^\/projects\/([^/]+)\/cast\/([^/]+)\/refs$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const characterId = decodeURIComponent(match[2])
        const project = projects.getProject(projectId)
        if (!project) throw new HttpError(404, '项目不存在')
        const character = projects.getCast(projectId, characterId)
        if (!character) throw new HttpError(404, '角色不存在')
        const body = await readJson(req, 24 * 1024 * 1024)
        const dataUri = String(body.dataUri || '')
        const kind = ['front', 'side', 'back', 'extra'].includes(body.kind) ? body.kind : 'extra'
        const mimeMatch = /^data:image\/(png|jpeg|jpg|webp);base64,/i.exec(dataUri)
        const extension = mimeMatch
          ? mimeMatch[1].toLowerCase() === 'png'
            ? 'png'
            : mimeMatch[1].toLowerCase() === 'webp'
              ? 'webp'
              : 'jpg'
          : 'jpg'
        const relative = `cast/${characterId}/${kind}.${extension}`
        await frames.saveDataUri(dataUri, projects.assetPath(projectId, relative))
        const updated = await projects.addCastRef(projectId, characterId, {
          kind,
          file: relative,
          url: String(body.url || ''),
        })
        sendJson(res, 200, { ok: true, character: updated })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/cast\/([^/]+)\/refs\/([^/]+)$/)
      if (match && method === 'PATCH') {
        const projectId = decodeURIComponent(match[1])
        const characterId = decodeURIComponent(match[2])
        const refId = decodeURIComponent(match[3])
        const body = await readJson(req)
        const character = await projects.updateCastRef(projectId, characterId, refId, body)
        if (!character) throw new HttpError(404, '参考图不存在')
        sendJson(res, 200, { ok: true, character })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/cast\/([^/]+)\/refs\/([^/]+)\/file$/)
      if (match && (method === 'GET' || method === 'HEAD')) {
        const projectId = decodeURIComponent(match[1])
        const characterId = decodeURIComponent(match[2])
        const refId = decodeURIComponent(match[3])
        const character = projects.getCast(projectId, characterId)
        const ref = (character?.refs || []).find((entry) => entry.id === refId)
        if (!ref || !ref.file) throw new HttpError(404, '参考图不存在')
        const filePath = projects.assetPath(projectId, ref.file)
        let info
        try {
          info = await stat(filePath)
        } catch {
          throw new HttpError(404, '参考图文件不存在')
        }
        res.writeHead(200, {
          'content-type': /\.png$/i.test(ref.file) ? 'image/png' : 'image/jpeg',
          'content-length': String(info.size),
          'cache-control': 'private, max-age=86400',
        })
        if (method === 'HEAD') {
          res.end()
          return
        }
        const stream = createReadStream(filePath)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/script\/parse$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const project = projects.getProject(projectId)
        if (!project) throw new HttpError(404, '项目不存在')
        const body = await readJson(req, 4 * 1024 * 1024)
        const drafts = bindCharactersToShots(parseScript(body.text), projects.listCast(projectId))
        if (drafts.length === 0) throw new HttpError(400, '没有解析出任何镜头')
        if (body.replace === true) {
          for (const shot of projects.listShots(projectId)) {
            await projects.deleteShot(projectId, shot.id)
          }
        }
        const created = []
        for (const draft of drafts) {
          const shot = await projects.createShot(projectId, {
            prompt: draft.prompt.slice(0, 4000),
            duration: draft.duration,
            episodeId: draft.episodeId,
            sceneId: draft.sceneId,
            context: {
              characters: draft.characters || [],
              continuity: draft.sceneTitle ? `场景：${draft.sceneTitle}` : '',
            },
          })
          if (shot) created.push(shot)
        }
        sendJson(res, 200, { ok: true, shots: created.map(publicShot) })
        return
      }

      /* ------------------------- canvas imports ------------------------- */

      // A video or image dragged in from Explorer. Stored under the project's
      // assets/imports/ so the canvas node keeps working after a restart.
      match = rest.match(/^\/projects\/([^/]+)\/imports$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const project = projects.getProject(projectId)
        if (!project) throw new HttpError(404, '项目不存在')
        const body = await readJson(req, 200 * 1024 * 1024)
        const dataUri = String(body.dataUri || '')
        const parsed = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUri)
        if (!parsed) throw new HttpError(400, '导入内容不是合法的 base64 data URI')
        const mime = parsed[1].toLowerCase()
        const buffer = Buffer.from(parsed[2], 'base64')
        if (buffer.length === 0) throw new HttpError(400, '导入内容为空')
        if (buffer.length > 200 * 1024 * 1024) throw new HttpError(413, '素材过大（上限 200MB）')
        const allowed = [
          'video/mp4',
          'video/quicktime',
          'video/webm',
          'image/png',
          'image/jpeg',
          'image/webp',
        ]
        const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : ''
        if (!kind || !allowed.includes(mime)) {
          throw new HttpError(415, `不支持的素材类型：${mime}`)
        }
        const extension = /mp4/.test(mime)
          ? 'mp4'
          : /quicktime/.test(mime)
            ? 'mov'
            : /webm/.test(mime)
              ? 'webm'
              : /png/.test(mime)
                ? 'png'
                : /webp/.test(mime)
                  ? 'webp'
                  : 'jpg'
        const name = String(body.name || `import.${extension}`).slice(0, 160)
        const id = `imp_${randomUUID().replace(/-/g, '').slice(0, 12)}`
        const relative = `imports/${id}.${extension}`
        const target = projects.assetPath(projectId, relative)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, buffer)
        // Duration is a convenience label, never a reason to fail an import:
        // probe with a hard timeout and fall back to 0.
        let duration = 0
        if (kind === 'video') {
          try {
            const ffmpegPath = await Promise.race([
              frames.detect(),
              new Promise((resolve) => setTimeout(() => resolve(''), 3000)),
            ])
            if (ffmpegPath) {
              const assembleApi = createAssemble({ ffmpegPath })
              duration = await Promise.race([
                assembleApi.probeDuration(target),
                new Promise((resolve) => setTimeout(() => resolve(0), 8000)),
              ])
            }
          } catch {
            duration = 0
          }
        }
        sendJson(res, 200, {
          ok: true,
          asset: {
            id,
            kind,
            name,
            file: relative,
            mime,
            bytes: buffer.length,
            duration: Math.round((Number(duration) || 0) * 10) / 10,
            url: `${ROUTE_PREFIX}/projects/${projectId}/imports/${id}`,
          },
        })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/imports\/([^/]+)$/)
      if (match && (method === 'GET' || method === 'HEAD')) {
        const projectId = decodeURIComponent(match[1])
        const assetId = decodeURIComponent(match[2])
        if (!/^imp_[a-z0-9]+$/i.test(assetId)) throw new HttpError(400, '素材标识不合法')
        const dir = projects.assetPath(projectId, 'imports')
        let entries = []
        try {
          entries = await readdir(dir)
        } catch {
          throw new HttpError(404, '素材不存在')
        }
        const file = entries.find((entry) => entry.startsWith(`${assetId}.`))
        if (!file) throw new HttpError(404, '素材不存在')
        const filePath = path.join(dir, file)
        let info
        try {
          info = await stat(filePath)
        } catch {
          throw new HttpError(404, '素材文件不存在')
        }
        const extension = path.extname(file).toLowerCase()
        const contentType =
          extension === '.mp4'
            ? 'video/mp4'
            : extension === '.mov'
              ? 'video/quicktime'
              : extension === '.webm'
                ? 'video/webm'
                : extension === '.png'
                  ? 'image/png'
                  : extension === '.webp'
                    ? 'image/webp'
                    : 'image/jpeg'
        // Range support keeps video seeking usable on imported clips.
        const range = String(req.headers.range || '')
        if (range) {
          const matchRange = /bytes=(\d*)-(\d*)/.exec(range)
          if (matchRange) {
            const total = info.size
            const start = matchRange[1] ? Number(matchRange[1]) : 0
            const end = matchRange[2] ? Math.min(Number(matchRange[2]), total - 1) : total - 1
            if (start >= total || end < start) {
              res.writeHead(416, { 'content-range': `bytes */${total}` })
              res.end()
              return
            }
            res.writeHead(206, {
              'content-type': contentType,
              'content-length': String(end - start + 1),
              'content-range': `bytes ${start}-${end}/${total}`,
              'accept-ranges': 'bytes',
              'cache-control': 'private, max-age=86400',
            })
            if (method === 'HEAD') {
              res.end()
              return
            }
            createReadStream(filePath, { start, end }).pipe(res)
            return
          }
        }
        res.writeHead(200, {
          'content-type': contentType,
          'content-length': String(info.size),
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=86400',
        })
        if (method === 'HEAD') {
          res.end()
          return
        }
        const stream = createReadStream(filePath)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/assemble$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const project = projects.getProject(projectId)
        if (!project) throw new HttpError(404, '项目不存在')
        const body = await readJson(req)
        const shots = projects.listShots(projectId)
        const wanted = Array.isArray(body.shotIds) && body.shotIds.length > 0
          ? shots.filter((shot) => body.shotIds.includes(shot.id))
          : shots
        const usable = wanted.filter((shot) => shot.status === 'ready' && shot.assetFile)
        if (usable.length === 0) throw new HttpError(400, '还没有生成完成的镜头可以合成')
        const files = usable.map((shot) => store.mediaPath(shot.assetFile))
        const outFile = path.join(projects.projectDir(projectId), `episode-${Date.now()}.mp4`)
        const result = await assemble.concat(files, outFile, {
          width: Number(body.width) || 1280,
          height: Number(body.height) || 720,
          fps: Number(body.fps) || 24,
        })
        if (!result.ok) throw new HttpError(502, result.error)
        const fileBase = path.basename(outFile)
        sendJson(res, 200, {
          ok: true,
          file: fileBase,
          duration: result.duration,
          clipCount: usable.length,
          url: `${ROUTE_PREFIX}/projects/${projectId}/episode/${encodeURIComponent(fileBase)}`,
        })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/episode\/([^/]+)$/)
      if (match && (method === 'GET' || method === 'HEAD')) {
        const projectId = decodeURIComponent(match[1])
        const file = decodeURIComponent(match[2])
        if (!/^episode-\d+\.mp4$/.test(file)) throw new HttpError(400, '文件名不合法')
        const filePath = path.join(projects.projectDir(projectId), file)
        let info
        try {
          info = await stat(filePath)
        } catch {
          throw new HttpError(404, '合成文件不存在')
        }
        res.writeHead(200, {
          'content-type': 'video/mp4',
          'content-length': String(info.size),
          'accept-ranges': 'none',
          'cache-control': 'private, max-age=86400',
          ...(url.searchParams.get('download') === '1'
            ? { 'content-disposition': `attachment; filename="${file}"` }
            : {}),
        })
        if (method === 'HEAD') {
          res.end()
          return
        }
        const stream = createReadStream(filePath)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
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

      /* --------------------------- storyboard --------------------------- */

      match = rest.match(/^\/projects\/([^/]+)\/shots\/([^/]+)\/storyboard$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const shotId = decodeURIComponent(match[2])
        const project = projects.getProject(projectId)
        const shot = projects.getShot(projectId, shotId)
        if (!project || !shot) throw new HttpError(404, '项目或镜头不存在')
        const prompt = composePrompt({ project, shot, previousShot: undefined })
        await projects.updateShot(projectId, shotId, { status: 'storyboard', storyboardError: '' })
        const task = await submitImage({
          prompt,
          size: '1024x768',
          projectId,
          shotId,
          purpose: 'storyboard',
        })
        await projects.updateShot(projectId, shotId, { storyboardTaskId: task.id })
        sendJson(res, 200, { ok: true, task: publicItem(task) })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/shots\/([^/]+)\/approve$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const shotId = decodeURIComponent(match[2])
        const shot = projects.getShot(projectId, shotId)
        if (!shot) throw new HttpError(404, '镜头不存在')
        if (!shot.storyboardFile) throw new HttpError(400, '该镜还没有静帧可批准')
        const updated = await projects.updateShot(projectId, shotId, {
          status: 'approved',
          firstFrame: { source: 'manual', file: shot.storyboardFile },
          error: '',
        })
        sendJson(res, 200, { ok: true, shot: publicShot(updated) })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/shots\/([^/]+)\/reject$/)
      if (match && method === 'POST') {
        const projectId = decodeURIComponent(match[1])
        const shotId = decodeURIComponent(match[2])
        const shot = projects.getShot(projectId, shotId)
        if (!shot) throw new HttpError(404, '镜头不存在')
        if (shot.storyboardFile) {
          const source = projects.assetPath(projectId, shot.storyboardFile)
          const target = projects.assetPath(
            projectId,
            `storyboard/rejected/${shotId}-${Date.now()}.jpg`,
          )
          await mkdir(path.dirname(target), { recursive: true })
          await rename(source, target).catch(() => {})
        }
        const updated = await projects.updateShot(projectId, shotId, {
          status: 'draft',
          storyboardFile: null,
          storyboardUrl: null,
          storyboardError: '',
          firstFrame: { source: 'auto', file: null },
        })
        sendJson(res, 200, { ok: true, shot: publicShot(updated) })
        return
      }

      match = rest.match(/^\/projects\/([^/]+)\/shots\/([^/]+)\/storyboard$/)
      if (match && (method === 'GET' || method === 'HEAD')) {
        const projectId = decodeURIComponent(match[1])
        const shotId = decodeURIComponent(match[2])
        const shot = projects.getShot(projectId, shotId)
        if (!shot || !shot.storyboardFile) throw new HttpError(404, '该镜还没有静帧')
        const filePath = projects.assetPath(projectId, shot.storyboardFile)
        let info
        try {
          info = await stat(filePath)
        } catch {
          throw new HttpError(404, '静帧文件不存在')
        }
        res.writeHead(200, {
          'content-type': /\.png$/i.test(shot.storyboardFile) ? 'image/png' : 'image/jpeg',
          'content-length': String(info.size),
          'cache-control': 'private, max-age=86400',
        })
        if (method === 'HEAD') {
          res.end()
          return
        }
        const stream = createReadStream(filePath)
        stream.on('error', () => res.destroy())
        stream.pipe(res)
        return
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
      const payload = { ok: false, error: messageOf(error) }
      if (Array.isArray(error?.blockers)) payload.blockers = error.blockers
      sendJson(res, status, payload)
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
    videoPath: normalizeRoute(config.videoPath) || DEFAULTS.videoPath,
    videoUpstreamPath: normalizeUpstreamPath(config.videoUpstreamPath) || DEFAULTS.videoUpstreamPath,
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

  async function onImageReady(item) {
    if (!item || item.purpose !== 'storyboard' || !item.projectId || !item.shotId) return
    const project = projects.getProject(item.projectId)
    if (!project) return
    const relative = `storyboard/${item.shotId}.jpg`
    const target = projects.assetPath(item.projectId, relative)
    try {
      await mkdir(path.dirname(target), { recursive: true })
      await frames.copyFile(store.mediaPath(item.file), target)
      await projects.updateShot(item.projectId, item.shotId, {
        status: 'pending-review',
        storyboardFile: relative,
        storyboardUrl: `${ROUTE_PREFIX}/projects/${item.projectId}/shots/${item.shotId}/storyboard`,
        storyboardError: '',
      })
    } catch (error) {
      await projects.updateShot(item.projectId, item.shotId, {
        status: 'failed',
        storyboardError: messageOf(error),
      })
    }
  }

  async function onImageFailed(item, error) {
    if (!item || item.purpose !== 'storyboard') return
    if (!item.projectId || !item.shotId) return
    await projects.updateShot(item.projectId, item.shotId, {
      storyboardError: messageOf(error),
      status: 'draft',
    })
  }

  async function onVideoCancelled(item) {
    if (!item || !item.projectId || !item.shotId) return
    await projects.updateShot(item.projectId, item.shotId, { status: 'cancelled', error: '' })
  }

  const tasks = createTasks(ctx, settings, store, {
    frameDataUri: (file) => frames.dataUri(file),
    extractTail: (videoFile, outFile) => frames.extractTail(videoFile, outFile),
    concat: async (inputs, outFile) => {
      const assemble = createAssemble({ ffmpegPath: await frames.detect() })
      return assemble.concat(inputs, outFile, {})
    },
    onVideoReady,
    onVideoFailed,
    onVideoCancelled,
    onImageReady,
    onImageFailed,
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
    if (Array.isArray(input.referenceUrls) && input.referenceUrls.length > 0) {
      item.referenceUrls = input.referenceUrls.map(String).slice(0, 4)
    }
    await store.add(item)
    tasks.start(item.id)
    return store.find(item.id)
  }

  async function submitImage(input) {
    const item = {
      id: randomUUID(),
      kind: 'image',
      status: 'queued',
      prompt: input.prompt,
      model: input.model || settings.imageModel,
      size: input.size || '1024x768',
      progress: 0,
      stage: 'queued',
      note: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (input.projectId) item.projectId = String(input.projectId)
    if (input.shotId) item.shotId = String(input.shotId)
    if (input.purpose) item.purpose = String(input.purpose)
    if (Number.isFinite(Number(input.seed))) item.seed = Number(input.seed)
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

  /**
   * Refuse to start when a shot cannot be locked.
   *
   * Passing needs any one of: an approved storyboard, a usable previous tail
   * frame, or a cast member whose reference image is public. The point is to
   * fail before any quota is spent, not 20 minutes in.
   */
  /**
   * Characters this shot should lock, in this order of precedence:
   *   1. explicitly selected `context.characters`
   *   2. names/aliases that actually appear in the shot prompt
   *
   * Auto-binding only ever *adds* characters that have a usable public
   * reference, so a shot never silently loses an explicitly chosen lock.
   */
  function resolveShotCast(project, shot) {
    const explicit = Array.isArray(shot?.context?.characters) ? shot.context.characters : []
    const characters = Array.isArray(project?.bible?.characters) ? project.bible.characters : []
    const locked = characters.filter((character) => character && (character.refs || []).some((ref) => /^https:\/\/\S+$/i.test(String(ref.url || ''))))
    const auto = locked
      .filter((character) => {
        const names = [character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])]
          .map((name) => String(name || '').trim())
          .filter(Boolean)
        return names.some((name) => String(shot?.prompt || '').includes(name))
      })
      .map((character) => character.id)
    return [...new Set([...explicit, ...auto])]
  }

  /**
   * A still frame borrowed from an earlier shot, used when the shot has no
   * approved storyboard of its own. This is the canvas "reference an earlier
   * clip" path: the referenced shot's approved still or tail frame becomes this
   * shot's starting image.
   */
  async function borrowedFrameFor(projectId, shot, allShots) {
    const refs = Array.isArray(shot?.refs) ? shot.refs : []
    if (refs.length === 0) return undefined
    const byId = new Map((allShots || []).map((entry) => [entry.id, entry]))
    for (const refId of refs) {
      const source = byId.get(refId)
      if (!source) continue
      const candidates = [
        source.storyboardFile,
        source.firstFrame && source.firstFrame.file,
        source.tailFile,
      ].filter(Boolean)
      for (const relative of candidates) {
        const absolute = projects.assetPath(projectId, relative)
        try {
          const info = await stat(absolute)
          if (info.size > 0) return absolute
        } catch {
          /* keep looking */
        }
      }
    }
    return undefined
  }

  function referenceUrlsFor(project, shot) {
    const cast = resolveShotCast(project, shot)
    const characters = Array.isArray(project?.bible?.characters) ? project.bible.characters : []
    const urls = []
    for (const character of characters) {
      if (!character || !cast.includes(character.id)) continue
      for (const ref of Array.isArray(character.refs) ? character.refs : []) {
        const url = String(ref?.url || '').trim()
        if (/^https:\/\/\S+$/i.test(url) && !urls.includes(url)) urls.push(url)
        if (urls.length >= 4) return urls
      }
    }
    return urls
  }

  /**
   * Which shots actually need identity locking?
   *
   * Only a shot whose cast resolves to at least one character (explicitly
   * selected, or named in the prompt) has a face to protect. A pure scenery
   * shot has nothing to lock, so it must never be blocked by this gate.
   */
  function lockIntent(project, shot) {
    const cast = resolveShotCast(project, shot)
    const characters = Array.isArray(project?.bible?.characters) ? project.bible.characters : []
    const named = characters.filter((character) => character && cast.includes(character.id))
    return { needsLock: named.length > 0, characters: named }
  }

  function preflight(projectId, sequence) {
    const project = projects.getProject(projectId)
    const blockers = []
    sequence.forEach((shot, index) => {
      if (!shot) return
      if (shot.status === 'ready' && shot.assetFile) return
      const previous = index > 0 ? sequence[index - 1] : undefined
      const hasApproved =
        (shot.firstFrame && shot.firstFrame.source === 'manual' && shot.firstFrame.file) ||
        shot.status === 'approved' ||
        shot.status === 'pending-review' ||
        Boolean(shot.storyboardFile)
      const hasTail = Boolean(previous && previous.tailFile)
      const referenceUrls = referenceUrlsFor(project, shot)
      const hasReference = referenceUrls.length > 0
      const { needsLock, characters } = lockIntent(project, shot)
      const index0 = shot.index || index + 1

      // Nothing to protect (scenery), or a lock already exists.
      if (!needsLock) {
        if (hasApproved || hasTail) return
        // Even for scenery, the first shot needs *something* to start from
        // only when the user asked for a locked run; plain text is fine.
        return
      }
      if (hasReference || hasApproved || hasTail) return
      // A canvas reference to an earlier shot also counts as a starting image.
      if (Array.isArray(shot.refs) && shot.refs.length > 0) return

      const names = characters.map((character) => character.name).filter(Boolean).join('、')
      blockers.push({
        shotId: shot.id,
        index: index0,
        characters: characters.map((character) => character.id),
        reason: `第 ${index0} 镜要锁 ${names} 的脸，但该角色还没有公网参考图，也没有已批准静帧；也可以给这镜上传首帧`,
      })
    })
    return blockers
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

    if (body.skipPreflight !== true) {
      const blockers = preflight(projectId, sequence)
      if (blockers.length > 0) {
        const error = new HttpError(
          422,
          `有 ${blockers.length} 个镜头无法锁定人物，已阻止启动：${blockers[0].reason}`,
        )
        error.blockers = blockers
        throw error
      }
    }

    chainLocks.add(projectId)
    chainCancelled.delete(projectId)
    const force = body.force === true

    await projects.updateProject(projectId, {
      chain: { running: true, currentShotId: null, startedAt: Date.now(), finishedAt: null, error: '' },
    })

    ;(async () => {
      const failures = []
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
          const liveProject = projects.getProject(projectId)
          const referenceUrls = referenceUrlsFor(liveProject, current)

          let firstFrameFile
          if (current.firstFrame && current.firstFrame.source === 'manual' && current.firstFrame.file) {
            firstFrameFile = projects.assetPath(projectId, current.firstFrame.file)
          } else if (previous && previous.tailFile) {
            firstFrameFile = projects.assetPath(projectId, previous.tailFile)
          }
          // Canvas reference: borrow an earlier shot's frame when this one has
          // none of its own (explicit first frame always wins).
          if (!firstFrameFile) {
            firstFrameFile = await borrowedFrameFor(projectId, current, allShots)
          }

          // Reference mode needs public URLs; without them fall back visibly.
          const lockMode =
            referenceUrls.length > 0 ? 'reference' : firstFrameFile ? 'keyframe' : 'text'
          await projects.updateShot(projectId, current.id, { lockMode })

          const prompt = composePrompt({ project: liveProject, shot: current, previousShot: previous })
          const seed = seedFor(liveProject, current, index)
          try {
            const task = await submitVideo({
              prompt,
              seconds: String(current.duration || 5),
              size: current.size,
              seed,
              projectId,
              shotId: current.id,
              firstFrameFile,
              referenceUrls,
            })
            chainCurrentTask.set(projectId, task.id)
            await projects.updateShot(projectId, current.id, { taskId: task.id })
            await waitForTask(task.id, () => chainCancelled.has(projectId))
            const settled = await waitForShotTail(projectId, current.id)
            if (settled && settled.status === 'failed') {
              throw new HttpError(502, settled.error || '镜头生成失败')
            }
          } catch (error) {
            if (chainCancelled.has(projectId)) throw error
            // Isolate a single bad shot: record it and keep the chain moving.
            failures.push({ shotId: current.id, index: current.index || index + 1, reason: messageOf(error) })
            await projects.updateShot(projectId, current.id, {
              status: 'failed',
              error: messageOf(error),
            })
          }
        }
        await projects.updateProject(projectId, {
          chain: {
            running: false,
            currentShotId: null,
            finishedAt: Date.now(),
            error: failures.length > 0 ? `${failures.length} 个镜头失败` : '',
            failures,
          },
        })
      } catch (error) {
        await projects.updateProject(projectId, {
          chain: {
            running: false,
            currentShotId: null,
            finishedAt: Date.now(),
            error: messageOf(error),
            failures,
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
    parseScript,
    submitImage,
    assemble: {
      concat: async (files, outFile, options) => {
        const ffmpeg = await frames.detect()
        return createAssemble({ ffmpegPath: ffmpeg }).concat(files, outFile, options)
      },
    },
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