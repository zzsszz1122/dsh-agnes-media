/**
 * Canvas graph engine tests.
 *
 * These lock the parts of `lib/graph.js` that are easy to break silently: the
 * v1→v2 migration (old projects must keep their wires), the one-link-per-input
 * rule, ordering with mute/bypass, cycle detection, first-frame resolution and
 * signature stability (the whole reason re-running a chain is cheap).
 *
 * Run: node --test test/
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  GRAPH_VERSION,
  NODE_TYPES,
  SLOT_TYPES,
  buildOrder,
  describeGraph,
  normalizeCanvas,
  resolveFirstFrame,
  resolveSlotType,
  shotSignature,
  typesCompatible,
  validateGraph,
} from '../lib/graph.js'

function shot(id, index, extra = {}) {
  return {
    id,
    index,
    prompt: `prompt ${index}`,
    duration: 5,
    size: '720P',
    status: 'draft',
    firstFrame: { source: 'auto' },
    refs: [],
    context: { characters: [], scene: '', continuity: '' },
    ...extra,
  }
}

function canvas(nodes, links, extra = {}) {
  return {
    version: GRAPH_VERSION,
    mode: 'graph',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: nodes.map((node) => ({
      pos: [0, 0],
      size: [268, 220],
      mode: 0,
      flags: { collapsed: false, pinned: false },
      data: {},
      ...node,
    })),
    links,
    ...extra,
  }
}

function link(id, from, to, originSlot = 1, targetSlot = 0, type = 'IMAGE') {
  return {
    id,
    origin_id: from,
    origin_slot: originSlot,
    target_id: to,
    target_slot: targetSlot,
    type,
    disabled: false,
  }
}

/* ------------------------------- migration -------------------------------- */

test('v1 canvas migrates to v2 without losing the layout or the wires', () => {
  const migrated = normalizeCanvas('prj_1', {
    viewport: { x: 12, y: 34, zoom: 1.5 },
    nodes: [
      { id: 'sht_1', type: 'shot', x: 40, y: 70 },
      { id: 'imp_1', type: 'media', x: 10, y: 20, data: { kind: 'video', file: 'imports/a.mp4' } },
      { id: 'imp_2', type: 'media', x: 10, y: 200, data: { kind: 'image', file: 'imports/b.png' } },
      { id: 'sht_2', type: 'shot', x: 300, y: 70 },
    ],
    edges: [{ id: 'e1', from: 'sht_1', to: 'sht_2', kind: 'sequence', autoFrame: true }],
  })

  assert.equal(migrated.version, GRAPH_VERSION)
  assert.deepEqual(migrated.viewport, { x: 12, y: 34, zoom: 1.5 })
  assert.deepEqual(
    migrated.nodes.map((node) => node.type),
    ['shot', 'clip', 'image', 'shot'],
  )
  assert.deepEqual(migrated.nodes[0].pos, [40, 70])
  assert.equal(migrated.links.length, 1)
  // A v1 edge carried a *picture*: slot 1 is the tail frame, slot 0 is the video.
  assert.equal(migrated.links[0].origin_slot, 1)
  assert.equal(migrated.links[0].target_slot, 0)
  assert.equal(migrated.mode, 'graph')

  // The migrated edge must survive validation, not be reported as a type error.
  const blockers = validateGraph(migrated, [shot('sht_1', 1), shot('sht_2', 2)])
  assert.deepEqual(blockers, [])
})

test('v1 reference edges land on the reference input', () => {
  const migrated = normalizeCanvas('prj_1', {
    nodes: [
      { id: 'sht_1', type: 'shot', x: 0, y: 0 },
      { id: 'sht_2', type: 'shot', x: 300, y: 0 },
    ],
    edges: [{ id: 'e1', from: 'sht_1', to: 'sht_2', kind: 'reference' }],
  })
  assert.equal(migrated.links[0].target_slot, 1)
  assert.equal(migrated.links[0].origin_slot, 1)
})

test('a canvas with no links stays in linear mode', () => {
  const normalized = normalizeCanvas('prj_1', { nodes: [{ id: 'sht_1', type: 'shot', x: 0, y: 0 }], links: [] })
  assert.equal(normalized.mode, 'linear')
})

