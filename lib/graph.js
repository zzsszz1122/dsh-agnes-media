/**
 * Canvas graph engine — the pure, side-effect-free half of the 1.1 canvas.
 *
 * 1.0 stored node positions and a decorative `edges` array that never reached
 * the executor: the chain always ran in `shot.index` order and always borrowed
 * the previous shot's tail frame. 1.1 turns the same canvas into an actual
 * execution graph, which needs four things this module owns:
 *
 *   1. a versioned canvas model (v2) plus a lossless migration from v1, so an
 *      existing project opens without losing its layout;
 *   2. typed ports, so a link can be refused instead of silently ignored;
 *   3. an ordering pass (topological, with cycle detection and mute/bypass),
 *      so "what runs next" is a property of the graph;
 *   4. a content signature per shot, so a re-run only re-executes the shots
 *      whose inputs actually changed.
 *
 * Everything here is deterministic and file-system free (only `node:crypto`),
 * so the executor in index.js stays responsible for all I/O and this module
 * stays testable.
 */

import { createHash } from 'node:crypto'

export const GRAPH_VERSION = 2

/** Port colours are shared with the client so both sides agree on what a wire means. */
export const SLOT_TYPES = {
  IMAGE: { color: '#3b82f6', label: '图像' },
  VIDEO: { color: '#a855f7', label: '视频' },
  '*': { color: '#94a3b8', label: '任意' },
}

/**
 * Node type registry.
 *
 * Slot numbers are part of the wire format: links persist `origin_slot` /
 * `target_slot`, so renumbering a slot silently re-points every saved link.
 * Append new slots, never insert.
 */
export const NODE_TYPES = {
  shot: {
    title: '镜头',
    executable: true,
    inputs: [
      { slot: 0, name: 'first_frame', type: 'IMAGE', label: '首帧' },
      { slot: 1, name: 'reference', type: 'IMAGE', label: '参考图' },
      { slot: 2, name: 'prev', type: 'VIDEO', label: '承接片段' },
    ],
    outputs: [
      { slot: 0, name: 'video', type: 'VIDEO', label: '成片' },
      { slot: 1, name: 'tail', type: 'IMAGE', label: '尾帧' },
      { slot: 2, name: 'still', type: 'IMAGE', label: '静帧' },
    ],
  },
  image: {
    title: '图片',
    executable: false,
    inputs: [],
    outputs: [{ slot: 0, name: 'image', type: 'IMAGE', label: '图像' }],
  },
  clip: {
    title: '视频素材',
    executable: false,
    inputs: [],
    outputs: [
      { slot: 0, name: 'video', type: 'VIDEO', label: '视频' },
      { slot: 1, name: 'frame', type: 'IMAGE', label: '尾帧' },
    ],
  },
  note: {
    title: '便签',
    executable: false,
    inputs: [],
    outputs: [],
  },
  reroute: {
    title: '转接',
    executable: false,
    virtual: true,
    inputs: [{ slot: 0, name: 'in', type: '*', label: '' }],
    outputs: [{ slot: 0, name: 'out', type: '*', label: '' }],
  },
}

export const NODE_MODES = { NORMAL: 0, MUTED: 2, BYPASS: 4 }
export const CANVAS_MODES = ['linear', 'graph']

const DEFAULT_SIZE = { shot: [268, 220], image: [220, 180], clip: [240, 190], note: [220, 140], reroute: [26, 26] }
const MIN_SIZE = [120, 60]
const MAX_SIZE = [640, 900]
const GRID = 1

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value))
}

