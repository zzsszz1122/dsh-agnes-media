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
      'tab.canvas': '画布',
      'tab.drama': '短剧模式',
      'canvas.hint': '拖拽节点排版；从右侧输出口拖到左侧输入口，建立「尾帧 → 首帧」链路。',
      'canvas.project': '项目',
      'canvas.newProject': '新建项目',
      'canvas.projectName': '项目名称',
      'canvas.create': '创建',
      'canvas.addShot': '添加镜头',
      'canvas.runAll': '生成链路',
      'canvas.runFrom': '从此镜续跑',
      'canvas.connect': '连线',
      'canvas.connecting': '选择目标镜头…',
      'canvas.firstFrame': '上传首帧',
      'canvas.ffmpegMissing': 'ffmpeg 未安装，尾帧无法自动抽取',
      'canvas.empty': '还没有镜头，点「添加镜头」开始',
      'drama.hint': '线性编排：每镜承接上一镜尾帧，可按顺序一键生成。',
      'drama.addShot': '添加镜头',
      'drama.runAll': '一键生成',
      'drama.runFrom': '从选中镜头续跑',
      'drama.save': '保存',
      'drama.prompt': '提示词',
      'drama.duration': '时长',
      'drama.camera': '镜头语言',
      'drama.continuity': '承接说明（留空自动生成）',
      'drama.preview': '预览',
      'drama.timeline': '时间线',
      'drama.total': '总时长',
      'drama.shots': '镜头',
      'drama.empty': '还没有镜头',
      'drama.noProject': '先创建一个项目',
      'action.save': '保存',
      'action.cancel': '取消',
      'action.refreshList': '刷新',
      'status.draft': '草稿',
      'status.blocked': '被阻塞',
      'status.ready': '已完成',
      'status.cancelled': '已取消',
      'action.cancelTask': '取消任务',
      'action.cancelChain': '取消链路',
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
      'tab.canvas': 'Canvas',
      'tab.drama': 'Drama',
      'canvas.hint': 'Drag nodes to arrange them; drag from the right output port to the left input port to chain tail frame → first frame.',
      'canvas.project': 'Project',
      'canvas.newProject': 'New project',
      'canvas.projectName': 'Project name',
      'canvas.create': 'Create',
      'canvas.addShot': 'Add shot',
      'canvas.runAll': 'Run chain',
      'canvas.runFrom': 'Continue from here',
      'canvas.connect': 'Connect',
      'canvas.connecting': 'Pick a target shot…',
      'canvas.firstFrame': 'Upload first frame',
      'canvas.ffmpegMissing': 'ffmpeg is missing; tail frames cannot be extracted',
      'canvas.empty': 'No shots yet — press “Add shot” to start',
      'drama.hint': 'Linear editing: every shot continues from the previous tail frame and can be generated in order.',
      'drama.addShot': 'Add shot',
      'drama.runAll': 'Generate all',
      'drama.runFrom': 'Continue from selected',
      'drama.save': 'Save',
      'drama.prompt': 'Prompt',
      'drama.duration': 'Duration',
      'drama.camera': 'Camera',
      'drama.continuity': 'Continuity note (auto when empty)',
      'drama.preview': 'Preview',
      'drama.timeline': 'Timeline',
      'drama.total': 'Total',
      'drama.shots': 'Shots',
      'drama.empty': 'No shots yet',
      'drama.noProject': 'Create a project first',
      'action.save': 'Save',
      'action.cancel': 'Cancel',
      'action.refreshList': 'Refresh',
      'status.draft': 'Draft',
      'status.blocked': 'Blocked',
      'status.ready': 'Done',
      'status.cancelled': 'Cancelled',
      'action.cancelTask': 'Cancel task',
      'action.cancelChain': 'Cancel chain',
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
      .agnes-view{display:flex;flex-direction:column;gap:10px}
      .agnes-projbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .agnes-view-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-height:16px}
      .agnes-canvas{position:relative;height:min(62vh,560px);min-height:360px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);touch-action:none;cursor:grab}
      .agnes-canvas-inner{position:absolute;left:0;top:0;transform-origin:0 0;background-image:radial-gradient(rgba(127,127,127,.18) 1px, transparent 1px);background-size:24px 24px}
      .agnes-canvas-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
      .agnes-edges{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
      .agnes-node{position:absolute;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;box-shadow:var(--dsw-shadow-lv1,none)}
      .agnes-node[data-selected="true"]{border-color:#2563eb;box-shadow:0 0 0 1px #2563eb}
      .agnes-node[data-status="failed"]{border-color:rgba(239,68,68,.7)}
      .agnes-node[data-status="ready"]{border-color:rgba(34,197,94,.55)}
      .agnes-node-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;cursor:grab;user-select:none}
      .agnes-node-status{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .agnes-node[data-status="failed"] .agnes-node-status{color:#ef4444}
      .agnes-node[data-status="ready"] .agnes-node-status{color:#22c55e}
      .agnes-node-prompt{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);max-height:32px;overflow:hidden}
      .agnes-node-media{width:100%;height:74px;object-fit:cover;border-radius:6px;background:#000}
      .agnes-node-error{font-size:10px;color:#ef4444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .agnes-node-actions{display:flex;gap:4px;flex-wrap:wrap}
      .agnes-mini{font-size:10.5px;padding:2px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit}
      .agnes-mini:hover{color:var(--dsw-alias-label-primary)}
      .agnes-port{position:absolute;top:46px;width:16px;height:16px;border-radius:50%;border:2px solid #2563eb;background:var(--dsw-alias-bg-base);padding:0;cursor:crosshair}
      .agnes-port-in{left:-9px}
      .agnes-port-out{right:-9px}
      .agnes-mini[data-active="true"]{border-color:#2563eb;color:#2563eb}
      .agnes-drama{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:14px;align-items:start}
      .agnes-drama-list{display:flex;flex-direction:column;gap:6px;max-height:min(62vh,560px);overflow:auto}
      .agnes-drama-row{display:grid;grid-template-columns:36px 54px 1fr 42px;gap:6px;align-items:center;text-align:left;padding:7px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:11.5px}
      .agnes-drama-row[data-active="true"]{border-color:#2563eb;background:rgba(37,99,235,.08)}
      .agnes-drama-row-status{font-size:10px;color:var(--dsw-alias-label-secondary)}
      .agnes-drama-row-status[data-status="ready"]{color:#22c55e}
      .agnes-drama-row-status[data-status="failed"]{color:#ef4444}
      .agnes-drama-row-prompt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
      .agnes-drama-row-duration{font-size:10px;color:var(--dsw-alias-label-secondary);text-align:right}
      .agnes-drama-detail{display:flex;flex-direction:column;gap:12px;min-width:0}
      .agnes-timeline{display:flex;gap:3px;height:36px;margin-top:4px}
      .agnes-timeline-clip{flex-basis:0;border-radius:5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
      .agnes-timeline-clip[data-status="ready"]{background:rgba(34,197,94,.35)}
      .agnes-timeline-clip[data-status="failed"]{background:rgba(239,68,68,.35)}
      .agnes-timeline-clip[data-status="running"]{background:rgba(37,99,235,.35)}
    `

    async function patchJson(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return readJsonResponse(response)
    }

    async function putJson(path, body) {
      const response = await fetch(`${API}${path}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return readJsonResponse(response)
    }

    async function deleteJson(path) {
      const response = await fetch(`${API}${path}`, { method: 'DELETE' })
      return readJsonResponse(response)
    }

    const loadProjects = () => getJson('/projects').then((data) => data.projects || [])
    const loadProjectDetail = (id) => getJson(`/projects/${id}`)
    const saveCanvasApi = (id, canvas) => putJson(`/projects/${id}/canvas`, canvas)
    const runChainApi = (id, body) => postJson(`/projects/${id}/chain`, body)
    const cancelTaskApi = (id) => postJson(`/task/${id}/cancel`, {})
    const cancelChainApi = (id) => postJson(`/projects/${id}/chain/cancel`, {})
    const addShotApi = (id, input) => postJson(`/projects/${id}/shots`, input)
    const patchShotApi = (id, shotId, patch) => patchJson(`/projects/${id}/shots/${shotId}`, patch)
    const deleteShotApi = (id, shotId) => deleteJson(`/projects/${id}/shots/${shotId}`)

    class ViewBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error) {
        try {
          console.error('[agnes-media] view error', error)
        } catch {
          /* ignore */
        }
      }

      render() {
        if (this.state.error) {
          return h(
            'div',
            { className: 'agnes-error' },
            `视图出错：${String((this.state.error && this.state.error.message) || this.state.error)}`,
          )
        }
        return this.props.children
      }
    }

    const NODE_W = 232
    const NODE_H = 168

    function mergeNodes(existing, shots) {
      const byId = new Map((existing || []).map((node) => [node.id, node]))
      return (shots || []).map((shot, index) => {
        const node = byId.get(shot.id)
        const fallbackX = 40 + (index % 4) * (NODE_W + 48)
        const fallbackY = 70 + Math.floor(index / 4) * (NODE_H + 56)
        return {
          id: shot.id,
          type: 'shot',
          x: Number.isFinite(Number(node && node.x)) ? Number(node.x) : fallbackX,
          y: Number.isFinite(Number(node && node.y)) ? Number(node.y) : fallbackY,
          data: {},
        }
      })
    }

    function ProjectToolbar(props) {
      const { t, projects, projectId, onPick, onCreate, newName, setNewName, extra } = props
      return h(
        'div',
        { className: 'agnes-projbar' },
        h('label', { className: 'agnes-label', style: { margin: 0 } }, t('canvas.project')),
        h(
          'select',
          {
            className: 'agnes-select',
            style: { maxWidth: '220px' },
            value: projectId,
            onChange: (event) => onPick(event.target.value),
          },
          ...(projects.length
            ? projects.map((project) => h('option', { key: project.id, value: project.id }, project.name))
            : [h('option', { key: 'none', value: '' }, '—')]),
        ),
        h('input', {
          className: 'agnes-input',
          style: { maxWidth: '180px' },
          placeholder: t('canvas.projectName'),
          value: newName,
          onChange: (event) => setNewName(event.target.value),
        }),
        h(
          'button',
          {
            type: 'button',
            className: 'agnes-button agnes-ghost',
            onClick: () => onCreate(newName),
          },
          t('canvas.create'),
        ),
        ...(extra || []),
      )
    }

    function CanvasView({ t }) {
      const [projects, setProjects] = useState([])
      const [projectId, setProjectId] = useState('')
      const [detail, setDetail] = useState(null)
      const [nodes, setNodes] = useState([])
      const [edges, setEdges] = useState([])
      const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 })
      const [newName, setNewName] = useState('')
      const [error, setError] = useState('')
      const [connecting, setConnecting] = useState('')
      const areaRef = useRef(null)
      const dragRef = useRef(null)
      const panRef = useRef(null)
      const saveTimer = useRef(null)

      const shots = detail ? detail.shots || [] : []
      const chain = detail && detail.project ? detail.project.chain : null

      useEffect(() => {
        loadProjects()
          .then((list) => {
            setProjects(list)
            if (list[0]) setProjectId((current) => current || list[0].id)
          })
          .catch((err) => setError(String(err)))
      }, [])

      useEffect(() => {
        if (!projectId) return undefined
        let alive = true
        loadProjectDetail(projectId)
          .then((data) => {
            if (!alive) return
            setDetail(data)
            setNodes(mergeNodes(data.canvas.nodes, data.shots))
            setEdges(data.canvas.edges || [])
            setViewport(data.canvas.viewport || { x: 0, y: 0, zoom: 1 })
          })
          .catch((err) => {
            if (alive) setError(String(err))
          })
        return () => {
          alive = false
        }
      }, [projectId])

      const pending = Boolean(
        detail && (chain?.running || shots.some((shot) => shot.status === 'running' || shot.status === 'queued')),
      )
      useEffect(() => {
        if (!projectId || !pending) return undefined
        const timer = setInterval(() => {
          loadProjectDetail(projectId)
            .then((data) => {
              setDetail(data)
              setNodes((current) => mergeNodes(current, data.shots))
              setEdges(data.canvas.edges || [])
            })
            .catch(() => {})
        }, 2500)
        return () => clearInterval(timer)
      }, [projectId, pending])

      const reload = useCallback(async () => {
        if (!projectId) return
        const data = await loadProjectDetail(projectId)
        setDetail(data)
        setNodes((current) => mergeNodes(current, data.shots))
        setEdges(data.canvas.edges || [])
      }, [projectId])

      const scheduleSave = useCallback(
        (nextNodes, nextEdges, nextViewport) => {
          if (!projectId) return
          if (saveTimer.current) clearTimeout(saveTimer.current)
          saveTimer.current = setTimeout(() => {
            saveCanvasApi(projectId, { nodes: nextNodes, edges: nextEdges, viewport: nextViewport }).catch(() => {})
          }, 500)
        },
        [projectId],
      )

      const toCanvasPoint = (event) => {
        const rect = areaRef.current.getBoundingClientRect()
        return {
          x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
          y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
        }
      }

      const onNodeDown = (event, node) => {
        event.stopPropagation()
        const point = toCanvasPoint(event)
        dragRef.current = { id: node.id, dx: point.x - node.x, dy: point.y - node.y, moved: false }
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          /* ignore */
        }
      }

      const onAreaDown = (event) => {
        if (event.button !== 0) return
        panRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          originX: viewport.x,
          originY: viewport.y,
        }
      }

      const onAreaMove = (event) => {
        if (panRef.current && !dragRef.current) {
          setViewport((current) => ({
            ...current,
            x: panRef.current.originX + (event.clientX - panRef.current.startX),
            y: panRef.current.originY + (event.clientY - panRef.current.startY),
          }))
          return
        }
        const drag = dragRef.current
        if (!drag) return
        const point = toCanvasPoint(event)
        const next = nodes.map((node) =>
          node.id === drag.id ? { ...node, x: point.x - drag.dx, y: point.y - drag.dy } : node,
        )
        drag.moved = true
        drag.latest = next
        setNodes(next)
      }

      const onAreaUp = () => {
        if (panRef.current) {
          panRef.current = null
          scheduleSave(nodes, edges, viewport)
        }
        const drag = dragRef.current
        if (drag) {
          dragRef.current = null
          if (drag.moved) scheduleSave(drag.latest || nodes, edges, viewport)
        }
      }

      // Wheel must not bubble to the page scroller, or zooming the canvas
      // scrolls the panel away and the graph seems to vanish. React registers
      // `wheel` as passive, so attach a non-passive native listener instead.
      useEffect(() => {
        const area = areaRef.current
        if (!area) return undefined
        const handler = (event) => {
          event.preventDefault()
          const factor = event.deltaY > 0 ? 0.9 : 1.1
          setViewport((current) => ({
            ...current,
            zoom: Math.min(2.5, Math.max(0.3, current.zoom * factor)),
          }))
        }
        area.addEventListener('wheel', handler, { passive: false })
        return () => area.removeEventListener('wheel', handler)
      }, [])

      const connectTo = (targetId) => {
        if (!connecting || connecting === targetId) {
          setConnecting('')
          return
        }
        const next = [
          ...edges.filter((edge) => !(edge.from === connecting && edge.to === targetId)),
          {
            id: `edg_${Date.now().toString(36)}`,
            from: connecting,
            to: targetId,
            kind: 'sequence',
            autoFrame: true,
          },
        ]
        setEdges(next)
        setConnecting('')
        scheduleSave(nodes, next, viewport)
      }

      const addShot = async () => {
        if (!projectId) return
        try {
          const data = await addShotApi(projectId, { prompt: '新镜头' })
          await reload()
          if (data.shot) setConnecting('')
        } catch (err) {
          setError(String(err))
        }
      }

      const removeShot = async (shotId) => {
        if (!projectId) return
        try {
          await deleteShotApi(projectId, shotId)
          setEdges((current) => current.filter((edge) => edge.from !== shotId && edge.to !== shotId))
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const runAll = async () => {
        if (!projectId) return
        try {
          await runChainApi(projectId, { shotIds: shots.map((shot) => shot.id) })
          setError('')
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const cancelChain = async () => {
        if (!projectId) return
        try {
          await cancelChainApi(projectId)
          setError('')
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const cancelShotTask = async (shot) => {
        if (!shot || !shot.taskId) return
        try {
          await cancelTaskApi(shot.taskId)
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const runFrom = async (shotId) => {
        if (!projectId) return
        try {
          await runChainApi(projectId, { from: shotId })
          setError('')
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const createProject = async (name) => {
        try {
          const data = await postJson('/projects', { name: name || '未命名项目' })
          const list = await loadProjects()
          setProjects(list)
          setProjectId(data.project.id)
          setNewName('')
        } catch (err) {
          setError(String(err))
        }
      }

      const pickFirstFrame = (shotId) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = () => {
          const file = input.files && input.files[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            postJson(`/projects/${projectId}/shots/${shotId}/first-frame`, {
              dataUri: String(reader.result),
            })
              .then(() => reload())
              .catch((err) => setError(String(err)))
          }
          reader.readAsDataURL(file)
        }
        input.click()
      }

      const nodeById = new Map(nodes.map((node) => [node.id, node]))

      return h(
        'div',
        { className: 'agnes-view' },
        h(ProjectToolbar, {
          t,
          projects,
          projectId,
          onPick: setProjectId,
          onCreate: createProject,
          newName,
          setNewName,
          extra: [
            h(
              'button',
              { key: 'add', type: 'button', className: 'agnes-button agnes-ghost', onClick: addShot },
              t('canvas.addShot'),
            ),
            h(
              'button',
              {
                key: 'run',
                type: 'button',
                className: 'agnes-button agnes-primary',
                disabled: !shots.length || Boolean(chain?.running),
                onClick: runAll,
              },
              chain?.running ? t('action.generating') : t('canvas.runAll'),
            ),
            chain?.running
              ? h(
                  'button',
                  {
                    key: 'cancelChain',
                    type: 'button',
                    className: 'agnes-button agnes-ghost',
                    onClick: cancelChain,
                  },
                  t('action.cancelChain'),
                )
              : null,
            detail && detail.ffmpeg === false
              ? h('span', { key: 'ffmpeg', className: 'agnes-chip', style: { color: '#f59e0b' } }, t('canvas.ffmpegMissing'))
              : null,
          ],
        }),
        h('div', { className: 'agnes-view-hint' }, t('canvas.hint')),
        error ? h('div', { className: 'agnes-error' }, error) : null,
        chain && chain.error ? h('div', { className: 'agnes-error' }, chain.error) : null,
        h(
          'div',
          {
            className: 'agnes-canvas',
            ref: areaRef,
            onPointerDown: onAreaDown,
            onPointerMove: onAreaMove,
            onPointerUp: onAreaUp,
            onPointerLeave: onAreaUp,
          },
          shots.length === 0
            ? h('div', { className: 'agnes-canvas-empty' }, t('canvas.empty'))
            : h(
                'div',
                {
                  className: 'agnes-canvas-inner',
                  style: {
                    transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
                  },
                },
                h(
                  'svg',
                  { className: 'agnes-edges', width: 6000, height: 4000 },
                  ...edges.map((edge) => {
                    const from = nodeById.get(edge.from)
                    const to = nodeById.get(edge.to)
                    if (!from || !to) return null
                    const x1 = from.x + NODE_W
                    const y1 = from.y + 60
                    const x2 = to.x
                    const y2 = to.y + 60
                    const mid = (x1 + x2) / 2
                    return h(
                      'g',
                      { key: edge.id },
                      h('path', {
                        d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
                        fill: 'none',
                        stroke: edge.autoFrame ? '#2563eb' : 'rgba(127,127,127,.6)',
                        strokeWidth: 2,
                        strokeDasharray: edge.autoFrame ? 'none' : '6 4',
                      }),
                      h('circle', { cx: x2, cy: y2, r: 3, fill: edge.autoFrame ? '#2563eb' : '#888' }),
                    )
                  }),
                ),
                ...nodes.map((node) => {
                  const shot = shots.find((entry) => entry.id === node.id)
                  if (!shot) return null
                  return h(
                    'div',
                    {
                      key: node.id,
                      className: 'agnes-node',
                      'data-status': shot.status || 'draft',
                      'data-selected': connecting === node.id ? 'true' : 'false',
                      style: { left: node.x, top: node.y, width: NODE_W },
                      onClick: () => {
                        if (connecting && connecting !== shot.id) connectTo(shot.id)
                      },
                    },
                    h(
                      'div',
                      {
                        className: 'agnes-node-head',
                        onPointerDown: (event) => onNodeDown(event, node),
                      },
                      h('b', null, `#${shot.index}`),
                      h('span', { className: 'agnes-node-status' }, t(`status.${shot.status || 'draft'}`)),
                    ),
                    h('div', { className: 'agnes-node-prompt' }, shot.prompt || '—'),
                    shot.assetUrl
                      ? h('video', {
                          className: 'agnes-node-media',
                          src: shot.assetUrl,
                          muted: true,
                          preload: 'metadata',
                        })
                      : null,
                    shot.error || shot.tailError
                      ? h(
                          'div',
                          { className: 'agnes-node-error', title: shot.error || shot.tailError },
                          shot.error || shot.tailError,
                        )
                      : null,
                    h(
                      'div',
                      { className: 'agnes-node-actions' },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'agnes-mini',
                          'data-active': connecting === shot.id ? 'true' : 'false',
                          onClick: (event) => {
                            event.stopPropagation()
                            setConnecting(connecting === shot.id ? '' : shot.id)
                          },
                        },
                        t('canvas.connect'),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'agnes-mini', onClick: () => runFrom(shot.id) },
                        t('canvas.runFrom'),
                      ),
                      shot.status === 'running' && shot.taskId
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'agnes-mini',
                              onClick: (event) => {
                                event.stopPropagation()
                                cancelShotTask(shot).catch(() => {})
                              },
                            },
                            t('action.cancelTask'),
                          )
                        : null,
                      h(
                        'button',
                        { type: 'button', className: 'agnes-mini', onClick: () => pickFirstFrame(shot.id) },
                        t('canvas.firstFrame'),
                      ),
                      h(
                        'button',
                        { type: 'button', className: 'agnes-mini', onClick: () => removeShot(shot.id) },
                        '×',
                      ),
                    ),
                    h('button', {
                      type: 'button',
                      className: 'agnes-port agnes-port-in',
                      title: t('canvas.connect'),
                      onClick: (event) => {
                        event.stopPropagation()
                        connectTo(node.id)
                      },
                    }),
                    h('button', {
                      type: 'button',
                      className: 'agnes-port agnes-port-out',
                      title: t('canvas.connect'),
                      onClick: (event) => {
                        event.stopPropagation()
                        setConnecting(connecting === node.id ? '' : node.id)
                      },
                    }),
                  )
                }),
              ),
        ),
        h(
          'div',
          { className: 'agnes-view-hint' },
          connecting ? t('canvas.connecting') : '',
          chain && chain.running ? ` · ${t('action.generating')}` : '',
        ),
      )
    }

    function DramaView({ t }) {
      const [projects, setProjects] = useState([])
      const [projectId, setProjectId] = useState('')
      const [detail, setDetail] = useState(null)
      const [selected, setSelected] = useState('')
      const [draft, setDraft] = useState(null)
      const [newName, setNewName] = useState('')
      const [error, setError] = useState('')
      const [saving, setSaving] = useState(false)

      const shots = detail ? detail.shots || [] : []
      const chain = detail && detail.project ? detail.project.chain : null
      const selectedShot = shots.find((shot) => shot.id === selected)

      useEffect(() => {
        loadProjects()
          .then((list) => {
            setProjects(list)
            if (list[0]) setProjectId((current) => current || list[0].id)
          })
          .catch((err) => setError(String(err)))
      }, [])

      useEffect(() => {
        if (!projectId) return undefined
        let alive = true
        loadProjectDetail(projectId)
          .then((data) => {
            if (!alive) return
            setDetail(data)
            if (!data.shots.some((shot) => shot.id === selected) && data.shots[0]) {
              setSelected(data.shots[0].id)
            }
          })
          .catch((err) => {
            if (alive) setError(String(err))
          })
        return () => {
          alive = false
        }
      }, [projectId])

      const pending = Boolean(
        detail && (chain?.running || shots.some((shot) => shot.status === 'running' || shot.status === 'queued')),
      )
      useEffect(() => {
        if (!projectId || !pending) return undefined
        const timer = setInterval(() => {
          loadProjectDetail(projectId)
            .then((data) => setDetail(data))
            .catch(() => {})
        }, 2500)
        return () => clearInterval(timer)
      }, [projectId, pending])

      useEffect(() => {
        if (!selectedShot) {
          setDraft(null)
          return
        }
        setDraft({
          prompt: selectedShot.prompt || '',
          duration: selectedShot.duration || 5,
          camera: selectedShot.camera || '',
          continuity: (selectedShot.context && selectedShot.context.continuity) || '',
        })
      }, [selected])

      const reload = useCallback(async () => {
        if (!projectId) return
        const data = await loadProjectDetail(projectId)
        setDetail(data)
        return data
      }, [projectId])

      const createProject = async (name) => {
        try {
          const data = await postJson('/projects', { name: name || '未命名项目' })
          const list = await loadProjects()
          setProjects(list)
          setProjectId(data.project.id)
          setNewName('')
        } catch (err) {
          setError(String(err))
        }
      }

      const addShot = async () => {
        if (!projectId) return
        try {
          const data = await addShotApi(projectId, { prompt: '新镜头' })
          await reload()
          if (data.shot) setSelected(data.shot.id)
        } catch (err) {
          setError(String(err))
        }
      }

      const saveShot = async () => {
        if (!projectId || !selectedShot || !draft) return
        setSaving(true)
        try {
          await patchShotApi(projectId, selectedShot.id, {
            prompt: draft.prompt,
            duration: Number(draft.duration) || 5,
            camera: draft.camera,
            context: { continuity: draft.continuity },
          })
          await reload()
          setError('')
        } catch (err) {
          setError(String(err))
        } finally {
          setSaving(false)
        }
      }

      const runAll = async () => {
        if (!projectId) return
        try {
          await runChainApi(projectId, { shotIds: shots.map((shot) => shot.id) })
          setError('')
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const cancelChain = async () => {
        if (!projectId) return
        try {
          await cancelChainApi(projectId)
          setError('')
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const cancelShotTask = async (shot) => {
        if (!shot || !shot.taskId) return
        try {
          await cancelTaskApi(shot.taskId)
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const runFrom = async () => {
        if (!projectId || !selectedShot) return
        try {
          await runChainApi(projectId, { from: selectedShot.id })
          setError('')
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const total = shots.reduce((sum, shot) => sum + (Number(shot.duration) || 0), 0)

      return h(
        'div',
        { className: 'agnes-view' },
        h(ProjectToolbar, {
          t,
          projects,
          projectId,
          onPick: setProjectId,
          onCreate: createProject,
          newName,
          setNewName,
          extra: [
            h(
              'button',
              { key: 'add', type: 'button', className: 'agnes-button agnes-ghost', onClick: addShot },
              t('drama.addShot'),
            ),
            h(
              'button',
              {
                key: 'run',
                type: 'button',
                className: 'agnes-button agnes-primary',
                disabled: !shots.length || Boolean(chain?.running),
                onClick: runAll,
              },
              chain?.running ? t('action.generating') : t('drama.runAll'),
            ),
            chain?.running
              ? h(
                  'button',
                  {
                    key: 'cancelChain',
                    type: 'button',
                    className: 'agnes-button agnes-ghost',
                    onClick: cancelChain,
                  },
                  t('action.cancelChain'),
                )
              : null,
            h(
              'button',
              {
                key: 'from',
                type: 'button',
                className: 'agnes-button agnes-ghost',
                disabled: !selectedShot || Boolean(chain?.running),
                onClick: runFrom,
              },
              t('drama.runFrom'),
            ),
          ],
        }),
        h('div', { className: 'agnes-view-hint' }, t('drama.hint')),
        error ? h('div', { className: 'agnes-error' }, error) : null,
        chain && chain.error ? h('div', { className: 'agnes-error' }, chain.error) : null,
        shots.length === 0
          ? h('div', { className: 'agnes-empty' }, h('b', null, t('drama.empty')))
          : h(
              'div',
              { className: 'agnes-drama' },
              h(
                'div',
                { className: 'agnes-drama-list' },
                ...shots.map((shot) =>
                  h(
                    'button',
                    {
                      key: shot.id,
                      type: 'button',
                      className: 'agnes-drama-row',
                      'data-active': shot.id === selected ? 'true' : 'false',
                      onClick: () => setSelected(shot.id),
                    },
                    h('b', null, `#${shot.index}`),
                    h('span', { className: 'agnes-drama-row-status', 'data-status': shot.status }, t(`status.${shot.status || 'draft'}`)),
                    h('span', { className: 'agnes-drama-row-prompt' }, shot.prompt || '—'),
                    h(
                      'span',
                      { className: 'agnes-drama-row-duration' },
                      shot.status === 'running' && shot.taskId
                        ? h(
                            'span',
                            {
                              className: 'agnes-mini',
                              role: 'button',
                              tabIndex: -1,
                              onClick: (event) => {
                                event.stopPropagation()
                                cancelShotTask(shot).catch(() => {})
                              },
                            },
                            t('action.cancelTask'),
                          )
                        : `${shot.duration || 5}${t('note.seconds')}`,
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'agnes-drama-detail' },
                draft
                  ? h(
                      'div',
                      { className: 'agnes-card' },
                      h('label', { className: 'agnes-label' }, t('drama.prompt')),
                      h('textarea', {
                        className: 'agnes-textarea',
                        style: { minHeight: '84px' },
                        value: draft.prompt,
                        onChange: (event) => setDraft({ ...draft, prompt: event.target.value }),
                      }),
                      h(
                        'div',
                        { className: 'agnes-row' },
                        h(
                          'div',
                          null,
                          h('label', { className: 'agnes-label' }, t('drama.duration')),
                          h(
                            'select',
                            {
                              className: 'agnes-select',
                              value: String(draft.duration),
                              onChange: (event) => setDraft({ ...draft, duration: Number(event.target.value) }),
                            },
                            ...[4, 5, 6, 8, 10, 12].map((value) =>
                              h('option', { key: value, value: String(value) }, `${value}${t('note.seconds')}`),
                            ),
                          ),
                        ),
                        h(
                          'div',
                          null,
                          h('label', { className: 'agnes-label' }, t('drama.camera')),
                          h('input', {
                            className: 'agnes-input',
                            value: draft.camera,
                            onChange: (event) => setDraft({ ...draft, camera: event.target.value }),
                          }),
                        ),
                      ),
                      h('label', { className: 'agnes-label', style: { marginTop: '10px' } }, t('drama.continuity')),
                      h('input', {
                        className: 'agnes-input',
                        value: draft.continuity,
                        onChange: (event) => setDraft({ ...draft, continuity: event.target.value }),
                      }),
                      h(
                        'div',
                        { className: 'agnes-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'agnes-button agnes-primary',
                            disabled: saving,
                            onClick: saveShot,
                          },
                          t('action.save'),
                        ),
                      ),
                    )
                  : null,
                selectedShot && selectedShot.assetUrl
                  ? h(
                      'div',
                      { className: 'agnes-card' },
                      h('label', { className: 'agnes-label' }, t('drama.preview')),
                      h('video', {
                        className: 'agnes-media',
                        src: selectedShot.assetUrl,
                        controls: true,
                        loop: true,
                        style: { maxHeight: '300px' },
                      }),
                    )
                  : null,
                h(
                  'div',
                  { className: 'agnes-card' },
                  h('label', { className: 'agnes-label' }, `${t('drama.timeline')} · ${t('drama.total')} ${total}${t('note.seconds')}`),
                  h(
                    'div',
                    { className: 'agnes-timeline' },
                    ...shots.map((shot) =>
                      h('span', {
                        key: shot.id,
                        className: 'agnes-timeline-clip',
                        'data-status': shot.status,
                        style: { flexGrow: Math.max(1, Number(shot.duration) || 5) },
                        title: shot.prompt || '',
                      }),
                    ),
                  ),
                ),
              ),
            ),
      )
    }

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

      const cancelActive = useCallback(async () => {
        const id = activeRef.current
        if (!id) return
        try {
          await cancelTaskApi(id)
          activeRef.current = null
          setBusy(false)
          setPhase('')
          setNote('')
          await refresh()
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }, [refresh])

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
            h(
              'button',
              {
                type: 'button',
                className: 'agnes-tab',
                'data-active': tab === 'canvas' ? 'true' : 'false',
                onClick: () => setTab('canvas'),
              },
              t('tab.canvas'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'agnes-tab',
                'data-active': tab === 'drama' ? 'true' : 'false',
                onClick: () => setTab('drama'),
              },
              t('tab.drama'),
            ),
          ),
          tab === 'canvas'
            ? h(ViewBoundary, { key: 'canvas' }, h(CanvasView, { t }))
            : tab === 'drama'
              ? h(ViewBoundary, { key: 'drama' }, h(DramaView, { t }))
              : h(
                  React.Fragment,
                  null,
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
                  busy
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'agnes-button agnes-ghost',
                          onClick: () => cancelActive(),
                        },
                        t('action.cancelTask'),
                      )
                    : null,
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
                        'span',
                        {
                          className: 'agnes-thumb-del',
                          role: 'button',
                          tabIndex: -1,
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
            (owner) =>
              h(
                ViewBoundary,
                { key: PANEL_ID },
                h(Page, { t: owner && owner.t ? owner.t : t }),
              ),
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