/* ------------------------------ normalisation ----------------------------- */

test('normalizeCanvas drops self loops, dangling links and duplicate inputs', () => {
  const normalized = normalizeCanvas(
    'prj_1',
    canvas(
      [{ id: 'sht_1', type: 'shot' }, { id: 'sht_2', type: 'shot' }, { id: 'sht_3', type: 'shot' }],
      [
        link(1, 'sht_1', 'sht_1'), // self loop
        link(2, 'sht_1', 'ghost'), // dangling target
        link(3, 'ghost', 'sht_2'), // dangling origin
        link(4, 'sht_1', 'sht_3'), // kept
        link(5, 'sht_2', 'sht_3'), // same input slot: last one wins
      ],
    ),
  )
  assert.equal(normalized.links.length, 1)
  assert.equal(normalized.links[0].origin_id, 'sht_2')
  assert.equal(normalized.links[0].target_id, 'sht_3')
  assert.deepEqual(
    normalized.links.map((entry) => entry.id),
    [1],
  )
})

test('normalizeCanvas clamps size, zoom and node mode', () => {
  const normalized = normalizeCanvas(
    'prj_1',
    canvas([{ id: 'sht_1', type: 'shot', size: [10, 5000], mode: 7 }], [], {
      viewport: { x: 0, y: 0, zoom: 99 },
    }),
  )
  assert.deepEqual(normalized.nodes[0].size, [120, 900])
  assert.equal(normalized.nodes[0].mode, 0)
  assert.equal(normalized.viewport.zoom, 2.5)
})

test('types only connect when equal or wildcard', () => {
  assert.equal(typesCompatible('IMAGE', 'IMAGE'), true)
  assert.equal(typesCompatible('IMAGE', 'VIDEO'), false)
  assert.equal(typesCompatible('IMAGE', '*'), true)
  assert.equal(typesCompatible('*', 'VIDEO'), true)
})

test('a reroute forwards the type of whatever feeds it', () => {
  const graph = canvas(
    [{ id: 'sht_1', type: 'shot' }, { id: 'rr_1', type: 'reroute' }, { id: 'sht_2', type: 'shot' }],
    [link(1, 'sht_1', 'rr_1', 1, 0), link(2, 'rr_1', 'sht_2', 0, 0)],
  )
  const reroute = graph.nodes.find((node) => node.id === 'rr_1')
  assert.equal(resolveSlotType(graph, reroute, 0, 'output'), 'IMAGE')
})

/* --------------------------------- ordering -------------------------------- */

test('order follows the wires, then shot index', () => {
  const graph = canvas(
    [{ id: 'sht_1', type: 'shot' }, { id: 'sht_2', type: 'shot' }, { id: 'sht_3', type: 'shot' }],
    // sht_3 depends on sht_2, sht_2 on sht_1
    [link(1, 'sht_1', 'sht_2'), link(2, 'sht_2', 'sht_3')],
  )
  const { order, cycle } = buildOrder(graph, [shot('sht_1', 1), shot('sht_2', 2), shot('sht_3', 3)])
  assert.deepEqual(cycle, [])
  assert.deepEqual(
    order.map((entry) => entry.shotId),
    ['sht_1', 'sht_2', 'sht_3'],
  )
})

test('a cycle is reported instead of being silently ordered', () => {
  const graph = canvas(
    [{ id: 'sht_1', type: 'shot' }, { id: 'sht_2', type: 'shot' }],
    [link(1, 'sht_1', 'sht_2', 1, 0), link(2, 'sht_2', 'sht_1', 0, 2, 'VIDEO')],
  )
  const result = buildOrder(graph, [shot('sht_1', 1), shot('sht_2', 2)])
  assert.deepEqual(result.cycle.sort(), ['sht_1', 'sht_2'])
  const blockers = validateGraph(graph, [shot('sht_1', 1), shot('sht_2', 2)])
  assert.ok(blockers.some((entry) => /成环/.test(entry.reason)))
})

