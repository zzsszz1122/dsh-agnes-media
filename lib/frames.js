/**
 * ffmpeg helper: locate a usable binary, extract a video's last frame, and
 * convert frames to data URIs for the upstream keyframe parameter.
 *
 * The binary is resolved once per Host process from `config.ffmpegPath`,
 * `AGNES_FFMPEG`, then `PATH`. A missing binary is reported, never guessed:
 * callers surface it in the UI as `need-ffmpeg`.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stderr: String(error) })
      return
    }
    let stderr = ''
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      finish({ code: -1, stderr: 'timeout' })
    }, timeoutMs)
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString()
    })
    child.on('error', (error) => finish({ code: -1, stderr: String(error) }))
    child.on('close', (code) => finish({ code, stderr }))
  })
}

export function createFrames(options = {}) {
  const candidates = [options.ffmpegPath, process.env.AGNES_FFMPEG, 'ffmpeg'].filter(Boolean)
  let resolved
  let detecting

  async function detect() {
    if (resolved) return resolved
    if (detecting) return detecting
    detecting = (async () => {
      for (const candidate of candidates) {
        const result = await run(candidate, ['-version'], 8000)
        if (result.code === 0) {
          resolved = candidate
          return candidate
        }
      }
      return null
    })()
    const found = await detecting
    detecting = undefined
    return found
  }

  async function extractTail(videoPath, outPath) {
    const ffmpeg = await detect()
    if (!ffmpeg) {
      return {
        ok: false,
        error: 'ffmpeg 未安装：无法抽取尾帧。请安装 ffmpeg，或在插件 config 里设置 ffmpegPath / AGNES_FFMPEG。',
      }
    }
    await mkdir(path.dirname(outPath), { recursive: true })
    const result = await run(
      ffmpeg,
      ['-y', '-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', outPath],
      60000,
    )
    if (result.code !== 0) {
      return { ok: false, error: `ffmpeg 抽帧失败：${result.stderr.slice(-300) || `exit ${result.code}`}` }
    }
    try {
      const info = await stat(outPath)
      if (!info.size) return { ok: false, error: 'ffmpeg 抽帧结果为空' }
    } catch {
      return { ok: false, error: 'ffmpeg 未生成尾帧文件' }
    }
    return { ok: true, file: outPath }
  }

  async function dataUri(filePath) {
    const bytes = await readFile(filePath)
    const extension = path.extname(filePath).toLowerCase()
    const mime =
      extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${bytes.toString('base64')}`
  }

  async function saveDataUri(value, outPath) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(value || ''))
    if (!match) throw new Error('首帧不是合法的 base64 data URI')
    const buffer = Buffer.from(match[2], 'base64')
    if (buffer.length === 0) throw new Error('首帧数据为空')
    if (buffer.length > 16 * 1024 * 1024) throw new Error('首帧图片过大（上限 16MB）')
    await mkdir(path.dirname(outPath), { recursive: true })
    await writeFile(outPath, buffer)
    return { mime: match[1], bytes: buffer.length, file: outPath }
  }

  return { detect, available: async () => Boolean(await detect()), extractTail, dataUri, saveDataUri }
}