function num(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Ports are compatible when they match, or when either side is the wildcard. */
export function typesCompatible(a, b) {
  const left = String(a || '*')
  const right = String(b || '*')
  return left === right || left === '*' || right === '*'
}

function nodeTypeOf(node) {
  return NODE_TYPES[node && node.type] ? node.type : 'shot'
}

function inputBySlot(type, slot) {
  const def = NODE_TYPES[type]
  if (!def) return undefined
  return (def.inputs || []).find((entry) => entry.slot === slot)
}

function outputBySlot(type, slot) {
  const def = NODE_TYPES[type]
  if (!def) return undefined
  return (def.outputs || []).find((entry) => entry.slot === slot)
}

/** The type a slot actually carries, resolving `*` through reroutes to a real producer. */
export function resolveSlotType(canvas, node, slot, direction = 'output', seen = new Set()) {
  if (!node) return undefined
  const type = nodeTypeOf(node)
  const def = direction === 'output' ? outputBySlot(type, slot) : inputBySlot(type, slot)
  if (!def) return undefined
  if (def.type !== '*') return def.type
  // A reroute is transparent: what it carries is whatever feeds it.
  if (type !== 'reroute' || seen.has(node.id)) return '*'
  seen.add(node.id)
  const upstream = (canvas.links || []).find(
    (link) => link && link.target_id === node.id && Number(link.target_slot) === Number(slot) && link.disabled !== true,
  )
  if (!upstream) return '*'
  const producer = (canvas.nodes || []).find((entry) => entry.id === upstream.origin_id)
  if (!producer) return '*'
  return resolveSlotType(canvas, producer, Number(upstream.origin_slot) || 0, 'output', seen)
}

/* ------------------------------ normalisation ------------------------------ */

/**
 * Migrate a 1.0 canvas (`nodes[].x/y`, `edges[]`) into the v2 shape.
 *
 * v1 media nodes carried their kind in `data.kind`; the v2 registry splits them
 * into `clip` and `image` so the port lists can differ.
 */
function migrateLegacy(projectId, input) {
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).map((node) => {
    if (!node || typeof node.id !== 'string') return undefined
    let type = node.type
    if (type === 'media') {
      const kind = String((node.data && node.data.kind) || '')
      type = kind === 'video' ? 'clip' : 'image'
    }
    if (!NODE_TYPES[type]) type = 'shot'
    const pos = Array.isArray(node.pos)
      ? [num(node.pos[0]), num(node.pos[1])]
      : [num(node.x), num(node.y)]
    return {
      id: node.id,
      type,
      pos,
      size: Array.isArray(node.size) ? node.size : undefined,
      mode: node.mode,
      flags: node.flags,
      data: node.data && typeof node.data === 'object' ? node.data : {},
    }
  })
  const edges = Array.isArray(input.edges) ? input.edges : []
  const links = edges.map((edge) => {
    if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string') return undefined
    // A v1 edge always meant "this shot's picture feeds that shot". Slot 0 on a
    // shot is its *video* output, so migrating to slot 0 would make every legacy
    // edge arrive as VIDEO into an IMAGE input and be rejected as a type error.
    // Slot 1 is the tail frame — which is exactly what v1 `autoFrame` described.
    return {
      origin_id: edge.from,
      origin_slot: 1,
      target_id: edge.to,
      // A legacy `reference` edge fed the reference input, not the keyframe.
      target_slot: edge.kind === 'reference' ? 1 : 0,
      type: 'IMAGE',
      disabled: false,
    }
  })
  return { nodes, links, mode: input.mode, viewport: input.viewport }
}

/**
 * Produce the canonical v2 canvas from whatever the caller had.
 *
 * Deliberately forgiving: a client that is mid-deploy, an older panel, or a
 * hand-edited file all converge here. Anything that survives would be a broken
 * graph later, so it is dropped now and the UI simply shows fewer links.
 */
