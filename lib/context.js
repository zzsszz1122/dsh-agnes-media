/**
 * Prompt assembly for a chained shot.
 *
 * The order is fixed so the prompt prefix stays stable across shots (which also
 * keeps any provider-side caching useful): style → characters → continuity →
 * the shot itself → camera → negative prompt.
 */

/** A character's text look; falls back to its reference kinds when `look` is empty. */
function lookOf(character) {
  const look = String(character?.look || '').trim()
  if (look) return look
  const kinds = (Array.isArray(character?.refs) ? character.refs : [])
    .map((ref) => ref.kind)
    .filter(Boolean)
  return kinds.length > 0 ? `参考图（${[...new Set(kinds)].join('/')}）` : ''
}

export function composePrompt({ project, shot, previousShot }) {
  const parts = []
  const style = String(project?.style || '').trim()
  if (style) parts.push(`【风格】${style}`)

  const bibleCharacters = Array.isArray(project?.bible?.characters) ? project.bible.characters : []
  const cast = Array.isArray(shot?.context?.characters) ? shot.context.characters : []
  let characters = bibleCharacters.filter((character) => character && cast.includes(character.id))
  // Auto-bind by name/alias when the shot has no explicit cast, so a prompt that
  // already says the character's name still locks that face.
  if (characters.length === 0) {
    const promptText = String(shot?.prompt || '')
    characters = bibleCharacters.filter((character) => {
      if (!character) return false
      const names = [character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])]
        .map((name) => String(name || '').trim())
        .filter(Boolean)
      return names.some((name) => promptText.includes(name))
    })
  }
  if (characters.length > 0) {
    parts.push(
      `【角色】${characters
        .map((character) => `${character.name || '角色'}：${lookOf(character)}`.trim())
        .join('；')}`,
    )
    const locked = characters.filter((character) =>
      (character.refs || []).some((ref) => /^https:\/\/\S+$/i.test(String(ref.url || ''))),
    )
    if (locked.length > 0) {
      parts.push(
        `【一致性】严格保持 ${locked
          .map((character) => character.name || '角色')
          .join('、')} 的面部特征、发型与服装不变形、不换脸；同一角色在不同镜头里必须是同一张脸。`,
      )
    }
  }

  const scenes = Array.isArray(project?.bible?.scenes) ? project.bible.scenes : []
  const scene = scenes.find((entry) => entry && entry.id === shot?.context?.scene)
  if (scene) parts.push(`【场景】${scene.name || ''}：${scene.look || ''}`.trim())

  const continuity =
    String(shot?.context?.continuity || '').trim() ||
    (previousShot
      ? `上一镜以「${previousShot.prompt || '上一画面'}」结束；本镜从该画面自然继续，保持同一场景、同一角色造型与光线。`
      : '')
  if (continuity) parts.push(`【承接】${continuity}`)

  const prompt = String(shot?.prompt || '').trim()
  if (prompt) parts.push(`【本镜】${prompt}`)
  if (shot?.camera) parts.push(`【镜头】${String(shot.camera).trim()}`)

  const negative = String(shot?.negativePrompt || project?.negative || '').trim()
  if (negative) parts.push(`【禁止】${negative}`)

  return parts.join('\n')
}

/**
 * Public HTTPS reference URLs for the characters in this shot, in cast order.
 *
 * Reference mode only accepts publicly reachable HTTPS images, so refs without
 * a URL are skipped rather than silently downgraded.
 */
export function collectReferenceUrls(project, shot, limit = 4) {
  const cast = Array.isArray(shot?.context?.characters) ? shot.context.characters : []
  const bibleCharacters = Array.isArray(project?.bible?.characters) ? project.bible.characters : []
  const urls = []
  for (const character of bibleCharacters) {
    if (!character || !cast.includes(character.id)) continue
    for (const ref of Array.isArray(character.refs) ? character.refs : []) {
      const url = String(ref?.url || '').trim()
      if (/^https:\/\/\S+$/i.test(url) && !urls.includes(url)) urls.push(url)
      if (urls.length >= limit) return urls
    }
  }
  return urls
}

export function seedFor(project, shot, index) {
  if (Number.isFinite(Number(shot?.seed))) return Number(shot.seed)
  const policy = project?.seedPolicy || 'increment'
  const base = Number.isFinite(Number(project?.seedBase)) ? Number(project.seedBase) : 1000
  if (policy === 'fixed') return base
  if (policy === 'increment') return base + Math.max(0, Number(index) || 0)
  return undefined
}

/** Screenplay-level name matching: exact name or alias substring, no guessing. */
export function matchCharacters(prompt, characters) {
  const text = String(prompt || '')
  if (!text) return []
  return (Array.isArray(characters) ? characters : [])
    .filter((character) => {
      if (!character) return false
      const names = [character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])]
        .map((name) => String(name || '').trim())
        .filter(Boolean)
      return names.some((name) => text.includes(name))
    })
    .map((character) => character.id)
}

