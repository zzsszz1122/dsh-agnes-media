/**
 * Project store for the drama/canvas features.
 *
 * Layout under `<DSH home>/agnes-media/projects/`:
 *
 *   <projectId>/project.json      project + bible + chain state
 *   <projectId>/shots/<id>.json   one shot per file
 *   <projectId>/canvas.json       node positions + edges + viewport
 *   <projectId>/assets/frames/    extracted tail/manual frames
 *
 * Writes are atomic (tmp + rename) and serialized per file; the in-memory maps
 * are the single source of truth for the process.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ID_ALPHABET = '0123456789abcdef'

function makeId(prefix) {
  const uuid = randomUUID().replace(/-/g, '').slice(0, 12)
  return `${prefix}_${uuid}`
}

function now() {
  return Date.now()
}

function defaultShot(projectId, index) {
  return {
    id: makeId('sht'),
    projectId,
    episodeId: 'ep1',
    sceneId: 'sc1',
    index,
    title: '',
    prompt: '',
    camera: '',
    negativePrompt: '',
    duration: 5,
    size: '720P',
    seed: null,
    context: { characters: [], scene: '', continuity: '' },
    firstFrame: { source: 'auto' },
    /** Shots this one borrows its look from (ids of earlier shots). */
    refs: [],
    status: 'draft',
    storyboardFile: null,
    storyboardUrl: null,
    storyboardTaskId: null,
    storyboardError: '',
    lockMode: '',
    taskId: null,
    assetFile: null,
    assetUrl: null,
    tailFile: null,
    tailUrl: null,
    tailError: '',
    error: '',
    createdAt: now(),
    updatedAt: now(),
  }
}

function defaultCanvas(projectId) {
  return {
    projectId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    updatedAt: now(),
  }
}

async function readJsonFile(file) {
  const text = await readFile(file, 'utf8')
  return JSON.parse(text)
}

/** A cast entry: { id, name, aliases[], look, refs[], locked }. */
export function normalizeCharacter(input = {}) {
  const refs = Array.isArray(input.refs)
    ? input.refs
        .filter((ref) => ref && typeof ref === 'object')
        .map((ref) => ({
          id: String(ref.id || makeId('ref')),
          kind: ['front', 'side', 'back', 'extra'].includes(ref.kind) ? ref.kind : 'extra',
          file: ref.file ? String(ref.file) : null,
          url: ref.url ? String(ref.url) : '',
          addedAt: Number(ref.addedAt) || Date.now(),
        }))
    : []
  return {
    id: String(input.id || makeId('cha')),
    name: String(input.name || '').trim() || '未命名角色',
    aliases: Array.isArray(input.aliases)
      ? input.aliases.map((alias) => String(alias).trim()).filter(Boolean)
      : [],
    look: String(input.look || '').trim(),
    refs,
    locked: hasUsableReference({ refs }),
  }
}

/** Reference mode needs a publicly reachable HTTPS image. */
export function hasUsableReference(character) {
  const refs = Array.isArray(character?.refs) ? character.refs : []
  return refs.some((ref) => /^https:\/\/\S+$/i.test(String(ref.url || '')))
}

async function writeJsonFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, file)
}

