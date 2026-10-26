/**
 * Rule-based script parser: turn a plain-text script into shot drafts.
 *
 * Accepted shapes (per line, after trimming):
 *   第X集 / EP01            → episode boundary
 *   场… / SC01 / 【场景】     → scene boundary (scene name kept)
 *   1. / #1 / （1）…         → one shot; everything after the marker is the prompt
 *   any other non-empty line → appended to the previous shot (or becomes one)
 *
 * No LLM call: the plugin keeps zero runtime dependencies, and a deterministic
 * split is easier to fix by hand in the drama table than a hallucinated one.
 */

const EPISODE_RE = /^(第\s*\d+\s*集|EP\s*\d+|episode\s*\d+)/i
const SCENE_RE = /^(场\s*景?\s*[:：]?\s*\d*|SC\s*\d+|scene\s*\d+|【场景】)/i
const SHOT_RE = /^(?:#|第?\s*)?(\d{1,3})\s*(?:[.、)）:：]|\s{2,})\s*(.*)$/

function slugNumber(text, re) {
  const match = re.exec(text)
  if (!match) return undefined
  const digits = match[0].match(/\d+/)
  return digits ? Number(digits[0]) : undefined
}

export function parseScript(text) {
  const lines = String(text || '').split(/\r?\n/)
  const shots = []
  let episode = { id: 'ep1', index: 1, title: '' }
  let scene = { id: 'sc1', index: 1, title: '' }
  let current = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (EPISODE_RE.test(line)) {
      const index = slugNumber(line, EPISODE_RE) || episode.index + 1
      episode = { id: `ep${index}`, index, title: line }
      scene = { id: 'sc1', index: 1, title: '' }
      current = null
      continue
    }
    if (SCENE_RE.test(line)) {
      const index = slugNumber(line, SCENE_RE) || scene.index + 1
      scene = { id: `sc${index}`, index, title: line }
      current = null
      continue
    }

    const shotMatch = SHOT_RE.exec(line)
    if (shotMatch && shotMatch[2]) {
      current = {
        episodeId: episode.id,
        sceneId: scene.id,
        sceneTitle: scene.title,
        prompt: shotMatch[2].trim(),
        duration: 5,
      }
      shots.push(current)
      continue
    }

    if (current) {
      current.prompt = `${current.prompt}\n${line}`
    } else {
      current = {
        episodeId: episode.id,
        sceneId: scene.id,
        sceneTitle: scene.title,
        prompt: line,
        duration: 5,
      }
      shots.push(current)
    }
  }

  return shots.map((shot, index) => ({ ...shot, index: index + 1 }))
}

/**
 * Bind cast members to parsed shots by exact name / alias substring.
 *
 * Returns a new array; an unmatched shot keeps an empty `characters` array
 * instead of guessing. Matching is done per shot against the prompt only.
 */
export function bindCharactersToShots(shots, characters) {
  const list = Array.isArray(characters) ? characters : []
  const withNames = list
    .map((character) => ({
      id: character.id,
      names: [character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])]
        .map((name) => String(name || '').trim())
        .filter(Boolean),
    }))
    .filter((entry) => entry.id && entry.names.length > 0)

  return (Array.isArray(shots) ? shots : []).map((shot) => {
    const prompt = String(shot.prompt || '')
    const characters = withNames
      .filter((entry) => entry.names.some((name) => prompt.includes(name)))
      .map((entry) => entry.id)
    return { ...shot, characters }
  })
}