test('a muted node is skipped and blocks its consumer', () => {
  const graph = canvas(
    [
      { id: 'sht_1', type: 'shot', mode: 2 },
      { id: 'sht_2', type: 'shot' },
    ],
    [link(1, 'sht_1', 'sht_2')],
  )
  const shots = [shot('sht_1', 1), shot('sht_2', 2)]
  const result = buildOrder(graph, shots)
  assert.deepEqual(
    result.order.map((entry) => entry.shotId),
    ['sht_2'],
  )
  assert.equal(result.skipped[0].nodeId, 'sht_1')
  const blockers = validateGraph(graph, shots)
  assert.ok(blockers.some((entry) => /静音/.test(entry.reason)))
})

test('a bypassed node passes its upstream frame through', () => {
  const graph = canvas(
    [
      { id: 'sht_1', type: 'shot' },
      { id: 'sht_2', type: 'shot', mode: 4 },
      { id: 'sht_3', type: 'shot' },
    ],
    [link(1, 'sht_1', 'sht_2'), link(2, 'sht_2', 'sht_3')],
  )
  const shots = [
    shot('sht_1', 1, { status: 'ready', tailFile: 'frames/sht_1-tail.jpg' }),
    shot('sht_2', 2),
    shot('sht_3', 3),
  ]
  const order = buildOrder(graph, shots).order.map((entry) => entry.shotId)
  assert.deepEqual(order, ['sht_1', 'sht_3'])

  const resolved = resolveFirstFrame(graph, shots, 'sht_3')
  assert.equal(resolved.kind, 'link')
  // sht_2 was bypassed, so sht_3 reads straight from sht_1's tail.
  assert.equal(resolved.producerId, 'sht_1')
  assert.deepEqual(resolved.value, { kind: 'shot-tail', shotId: 'sht_1' })
})

test('nodeIds restricts the run to those shots and their ancestors', () => {
  const graph = canvas(
    [{ id: 'sht_1', type: 'shot' }, { id: 'sht_2', type: 'shot' }, { id: 'sht_3', type: 'shot' }],
    [link(1, 'sht_1', 'sht_2')],
  )
  const shots = [shot('sht_1', 1), shot('sht_2', 2), shot('sht_3', 3)]
  const result = buildOrder(graph, shots, { nodeIds: ['sht_2'] })
  assert.deepEqual(
    result.order.map((entry) => entry.shotId),
    ['sht_1', 'sht_2'],
  )
})

/* ------------------------------ first frames ------------------------------ */

test('an uploaded first frame outranks a wired one', () => {
  const graph = canvas(
    [{ id: 'sht_1', type: 'shot' }, { id: 'sht_2', type: 'shot' }],
    [link(1, 'sht_1', 'sht_2')],
  )
  const shots = [
    shot('sht_1', 1, { status: 'ready', tailFile: 'frames/tail.jpg' }),
    shot('sht_2', 2, { firstFrame: { source: 'manual', file: 'frames/manual.jpg' } }),
  ]
  assert.deepEqual(resolveFirstFrame(graph, shots, 'sht_2'), { kind: 'manual', file: 'frames/manual.jpg', reason: '' })
})

test('a wired tail frame is the first frame when nothing else is', () => {
  const graph = canvas(
    [{ id: 'sht_1', type: 'shot' }, { id: 'sht_2', type: 'shot' }],
    [link(1, 'sht_1', 'sht_2')],
  )
  const shots = [shot('sht_1', 1, { status: 'ready', tailFile: 'frames/tail.jpg' }), shot('sht_2', 2)]
  const resolved = resolveFirstFrame(graph, shots, 'sht_2')
  assert.equal(resolved.kind, 'link')
  assert.equal(resolved.producerId, 'sht_1')
})

test('an image node can feed a first frame', () => {
  const graph = canvas(
    [{ id: 'img_1', type: 'image', data: { file: 'imports/a.png' } }, { id: 'sht_2', type: 'shot' }],
    [link(1, 'img_1', 'sht_2', 0, 0)],
  )
  const resolved = resolveFirstFrame(graph, [shot('sht_2', 1)], 'sht_2')
  assert.equal(resolved.kind, 'link')
  assert.deepEqual(resolved.value, { kind: 'asset', file: 'imports/a.png', nodeId: 'img_1' })
})

