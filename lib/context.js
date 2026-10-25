/**
 * Prompt assembly for a chained shot.
 *
 * The order is fixed so the prompt prefix stays stable across shots (which also
 * keeps any provider-side caching useful): style → characters → continuity →
 * the shot itself → camera → negative prompt.
 */

export function composePrompt({ project, shot, previousShot }) {
  const parts = []
  const style = String(project?.style || '').trim()
  if (style) parts.push(`【风格】${style}`)

  const bibleCharacters = Array.isArray(project?.bible?.characters) ? project.bible.characters : []
  const cast = Array.isArray(shot?.context?.characters) ? shot.context.characters : []
  const characters = bibleCharacters.filter((character) => character && cast.includes(character.id))
  if (characters.length > 0) {
    parts.push(
      `【角色】${characters
        .map((character) => `${character.name || '角色'}：${character.look || ''}`.trim())
        .join('；')}`,
    )
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

export function seedFor(project, shot, index) {
  if (Number.isFinite(Number(shot?.seed))) return Number(shot.seed)
  const policy = project?.seedPolicy || 'increment'
  const base = Number.isFinite(Number(project?.seedBase)) ? Number(project.seedBase) : 1000
  if (policy === 'fixed') return base
  if (policy === 'increment') return base + Math.max(0, Number(index) || 0)
  return undefined
}
