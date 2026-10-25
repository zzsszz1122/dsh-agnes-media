/**
 * Client half of `dsh-agnes-media`.
 *
 * Registers one sidebar panel entry (`sidebar.panellist`) plus the page it
 * opens (`main`). The page only submits tasks and reads Host history: every
 * generation runs in the Host process, so switching panels, reloading, or
 * closing the page never loses a queued or finished result.
 */
window.__ModuleLoader__.load({
  id: 'dsh-agnes-media',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const PANEL_ID = 'agnes-media'
    const NS = 'dsh-agnes-media'
    const API = '/agnes-media/api'

    const ZH = {
      'panel.title': 'Agnes 创作室',
      'panel.subtitle': '调用「设置 → 模型」里已配置的免费生图 / 生视频模型；任务在后台排队，离开页面也会继续',
      'tab.video': '生视频',
      'tab.image': '生图',
      'model.video': '视频模型',
      'model.image': '图像模型',
      'field.prompt': '提示词',
      'placeholder.video': '描述镜头：主体、动作、运镜、光线、氛围……',
      'placeholder.image': '描述画面：主体、风格、构图、光线……',
      'field.size': '分辨率',
      'field.seconds': '时长',
      'field.seed': '种子（可选）',
      'action.generate.video': '生成视频',
      'action.generate.image': '生成图片',
      'action.generating': '生成中…',
      'action.refresh': '重新检测',
      'action.download': '下载',
      'action.open': '新窗口打开',
      'action.copy': '复制链接',
      'action.clear': '清空预览',
      'action.delete': '删除',
      'status.key.ok': 'Key 已就绪',
      'status.key.missing': 'Key 未配置',
      'status.hint': '请到「设置 → 模型 → agnes」填写 API Key，或在 DSH 凭据中新增 {env}。',
      'status.backend': '后台任务',
      'empty.title': '还没有生成结果',
      'empty.hint': '写一段提示词后点击生成；任务在后台运行，可以随时切走。',
      'phase.submitting': '提交任务…',
      'phase.queued': '排队中…',
      'phase.render': '渲染中…',
      'phase.download': '下载结果…',
      'phase.image': '生成图片…',
      'status.queued': '排队中',
      'status.running': '生成中',
      'status.failed': '失败',
      'error.title': '生成失败',
      'error.prompt': '请先填写提示词。',
      'history.title': '生成历史',
      'history.hint': '保存在本机，切换页面、重启 DSH 都不会丢',
      'history.empty': '还没有生成记录',
      'examples.title': '试试：',
      'example.video.1': '一只柯基冲浪，夕阳逆光，电影慢镜头',
      'example.video.2': '霓虹雨夜的老巷子，赛博朋克，35mm 变形宽银幕',
      'example.video.3': '雨街上一只纸船漂过，微距特写',
      'example.image.1': '长满青苔的岩石上放着一只玻璃茶壶，壶中是星河',
      'example.image.2': '白桦林里一只红狐狸，极简海报风',
      'example.image.3': '黄昏里的等距视角温馨书店，暖色台灯',
      'note.seconds': '秒',
      'note.source': '来源',
    }

    const EN = {
      'panel.title': 'Agnes Studio',
      'panel.subtitle': 'Calls the free image and video models from Settings → Models; tasks queue in the background and survive leaving this page',
      'tab.video': 'Video',
      'tab.image': 'Image',
      'model.video': 'Video model',
      'model.image': 'Image model',
      'field.prompt': 'Prompt',
      'placeholder.video': 'Describe the shot: subject, action, camera, light, mood…',
      'placeholder.image': 'Describe the picture: subject, style, composition, light…',
      'field.size': 'Resolution',
      'field.seconds': 'Duration',
      'field.seed': 'Seed (optional)',
      'action.generate.video': 'Generate video',
      'action.generate.image': 'Generate image',
      'action.generating': 'Generating…',
      'action.refresh': 'Recheck',
      'action.download': 'Download',
      'action.open': 'Open',
      'action.copy': 'Copy link',
      'action.clear': 'Clear preview',
      'action.delete': 'Delete',
      'status.key.ok': 'Key ready',
      'status.key.missing': 'Key missing',
      'status.hint': 'Add the API key in Settings → Models → agnes, or store {env} in DSH credentials.',
      'status.backend': 'background task',
      'empty.title': 'Nothing generated yet',
      'empty.hint': 'Write a prompt and generate; the task keeps running while you are away.',
      'phase.submitting': 'Submitting task…',
      'phase.queued': 'Queued…',
      'phase.render': 'Rendering…',
      'phase.download': 'Downloading result…',
      'phase.image': 'Generating image…',
      'status.queued': 'Queued',
      'status.running': 'Running',
      'status.failed': 'Failed',
      'error.title': 'Generation failed',
      'error.prompt': 'Write a prompt first.',
      'history.title': 'History',
      'history.hint': 'Stored on this machine; survives panel switches and restarts',
      'history.empty': 'No generations yet',
      'examples.title': 'Try:',
      'example.video.1': 'A corgi surfing a sunset wave, cinematic slow motion',
      'example.video.2': 'Neon rain in a cyberpunk alley, 35mm anamorphic',
      'example.video.3': 'A paper boat drifting down a rainy street, macro',
      'example.image.1': 'A glass teapot of galaxies on a mossy rock, studio light',
      'example.image.2': 'A red fox in a birch forest, minimalist poster',
      'example.image.3': 'An isometric cozy bookstore at dusk, warm lamps',
      'note.seconds': 's',
      'note.source': 'source',
    }

    const IMAGE_SIZES = ['1024x1024', '1024x768', '768x1024', '1280x720', '720x1280', '1536x1536', '2048x2048']
    const VIDEO_SIZES = ['720P', '1080P']
    const VIDEO_SECONDS = ['4', '5', '6', '8', '10', '12']

    async function readJsonResponse(response) {
      let data = {}
      try {
        data = await response.json()
      } catch {
        /* the HTTP status is the only fact left */
      }
      if (!response.ok || (data && data.ok === false)) {
        throw new Error(data && data.error ? String(data.error) : `HTTP ${response.status}`)
      }
      return data || {}
    }

    async function getJson(path) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store' })
      return readJsonResponse(response)
    }

    async function postJson(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return readJsonResponse(response)
    }

    function Icon(props) {
      const size = props && props.size ? props.size : 16
      const active = Boolean(props && props.active)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', flex: 'none' },
        },
        h('rect', { x: 2.5, y: 4.5, width: 19, height: 15, rx: 3 }),
        h('path', { d: 'M2.5 9h19' }),
        h('path', { d: 'M7 4.5 9.5 9M14.5 4.5 17 9' }),
        h('path', { d: 'M10.2 12.4v4.8l4.4-2.4z', fill: 'currentColor', stroke: 'none' }),
      )
    }

    const STYLES = `
      .agnes-root{display:flex;flex-direction:column;height:100%;min-height:480px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);overflow:hidden}
      .agnes-scroll{flex:1;min-height:0;overflow:auto;padding:26px 30px 40px}
      .agnes-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .agnes-title{font-size:20px;font-weight:600;letter-spacing:.01em;line-height:1.25}
      .agnes-sub{font-size:12.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;line-height:1.5;max-width:700px}
      .agnes-badges{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .agnes-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:999px;padding:4px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
      .agnes-dot{width:7px;height:7px;border-radius:50%;background:#9ca3af;flex:none}
      .agnes-dot[data-ok="true"]{background:#22c55e}
      .agnes-dot[data-ok="false"]{background:#ef4444}
      .agnes-tabs{display:inline-flex;gap:2px;background:transparent;border:0;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.35));padding:0;margin-bottom:14px}
      .agnes-tab{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#9ca3af);padding:7px 16px;cursor:pointer;font:inherit;font-size:12.5px;line-height:1.4;margin-bottom:-1px}
      .agnes-tab[data-active="true"]{color:var(--dsw-alias-label-primary,inherit);font-weight:600;border-bottom-color:#2563eb}
      .agnes-grid{display:grid;grid-template-columns:minmax(300px,420px) minmax(0,1fr);gap:18px;align-items:start}
      @media (max-width:900px){.agnes-grid{grid-template-columns:1fr}}
      .agnes-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px;box-sizing:border-box}
      .agnes-card+.agnes-card{margin-top:14px}
      .agnes-label{display:block;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:0 0 6px}
      .agnes-model{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
      .agnes-model b{font-weight:600;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px}
      .agnes-textarea{width:100%;box-sizing:border-box;min-height:124px;resize:vertical;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;line-height:1.55;outline:none}
      .agnes-textarea:focus{border-color:#2563eb}
      .agnes-row{display:flex;gap:10px}
      .agnes-row>*{flex:1;min-width:0}
      .agnes-field{margin-top:12px}
      .agnes-select,.agnes-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;font:inherit;font-size:12.5px;outline:none}
      .agnes-select:focus,.agnes-input:focus{border-color:#2563eb}
      .agnes-actions{display:flex;gap:8px;margin-top:14px}
      .agnes-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:9px;padding:8px 14px;font:inherit;font-size:12.5px;cursor:pointer;border:1px solid transparent;white-space:nowrap;text-decoration:none}
      .agnes-button:disabled{opacity:.55;cursor:default}
      .agnes-primary{background:#2563eb;color:#fff;border-color:#2563eb;font-weight:600}
      .agnes-primary:hover:not(:disabled){background:#1d4ed8;border-color:#1d4ed8}
      .agnes-ghost{border-color:var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary)}
      .agnes-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
      .agnes-examples{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}
      .agnes-examples span{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .agnes-example{font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:3px 9px;cursor:pointer;font-family:inherit}
      .agnes-example:hover{color:var(--dsw-alias-label-primary)}
      .agnes-error{display:flex;gap:8px;align-items:flex-start;border:1px solid rgba(239,68,68,.55);background:rgba(239,68,68,.08);color:#ef4444;border-radius:10px;padding:9px 12px;font-size:12.5px;line-height:1.5;margin-top:12px;word-break:break-word}
      .agnes-progress{height:6px;border-radius:999px;background:rgba(127,127,127,.25);overflow:hidden;margin-top:10px}
      .agnes-progress>i{display:block;height:100%;background:#2563eb;transition:width .4s ease}
      .agnes-stagemark{display:flex;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:8px}
      .agnes-media{width:100%;max-height:calc(100vh - 300px);border-radius:10px;display:block;background:#000;object-fit:contain}
      .agnes-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;min-height:260px;color:var(--dsw-alias-label-secondary);border:1px dashed var(--dsw-alias-border-l1);border-radius:12px;text-align:center;padding:24px;font-size:12.5px}
      .agnes-empty b{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
      .agnes-history-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
      .agnes-history{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;margin-top:10px}
      .agnes-thumb{position:relative;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;aspect-ratio:1;background:var(--dsw-alias-bg-layer-2);cursor:pointer;padding:0}
      .agnes-thumb[data-active="true"]{border-color:#2563eb;box-shadow:0 0 0 1px #2563eb}
      .agnes-thumb img,.agnes-thumb video{width:100%;height:100%;object-fit:cover;display:block}
      .agnes-thumb-state{display:flex;align-items:center;justify-content:center;height:100%;font-size:11.5px;color:var(--dsw-alias-label-secondary);text-align:center;padding:6px;box-sizing:border-box;line-height:1.4}
      .agnes-thumb-del{position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:50%;border:0;background:rgba(0,0,0,.55);color:#fff;font-size:12px;line-height:1;cursor:pointer;display:none}
      .agnes-thumb:hover .agnes-thumb-del{display:block}
      .agnes-thumb-badge{position:absolute;left:4px;bottom:4px;font-size:9.5px;line-height:1.4;padding:1px 5px;border-radius:999px;background:rgba(0,0,0,.6);color:#fff}
      .agnes-foot{margin-top:14px;font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .agnes-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;word-break:break-all}
    `

    function Page(props) {
      const t = props && typeof props.t === 'function' ? props.t : (key) => key
      const [tab, setTab] = useState('video')
      const [prompt, setPrompt] = useState('')
      const [imageSize, setImageSize] = useState('1024x1024')
      const [videoSize, setVideoSize] = useState('720P')
      const [seconds, setSeconds] = useState('5')
      const [seed, setSeed] = useState('')
      const [status, setStatus] = useState(null)
      const [history, setHistory] = useState([])
      const [busy, setBusy] = useState(false)
      const [phase, setPhase] = useState('')
      const [progress, setProgress] = useState(0)
      const [note, setNote] = useState('')
      const [error, setError] = useState('')
      const [result, setResult] = useState(null)
      const [refreshTick, setRefreshTick] = useState(0)
      const activeRef = useRef(null)

      const stageText = useCallback(
        (item) => {
          if (!item) return ''
          if (item.note) return item.note
          if (item.status === 'queued') return t('status.queued')
          if (item.status === 'failed') return item.error || t('status.failed')
          if (item.stage === 'submit') return t('phase.submitting')
          if (item.stage === 'queue') return `${t('phase.queued')} ${Math.round(item.progress || 0)}%`
          if (item.stage === 'download') return t('phase.download')
          if (item.stage === 'image') return t('phase.image')
          return `${t('phase.render')} ${Math.round(item.progress || 0)}%`
        },
        [t],
      )

      const historyLabel = useCallback(
        (item) => {
          if (!item) return ''
          if (item.status === 'failed') return t('status.failed')
          if (item.status === 'ready') return ''
          if (item.status === 'queued') return t('status.queued')
          return `${t('status.running')} ${Math.round(item.progress || 0)}%`
        },
        [t],
      )

      const refresh = useCallback(async () => {
        const data = await getJson('/history')
        const items = Array.isArray(data.items) ? data.items : []
        setHistory(items)
        const active = activeRef.current
        if (active) {
          const item = items.find((entry) => entry.id === active)
          if (item) {
            setProgress(item.progress || 0)
            setNote(item.note || '')
            setPhase(stageText(item))
            if (item.status === 'ready') {
              activeRef.current = null
              setBusy(false)
              setPhase('')
              setNote('')
              setResult(item)
            } else if (item.status === 'failed') {
              activeRef.current = null
              setBusy(false)
              setPhase('')
              setNote('')
              setError(item.error || t('error.title'))
            }
          }
        }
        return items
      }, [stageText, t])

      useEffect(() => {
        let cancelled = false
        getJson('/history')
          .then((data) => {
            if (cancelled) return
            const items = Array.isArray(data.items) ? data.items : []
            setHistory(items)
            const latest = items.find((item) => item.status === 'ready')
            if (latest) setResult(latest)
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [])

      useEffect(() => {
        let alive = true
        getJson('/status')
          .then((data) => {
            if (alive) setStatus(data)
          })
          .catch(() => {
            if (alive) setStatus({ configured: false })
          })
        return () => {
          alive = false
        }
      }, [refreshTick])

      const hasPending = history.some((item) => item.status === 'queued' || item.status === 'running')
      useEffect(() => {
        if (!hasPending) return undefined
        const timer = setInterval(() => {
          refresh().catch(() => {})
        }, 2500)
        return () => clearInterval(timer)
      }, [hasPending, refresh])

      const generate = useCallback(async () => {
        const text = prompt.trim()
        if (!text) {
          setError(t('error.prompt'))
          return
        }
        setError('')
        setProgress(0)
        setPhase(tab === 'image' ? t('phase.image') : t('phase.submitting'))
        setNote('')
        setResult(null)
        try {
          const payload = { prompt: text }
          const seedValue = Number(seed)
          if (seed.trim() !== '' && Number.isFinite(seedValue)) payload.seed = seedValue
          const data =
            tab === 'image'
              ? await postJson('/image', { ...payload, size: imageSize })
              : await postJson('/video', { ...payload, size: videoSize, seconds })
          const item = data.item
          if (!item) throw new Error(t('error.title'))
          activeRef.current = item.id
          setBusy(true)
          setHistory((current) => [item, ...current.filter((entry) => entry.id !== item.id)])
          await refresh()
        } catch (caught) {
          activeRef.current = null
          setBusy(false)
          setPhase('')
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }, [prompt, tab, imageSize, videoSize, seconds, seed, t, refresh])

      const removeItem = useCallback(
        async (id) => {
          try {
            await postJson('/history/delete', { id })
            if (activeRef.current === id) {
              activeRef.current = null
              setBusy(false)
              setPhase('')
            }
            setResult((current) => (current && current.id === id ? null : current))
            await refresh()
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
          }
        },
        [refresh],
      )

      const configured = Boolean(status && status.configured)
      const activeModel =
        tab === 'image'
          ? (status && status.imageModel) || 'agnes-image-2.5-flash'
          : (status && status.videoModel) || 'agnes-video-2.5-flash'
      const examples =
        tab === 'image'
          ? ['example.image.1', 'example.image.2', 'example.image.3']
          : ['example.video.1', 'example.video.2', 'example.video.3']

      return h(
        'div',
        { className: 'agnes-root' },
        h('style', null, STYLES),
        h(
          'div',
          { className: 'agnes-scroll' },
          h(
            'div',
            { className: 'agnes-head' },
            h(
              'div',
              null,
              h('div', { className: 'agnes-title' }, t('panel.title')),
              h('div', { className: 'agnes-sub' }, t('panel.subtitle')),
            ),
            h(
              'div',
              { className: 'agnes-badges' },
              h(
                'span',
                { className: 'agnes-chip' },
                h('i', { className: 'agnes-dot', 'data-ok': configured ? 'true' : 'false' }),
                configured ? t('status.key.ok') : t('status.key.missing'),
                status && status.source ? ` · ${status.source}` : '',
              ),
              status && status.baseURL
                ? h('span', { className: 'agnes-chip agnes-mono' }, status.baseURL)
                : null,
              h(
                'button',
                {
                  type: 'button',
                  className: 'agnes-button agnes-ghost',
                  onClick: () => setRefreshTick((value) => value + 1),
                },
                t('action.refresh'),
              ),
            ),
          ),
          !configured && status
            ? h(
                'div',
                { className: 'agnes-error' },
                (t('status.hint') || '').replace('{env}', status.apiKeyEnv || 'AGNES_API_KEY'),
              )
            : null,
          h(
            'div',
            { className: 'agnes-tabs' },
            h(
              'button',
              {
                type: 'button',
                className: 'agnes-tab',
                'data-active': tab === 'video' ? 'true' : 'false',
                onClick: () => setTab('video'),
              },
              t('tab.video'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'agnes-tab',
                'data-active': tab === 'image' ? 'true' : 'false',
                onClick: () => setTab('image'),
              },
              t('tab.image'),
            ),
          ),
          h(
            'div',
            { className: 'agnes-grid' },
            h(
              'div',
              null,
              h(
                'div',
                { className: 'agnes-card' },
                h(
                  'label',
                  { className: 'agnes-label' },
                  tab === 'image' ? t('model.image') : t('model.video'),
                ),
                h(
                  'div',
                  { className: 'agnes-model' },
                  h('b', null, activeModel),
                  h('span', null, configured ? t('status.key.ok') : t('status.key.missing')),
                ),
                h(
                  'div',
                  { className: 'agnes-field' },
                  h('label', { className: 'agnes-label' }, t('field.prompt')),
                ),
                h('textarea', {
                  className: 'agnes-textarea',
                  value: prompt,
                  placeholder: tab === 'image' ? t('placeholder.image') : t('placeholder.video'),
                  onChange: (event) => setPrompt(event.target.value),
                  disabled: busy,
                }),
                h(
                  'div',
                  { className: 'agnes-examples' },
                  h('span', null, t('examples.title')),
                  ...examples.map((key) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key,
                        className: 'agnes-example',
                        disabled: busy,
                        onClick: () => {
                          setPrompt(t(key))
                          setError('')
                        },
                      },
                      t(key),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'agnes-row agnes-field' },
                  h(
                    'div',
                    null,
                    h('label', { className: 'agnes-label' }, t('field.size')),
                    tab === 'image'
                      ? h(
                          'select',
                          {
                            className: 'agnes-select',
                            value: imageSize,
                            disabled: busy,
                            onChange: (event) => setImageSize(event.target.value),
                          },
                          ...IMAGE_SIZES.map((size) => h('option', { key: size, value: size }, size)),
                        )
                      : h(
                          'select',
                          {
                            className: 'agnes-select',
                            value: videoSize,
                            disabled: busy,
                            onChange: (event) => setVideoSize(event.target.value),
                          },
                          ...VIDEO_SIZES.map((size) => h('option', { key: size, value: size }, size)),
                        ),
                  ),
                  tab === 'video'
                    ? h(
                        'div',
                        null,
                        h('label', { className: 'agnes-label' }, t('field.seconds')),
                        h(
                          'select',
                          {
                            className: 'agnes-select',
                            value: seconds,
                            disabled: busy,
                            onChange: (event) => setSeconds(event.target.value),
                          },
                          ...VIDEO_SECONDS.map((value) =>
                            h('option', { key: value, value }, `${value}${t('note.seconds')}`),
                          ),
                        ),
                      )
                    : h(
                        'div',
                        null,
                        h('label', { className: 'agnes-label' }, t('field.seed')),
                        h('input', {
                          className: 'agnes-input',
                          value: seed,
                          inputMode: 'numeric',
                          placeholder: '—',
                          disabled: busy,
                          onChange: (event) => setSeed(event.target.value),
                        }),
                      ),
                ),
                h(
                  'div',
                  { className: 'agnes-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-button agnes-primary',
                      disabled: busy || !configured,
                      onClick: () => generate(),
                      style: { flex: 1 },
                    },
                    busy
                      ? t('action.generating')
                      : tab === 'image'
                        ? t('action.generate.image')
                        : t('action.generate.video'),
                  ),
                  result
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'agnes-button agnes-ghost',
                          onClick: () => setResult(null),
                        },
                        t('action.clear'),
                      )
                    : null,
                ),
                busy
                  ? h(
                      'div',
                      null,
                      h(
                        'div',
                        { className: 'agnes-progress' },
                        h('i', { style: { width: `${Math.max(4, Math.min(100, progress))}%` } }),
                      ),
                      h(
                        'div',
                        { className: 'agnes-stagemark' },
                        h('span', null, note || phase || t('action.generating')),
                        h('span', null, `${Math.round(progress)}%`),
                      ),
                    )
                  : null,
                error ? h('div', { className: 'agnes-error' }, h('div', null, error)) : null,
              ),
            ),
            h(
              'div',
              { className: 'agnes-card' },
              result
                ? h(
                    'div',
                    null,
                    result.kind === 'video'
                      ? h('video', {
                          className: 'agnes-media',
                          src: result.url,
                          controls: true,
                          autoPlay: true,
                          loop: true,
                          playsInline: true,
                        })
                      : h('img', {
                          className: 'agnes-media',
                          src: result.url,
                          alt: result.prompt || 'agnes image',
                          style: { maxHeight: 'calc(100vh - 320px)' },
                        }),
                    h(
                      'div',
                      { className: 'agnes-actions' },
                      h(
                        'a',
                        {
                          className: 'agnes-button agnes-primary',
                          href: `${result.url}${result.url.indexOf('?') >= 0 ? '&' : '?'}download=1`,
                          download: `agnes-${result.kind}`,
                        },
                        t('action.download'),
                      ),
                      result.upstream
                        ? h(
                            'a',
                            {
                              className: 'agnes-button agnes-ghost',
                              href: result.upstream,
                              target: '_blank',
                              rel: 'noreferrer noopener',
                            },
                            t('action.open'),
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'agnes-button agnes-ghost',
                          onClick: () => {
                            if (result.upstream && navigator.clipboard) {
                              navigator.clipboard.writeText(result.upstream).catch(() => {})
                            }
                          },
                        },
                        t('action.copy'),
                      ),
                    ),
                    h(
                      'div',
                      { className: 'agnes-foot' },
                      h('span', null, result.prompt),
                    ),
                  )
                : h(
                    'div',
                    { className: 'agnes-empty' },
                    h('b', null, t('empty.title')),
                    h('span', null, t('empty.hint')),
                  ),
            ),
          ),
          h(
            'div',
            { className: 'agnes-card', style: { marginTop: '16px' } },
            h(
              'div',
              { className: 'agnes-history-head' },
              h('label', { className: 'agnes-label', style: { margin: 0 } }, t('history.title')),
              h(
                'span',
                { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' } },
                t('history.hint'),
              ),
            ),
            history.length === 0
              ? h(
                  'div',
                  {
                    style: {
                      fontSize: '12px',
                      color: 'var(--dsw-alias-label-secondary)',
                      padding: '10px 0',
                    },
                  },
                  t('history.empty'),
                )
              : h(
                  'div',
                  { className: 'agnes-history' },
                  ...history.map((item) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: item.id,
                        className: 'agnes-thumb',
                        'data-active': result && result.id === item.id ? 'true' : 'false',
                        title: item.prompt,
                        onClick: () => {
                          if (item.status === 'ready' && item.url) {
                            setResult(item)
                            setError('')
                          }
                        },
                      },
                      item.status === 'ready' && item.url
                        ? item.kind === 'video'
                          ? h('video', { src: item.url, muted: true, preload: 'metadata' })
                          : h('img', { src: item.url, alt: item.prompt || '' })
                        : h('span', { className: 'agnes-thumb-state' }, historyLabel(item)),
                      item.status === 'ready'
                        ? h(
                            'span',
                            { className: 'agnes-thumb-badge' },
                            item.kind === 'video' ? t('tab.video') : t('tab.image'),
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'agnes-thumb-del',
                          title: t('action.delete'),
                          onClick: (event) => {
                            event.stopPropagation()
                            removeItem(item.id).catch(() => {})
                          },
                        },
                        '×',
                      ),
                    ),
                  ),
                ),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-agnes-media: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-agnes-media: en dictionary')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () => {
          const offRow = ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 2,
              label: () => t('panel.title'),
              locale: NS,
              inject: () => ({ t }),
            },
            (owner) =>
              h(Icon, { size: owner && owner.size ? owner.size : 16, active: Boolean(owner && owner.active) }),
          )
          const offPanel = ctx.slots.register(
            {
              name: 'main',
              key: PANEL_ID,
              locale: NS,
              inject: () => ({ t }),
            },
            (owner) => h(Page, { t: owner && owner.t ? owner.t : t }),
          )
          return () => {
            if (typeof offRow === 'function') offRow()
            if (typeof offPanel === 'function') offPanel()
          }
        })
      },
    }
  },
})