export function createProjects(root) {
  const projects = new Map()
  const shots = new Map()
  const canvases = new Map()
  /** Per-project write queues so two updates cannot interleave. */
  const queues = new Map()

  function projectDir(id) {
    return path.join(root, id)
  }

  function shotsDir(id) {
    return path.join(projectDir(id), 'shots')
  }

  function assetPath(projectId, relative) {
    return path.join(projectDir(projectId), 'assets', relative)
  }

  function enqueue(projectId, operation) {
    const previous = queues.get(projectId) || Promise.resolve()
    const next = previous.then(operation, operation)
    queues.set(
      projectId,
      next.catch(() => {}),
    )
    return next
  }

  const ready = (async () => {
    await mkdir(root, { recursive: true })
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = path.join(root, entry.name)
      try {
        const project = await readJsonFile(path.join(dir, 'project.json'))
        projects.set(project.id, project)
      } catch {
        continue
      }
      const byId = new Map()
      let files = []
      try {
        files = await readdir(path.join(dir, 'shots'))
      } catch {
        files = []
      }
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const shot = await readJsonFile(path.join(dir, 'shots', file))
          byId.set(shot.id, shot)
        } catch {
          /* skip a half-written shot */
        }
      }
      shots.set(entry.name, byId)
      try {
        canvases.set(entry.name, await readJsonFile(path.join(dir, 'canvas.json')))
      } catch {
        canvases.set(entry.name, defaultCanvas(entry.name))
      }
    }
  })()

  function projectList() {
    return [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function shotList(projectId) {
    const map = shots.get(projectId)
    if (!map) return []
    return [...map.values()].sort((a, b) => a.index - b.index || a.createdAt - b.createdAt)
  }

  async function saveProject(project) {
    project.updatedAt = now()
    projects.set(project.id, project)
    await writeJsonFile(path.join(projectDir(project.id), 'project.json'), project)
    return project
  }

  async function saveShot(shot) {
    shot.updatedAt = now()
    let map = shots.get(shot.projectId)
    if (!map) {
      map = new Map()
      shots.set(shot.projectId, map)
    }
    map.set(shot.id, shot)
    await writeJsonFile(path.join(shotsDir(shot.projectId), `${shot.id}.json`), shot)
    return shot
  }

  return {
    ready,
    root,
    projectDir,
    assetPath,
    listProjects: () => projectList().map((project) => ({ ...project })),
    getProject(projectId) {
      const project = projects.get(projectId)
      return project ? { ...project } : undefined
    },
    getShot(projectId, shotId) {
      const shot = shots.get(projectId)?.get(shotId)
      return shot ? { ...shot } : undefined
    },
    listShots: (projectId) => shotList(projectId).map((shot) => ({ ...shot })),
    getCanvas(projectId) {
      const canvas = canvases.get(projectId)
      return canvas ? JSON.parse(JSON.stringify(canvas)) : defaultCanvas(projectId)
    },
    async createProject(input = {}) {
      await ready
      const project = {
        id: makeId('prj'),
        name: String(input.name || '').trim() || '未命名项目',
        style: String(input.style || '').trim(),
        negative: String(input.negative || '').trim(),
        seedPolicy: ['fixed', 'increment', 'random'].includes(input.seedPolicy)
          ? input.seedPolicy
          : 'increment',
        bible: {
          characters: Array.isArray(input.bible?.characters) ? input.bible.characters : [],
          scenes: Array.isArray(input.bible?.scenes) ? input.bible.scenes : [],
        },
        chain: { running: false, currentShotId: null, startedAt: null, finishedAt: null, error: '' },
        createdAt: now(),
        updatedAt: now(),
      }
      await mkdir(shotsDir(project.id), { recursive: true })
      await mkdir(path.join(projectDir(project.id), 'assets', 'frames'), { recursive: true })
      canvases.set(project.id, defaultCanvas(project.id))
      await saveProject(project)
      await writeJsonFile(path.join(projectDir(project.id), 'canvas.json'), defaultCanvas(project.id))
      return { ...project }
    },
    async updateProject(projectId, patch = {}) {
      await ready
      const project = projects.get(projectId)
      if (!project) return undefined
      if (patch.name !== undefined) project.name = String(patch.name).trim() || project.name
      if (patch.style !== undefined) project.style = String(patch.style)
      if (patch.negative !== undefined) project.negative = String(patch.negative)
      if (['fixed', 'increment', 'random'].includes(patch.seedPolicy)) project.seedPolicy = patch.seedPolicy
      if (patch.bible && typeof patch.bible === 'object') {
        project.bible = {
          characters: Array.isArray(patch.bible.characters) ? patch.bible.characters : project.bible?.characters || [],
          scenes: Array.isArray(patch.bible.scenes) ? patch.bible.scenes : project.bible?.scenes || [],
        }
      }
      if (patch.chain && typeof patch.chain === 'object') {
        project.chain = { ...(project.chain || {}), ...patch.chain }
      }
      return enqueue(projectId, () => saveProject(project))
    },
    async deleteProject(projectId) {
      await ready
      const exists = projects.delete(projectId)
      shots.delete(projectId)
      canvases.delete(projectId)
      if (exists) await rm(projectDir(projectId), { recursive: true, force: true })
      return exists
    },

    /* ------------------------------ cast ------------------------------ */

    listCast(projectId) {
      const project = projects.get(projectId)
      return Array.isArray(project?.bible?.characters) ? project.bible.characters : []
    },
    getCast(projectId, characterId) {
      return this.listCast(projectId).find((character) => character.id === characterId)
    },
    async createCast(projectId, input = {}) {
      await ready
      const project = projects.get(projectId)
      if (!project) return undefined
      const character = normalizeCharacter(input)
      project.bible = project.bible || { characters: [], scenes: [] }
      project.bible.characters = [...(project.bible.characters || []), character]
      await saveProject(project)
      await mkdir(path.join(projectDir(projectId), 'assets', 'cast', character.id), { recursive: true })
      return character
    },
    async updateCast(projectId, characterId, patch = {}) {
      await ready
      const project = projects.get(projectId)
      if (!project) return undefined
      const characters = project.bible?.characters || []
      const index = characters.findIndex((character) => character.id === characterId)
      if (index < 0) return undefined
      const current = characters[index] || {}
      const next = normalizeCharacter({
        ...current,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.look !== undefined ? { look: patch.look } : {}),
        ...(patch.aliases !== undefined ? { aliases: patch.aliases } : {}),
        ...(patch.refs !== undefined ? { refs: patch.refs } : {}),
      })
      // Keep the existing id even if normalizeCharacter had to mint one.
      next.id = current.id
      characters[index] = next
      project.bible.characters = characters
      await saveProject(project)
      return next
    },
    async deleteCast(projectId, characterId) {
      await ready
      const project = projects.get(projectId)
      if (!project) return false
      const characters = project.bible?.characters || []
      const next = characters.filter((character) => character.id !== characterId)
      if (next.length === characters.length) return false
      project.bible.characters = next
      await saveProject(project)
      // Drop the shot bindings so composePrompt cannot reference a ghost.
      for (const shot of shotList(projectId)) {
        if (Array.isArray(shot.context?.characters) && shot.context.characters.includes(characterId)) {
          await this.updateShot(projectId, shot.id, {
            context: { characters: shot.context.characters.filter((id) => id !== characterId) },
          })
        }
      }
      await rm(path.join(projectDir(projectId), 'assets', 'cast', characterId), {
        recursive: true,
        force: true,
      })
      return true
    },
    async addCastRef(projectId, characterId, ref) {
      await ready
      const project = projects.get(projectId)
      if (!project) return undefined
      const characters = project.bible?.characters || []
      const index = characters.findIndex((character) => character.id === characterId)
      if (index < 0) return undefined
      const current = normalizeCharacter(characters[index])
      const nextRefs = [
        ...(current.refs || []).filter((entry) => entry.kind !== ref.kind || entry.kind === 'extra'),
        {
          id: String(ref.id || makeId('ref')),
          kind: ['front', 'side', 'back', 'extra'].includes(ref.kind) ? ref.kind : 'extra',
          file: ref.file ? String(ref.file) : null,
          url: String(ref.url || ''),
          addedAt: Date.now(),
        },
      ]
      return this.updateCast(projectId, characterId, { refs: nextRefs })
    },
    async updateCastRef(projectId, characterId, refId, patch = {}) {
      const character = this.getCast(projectId, characterId)
      if (!character) return undefined
      const refs = (character.refs || []).map((ref) =>
        ref.id === refId
          ? { ...ref, ...(patch.url !== undefined ? { url: String(patch.url) } : {}) }
          : ref,
      )
      if (!refs.some((ref) => ref.id === refId)) return undefined
      return this.updateCast(projectId, characterId, { refs })
    },

    currentCast(projectId) {
      return this.listCast(projectId)
    },

    async createShot(projectId, input = {}) {
      await ready
      const project = projects.get(projectId)
      if (!project) return undefined
      const existing = shotList(projectId)
      const index = Number.isFinite(input.index)
        ? Number(input.index)
        : existing.length === 0
          ? 1
          : Math.max(...existing.map((shot) => shot.index)) + 1
      const shot = defaultShot(projectId, index)
      if (input.title !== undefined) shot.title = String(input.title)
      if (input.prompt !== undefined) shot.prompt = String(input.prompt).slice(0, 4000)
      if (input.camera !== undefined) shot.camera = String(input.camera)
      if (input.negativePrompt !== undefined) shot.negativePrompt = String(input.negativePrompt)
      if (input.episodeId !== undefined) shot.episodeId = String(input.episodeId)
      if (input.sceneId !== undefined) shot.sceneId = String(input.sceneId)
      if (input.duration !== undefined) shot.duration = Number(input.duration) || 5
      if (input.size !== undefined) shot.size = String(input.size)
      if (Number.isFinite(Number(input.seed))) shot.seed = Number(input.seed)
      if (input.context && typeof input.context === 'object') {
        shot.context = {
          characters: Array.isArray(input.context.characters) ? input.context.characters : [],
          scene: String(input.context.scene || ''),
          continuity: String(input.context.continuity || ''),
        }
      }
      if (Array.isArray(input.refs)) {
        shot.refs = input.refs.map(String).filter(Boolean).slice(0, 4)
      }
      await enqueue(projectId, () => saveShot(shot))
      return { ...shot }
    },
    async updateShot(projectId, shotId, patch = {}) {
      await ready
      const shot = shots.get(projectId)?.get(shotId)
      if (!shot) return undefined
      const stringFields = ['title', 'prompt', 'camera', 'negativePrompt', 'status', 'error', 'taskId', 'size', 'tailError', 'episodeId', 'sceneId']
      for (const field of stringFields) {
        if (patch[field] !== undefined) shot[field] = String(patch[field])
      }
      const passthrough = [
        'assetFile',
        'assetUrl',
        'tailFile',
        'tailUrl',
        'storyboardFile',
        'storyboardUrl',
        'storyboardTaskId',
        'storyboardError',
        'lockMode',
      ]
      for (const field of passthrough) {
        if (patch[field] !== undefined) shot[field] = patch[field] === null ? null : String(patch[field])
      }
      if (patch.prompt !== undefined) shot.prompt = String(patch.prompt).slice(0, 4000)
      if (patch.index !== undefined) shot.index = Number(patch.index) || shot.index
      if (patch.duration !== undefined) shot.duration = Number(patch.duration) || shot.duration
      if (patch.seed !== undefined) shot.seed = Number.isFinite(Number(patch.seed)) ? Number(patch.seed) : null
      if (patch.context && typeof patch.context === 'object') {
        shot.context = {
          characters: Array.isArray(patch.context.characters)
            ? patch.context.characters
            : shot.context?.characters || [],
          scene: patch.context.scene !== undefined ? String(patch.context.scene) : shot.context?.scene || '',
          continuity:
            patch.context.continuity !== undefined
              ? String(patch.context.continuity)
              : shot.context?.continuity || '',
        }
      }
      if (patch.firstFrame && typeof patch.firstFrame === 'object') {
        shot.firstFrame = {
          ...(shot.firstFrame || {}),
          source: ['auto', 'manual', 'none'].includes(patch.firstFrame.source)
            ? patch.firstFrame.source
            : shot.firstFrame?.source || 'auto',
          ...(patch.firstFrame.file !== undefined ? { file: patch.firstFrame.file } : {}),
        }
      }
      if (patch.refs !== undefined) {
        shot.refs = Array.isArray(patch.refs)
          ? patch.refs.map(String).filter(Boolean).slice(0, 4)
          : []
      }
      return enqueue(projectId, () => saveShot(shot))
    },
    async deleteShot(projectId, shotId) {
      await ready
      const map = shots.get(projectId)
      if (!map || !map.delete(shotId)) return false
      unlink(path.join(shotsDir(projectId), `${shotId}.json`)).catch(() => {})
      const canvas = canvases.get(projectId)
      if (canvas) {
        canvas.nodes = canvas.nodes.filter((node) => node.id !== shotId)
        canvas.edges = canvas.edges.filter((edge) => edge.from !== shotId && edge.to !== shotId)
        await writeJsonFile(path.join(projectDir(projectId), 'canvas.json'), canvas)
      }
      return true
    },
    async saveCanvas(projectId, input = {}) {
      await ready
      const project = projects.get(projectId)
      if (!project) return undefined
      const canvas = {
        projectId,
        viewport: {
          x: Number(input.viewport?.x) || 0,
          y: Number(input.viewport?.y) || 0,
          zoom: Math.min(2.5, Math.max(0.25, Number(input.viewport?.zoom) || 1)),
        },
        nodes: Array.isArray(input.nodes)
          ? input.nodes
              .filter((node) => node && typeof node.id === 'string')
              .map((node) => ({
                id: node.id,
                type: ['shot', 'image', 'note'].includes(node.type) ? node.type : 'shot',
                x: Number(node.x) || 0,
                y: Number(node.y) || 0,
                data: node.data && typeof node.data === 'object' ? node.data : {},
              }))
          : [],
        edges: Array.isArray(input.edges)
          ? input.edges
              .filter((edge) => edge && typeof edge.from === 'string' && typeof edge.to === 'string')
              .map((edge) => ({
                id: String(edge.id || makeId('edg')),
                from: edge.from,
                to: edge.to,
                kind: edge.kind === 'reference' ? 'reference' : 'sequence',
                autoFrame: edge.autoFrame !== false,
              }))
          : [],
        updatedAt: now(),
      }
      canvases.set(projectId, canvas)
      await writeJsonFile(path.join(projectDir(projectId), 'canvas.json'), canvas)
      return canvas
    },
  }
}