export function normalizeCanvas(projectId, input = {}) {
  const source =
    input && (Number(input.version) === GRAPH_VERSION || Array.isArray(input.links)) ? input : migrateLegacy(projectId, input || {})
  const rawLinks = Array.isArray(source.links) ? source.links : []

  const nodes = []
  const seen = new Set()
  for (const node of Array.isArray(source.nodes) ? source.nodes : []) {
    if (!node || typeof node.id !== 'string' || !node.id || seen.has(node.id)) continue
    seen.add(node.id)
    const type = nodeTypeOf(node)
    const fallback = DEFAULT_SIZE[type] || DEFAULT_SIZE.shot
    const size = Array.isArray(node.size) ? node.size : fallback
    nodes.push({
      id: node.id,
      type,
      pos: [Math.round(num(node.pos && node.pos[0], 40)) , Math.round(num(node.pos && node.pos[1], 40))],
      size: [
        Math.round(clamp(num(size[0], fallback[0]), MIN_SIZE[0], MAX_SIZE[0])),
        Math.round(clamp(num(size[1], fallback[1]), MIN_SIZE[1], MAX_SIZE[1])),
      ],
      mode: [0, 2, 4].includes(Number(node.mode)) ? Number(node.mode) : 0,
      flags: {
        collapsed: Boolean(node.flags && node.flags.collapsed),
        pinned: Boolean(node.flags && node.flags.pinned),
      },
      data: node.data && typeof node.data === 'object' ? node.data : {},
    })
  }

  const byId = new Map(nodes.map((node) => [node.id, node]))
  // One link per input slot. Later entries win so the last drag is the one that
  // sticks, which matches what the user just did on the canvas.
  const occupied = new Map()
  const links = []
  let nextId = 1
  for (const link of rawLinks) {
    if (!link || typeof link !== 'object') continue
    const originId = typeof link.origin_id === 'string' ? link.origin_id : String(link.origin || '')
    const targetId = typeof link.target_id === 'string' ? link.target_id : String(link.target || '')
    if (!originId || !targetId || originId === targetId) continue
    if (!byId.has(originId) || !byId.has(targetId)) continue
    const key = `${targetId}:${num(link.target_slot, 0)}`
    occupied.set(key, { originId, targetId, slot: num(link.target_slot, 0) })
    links.push({
      origin_id: originId,
      origin_slot: Math.max(0, Math.round(num(link.origin_slot, 0))),
      target_id: targetId,
      target_slot: Math.max(0, Math.round(num(link.target_slot, 0))),
      type: String(link.type || 'IMAGE'),
      disabled: link.disabled === true,
    })
  }
  // Rebuild the list with exactly one survivor per occupied input slot.
  const kept = []
  const survivors = new Map()
  for (const link of links) {
    survivors.set(`${link.target_id}:${link.target_slot}`, link)
  }
  for (const link of links) {
    if (survivors.get(`${link.target_id}:${link.target_slot}`) === link) {
      kept.push({ id: nextId++, ...link })
    }
  }

  const explicitMode = CANVAS_MODES.includes(source.mode) ? source.mode : undefined
  const mode = explicitMode || (kept.length > 0 ? 'graph' : 'linear')

  return {
    version: GRAPH_VERSION,
    projectId,
    mode,
    viewport: {
      x: Math.round(num(source.viewport && source.viewport.x)),
      y: Math.round(num(source.viewport && source.viewport.y)),
      zoom: Math.round(clamp(num(source.viewport && source.viewport.zoom, 1), 0.25, 2.5) * 1000) / 1000,
    },
    nodes,
    links: kept,
    updatedAt: Date.now(),
  }
}

/* -------------------------------- traversal -------------------------------- */

function shotMap(shots) {
  return new Map((Array.isArray(shots) ? shots : []).map((shot) => [shot.id, shot]))
}

function activeLinks(canvas) {
  return (canvas.links || []).filter((link) => link && link.disabled !== true)
}

/**
 * Links that mean "downstream waits for upstream to produce a picture".
 *
 * Any node may be a producer (a clip's tail frame is as valid a starting image
 * as an earlier shot's), but only shots are consumers.
 */
function dependencyEdges(canvas) {
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]))
  const edges = []
  for (const link of activeLinks(canvas)) {
    const target = byId.get(link.target_id)
    const origin = byId.get(link.origin_id)
    if (!target || !origin) continue
    if (!NODE_TYPES[target.type] || !NODE_TYPES[target.type].executable) continue
    edges.push({ from: link.origin_id, to: link.target_id, link })
  }
  return edges
}

/** Walk upstream through reroutes until a node that actually produces output. */
function resolveProducer(canvas, nodeId, slot) {
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]))
  let current = byId.get(nodeId)
  let currentSlot = num(slot)
  const seen = new Set()
  while (current) {
    if (current.type !== 'reroute') return { node: current, slot: currentSlot }
    if (seen.has(current.id)) return undefined
    seen.add(current.id)
    const link = activeLinks(canvas).find(
      (entry) => entry.target_id === current.id && Number(entry.target_slot) === 0,
    )
    if (!link) return undefined
    current = byId.get(link.origin_id)
    currentSlot = num(link.origin_slot)
  }
  return undefined
}

/**
 * Bypass: the node does not run, but its output is satisfied by its first
 * available input, so data flows through it untouched. This mirrors what users
 * expect from muting a node in the middle of a chain.
 */
function bypassSource(canvas, node) {
  const type = nodeTypeOf(node)
  const slots = (NODE_TYPES[type].inputs || []).map((entry) => entry.slot)
  for (const slot of slots) {
    const link = activeLinks(canvas).find(
      (entry) => entry.target_id === node.id && Number(entry.target_slot) === Number(slot),
    )
    if (link) return { nodeId: link.origin_id, slot: num(link.origin_slot) }
  }
  return undefined
}

