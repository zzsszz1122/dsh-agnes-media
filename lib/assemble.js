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
   * `options`: { width, height, fps, crossfade }.
   *
   * `crossfade` (seconds) dissolves each seam instead of hard-cutting. It is
   * meant for *chunks of one continuous shot*: the upstream renderer treats the
   * tail-frame handoff as guidance, not a strict first frame, so two chunks can
   * drift apart and a hard cut reads as an accidental scene change. Dissolving
   * the drift makes the seam feel like one continuous take. Total duration is
   * `sum(durations) - (n-1)*crossfade`, which also trims the couple of extra
   * frames the upstream usually appends to every chunk.
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
    const crossfade = Number(options.crossfade) > 0 ? Number(options.crossfade) : 0

    // Probe once: audio presence and exact durations (needed for xfade offsets).
    const probes = []
    for (const file of files) probes.push(await probe(file))
    const durations = probes.map((info) => Number(info?.format?.duration) || 0)
    const withAudio = probes.every((info) => hasAudioStream(info))

    const inputs = files.flatMap((file) => ['-i', file])
    const videoParts = files.map(
      (_, index) =>
        `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},settb=AVTB[v${index}]`,
    )
    const videoLabels = files.map((_, index) => `[v${index}]`).join('')
    let filter
    let maps
    let durationNote = ''

    if (crossfade > 0 && files.length > 1) {
      // Chain xfade over the normalized streams. For fade i (joining stream
      // [v(i-1)] and [v i]): the left stream runs
      //   sum(dur[0..i-1]) - (i-1)*crossfade
      // seconds, and the fade starts `crossfade` before it ends.
      const fadeStages = []
      for (let i = 1; i < files.length; i += 1) {
        const leftIn = i === 1 ? '[v0]' : `[xf${i - 1}]`
        const consumed = durations.slice(0, i).reduce((a, b) => a + b, 0)
        const overlapSoFar = (i - 1) * crossfade
        const offset = Math.max(0, consumed - crossfade - overlapSoFar)
        fadeStages.push(
          `${leftIn}[v${i}]xfade=transition=fade:duration=${crossfade}:offset=${offset.toFixed(3)}[xf${i}]`,
        )
      }
      const lastFade = `[xf${files.length - 1}]`
      if (withAudio) {
        const audioParts = files.map(
          (_, index) => `[${index}:a]aresample=async=1:first_pts=0,apad=whole_dur=1[a${index}]`,
        )
        const audioStages = []
        for (let i = 1; i < files.length; i += 1) {
          const leftIn = i === 1 ? '[a0]' : `[af${i - 1}]`
          audioStages.push(`${leftIn}[a${i}]acrossfade=d=${crossfade}[af${i}]`)
        }
        filter = `${videoParts.join(';')};${audioParts.join(';')};${fadeStages.join(';')};${audioStages.join(';')}`
        maps = ['-map', lastFade, '-map', `[af${files.length - 1}]`]
      } else {
        filter = `${videoParts.join(';')};${fadeStages.join(';')}`
        maps = ['-map', lastFade, '-an']
      }
      durationNote = ` (crossfade ${crossfade}s)`
    } else if (withAudio) {
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
      return { ok: false, error: `ffmpeg 合成失败${durationNote}：${result.stderr.slice(-400) || `exit ${result.code}`}` }
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