test('no wiring and no upload means a text run, not an error', () => {
  const graph = canvas([{ id: 'sht_1', type: 'shot' }], [])
  const resolved = resolveFirstFrame(graph, [shot('sht_1', 1)], 'sht_1')
  assert.equal(resolved.kind, 'none')
  assert.equal(resolved.reason, '')
})

/* -------------------------------- signature ------------------------------- */

test('the same inputs produce the same signature', () => {
  const project = { style: '赛博朋克', negative: '水印', seedPolicy: 'increment' }
  const entry = shot('sht_1', 1, { seed: 7 })
  const a = shotSignature(project, entry, { firstFrameMode: 'link', sourceSig: 'abc' })
  const b = shotSignature(project, entry, { firstFrameMode: 'link', sourceSig: 'abc' })
  assert.equal(a, b)
  assert.equal(a.length, 16)
})

test('editing a shot or an ancestor changes the signature', () => {
  const project = { style: '', negative: '', seedPolicy: 'increment' }
  const base = shot('sht_2', 2)
  const original = shotSignature(project, base, { firstFrameMode: 'link', sourceSig: 'abc' })
  const edited = shotSignature(project, { ...base, prompt: 'different' }, { firstFrameMode: 'link', sourceSig: 'abc' })
  const upstream = shotSignature(project, base, { firstFrameMode: 'link', sourceSig: 'def' })
  assert.notEqual(original, edited)
  assert.notEqual(original, upstream)
})

test('reordering cast ids does not change the signature', () => {
  const project = { style: '', negative: '', seedPolicy: 'increment' }
  const a = shotSignature(project, shot('sht_1', 1, { context: { characters: ['c1', 'c2'], scene: '', continuity: '' } }))
  const b = shotSignature(project, shot('sht_1', 1, { context: { characters: ['c2', 'c1'], scene: '', continuity: '' } }))
  assert.equal(a, b)
})

/* --------------------------- validation & summary --------------------------- */

test('a type mismatch is reported, not silently dropped', () => {
  const graph = canvas(
    [{ id: 'sht_1', type: 'shot' }, { id: 'sht_2', type: 'shot' }],
    // video output into a video input is fine, but IMAGE into prev(VIDEO) is not
    [link(1, 'sht_1', 'sht_2', 1, 2, 'IMAGE')],
  )
  const blockers = validateGraph(graph, [shot('sht_1', 1), shot('sht_2', 2)])
  assert.ok(blockers.some((entry) => /接不上/.test(entry.reason)))
})

test('describeGraph reports mode, order, blockers and cached shots', () => {
  const graph = canvas([{ id: 'sht_1', type: 'shot' }], [])
  graph.mode = 'linear'
  const shots = [shot('sht_1', 1, { status: 'ready', assetFile: 'media/a.mp4' })]
  const signature = shotSignature({}, shots[0], { firstFrameMode: 'none' })
  shots[0].signature = signature
  const summary = describeGraph(graph, shots, { project: {}, projectId: 'prj_1' })
  assert.equal(summary.mode, 'linear')
  assert.deepEqual(
    summary.order.map((entry) => entry.shotId),
    ['sht_1'],
  )
  assert.deepEqual(summary.blockers, [])
  assert.equal(summary.cached.length, 1)
})

test('the node registry exposes the slots the client draws', () => {
  assert.deepEqual(
    NODE_TYPES.shot.inputs.map((entry) => [entry.slot, entry.type]),
    [
      [0, 'IMAGE'],
      [1, 'IMAGE'],
      [2, 'VIDEO'],
    ],
  )
  assert.deepEqual(
    NODE_TYPES.shot.outputs.map((entry) => [entry.slot, entry.type]),
    [
      [0, 'VIDEO'],
      [1, 'IMAGE'],
      [2, 'IMAGE'],
    ],
  )
  assert.ok(SLOT_TYPES.IMAGE.color)
  assert.ok(SLOT_TYPES.VIDEO.color)
})