/** Follow bypassed shots downstream so a muted passthrough does not break the chain. */
function resolveEffectiveProducer(canvas, nodeId, slot) {
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]))
  let producer = resolveProducer(canvas, nodeId, slot)
  const seen = new Set()
  while (producer && byId.get(producer.node.id)?.mode === NODE_MODES.BYPASS) {
    if (seen.has(producer.node.id)) return undefined
    seen.add(producer.node.id)
    const next = bypassSource(canvas, producer.node)
    if (!next) return undefined
    producer = resolveProducer(canvas, next.nodeId, next.slot)
  }
  if (producer && byId.get(producer.node.id)?.mode === NODE_MODES.MUTED) return undefined
  return producer
}

/**
 * Topological order of the shots to execute, plus cycle detection.
 *
 * `nodeIds` restricts the run to those nodes and their ancestors — the canvas
 * equivalent of "run just this branch". Ties break on `shot.index` so a freshly
 * laid-out canvas still runs in story order.
 */
export function buildOrder(canvas, shots, options = {}) {
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]))
  const byShot = shotMap(shots)
  const edges = dependencyEdges(canvas)

  const shotNodes = (canvas.nodes || []).filter((node) => node.type === 'shot' && byShot.has(node.id))
  let allowed = new Set(shotNodes.map((node) => node.id))

  if (Array.isArray(options.nodeIds) && options.nodeIds.length > 0) {
    // Upstream closure: the selected nodes and everything they depend on.
    const keep = new Set()
    const stack = options.nodeIds.map(String).filter((id) => byId.has(id))
    while (stack.length > 0) {
      const id = stack.pop()
      if (keep.has(id)) continue
      keep.add(id)
      for (const edge of edges) {
        if (edge.to === id) stack.push(edge.from)
      }
    }
    allowed = new Set([...allowed].filter((id) => keep.has(id)))
  }

  const dependencies = new Map()
  const dependents = new Map()
  for (const id of allowed) {
    dependencies.set(id, new Set())
    dependents.set(id, new Set())
  }
  for (const edge of edges) {
    if (!allowed.has(edge.to)) continue
    // A dependency on a node outside the run is a real blocker, not a silent skip:
    // the executor reports it instead of generating from a missing frame.
    const origin = byId.get(edge.from)
    if (origin && origin.type === 'shot') {
      dependencies.get(edge.to).add(edge.from)
      if (!dependents.has(edge.from)) dependents.set(edge.from, new Set())
      dependents.get(edge.from).add(edge.to)
    }
  }

  const skipped = []
  const order = []
  const remaining = new Set(allowed)
  const done = new Set()

  const indexOf = (id) => {
    const shot = byShot.get(id)
    return Number.isFinite(Number(shot && shot.index)) ? Number(shot.index) : Number.MAX_SAFE_INTEGER
  }

  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => [...dependencies.get(id)].every((dependency) => done.has(dependency) || !remaining.has(dependency)))
      .sort((a, b) => indexOf(a) - indexOf(b) || String(a).localeCompare(String(b)))
    if (ready.length === 0) {
      // Nothing can move: whatever is left sits on a cycle.
      return { order, cycle: [...remaining], skipped, mode: canvas.mode }
    }
    for (const id of ready) {
      remaining.delete(id)
      done.add(id)
      const node = byId.get(id)
      if (node.mode === NODE_MODES.MUTED) {
        skipped.push({ nodeId: id, reason: '静音' })
        continue
      }
      const shot = byShot.get(id)
      order.push({
        nodeId: id,
        shotId: id,
        index: Number(shot && shot.index) || order.length + 1,
        bypassed: node.mode === NODE_MODES.BYPASS,
      })
    }
  }

  return { order: order.filter((entry) => !entry.bypassed), cycle: [], skipped, mode: canvas.mode }
}

/* ---------------------------- first-frame resolution ---------------------------- */

function producerValue(producer) {
  if (!producer) return undefined
  const { node, slot } = producer
  if (node.type === 'shot') {
    if (slot === 1 || slot === 0) return { kind: 'shot-tail', shotId: node.id }
    if (slot === 2) return { kind: 'shot-still', shotId: node.id }
    return undefined
  }
  if (node.type === 'image') return { kind: 'asset', file: node.data && node.data.file, nodeId: node.id }
  if (node.type === 'clip') return { kind: 'clip-frame', file: node.data && node.data.file, nodeId: node.id }
  return undefined
}

/**
 * Where this shot's first frame comes from.
 *
 * Order matters and is documented in the spec: an explicit upload always wins,
 * then the wired `first_frame` input, then a wired `prev` clip's tail. A shot
 * with no framing at all still runs — it just generates from text.
 */
