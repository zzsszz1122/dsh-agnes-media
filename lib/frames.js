/**
 * ffmpeg helper: locate a usable binary, extract a video's last frame, and
 * convert frames to data URIs for the upstream keyframe parameter.
 *
 * Resolution order:
 *   1. `config.ffmpegPath`
 *   2. `AGNES_FFMPEG`
 *   3. common Windows installs (winget packages, Program Files, scoop, choco)
 *   4. `ffmpeg` from PATH
 *
 * The first candidate that answers `-version` wins and is cached for the
 * process. A missing binary is reported, never guessed: callers surface it in
 * the UI as `need-ffmpeg`.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
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

async function scanWinGetPackages() {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return []
  const root = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages')
  let packages = []
  try {
    packages = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const pkg of packages) {
    if (!pkg.isDirectory() || !/ffmpeg/i.test(pkg.name)) continue
    const stack = [{ dir: path.join(root, pkg.name), depth: 0 }]
    while (stack.length > 0) {
      const current = stack.pop()
      let children = []
      try {
        children = await readdir(current.dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const child of children) {
        const full = path.join(current.dir, child.name)
        if (child.isFile() && child.name.toLowerCase() === 'ffmpeg.exe') {
          found.push(full)
        } else if (child.isDirectory() && current.depth < 3) {
          stack.push({ dir: full, depth: current.depth + 1 })
        }
      }
    }
  }
  return found
}

export function createFrames(options = {}) {
  let resolved
  let detecting

  function explicitCandidates() {
    const env = process.env
    const list = [options.ffmpegPath, env.AGNES_FFMPEG]
    if (env.LOCALAPPDATA) {
      list.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'))
      list.push(path.join(env.LOCALAPPDATA, 'Programs', 'ffmpeg', 'bin', 'ffmpeg.exe'))
    }
    list.push('C:\\ffmpeg\\bin\\ffmpeg.exe')
    if (env.ProgramFiles) list.push(path.join(env.ProgramFiles, 'ffmpeg', 'bin', 'ffmpeg.exe'))
    if (env.USERPROFILE) list.push(path.join(env.USERPROFILE, 'scoop', 'shims', 'ffmpeg.exe'))
    if (env.ChocolateyInstall) list.push(path.join(env.ChocolateyInstall, 'bin', 'ffmpeg.exe'))
    return list.filter(Boolean)
  }

  async function tryCandidate(candidate, tried) {
    if (!candidate || tried.has(candidate)) return false
    tried.add(candidate)
    if (path.isAbsolute(candidate) && !existsSync(candidate)) return false
    const result = await run(candidate, ['-version'], 8000)
    if (result.code === 0) {
      resolved = candidate
      return true
    }
    return false
  }

  async function detect() {
    if (resolved) return resolved
    if (detecting) return detecting
    detecting = (async () => {
      const tried = new Set()
      for (const candidate of explicitCandidates()) {
        if (await tryCandidate(candidate, tried)) return resolved
      }
      for (const candidate of await scanWinGetPackages()) {
        if (await tryCandidate(candidate, tried)) return resolved
      }
      if (await tryCandidate('ffmpeg', tried)) return resolved
      return undefined
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
