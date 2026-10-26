/**
 * ffmpeg assembly: concatenate finished shots into one episode video.
 *
 * Reuses the ffmpeg binary resolved by the frames module (`ffmpegPath`);
 * ffprobe is taken from the same directory. Clips are normalized (size / sar /
 * fps / timebase) before concat so mixed shots do not corrupt the timeline.
 * Audio is mapped only when every input carries it — model output often has
 * no audio track, and a missing `[i:a]` pad makes ffmpeg abort instantly.
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { stat } from 'node:fs/promises'

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error) })
      return
    }
    let stdout = ''
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
      finish({ code: -1, stdout, stderr: 'timeout' })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      if (stdout.length < 200000) stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8000) stderr += chunk.toString()
    })
    child.on('error', (error) => finish({ code: -1, stdout, stderr: String(error) }))
    child.on('close', (code) => finish({ code, stdout, stderr }))
  })
}

function ffprobePathFor(ffmpeg) {
  if (!ffmpeg || ffmpeg === 'ffmpeg') return 'ffprobe'
  return join(dirname(ffmpeg), ffmpeg.toLowerCase().endsWith('ffmpeg.exe') ? 'ffprobe.exe' : 'ffprobe')
}

function hasAudioStream(json) {
  return Array.isArray(json?.streams) && json.streams.some((stream) => stream.codec_type === 'audio')
}

export function createAssemble({ ffmpegPath }) {
  const ffprobe = ffprobePathFor(ffmpegPath)

  async function probe(file) {
    const result = await run(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      30000,
    )
    if (result.code !== 0) return undefined
    try {
      return JSON.parse(result.stdout)
    } catch {
      return undefined
    }
  }

  async function probeDuration(file) {
    const info = await probe(file)
    const seconds = Number(info?.format?.duration)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  }

  /**
   * Concatenate `files` (absolute paths, ordered) into `outFile`.
   * `options`: { width, height, fps }.
   */
  async function concat(files, outFile, options = {}) {
    if (!ffmpegPath) return { ok: false, error: 'ffmpeg 未安装，无法合成导出。' }
    if (!Array.isArray(files) || files.length === 0) {
      return { ok: false, error: '没有可合成的镜头片段' }
    }
    for (const file of files) {
      try {
        const info = await stat(file)
        if (!info.size) return { ok: false, error: `片段为空：${file}` }
      } catch {
        return { ok: false, error: `片段不存在：${file}` }
      }
    }

    const width = options.width || 1280
    const height = options.height || 720
    const fps = options.fps || 24

    let withAudio = false
    if (files.length > 0) {
      const checks = []
      for (const file of files) checks.push(await probe(file))
      withAudio = checks.every((info) => hasAudioStream(info))
    }

    const inputs = files.flatMap((file) => ['-i', file])
    const videoParts = files.map(
      (_, index) =>
        `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},settb=AVTB[v${index}]`,
    )
    const videoLabels = files.map((_, index) => `[v${index}]`).join('')
    let filter
    let maps
    if (withAudio) {
      const audioParts = files.map(
        (_, index) => `[${index}:a]aresample=async=1:first_pts=0,apad=whole_dur=1[a${index}]`,
      )
      const audioLabels = files.map((_, index) => `[a${index}]`).join('')
      filter = `${videoParts.join(';')};${audioParts.join(';')};${files
        .map((_, index) => `[v${index}][a${index}]`)
        .join('')}concat=n=${files.length}:v=1:a=1[outv][outa]`
      maps = ['-map', '[outv]', '-map', '[outa]', '-shortest']
    } else {
      filter = `${videoParts.join(';')};${videoLabels}concat=n=${files.length}:v=1:a=0[outv]`
      maps = ['-map', '[outv]', '-an']
    }

    const result = await run(
      ffmpegPath,
      [
        '-y',
        ...inputs,
        '-filter_complex',
        filter,
        ...maps,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        ...(withAudio ? ['-c:a', 'aac', '-b:a', '160k'] : []),
        '-movflags',
        '+faststart',
        outFile,
      ],
      600000,
    )
    if (result.code !== 0) {
      return { ok: false, error: `ffmpeg 合成失败：${result.stderr.slice(-400) || `exit ${result.code}`}` }
    }
    try {
      const info = await stat(outFile)
      if (!info.size) return { ok: false, error: '合成结果为空文件' }
    } catch {
      return { ok: false, error: 'ffmpeg 未生成合成文件' }
    }
    const duration = await probeDuration(outFile)
    return { ok: true, file: outFile, duration: Math.round(duration * 10) / 10 }
  }

  return { concat, probeDuration, available: Boolean(ffmpegPath) }
}