export function resolveFirstFrame(canvas, shots, shotId) {
  const byShot = shotMap(shots)
  const shot = byShot.get(shotId)
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]))

  const inputs = new Map()
  for (const link of activeLinks(canvas)) {
    if (link.target_id !== shotId) continue
    inputs.set(Number(link.target_slot) || 0, link)
  }

  if (shot && shot.firstFrame && shot.firstFrame.source === 'manual' && shot.firstFrame.file) {
    return { kind: 'manual', file: shot.firstFrame.file, reason: '' }
  }

  const wire = inputs.get(0) || inputs.get(2)
  if (wire) {
    const producer = resolveEffectiveProducer(canvas, wire.origin_id, wire.origin_slot)
    const value = producerValue(producer)
    if (value) {
      return {
        kind: 'link',
        producerId: producer.node.id,
        producerSlot: producer.slot,
        value,
        reason: '',
      }
    }
    const origin = byId.get(wire.origin_id)
    if (origin && origin.type === 'shot' && origin.mode === NODE_MODES.MUTED) {
      return { kind: 'none', reason: `上游 ${origin.id} 被静音，拿不到画面` }
    }
    return { kind: 'none', reason: '连线的上游还没有可用的画面' }
  }

  return { kind: 'none', reason: '' }
}

/* --------------------------------- signature --------------------------------- */

function sortedIds(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(String).filter(Boolean))].sort().join(',')
}

/**
 * Content hash for a shot.
 *
 * The point is not cryptographic strength: it is that *identical work hashes
 * identically*, and that any change in an ancestor changes every descendant's
 * hash. That is what makes "re-run the chain" cheap — only the touched branch
 * re-executes.
 */
export function shotSignature(project, shot, options = {}) {
  const sourceSig = String(options.sourceSig || '')
  const firstFrameMode = String(options.firstFrameMode || 'text')
  const parts = [
    'v1',
    String((shot && shot.prompt) || ''),
    String((shot && shot.duration) || ''),
    String((shot && shot.size) || ''),
    Number.isFinite(Number(shot && shot.seed)) ? String(Number(shot.seed)) : '',
    String((shot && shot.negativePrompt) || ''),
    String((shot && shot.camera) || ''),
    String((shot && shot.context && shot.context.continuity) || ''),
    sortedIds(shot && shot.context && shot.context.characters),
    sortedIds(shot && shot.refs),
    String((project && project.style) || ''),
    String((project && project.negative) || ''),
    String((project && project.seedPolicy) || ''),
    firstFrameMode,
    sourceSig,
  ]
  return createHash('sha1').update(parts.join('\u0001'), 'utf8').digest('hex').slice(0, 16)
}

/* -------------------------------- validation -------------------------------- */

/**
 * Everything that would make a run fail, collected up front.
 *
 * The executor refuses to start on any blocker, because the alternative is
 * discovering the problem after burning quota on the shots before it.
 */
export function validateGraph(canvas, shots, options = {}) {
  const blockers = []
  const byId = new Map((canvas.nodes || []).map((node) => [node.id, node]))
  const byShot = shotMap(shots)
  const label = (id) => {
    const shot = byShot.get(id)
    const node = byId.get(id)
    if (shot) return `镜头#${shot.index}`
    if (node) return NODE_TYPES[node.type] ? `${NODE_TYPES[node.type].title}` : `节点 ${id}`
    return `节点 ${id}`
  }

  // 1. Dangling endpoints and self loops survive only through hand-edited files.
  for (const link of canvas.links || []) {
    if (!byId.has(link.origin_id)) {
      blockers.push({ nodeId: link.target_id, reason: `连线起点 ${link.origin_id} 不存在` })
    } else if (!byId.has(link.target_id)) {
      blockers.push({ nodeId: link.origin_id, reason: `连线终点 ${link.target_id} 不存在` })
    } else if (link.origin_id === link.target_id) {
      blockers.push({ nodeId: link.origin_id, reason: '节点不能连到自己' })
    }
  }

  // 2. Type mismatches: the client refuses these, but a stale file may not.
  const seenInputs = new Map()
  for (const link of activeLinks(canvas)) {
    const origin = byId.get(link.origin_id)
    const target = byId.get(link.target_id)
    if (!origin || !target) continue
    const outType = outputBySlot(nodeTypeOf(origin), link.origin_slot)
    const inType = inputBySlot(nodeTypeOf(target), link.target_slot)
    if (!outType || !inType) {
      blockers.push({
        nodeId: link.target_id,
        reason: `端口不存在：${label(link.origin_id)} → ${label(link.target_id)}`,
      })
      continue
    }
    if (!typesCompatible(outType.type, inType.type)) {
      blockers.push({
        nodeId: link.target_id,
        reason: `${label(link.origin_id)} 的「${outType.label || outType.name}」是 ${outType.type}，接不上 ${label(link.target_id)} 的「${inType.label || inType.name}」(${inType.type})`,
      })
    }
    const key = `${link.target_id}:${link.target_slot}`
    if (seenInputs.has(key)) {
      blockers.push({
        nodeId: link.target_id,
        reason: `${label(link.target_id)} 的「${inType.label || inType.name}」接了不止一条线`,
      })
    }
    seenInputs.set(key, link)
  }

  // 3. Cycle / mute problems come from the ordering pass itself.
  const ordered = buildOrder(canvas, shots, options)
  if (ordered.cycle.length > 0) {
    blockers.push({
      nodeId: ordered.cycle[0],
      reason: `连线成环：${ordered.cycle.map((id) => label(id)).join(' → ')}`,
    })
  }

  const runIds = new Set(ordered.order.map((entry) => entry.shotId))
  for (const entry of ordered.skipped) {
    // A muted shot is only a problem if something downstream still expects it.
    const consumers = activeLinks(canvas).filter((link) => link.origin_id === entry.nodeId)
    for (const link of consumers) {
      const consumer = byId.get(link.target_id)
      if (!consumer || !runIds.has(consumer.id)) continue
      blockers.push({
        nodeId: consumer.id,
        reason: `${label(consumer.id)} 依赖 ${label(entry.nodeId)}，但后者被静音`,
      })
    }
  }

  // 4. A wired first frame whose producer will not produce anything this run.
  for (const entry of ordered.order) {
    const shot = byShot.get(entry.shotId)
    if (!shot) continue
    const resolved = resolveFirstFrame(canvas, shots, entry.shotId)
    if (resolved.kind === 'none' && resolved.reason) {
      blockers.push({ nodeId: entry.shotId, shotId: entry.shotId, index: shot.index, reason: resolved.reason })
      continue
    }
    if (resolved.kind === 'link') {
      const value = resolved.value || {}
      if (value.kind === 'shot-tail' || value.kind === 'shot-still') {
        const producer = byShot.get(value.shotId)
        const ready = producer && producer.status === 'ready'
        const hasTail = producer && (value.kind === 'shot-tail' ? producer.tailFile : producer.storyboardFile || producer.firstFrame?.file)
        // Not an error when the producer is simply not generated yet: it is
        // scheduled before this shot in the same run. Only an excluded producer
        // (muted, or filtered out by nodeIds) leaves a hole nothing will fill.
        if (producer && !runIds.has(producer.id) && !(ready && hasTail)) {
          blockers.push({
            nodeId: entry.shotId,
            shotId: entry.shotId,
            index: shot.index,
            reason: `${label(entry.shotId)} 的首帧来自 ${label(producer.id)}，但后者不在本次执行范围内`,
          })
        }
      }
      if (value.kind === 'asset' || value.kind === 'clip-frame') {
        if (!value.file) {
          blockers.push({
            nodeId: entry.shotId,
            shotId: entry.shotId,
            index: shot.index,
            reason: `${label(entry.shotId)} 的素材连线没有文件`,
          })
        }
      }
    }
  }

  return blockers
}

/** Shared payload for `GET /projects/:id/graph` and the validate route. */
export function describeGraph(canvas, shots, options = {}) {
  const normalized = normalizeCanvas(options.projectId || canvas.projectId || '', canvas)
  const ordered = buildOrder(normalized, shots, options)
  const blockers = validateGraph(normalized, shots, options)
  const byShot = shotMap(shots)
  const cached = []
  for (const entry of ordered.order) {
    const shot = byShot.get(entry.shotId)
    if (!shot) continue
    const resolved = resolveFirstFrame(normalized, shots, entry.shotId)
    const signature = shotSignature(options.project || {}, shot, {
      firstFrameMode: resolved.kind,
    })
    if (shot.signature && shot.signature === signature && shot.status === 'ready' && shot.assetFile) {
      cached.push({ shotId: shot.id, reason: '输入未变' })
    }
  }
  return {
    mode: normalized.mode,
    order: ordered.order,
    cycle: ordered.cycle,
    skipped: ordered.skipped,
    blockers,
    cached,
  }
}
