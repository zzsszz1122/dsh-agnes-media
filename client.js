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
      'status.keyHintTitle': '当前实际使用的令牌指纹，可与 Agnes 控制台里的 Key 对照（不会显示完整密钥）',
      'status.keyCleaned': '检测到令牌里有多余的空格、换行或引号，已自动清理后再发送。',
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
      'canvas.deleteProject': '删除项目',
      'canvas.deleteProjectConfirm': '确认删除当前项目？其全部镜头、角色与素材都会被删除，且不可恢复。',
      'action.confirmDelete': '确认删除',
      'canvas.deleteProjectHint': '删除当前项目及其全部镜头、角色与素材（不可恢复）',
      'ctx.delete': '删除',
      'ctx.confirmDelete': '再点一次确认删除',
      'ctx.rightClickHint': '右键可删除该镜头',
      'canvas.addShot': '添加镜头',
      'canvas.runAll': '生成链路',
      'canvas.runFrom': '从此镜续跑',
      'canvas.connect': '连线',
      'canvas.connecting': '选择目标镜头…',
      'canvas.firstFrame': '上传首帧',
      'canvas.ffmpegMissing': 'ffmpeg 未安装，尾帧无法自动抽取',
      'canvas.empty': '还没有镜头，点「添加镜头」开始；也可以把视频/图片从资源管理器拖进来',
      'canvas.imported': '导入',
      'canvas.unsupported': '只支持拖入视频或图片',
      'canvas.dropHint': '松开即可导入到画布',
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
      'drama.import': '剧本导入',
      'drama.export': '合成导出',
      'drama.exporting': '合成中…',
      'drama.scriptPlaceholder': '粘贴剧本：每行一句；用「1. / #1」分镜、用「第X集 / 场…」分集分场',
      'drama.scriptReplace': '导入将替换当前所有镜头',
      'drama.doImport': '解析并导入',
      'drama.downloaded': '成片已生成',
      'drama.clips': '片段',
      'action.save': '保存',
      'action.cancel': '取消',
      'action.refreshList': '刷新',
      'status.draft': '草稿',
      'status.blocked': '被阻塞',
      'status.ready': '已完成',
      'status.cancelled': '已取消',
      'action.cancelTask': '取消任务',
      'action.cancelChain': '取消链路',
      'pane.shots': '镜头',
      'pane.cast': '角色',
      'pane.storyboard': '静帧审片',
      'cast.create': '新建角色',
      'cast.name': '角色名',
      'cast.aliases': '别名（逗号分隔）',
      'cast.look': '外观描述（文本兜底，会拼进提示词）',
      'cast.add': '添加角色',
      'cast.empty': '还没有角色。角色用于生成参考图并锁定人物。',
      'cast.locked': '已锁脸',
      'cast.unlocked': '未锁脸',
      'cast.refs': '张参考图',
      'cast.front': '正视图',
      'cast.side': '侧视图',
      'cast.back': '背视图',
      'cast.setUrl': '设置公网 URL',
      'cast.inShot': '本镜出场角色',
      'ref.fromShots': '参考前面的镜头',
      'ref.hint': '选中后优先用该镜的静帧/尾帧作为本镜首帧；● 表示已生成',
      'cast.urlPrompt': '粘贴公网可访问的 HTTPS 图片地址（参考模式必需）',
      'cast.clearUrl': '清除 URL',
      'cast.lockHint': '锁脸需要至少一张公网 HTTPS 参考图；本地图片无法被上游读取',
      'cast.lockScope': '锁定范围：只对本镜「出场角色」中勾选的角色生效',
      'cast.nameRequired': '角色名不能为空',
      'story.hint': '先生成静帧审片：便宜、快；通过后再生成视频。',
      'story.generate': '生成静帧',
      'story.approve': '通过',
      'story.reject': '打回',
      'story.none': '还没有静帧',
      'drama.blockedHint': '以下镜头无法锁定人物，链路已阻止启动：',
      'drama.blockedOptions': '三种解决方式（不需要重新上传视频）：给角色填一张公网图 → 点「去角色」；或给该镜生成并批准静帧 → 去「静帧审片」；也可以直接不锁脸生成。',
      'drama.goCast': '去角色',
      'drama.runAnyway': '不锁脸，仍然生成',
      'lock.reference': '参考锁脸',
      'lock.keyframe': '首帧锁定',
      'lock.text': '仅文本（未锁脸）',
      'status.pending-review': '待审片',
      'status.approved': '已批准',
      'status.storyboard': '静帧生成中',
      // ---- composer entry (the first nav item) ----
      'home.title': '今天，你想创造什么？',
      'home.placeholder':
        '上传参考素材、输入文字，自由组合图、文、视频多元素，定义精彩互动。例如:@图片1模仿@视频1的动作',
      'home.add': '添加素材',
      'home.add.library': '从资产库添加',
      'home.add.local': '本地上传',
      'home.add.hint': '支持 png / jpeg / webp，单张不超过 16MB',
      'home.assets.empty': '资产库里还没有图片，先用「本地上传」或生成一张。',
      'home.assets.hint': '选用历史里已生成的图片作为首帧',
      'home.mode.video': '视频生成',
      'home.mode.image': '图片生成',
      'home.compose.auto': '全能模式',
      'home.compose.reference': '参考模式',
      'home.compose.keyframe': '首帧模式',
      'home.compose.text': '纯文本',
      'home.compose.auto.hint': '首帧锁开场，其余素材作参考图；点素材标签可互换',
      'home.compose.reference.hint': '全部素材作为参考图（最多 4 张），不占用首帧',
      'home.compose.keyframe.hint': '必须添加一张图片作首帧',
      'home.compose.text.hint': '忽略素材，只按文字生成',
      'home.compose.required': '首帧模式需要先添加一张图片作首帧。',
      'home.compose.needReference': '参考模式至少要添加一张参考图。',
      'home.tagToggle': '点开选择用途：首帧 / 参考',
      'home.mention.hint': '把素材引用到提示词里，序号与缩略图一致',
      'home.refDropped': '上游未接受参考图，本条已按降级模式生成：{reason}',
      'home.refSkipped': '有参考图超过 4MB，已跳过内联；建议裁成脸部小图再传',
      'home.model.title': '当前模型',
      'home.model.upstream': '上游地址',
      'home.model.key': '密钥',
      'home.model.route': '提交接口',
      'home.duration': '时长',
      'home.size': '分辨率',
      'home.duration.auto': 'Auto',
      'home.mention': '引用素材',
      'home.mention.empty': '先添加素材，才能用 @ 引用。',
      'home.submit': '生成',
      'home.frame': '首帧',
      'home.reference': '参考',
      'home.role.choose': '待选',
      'home.role.title': '这张图怎么用？',
      'home.role.frameDesc': '从这张图开始：锁定第 0 秒的构图、姿态与光线，之后的镜头不再受它约束',
      'home.role.referenceDesc': '整段参考它的外观：人物长相、配色、道具与风格，但不决定开场画面',
      'home.role.diff': '一句话：首帧管「怎么开始」，参考管「像不像」。随时点标签可改。',
      'home.role.pending': '有素材还没指定用途：点素材上的标签选「首帧」或「参考」。',
      'home.remove': '移除素材',
      'home.uploadFail': '读取图片失败：{name}',
      'home.tip': '任务在后台排队，切走或刷新都不会丢',
      'home.assetFallback': '资产图',
      'home.mentionToken': '图片',
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
      'status.keyHintTitle': 'Fingerprint of the token actually in use — compare it with the key in your Agnes console (the full key is never shown)',
      'status.keyCleaned': 'The stored token contained stray spaces, newlines or quotes; it was cleaned before being sent.',
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
      'canvas.deleteProject': 'Delete project',
      'canvas.deleteProjectConfirm': 'Delete this project? All its shots, characters and assets go with it, and this cannot be undone.',
      'action.confirmDelete': 'Delete',
      'canvas.deleteProjectHint': 'Deletes this project with all its shots, characters and assets (cannot be undone)',
      'ctx.delete': 'Delete',
      'ctx.confirmDelete': 'Click again to confirm',
      'ctx.rightClickHint': 'Right-click to delete this shot',
      'canvas.addShot': 'Add shot',
      'canvas.runAll': 'Run chain',
      'canvas.runFrom': 'Continue from here',
      'canvas.connect': 'Connect',
      'canvas.connecting': 'Pick a target shot…',
      'canvas.firstFrame': 'Upload first frame',
      'canvas.ffmpegMissing': 'ffmpeg is missing; tail frames cannot be extracted',
      'canvas.empty': 'No shots yet — press “Add shot”, or drag a video or image here',
      'canvas.imported': 'Imported',
      'canvas.unsupported': 'Only video or image files can be dropped',
      'canvas.dropHint': 'Release to import onto the canvas',
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
      'drama.import': 'Import script',
      'drama.export': 'Assemble',
      'drama.exporting': 'Assembling…',
      'drama.scriptPlaceholder': 'Paste a script: one line each; use "1. / #1" for shots, "EP01 / 第X集 / 场…" for episodes and scenes',
      'drama.scriptReplace': 'Importing replaces every current shot',
      'drama.doImport': 'Parse & import',
      'drama.downloaded': 'Episode rendered',
      'drama.clips': 'clips',
      'action.save': 'Save',
      'action.cancel': 'Cancel',
      'action.refreshList': 'Refresh',
      'status.draft': 'Draft',
      'status.blocked': 'Blocked',
      'status.ready': 'Done',
      'status.cancelled': 'Cancelled',
      'action.cancelTask': 'Cancel task',
      'action.cancelChain': 'Cancel chain',
      'pane.shots': 'Shots',
      'pane.cast': 'Cast',
      'pane.storyboard': 'Storyboard',
      'cast.create': 'New character',
      'cast.name': 'Name',
      'cast.aliases': 'Aliases (comma separated)',
      'cast.look': 'Look (text fallback, injected into prompts)',
      'cast.add': 'Add character',
      'cast.empty': 'No characters yet. A character provides reference images that lock identity.',
      'cast.locked': 'Identity locked',
      'cast.unlocked': 'Not locked',
      'cast.refs': 'refs',
      'cast.front': 'Front',
      'cast.side': 'Side',
      'cast.back': 'Back',
      'cast.setUrl': 'Set public URL',
      'cast.inShot': 'Characters in this shot',
      'ref.fromShots': 'Reference earlier shots',
      'ref.hint': 'The selected shot supplies this one\'s first frame (still or tail); ● means rendered',
      'cast.urlPrompt': 'Paste a publicly reachable HTTPS image URL (required by reference mode)',
      'cast.clearUrl': 'Clear URL',
      'cast.lockHint': 'Locking needs at least one public HTTPS reference image; the upstream cannot read local files',
      'cast.lockScope': 'Scope: only characters selected under "characters in this shot" are locked',
      'cast.nameRequired': 'Character name is required',
      'story.hint': 'Render stills first: they are cheap and fast. Approve them before spending on video.',
      'story.generate': 'Render still',
      'story.approve': 'Approve',
      'story.reject': 'Reject',
      'story.none': 'No still yet',
      'drama.blockedHint': 'These shots cannot lock identity; the chain was not started:',
      'drama.blockedOptions': 'Three fixes (no re-upload of video needed): give the character a public image URL ("Go to cast"); or render and approve a still for that shot ("Storyboard"); or generate anyway without locking.',
      'drama.goCast': 'Go to cast',
      'drama.runAnyway': 'Generate without locking',
      'lock.reference': 'Reference lock',
      'lock.keyframe': 'Keyframe lock',
      'lock.text': 'Text only (unlocked)',
      'status.pending-review': 'In review',
      'status.approved': 'Approved',
      'status.storyboard': 'Rendering still',
      // ---- composer entry (the first nav item) ----
      'home.title': 'What will you create today?',
      'home.placeholder':
        'Upload references, type text, and combine image, text or video elements. Example: @image1 mimics the motion of @video1',
      'home.add': 'Add reference',
      'home.add.library': 'From library',
      'home.add.local': 'Upload from device',
      'home.add.hint': 'png / jpeg / webp, up to 16MB each',
      'home.assets.empty': 'No images in the library yet — upload one or generate one first.',
      'home.assets.hint': 'Use an image already in history as the first frame',
      'home.mode.video': 'Video',
      'home.mode.image': 'Image',
      'home.compose.auto': 'Versatile',
      'home.compose.reference': 'Reference',
      'home.compose.keyframe': 'First frame',
      'home.compose.text': 'Text only',
      'home.compose.auto.hint': 'The first frame anchors the opening, the rest condition the look; click a tag to swap',
      'home.compose.reference.hint': 'Every attachment is a reference image (up to four); no keyframe is used',
      'home.compose.keyframe.hint': 'Requires one image as the first frame',
      'home.compose.text.hint': 'Ignores references, generates from text',
      'home.compose.required': 'First-frame mode needs an image reference.',
      'home.compose.needReference': 'Reference mode needs at least one reference image.',
      'home.tagToggle': 'Open the role picker: first frame or reference',
      'home.mention.hint': 'Cite an attachment in the prompt; the number matches its thumbnail',
      'home.refDropped': 'The renderer refused the reference images; this clip used a fallback: {reason}',
      'home.refSkipped': 'A reference was larger than 4MB and was left out; crop it to the face and retry',
      'home.model.title': 'Current model',
      'home.model.upstream': 'Upstream',
      'home.model.key': 'Key',
      'home.model.route': 'Submit route',
      'home.duration': 'Duration',
      'home.size': 'Resolution',
      'home.duration.auto': 'Auto',
      'home.mention': 'Reference a material',
      'home.mention.empty': 'Add a reference first, then use @ to cite it.',
      'home.submit': 'Generate',
      'home.frame': 'First frame',
      'home.reference': 'Reference',
      'home.role.choose': 'Choose',
      'home.role.title': 'How should this image be used?',
      'home.role.frameDesc': 'The clip starts here: locks the opening framing, pose and light. Later shots are not bound by it',
      'home.role.referenceDesc': 'Conditions the whole clip: face, palette, props and style. Does not decide the opening frame',
      'home.role.diff': 'In one line: the first frame decides how it starts, a reference decides what it looks like. Click the tag to change any time.',
      'home.role.pending': 'An attachment has no role yet: click its tag and pick First frame or Reference.',
      'home.remove': 'Remove reference',
      'home.uploadFail': 'Could not read image: {name}',
      'home.tip': 'Tasks queue in the background; switching away or reloading will not lose them',
      'home.assetFallback': 'Asset',
      'home.mentionToken': 'image',
    }

    const IMAGE_SIZES = ['1024x1024', '1024x768', '768x1024', '1280x720', '720x1280', '1536x1536', '2048x2048']
    const VIDEO_SIZES = ['720P', '1080P']
    const VIDEO_SECONDS = ['5', '10', '15', '20', '25', '30']

    /** Read a dropped File into a data URI without touching the DOM elsewhere. */
    function readFileAsDataUri(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error(`读取失败：${file.name}`))
        reader.readAsDataURL(file)
      })
    }

    async function readJsonResponse(response) {
      let data = {}
      try {
        data = await response.json()
      } catch {
        /* the HTTP status is the only fact left */
      }
      if (!response.ok || (data && data.ok === false)) {
        const error = new Error(data && data.error ? String(data.error) : `HTTP ${response.status}`)
        error.status = response.status
        if (Array.isArray(data?.blockers)) error.blockers = data.blockers
        throw error
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

    /**
     * Composer glyphs. The reference design leans on a handful of 16px outline
     * icons inside its toolbar; they are inlined so the panel stays a single
     * file and never blocks on a webfont or sprite request.
     */
    const GLYPHS = {
      plus: [['path', { d: 'M12 5v14M5 12h14' }]],
      film: [
        ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 3 }],
        ['path', { d: 'M7.5 5v14M16.5 5v14M3 10h4.5M16.5 10H21M3 14h4.5M16.5 14H21' }],
      ],
      chevron: [['path', { d: 'm6 9 6 6 6-6' }]],
      sparkle: [['path', { d: 'M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9z' }]],
      at: [
        ['circle', { cx: 12, cy: 12, r: 3.8 }],
        ['path', { d: 'M15.8 8.2V13a2.8 2.8 0 0 0 5.6 0v-1a9.4 9.4 0 1 0-3.3 7.2' }],
      ],
      upload: [
        ['path', { d: 'M12 15.5V4m0 0L8 8m4-4 4 4' }],
        ['path', { d: 'M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16' }],
      ],
      image: [
        ['rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 3 }],
        ['circle', { cx: 9, cy: 10, r: 1.5 }],
        ['path', { d: 'm5 18 4.5-4.5L13 17l2.6-2.6L19 18' }],
      ],
      layers: [
        ['path', { d: 'm12 3 8.5 4.5L12 12 3.5 7.5 12 3z' }],
        ['path', { d: 'm4 12.5 8 4.3 8-4.3M4 17l8 4.3 8-4.3' }],
      ],
    }

    function Glyph(props) {
      const name = (props && props.name) || 'plus'
      const size = (props && props.size) || 14
      const paths = GLYPHS[name] || GLYPHS.plus
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block', flex: 'none' },
        },
        ...paths.map(([tag, attrs], index) => h(tag, { key: index, ...attrs })),
      )
    }

    /**
     * `agnes-video-2.5-flash` reads badly on a chip; the panel shows the label
     * the Agnes console uses. Unknown ids are title-cased rather than hidden so
     * a misconfigured model is still visible.
     */
    function prettyModel(id) {
      const raw = String(id || '').trim()
      if (!raw) return '—'
      return raw
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
        .join(' ')
    }

    /** Absolute https URL — the only kind the renderer can fetch by itself. */
    function isHttpsUrl(value) {
      try {
        return new URL(String(value || '').trim()).protocol === 'https:'
      } catch {
        return false
      }
    }

    const APP_IMAGE_MIMES = new RegExp('^image/(png|jpeg|jpg|webp)$', 'i')

    const STYLES = `
      .agnes-root{display:flex;flex-direction:column;height:100%;min-height:480px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);overflow:hidden;--agnes-accent:#2563eb;--agnes-accent-strong:#1d4ed8;--agnes-accent-soft:rgba(37,99,235,.10);--agnes-accent-line:rgba(37,99,235,.45)}
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
      /* The composer entry takes the full width; the result card stacks under it. */
      .agnes-grid.agnes-grid-single{grid-template-columns:minmax(0,1fr)}
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
      .agnes-error-panel{align-items:center;justify-content:space-between;flex-wrap:wrap}
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
      .agnes-result-prompt{display:block;width:100%;max-width:100%;box-sizing:border-box;max-height:72px;overflow-y:auto;overflow-x:hidden;white-space:pre-wrap;word-break:break-word;line-height:1.5;font-size:11.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 8px;scrollbar-width:thin;overscroll-behavior:contain}
      .agnes-result-prompt::-webkit-scrollbar{width:8px}
      .agnes-result-prompt::-webkit-scrollbar-thumb{background:rgba(127,127,127,.45);border-radius:4px}
      .agnes-result-prompt::-webkit-scrollbar-track{background:transparent}
      .agnes-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;word-break:break-all}
      .agnes-view{display:flex;flex-direction:column;gap:10px}
      .agnes-projbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .agnes-view-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary);min-height:16px}
      .agnes-canvas{position:relative;height:min(62vh,560px);min-height:360px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);touch-action:none;cursor:grab}
      .agnes-canvas-inner{position:absolute;left:0;top:0;transform-origin:0 0;background-image:radial-gradient(rgba(127,127,127,.18) 1px, transparent 1px);background-size:24px 24px}
      .agnes-canvas-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
      .agnes-canvas[data-drag="true"]{outline:2px dashed #2563eb;outline-offset:-6px}
      .agnes-canvas[data-drag="true"]::after{content:'';position:absolute;inset:0;background:rgba(37,99,235,.08);pointer-events:none}
      .agnes-node-media video,.agnes-node-media img.agnes-node-media{width:100%;display:block;border-radius:8px;background:#000}
      .agnes-node-media{border-left:3px solid #8b5cf6}
      .agnes-node-media .agnes-node-head{color:#8b5cf6}
      .agnes-edges{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
      .agnes-node{position:absolute;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;box-shadow:var(--dsw-shadow-lv1,none)}
      .agnes-node[data-selected="true"]{border-color:#2563eb;box-shadow:0 0 0 1px #2563eb}
      .agnes-node[data-status="failed"]{border-color:rgba(239,68,68,.7)}
      .agnes-node[data-status="ready"]{border-color:rgba(34,197,94,.55)}
      .agnes-node-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;cursor:grab;user-select:none}
      .agnes-node-status{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
      .agnes-node[data-status="failed"] .agnes-node-status{color:#ef4444}
      .agnes-node[data-status="ready"] .agnes-node-status{color:#22c55e}
      .agnes-node-prompt{font-size:11.5px;line-height:1.4;color:var(--dsw-alias-label-secondary);max-height:44px;overflow-y:auto;overflow-x:hidden;white-space:pre-wrap;word-break:break-word;scrollbar-width:thin;overscroll-behavior:contain}
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
      .agnes-drama-row{display:grid;grid-template-columns:36px 54px 1fr auto;gap:6px;align-items:center;text-align:left;padding:7px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:11.5px}
      .agnes-drama-row[data-active="true"]{border-color:#2563eb;background:rgba(37,99,235,.08)}
      .agnes-drama-row-status{font-size:10px;color:var(--dsw-alias-label-secondary)}
      .agnes-drama-row-status[data-status="ready"]{color:#22c55e}
      .agnes-drama-row-status[data-status="failed"]{color:#ef4444}
      .agnes-drama-row-prompt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
      .agnes-ctx-backdrop{position:fixed;inset:0;z-index:60}
      .agnes-ctx{position:fixed;min-width:170px;padding:6px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 28px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:4px}
      .agnes-ctx-title{padding:3px 8px 5px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:2px}
      .agnes-ctx-item{display:block;width:100%;text-align:left;padding:7px 9px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;cursor:pointer}
      .agnes-ctx-item:hover{background:rgba(127,127,127,.14)}
      .agnes-ctx-danger{color:#fff;background:#dc2626}
      .agnes-ctx-danger:hover{background:#b91c1c}
      .agnes-button.agnes-danger{background:#dc2626;border-color:#dc2626;color:#fff}
      .agnes-button.agnes-danger:hover{background:#b91c1c;border-color:#b91c1c}
      .agnes-confirmbar{display:flex;align-items:center;gap:8px;margin:8px 0 2px;padding:9px 12px;border-radius:10px;border:1px solid #dc2626;background:rgba(220,38,38,.10);color:var(--dsw-alias-label-primary);font-size:12px}
      .agnes-confirmbar>span{flex:1;min-width:0}
      .agnes-drama-row-duration{font-size:10px;color:var(--dsw-alias-label-secondary);text-align:right;white-space:nowrap}
      .agnes-drama-cancel{display:inline-block;white-space:nowrap;padding:3px 8px;border-radius:6px;border:1px solid rgba(59,130,246,.5);background:rgba(59,130,246,.14);color:#3b82f6;font-family:inherit;font-size:11px;font-weight:600;line-height:1.4;text-align:center;cursor:pointer;vertical-align:middle}
      .agnes-drama-cancel:hover{background:rgba(59,130,246,.24);border-color:rgba(59,130,246,.75)}
      .agnes-drama-cancel:active{background:rgba(59,130,246,.34)}
      .agnes-drama-detail{display:flex;flex-direction:column;gap:12px;min-width:0}
      .agnes-timeline{display:flex;gap:3px;height:36px;margin-top:4px}
      .agnes-timeline-clip{flex-basis:0;border-radius:5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
      .agnes-timeline-clip[data-status="ready"]{background:rgba(34,197,94,.35)}
      .agnes-timeline-clip[data-status="failed"]{background:rgba(239,68,68,.35)}
      .agnes-timeline-clip[data-status="running"]{background:rgba(37,99,235,.35)}
      .agnes-cast-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
      .agnes-cast-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12.5px}
      .agnes-cast-refs{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}
      .agnes-cast-slot{position:relative;aspect-ratio:3/4;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;overflow:hidden;padding:0;display:flex;align-items:center;justify-content:center}
      .agnes-cast-slot img{width:100%;height:100%;object-fit:cover;display:block}
      .agnes-cast-url{position:absolute;left:2px;bottom:2px;font-size:9px;background:rgba(0,0,0,.65);color:#fff;border-radius:999px;padding:1px 5px;cursor:pointer}
      .agnes-story-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
      .agnes-story-card{display:flex;flex-direction:column;gap:8px}
      .agnes-story-img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;display:block}
      .agnes-story-placeholder{width:100%;aspect-ratio:4/3;border:1px dashed var(--dsw-alias-border-l1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .agnes-story-prompt{font-size:11.5px;color:var(--dsw-alias-label-secondary);max-height:44px;overflow-y:auto;overflow-x:hidden;line-height:1.45;white-space:pre-wrap;word-break:break-word;scrollbar-width:thin;overscroll-behavior:contain}
      .agnes-cast-toggle{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
      .agnes-cast-pill{font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit}
      .agnes-cast-pill[data-active="true"]{border-color:#2563eb;color:#2563eb;background:rgba(37,99,235,.1)}

      /* ---- composer entry: the first nav item ---- */
      .agnes-hero{display:flex;flex-direction:column;align-items:stretch;gap:14px;margin:2px 0 4px}
      .agnes-hero-title{font-size:22px;font-weight:600;letter-spacing:.01em;line-height:1.35;text-align:center;margin:6px 0 2px}
      .agnes-composer{position:relative;width:100%;max-width:900px;margin:0 auto;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:18px;padding:14px 14px 10px;box-shadow:0 8px 26px rgba(0,0,0,.07)}
      .agnes-composer[data-busy="true"]{box-shadow:0 8px 26px rgba(0,0,0,.07),0 0 0 1px var(--agnes-accent-line)}
      .agnes-composer:focus-within{border-color:var(--agnes-accent-line);box-shadow:0 8px 26px rgba(0,0,0,.08),0 0 0 3px var(--agnes-accent-soft)}
      .agnes-composer-input{display:block;width:100%;box-sizing:border-box;min-height:88px;max-height:220px;resize:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.6;outline:none;padding:2px 4px 12px}
      .agnes-composer-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.9}
      .agnes-composer-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:32px}
      .agnes-round{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex:none;padding:0;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:16px;line-height:1}
      .agnes-round:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .agnes-round:disabled{opacity:.5;cursor:default}
      .agnes-pill{display:inline-flex;align-items:center;gap:5px;height:30px;box-sizing:border-box;max-width:230px;padding:0 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
      .agnes-pill>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .agnes-pill:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .agnes-pill:disabled{opacity:.55;cursor:default}
      .agnes-pill[data-open="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .agnes-pill-accent{color:var(--agnes-accent);border-color:var(--agnes-accent-line);background:var(--agnes-accent-soft)}
      .agnes-pill-accent:hover:not(:disabled){color:var(--agnes-accent-strong);background:rgba(37,99,235,.16)}
      .agnes-bar-spacer{flex:1 1 auto;min-width:6px}
      .agnes-send{display:inline-flex;align-items:center;gap:6px;height:32px;flex:none;padding:0 14px;border-radius:999px;border:1px solid var(--agnes-accent);background:var(--agnes-accent);color:#fff;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
      .agnes-send:hover:not(:disabled){background:var(--agnes-accent-strong);border-color:var(--agnes-accent-strong)}
      .agnes-send:disabled{opacity:.5;cursor:default}
      .agnes-send.agnes-send-stop{background:transparent;color:#dc2626;border-color:rgba(220,38,38,.45);font-weight:500}
      .agnes-send.agnes-send-stop:hover{background:rgba(220,38,38,.1);border-color:rgba(220,38,38,.7)}
      .agnes-menu-wrap{position:relative;display:inline-flex;flex:none}
      .agnes-menu{position:absolute;left:0;bottom:calc(100% + 8px);z-index:50;min-width:196px;padding:6px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 14px 34px rgba(0,0,0,.2);display:flex;flex-direction:column;gap:2px}
      .agnes-menu[data-align="end"]{left:auto;right:0}
      .agnes-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 9px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer;white-space:nowrap}
      .agnes-menu-item:hover{background:rgba(127,127,127,.14)}
      .agnes-menu-item[data-active="true"]{color:var(--agnes-accent);font-weight:600;background:var(--agnes-accent-soft)}
      .agnes-menu-item[data-disabled="true"]{color:var(--dsw-alias-label-secondary);cursor:default;opacity:.6}
      .agnes-menu-item img{width:26px;height:26px;flex:none;object-fit:cover;border-radius:6px;background:var(--dsw-alias-bg-layer-2)}
      .agnes-menu-note{padding:3px 9px 6px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:normal;max-width:260px}
      .agnes-menu-sep{height:1px;margin:4px 4px;background:var(--dsw-alias-border-l1)}
      .agnes-menu-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:4px 9px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
      .agnes-menu-row b{font-weight:600;color:var(--dsw-alias-label-primary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .agnes-menu-scroll{max-height:224px;overflow:auto;display:flex;flex-direction:column;gap:2px}
      .agnes-menu-backdrop{position:fixed;inset:0;z-index:45;background:transparent}
      .agnes-attach-row{display:flex;gap:8px;flex-wrap:wrap;padding:0 2px 10px}
      .agnes-attach{position:relative;width:98px;display:flex;flex-direction:column;gap:4px}
      .agnes-attach img{display:block;width:98px;height:66px;object-fit:cover;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:#000}
      .agnes-attach-name{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .agnes-attach-tag{position:absolute;left:4px;bottom:26px;font:inherit;font-size:9.5px;line-height:1.5;padding:0 5px;border:0;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;cursor:pointer}
      .agnes-attach-tag[data-role="reference"]{background:rgba(37,99,235,.82)}
      .agnes-attach-tag[data-role="frame"]{background:rgba(37,99,235,.82)}
      .agnes-attach-tag[data-role="pending"]{background:rgba(186,117,23,.92)}
      .agnes-attach[data-pending="true"] img{outline:2px dashed rgba(186,117,23,.75);outline-offset:1px}
      .agnes-role-inline{display:flex;flex-direction:column;gap:7px;margin:0 2px 10px;padding:10px 11px;border-radius:12px;border:1px solid rgba(186,117,23,.45);background:rgba(186,117,23,.07)}
      .agnes-role-head{display:flex;align-items:baseline;gap:8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
      .agnes-role-name{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
      .agnes-role-cards{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      @media (max-width:720px){.agnes-role-cards{grid-template-columns:1fr}}
      .agnes-role-option{display:flex;flex-direction:column;gap:3px;text-align:left;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
      .agnes-role-option[data-active="true"]{border-color:var(--agnes-accent);box-shadow:0 0 0 1px var(--agnes-accent-line)}
      .agnes-role-option:hover{border-color:var(--agnes-accent);background:var(--agnes-accent-soft)}
      .agnes-role-option b{font-size:12.5px;font-weight:600}
      .agnes-role-option[data-kind="frame"] b{color:#2563eb}
      .agnes-role-option[data-kind="reference"] b{color:var(--agnes-accent)}
      .agnes-role-option span{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:normal}
      .agnes-role-foot{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:normal}
      .agnes-round[data-open="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .agnes-warn{display:flex;gap:8px;align-items:flex-start;border:1px solid rgba(186,117,23,.5);background:rgba(186,117,23,.1);color:#a35b00;border-radius:10px;padding:9px 12px;font-size:12px;line-height:1.5}
      .agnes-attach-del{position:absolute;top:3px;right:3px;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:rgba(0,0,0,.62);color:#fff;font-size:12px;line-height:1;cursor:pointer}
      .agnes-composer-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:8px 4px 0}
      .agnes-composer-hint{font-size:11px;color:var(--dsw-alias-label-secondary)}
      .agnes-composer-actions{display:flex;align-items:center;gap:8px}
      .agnes-hero-examples{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;max-width:900px;margin:0 auto}
      .agnes-composer-progress{margin:10px 4px 0}
      .agnes-stack{display:flex;flex-direction:column;gap:16px;margin-top:18px}
      .agnes-send-count{font-variant-numeric:tabular-nums;opacity:.85}
      /* Accent ink is theme-independent: the blue reads correctly on both the
         light and dark surfaces, so only the shadows need a dark variant. */
      @media (prefers-color-scheme:dark){
        .agnes-composer{box-shadow:0 8px 26px rgba(0,0,0,.38)}
        .agnes-menu{box-shadow:0 14px 34px rgba(0,0,0,.55)}
      }
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
    const deleteProjectApi = (id) => deleteJson(`/projects/${id}`)

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
            { className: 'agnes-error agnes-error-panel' },
            h(
              'span',
              null,
              `视图出错：${String((this.state.error && this.state.error.message) || this.state.error)}`,
            ),
            // A render-time error used to leave the panel permanently dead until
            // a page refresh; this restores it in place.
            h(
              'button',
              {
                type: 'button',
                className: 'agnes-button agnes-ghost',
                onClick: () => this.setState({ error: null }),
              },
              '重新加载视图',
            ),
          )
        }
        return this.props.children
      }
    }

    const NODE_W = 232
    const NODE_H = 168

    function mergeNodes(existing, shots) {
      const byId = new Map((existing || []).map((node) => [node.id, node]))
      const shotIds = new Set((shots || []).map((shot) => shot.id))
      // Imported media nodes are not backed by a shot, so they survive as-is.
      const extras = (existing || []).filter(
        (node) => node && node.type !== 'shot' && !shotIds.has(node.id),
      )
      const shotNodes = (shots || []).map((shot, index) => {
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
      return [...shotNodes, ...extras]
    }

    function statusColor(status) {
      if (status === 'ready' || status === 'approved') return '#22c55e'
      if (status === 'failed' || status === 'blocked') return '#ef4444'
      if (status === 'running' || status === 'storyboard') return '#2563eb'
      if (status === 'pending-review') return '#f59e0b'
      return 'var(--dsw-alias-label-secondary)'
    }

    function ProjectToolbar(props) {
      const { t, projects, projectId, onPick, onCreate, newName, setNewName, extra, onDelete } = props
      // Deleting a project takes its shots, cast and assets with it, so the
      // button arms itself first and only acts on the second click. window.confirm
      // is inert in this WebView, so the confirmation has to live in the UI.
      const [confirming, setConfirming] = useState(false)
      useEffect(() => {
        setConfirming(false)
      }, [projectId])
      return h(
        'div',
        null,
        h(
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
          onDelete && projectId
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'agnes-button agnes-ghost',
                  title: t('canvas.deleteProjectHint'),
                  onClick: () => setConfirming((value) => !value),
                },
                t('canvas.deleteProject'),
              )
            : null,
          ...(extra || []),
        ),
        // An explicit confirm bar rather than a self-arming button: it can be
        // cancelled, and it stays put until answered instead of deleting the
        // project on some unrelated later click.
        confirming && projectId
          ? h(
              'div',
              { className: 'agnes-confirmbar' },
              h('span', null, t('canvas.deleteProjectConfirm')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'agnes-button agnes-danger',
                  onClick: () => {
                    setConfirming(false)
                    onDelete(projectId)
                  },
                },
                t('action.confirmDelete'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'agnes-button agnes-ghost',
                  onClick: () => setConfirming(false),
                },
                t('action.cancel'),
              ),
            )
          : null,
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
      const [dragging, setDragging] = useState(false)
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

      /** Drop files from Explorer onto the canvas: upload, then add a node. */
      const onDrop = async (event) => {
        event.preventDefault()
        setDragging(false)
        if (!projectId) return
        const files = Array.from(event.dataTransfer?.files || [])
        if (files.length === 0) return
        const point = toCanvasPoint(event)
        const next = [...nodes]
        let y = point.y
        for (const file of files) {
          const isVideo = file.type.startsWith('video/')
          const isImage = file.type.startsWith('image/')
          if (!isVideo && !isImage) {
            setError(t('canvas.unsupported'))
            continue
          }
          try {
            const dataUri = await readFileAsDataUri(file)
            const data = await postJson(`/projects/${projectId}/imports`, {
              dataUri,
              name: file.name,
            })
            next.push({
              id: data.asset.id,
              type: 'media',
              x: point.x,
              y,
              data: { ...data.asset, kind: data.asset.kind },
            })
            y += NODE_H + 16
          } catch (err) {
            setError(String(err))
          }
        }
        setNodes(next)
        scheduleSave(next, edges, viewport)
      }

      const removeMediaNode = (nodeId) => {
        const next = nodes.filter((node) => node.id !== nodeId)
        setNodes(next)
        scheduleSave(next, edges, viewport)
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
        // Snapshot the pan origin *before* scheduling the update. The updater
        // runs later, during React's render pass, and by then onAreaUp may have
        // already nulled panRef — reading it inside the updater threw
        // "Cannot read properties of null (reading 'originX')" and took the
        // whole panel down through the error boundary.
        const pan = panRef.current
        if (pan && !dragRef.current) {
          const dx = event.clientX - pan.startX
          const dy = event.clientY - pan.startY
          setViewport((current) => ({ ...current, x: pan.originX + dx, y: pan.originY + dy }))
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

      const removeProject = async (id) => {
        if (!id) return
        try {
          await deleteProjectApi(id)
          const list = await loadProjects()
          setProjects(list)
          if (id === projectId) {
            const next = list[0] ? list[0].id : ''
            setProjectId(next)
            // Clear immediately: leaving stale nodes behind shows a project
            // that no longer exists.
            setDetail(null)
            setNodes([])
            setEdges([])
          }
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
          onDelete: removeProject,
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
            'data-drag': dragging ? 'true' : 'false',
            onDragOver: (event) => {
              if (!event.dataTransfer?.types?.includes('Files')) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
              if (!dragging) setDragging(true)
            },
            onDragLeave: (event) => {
              if (event.currentTarget.contains(event.relatedTarget)) return
              setDragging(false)
            },
            onDrop: onDrop,
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
                  if (!shot && node.type === 'media' && node.data && node.data.url) {
                    const media = node.data
                    return h(
                      'div',
                      {
                        key: node.id,
                        className: 'agnes-node agnes-node-media',
                        'data-status': 'imported',
                        style: { left: node.x, top: node.y, width: NODE_W },
                      },
                      h(
                        'div',
                        { className: 'agnes-node-head', onPointerDown: (event) => onNodeDown(event, node) },
                        h('b', null, media.kind === 'video' ? '🎬' : '🖼'),
                        h(
                          'span',
                          { className: 'agnes-node-status' },
                          media.duration ? `${media.duration}s` : t('canvas.imported'),
                        ),
                      ),
                      media.kind === 'video'
                        ? h('video', {
                            className: 'agnes-node-media',
                            src: media.url,
                            controls: true,
                            preload: 'metadata',
                          })
                        : h('img', { className: 'agnes-node-media', src: media.url, alt: media.name || '' }),
                      h('div', { className: 'agnes-node-prompt', title: media.name }, media.name || ''),
                      h(
                        'div',
                        { className: 'agnes-node-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'agnes-mini',
                            onClick: (event) => {
                              event.stopPropagation()
                              removeMediaNode(node.id)
                            },
                          },
                          t('action.delete'),
                        ),
                      ),
                    )
                  }
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
      const [scriptOpen, setScriptOpen] = useState(false)
      const [scriptText, setScriptText] = useState('')
      const [assembling, setAssembling] = useState(false)
      const [assembled, setAssembled] = useState(null)
      const [pane, setPane] = useState('shots')
      const [cast, setCast] = useState([])
      const [castDraft, setCastDraft] = useState({ name: '', aliases: '', look: '' })
      const [castBusy, setCastBusy] = useState(false)
      const [urlEditing, setUrlEditing] = useState(null)
      const [urlDraft, setUrlDraft] = useState('')
      const [storyBusy, setStoryBusy] = useState({})
      const [blockers, setBlockers] = useState([])
      // Right-click menu for the shot list: { id, x, y, confirm }.
      const [shotMenu, setShotMenu] = useState(null)

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

      const removeShot = async (shotId) => {
        if (!projectId) return
        try {
          await deleteShotApi(projectId, shotId)
          const data = await reload()
          if (data && data.shots && data.shots.length) setSelected(data.shots[0].id)
          else setSelected('')
        } catch (err) {
          setError(String(err))
        }
      }

      const removeProject = async (id) => {
        if (!id) return
        try {
          await deleteProjectApi(id)
          const list = await loadProjects()
          setProjects(list)
          if (id === projectId) {
            const next = list[0] ? list[0].id : ''
            setProjectId(next)
            // Drop the selection and cached detail so the pane cannot keep
            // showing shots from the project that was just removed.
            setSelected('')
            setDetail(null)
            setCast([])
          }
        } catch (err) {
          setError(String(err))
        }
      }

      const reloadCast = useCallback(async () => {
        if (!projectId) return []
        const data = await getJson(`/projects/${projectId}/cast`)
        const list = data.cast || []
        setCast(list)
        return list
      }, [projectId])

      useEffect(() => {
        if (!projectId) return undefined
        let alive = true
        getJson(`/projects/${projectId}/cast`)
          .then((data) => {
            if (alive) setCast(data.cast || [])
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [projectId])

      const createCast = async () => {
        if (!projectId) return
        const name = castDraft.name.trim()
        if (!name) {
          setError(t('cast.nameRequired'))
          return
        }
        setCastBusy(true)
        try {
          await postJson(`/projects/${projectId}/cast`, {
            name,
            aliases: castDraft.aliases
              .split(/[,，\s]+/)
              .map((alias) => alias.trim())
              .filter(Boolean),
            look: castDraft.look,
          })
          setCastDraft({ name: '', aliases: '', look: '' })
          await reloadCast()
          setError('')
        } catch (err) {
          setError(String(err))
        } finally {
          setCastBusy(false)
        }
      }

      const updateCastField = async (character, patch) => {
        if (!projectId) return
        try {
          await patchJson(`/projects/${projectId}/cast/${character.id}`, patch)
          await reloadCast()
        } catch (err) {
          setError(String(err))
        }
      }

      const removeCast = async (character) => {
        if (!projectId) return
        try {
          await deleteJson(`/projects/${projectId}/cast/${character.id}`)
          await reloadCast()
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const uploadCastRef = (character, kind) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = () => {
          const file = input.files && input.files[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            postJson(`/projects/${projectId}/cast/${character.id}/refs`, {
              kind,
              dataUri: String(reader.result),
            })
              .then(() => reloadCast())
              .catch((err) => setError(String(err)))
          }
          reader.readAsDataURL(file)
        }
        input.click()
      }

      // `window.prompt` is inert in the Electron WebView, so the URL is edited
      // inline on the card instead (this was why locking never succeeded).
      const setRefUrl = async (character, ref, url) => {
        try {
          await patchJson(`/projects/${projectId}/cast/${character.id}/refs/${ref.id}`, {
            url: String(url || '').trim(),
          })
          setUrlEditing(null)
          setUrlDraft('')
          await reloadCast()
          setError('')
        } catch (err) {
          setError(String(err))
        }
      }

      const generateStoryboard = async (shot) => {
        if (!projectId || !shot) return
        setStoryBusy((current) => ({ ...current, [shot.id]: true }))
        try {
          await postJson(`/projects/${projectId}/shots/${shot.id}/storyboard`, {})
          await reload()
        } catch (err) {
          setError(String(err))
        } finally {
          setStoryBusy((current) => {
            const next = { ...current }
            delete next[shot.id]
            return next
          })
        }
      }

      const approveStoryboard = async (shot) => {
        if (!projectId || !shot) return
        try {
          await postJson(`/projects/${projectId}/shots/${shot.id}/approve`, {})
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const rejectStoryboard = async (shot) => {
        if (!projectId || !shot) return
        try {
          await postJson(`/projects/${projectId}/shots/${shot.id}/reject`, {})
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const toggleShotCharacter = async (shot, characterId) => {
        if (!projectId) return
        const current = Array.isArray(shot.context?.characters) ? shot.context.characters : []
        const next = current.includes(characterId)
          ? current.filter((id) => id !== characterId)
          : [...current, characterId]
        try {
          await patchShotApi(projectId, shot.id, { context: { characters: next } })
          await reload()
        } catch (err) {
          setError(String(err))
        }
      }

      const toggleShotRef = async (shot, refId) => {
        if (!projectId) return
        const current = Array.isArray(shot.refs) ? shot.refs : []
        const next = current.includes(refId) ? current.filter((id) => id !== refId) : [...current, refId]
        try {
          await patchShotApi(projectId, shot.id, { refs: next })
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
        setBlockers([])
        try {
          await runChainApi(projectId, { shotIds: shots.map((shot) => shot.id) })
          setError('')
          await reload()
        } catch (err) {
          setError(String(err))
          setBlockers(Array.isArray(err.blockers) ? err.blockers : [])
        }
      }

      // Escape hatch: generate without identity locking. The result is honest
      // about it — every shot still records lockMode and the UI shows it.
      const runAnyway = async () => {
        if (!projectId) return
        try {
          await runChainApi(projectId, {
            shotIds: shots.map((shot) => shot.id),
            skipPreflight: true,
          })
          setBlockers([])
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

      const importScript = async () => {
        if (!projectId) return
        const text = scriptText.trim()
        if (!text) {
          setError(t('error.prompt'))
          return
        }
        try {
          await postJson(`/projects/${projectId}/script/parse`, { text, replace: true })
          setScriptOpen(false)
          setError('')
          const data = await reload()
          if (data.shots && data.shots[0]) setSelected(data.shots[0].id)
        } catch (err) {
          setError(String(err))
        }
      }

      const exportVideo = async () => {
        if (!projectId) return
        setAssembling(true)
        try {
          const data = await postJson(`/projects/${projectId}/assemble`, {})
          setAssembled(data)
          setError('')
        } catch (err) {
          setError(String(err))
        } finally {
          setAssembling(false)
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
          onDelete: removeProject,
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
            h(
              'button',
              {
                key: 'import',
                type: 'button',
                className: 'agnes-button agnes-ghost',
                disabled: Boolean(chain?.running),
                onClick: () => setScriptOpen((value) => !value),
              },
              t('drama.import'),
            ),
            h(
              'button',
              {
                key: 'export',
                type: 'button',
                className: 'agnes-button agnes-ghost',
                disabled:
                  assembling ||
                  !shots.some((shot) => shot.status === 'ready' && shot.assetUrl) ||
                  detail && detail.ffmpeg === false,
                onClick: exportVideo,
              },
              assembling ? t('drama.exporting') : t('drama.export'),
            ),
          ],
        }),
        h('div', { className: 'agnes-view-hint' }, t('drama.hint')),
        h(
          'div',
          { className: 'agnes-tabs', style: { marginBottom: '6px' } },
          h(
            'button',
            {
              type: 'button',
              className: 'agnes-tab',
              'data-active': pane === 'shots' ? 'true' : 'false',
              onClick: () => setPane('shots'),
            },
            t('pane.shots'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'agnes-tab',
              'data-active': pane === 'cast' ? 'true' : 'false',
              onClick: () => setPane('cast'),
            },
            `${t('pane.cast')} (${cast.length})`,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'agnes-tab',
              'data-active': pane === 'storyboard' ? 'true' : 'false',
              onClick: () => setPane('storyboard'),
            },
            t('pane.storyboard'),
          ),
        ),
        blockers.length > 0
          ? h(
              'div',
              { className: 'agnes-error', style: { display: 'block' } },
              h('div', null, t('drama.blockedHint')),
              ...blockers.map((blocker) =>
                h('div', { key: blocker.shotId, className: 'agnes-mono' }, `#${blocker.index} ${blocker.reason}`),
              ),
              h(
                'div',
                { className: 'agnes-view-hint', style: { marginTop: '6px' } },
                t('drama.blockedOptions'),
              ),
              h(
                'div',
                { className: 'agnes-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-button agnes-ghost',
                    onClick: () => {
                      setPane('cast')
                      setBlockers([])
                    },
                  },
                  t('drama.goCast'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-button agnes-primary',
                    onClick: runAnyway,
                  },
                  t('drama.runAnyway'),
                ),
              ),
            )
          : null,
        assembled
          ? h(
              'div',
              { className: 'agnes-card' },
              h(
                'label',
                { className: 'agnes-label' },
                `${t('drama.downloaded')} · ${assembled.clipCount} ${t('drama.clips')} · ${assembled.duration}${t('note.seconds')}`,
              ),
              h('video', {
                className: 'agnes-media',
                src: assembled.url,
                controls: true,
                style: { maxHeight: '340px' },
              }),
              h(
                'div',
                { className: 'agnes-actions' },
                h(
                  'a',
                  {
                    className: 'agnes-button agnes-primary',
                    href: `${assembled.url}?download=1`,
                    download: 'agnes-episode.mp4',
                  },
                  t('action.download'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-button agnes-ghost',
                    onClick: () => setAssembled(null),
                  },
                  t('action.clear'),
                ),
              ),
            )
          : null,
        scriptOpen
          ? h(
              'div',
              { className: 'agnes-card' },
              h('label', { className: 'agnes-label' }, t('drama.scriptPlaceholder')),
              h('textarea', {
                className: 'agnes-textarea',
                style: { minHeight: '160px' },
                value: scriptText,
                placeholder: t('drama.scriptPlaceholder'),
                onChange: (event) => setScriptText(event.target.value),
              }),
              h('div', { className: 'agnes-view-hint' }, t('drama.scriptReplace')),
              h(
                'div',
                { className: 'agnes-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-button agnes-primary',
                    disabled: !scriptText.trim(),
                    onClick: importScript,
                  },
                  t('drama.doImport'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-button agnes-ghost',
                    onClick: () => setScriptOpen(false),
                  },
                  t('action.cancel'),
                ),
              ),
            )
          : null,
        error ? h('div', { className: 'agnes-error' }, error) : null,
        chain && chain.error ? h('div', { className: 'agnes-error' }, chain.error) : null,
        shotMenu
          ? h(
              'div',
              {
                className: 'agnes-ctx-backdrop',
                onClick: () => setShotMenu(null),
                onContextMenu: (event) => {
                  event.preventDefault()
                  setShotMenu(null)
                },
              },
              h(
                'div',
                {
                  className: 'agnes-ctx',
                  style: {
                    // Keep the menu inside the viewport when the click lands low.
                    left: Math.max(4, Math.min(shotMenu.x, (window.innerWidth || 900) - 190)),
                    top: Math.max(4, Math.min(shotMenu.y, (window.innerHeight || 700) - 132)),
                  },
                  onClick: (event) => event.stopPropagation(),
                },
                h('div', { className: 'agnes-ctx-title' }, `#${shotMenu.index}`),
                h(
                  'button',
                  {
                    type: 'button',
                    className: shotMenu.confirm ? 'agnes-ctx-item agnes-ctx-danger' : 'agnes-ctx-item',
                    onClick: () => {
                      if (!shotMenu.confirm) {
                        setShotMenu({ ...shotMenu, confirm: true })
                        return
                      }
                      const id = shotMenu.id
                      setShotMenu(null)
                      removeShot(id).catch(() => {})
                    },
                  },
                  shotMenu.confirm ? t('ctx.confirmDelete') : t('ctx.delete'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-ctx-item',
                    onClick: () => setShotMenu(null),
                  },
                  t('action.cancel'),
                ),
              ),
            )
          : null,
        pane === 'shots' && (shots.length === 0
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
                      title: t('ctx.rightClickHint'),
                      onClick: () => setSelected(shot.id),
                      onContextMenu: (event) => {
                        event.preventDefault()
                        setSelected(shot.id)
                        setShotMenu({
                          id: shot.id,
                          index: shot.index,
                          x: event.clientX,
                          y: event.clientY,
                          confirm: false,
                        })
                      },
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
                              className: 'agnes-drama-cancel',
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
                            ...['5', '10', '15', '20', '25', '30'].map((value) =>
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
                      cast.length > 0
                        ? h(
                            'div',
                            null,
                            h('label', { className: 'agnes-label', style: { marginTop: '10px' } }, t('cast.inShot')),
                            h(
                              'div',
                              { className: 'agnes-cast-toggle' },
                              ...cast.map((character) =>
                                h(
                                  'button',
                                  {
                                    key: character.id,
                                    type: 'button',
                                    className: 'agnes-cast-pill',
                                    'data-active':
                                      (selectedShot.context?.characters || []).includes(character.id)
                                        ? 'true'
                                        : 'false',
                                    onClick: () => toggleShotCharacter(selectedShot, character.id),
                                  },
                                  character.locked ? '● ' : '○ ',
                                  character.name,
                                ),
                              ),
                            ),
                          )
                        : null,
                      shots.filter((entry) => entry.index < (selectedShot.index || 0)).length > 0
                        ? h(
                            'div',
                            null,
                            h('label', { className: 'agnes-label', style: { marginTop: '10px' } }, t('ref.fromShots')),
                            h(
                              'div',
                              { className: 'agnes-cast-toggle' },
                              ...shots
                                .filter((entry) => entry.index < (selectedShot.index || 0))
                                .map((entry) =>
                                  h(
                                    'button',
                                    {
                                      key: entry.id,
                                      type: 'button',
                                      className: 'agnes-cast-pill',
                                      'data-active': (selectedShot.refs || []).includes(entry.id)
                                        ? 'true'
                                        : 'false',
                                      onClick: () => toggleShotRef(selectedShot, entry.id),
                                    },
                                    `#${entry.index}`,
                                    entry.status === 'ready' ? ' ●' : '',
                                  ),
                                ),
                            ),
                            h('div', { className: 'agnes-view-hint' }, t('ref.hint')),
                          )
                        : null,
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
            )),
        pane === 'cast'
          ? h(
              'div',
              { className: 'agnes-view' },
              h('div', { className: 'agnes-view-hint' }, `${t('cast.lockHint')} · ${t('cast.lockScope')}`),
              h(
                'div',
                { className: 'agnes-card' },
                h('label', { className: 'agnes-label' }, t('cast.create')),
                h(
                  'div',
                  { className: 'agnes-row' },
                  h('input', {
                    className: 'agnes-input',
                    placeholder: t('cast.name'),
                    value: castDraft.name,
                    onChange: (event) => setCastDraft({ ...castDraft, name: event.target.value }),
                  }),
                  h('input', {
                    className: 'agnes-input',
                    placeholder: t('cast.aliases'),
                    value: castDraft.aliases,
                    onChange: (event) => setCastDraft({ ...castDraft, aliases: event.target.value }),
                  }),
                ),
                h('input', {
                  className: 'agnes-input',
                  style: { marginTop: '8px' },
                  placeholder: t('cast.look'),
                  value: castDraft.look,
                  onChange: (event) => setCastDraft({ ...castDraft, look: event.target.value }),
                }),
                h(
                  'div',
                  { className: 'agnes-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-button agnes-primary',
                      disabled: castBusy || !castDraft.name.trim(),
                      onClick: createCast,
                    },
                    t('cast.add'),
                  ),
                ),
              ),
              cast.length === 0
                ? h('div', { className: 'agnes-empty' }, h('b', null, t('cast.empty')))
                : h(
                    'div',
                    { className: 'agnes-cast-grid' },
                    ...cast.map((character) =>
                      h(
                        'div',
                        { key: character.id, className: 'agnes-card' },
                        h(
                          'div',
                          { className: 'agnes-cast-head' },
                          h('b', null, character.name),
                          h(
                            'span',
                            {
                              className: 'agnes-chip',
                              style: { color: character.locked ? '#22c55e' : '#f59e0b' },
                            },
                            character.locked ? t('cast.locked') : t('cast.unlocked'),
                          ),
                          h(
                            'span',
                            { className: 'agnes-chip' },
                            `${(character.refs || []).length} ${t('cast.refs')}`,
                          ),
                        ),
                        h(
                          'div',
                          { className: 'agnes-cast-refs' },
                          ...['front', 'side', 'back'].map((kind) => {
                            const ref = (character.refs || []).find((entry) => entry.kind === kind)
                            return h(
                              'button',
                              {
                                key: kind,
                                type: 'button',
                                className: 'agnes-cast-slot',
                                title: `${kind}${ref && ref.url ? ' · HTTPS' : ''}`,
                                onClick: () => {
                                  if (ref && ref.file) {
                                    setUrlEditing({
                                      characterId: character.id,
                                      refId: ref.id,
                                      current: ref.url || '',
                                    })
                                    setUrlDraft(ref.url || '')
                                  } else {
                                    uploadCastRef(character, kind)
                                  }
                                },
                                onDoubleClick: () => uploadCastRef(character, kind),
                              },
                              ref && ref.file
                                ? h('img', {
                                    src: `/agnes-media/api/projects/${projectId}/cast/${character.id}/refs/${ref.id}/file`,
                                    alt: kind,
                                  })
                                : h('span', null, t(`cast.${kind}`)),
                              ref && ref.file
                                ? h(
                                    'span',
                                    {
                                      className: 'agnes-cast-url',
                                      role: 'button',
                                      onClick: (event) => {
                                        event.stopPropagation()
                                        uploadCastRef(character, kind)
                                      },
                                    },
                                    ref.url ? 'URL ✓' : t('cast.setUrl'),
                                  )
                                : null,
                            )
                          }),
                        ),
                        urlEditing && urlEditing.characterId === character.id
                          ? (() => {
                              const targetRef = (character.refs || []).find(
                                (entry) => entry.id === urlEditing.refId,
                              )
                              return targetRef
                                ? h(
                                    'div',
                                    { style: { marginTop: '6px' } },
                                    h(
                                      'div',
                                      { className: 'agnes-view-hint' },
                                      t('cast.urlPrompt'),
                                    ),
                                    h(
                                      'div',
                                      { className: 'agnes-row' },
                                      h('input', {
                                        className: 'agnes-input',
                                        autoFocus: true,
                                        placeholder: 'https://…/front.jpg',
                                        value: urlDraft,
                                        onChange: (event) => setUrlDraft(event.target.value),
                                      }),
                                      h(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'agnes-button agnes-primary',
                                          disabled: !/^https:\/\/\S+$/i.test(urlDraft.trim()),
                                          onClick: () => setRefUrl(character, targetRef, urlDraft),
                                        },
                                        t('action.save'),
                                      ),
                                    ),
                                    h(
                                      'div',
                                      { className: 'agnes-actions' },
                                      h(
                                        'button',
                                        {
                                          type: 'button',
                                          className: 'agnes-button agnes-ghost',
                                          onClick: () => {
                                            setUrlEditing(null)
                                            setUrlDraft('')
                                          },
                                        },
                                        t('action.cancel'),
                                      ),
                                      targetRef.url
                                        ? h(
                                            'button',
                                            {
                                              type: 'button',
                                              className: 'agnes-button agnes-ghost',
                                              onClick: () => setRefUrl(character, targetRef, ''),
                                            },
                                            t('cast.clearUrl'),
                                          )
                                        : null,
                                    ),
                                  )
                                : null
                            })()
                          : null,
                        h(
                          'input',
                          {
                            className: 'agnes-input',
                            style: { marginTop: '6px' },
                            defaultValue: (character.aliases || []).join('，'),
                            placeholder: t('cast.aliases'),
                            onBlur: (event) =>
                              updateCastField(character, {
                                aliases: event.target.value
                                  .split(/[,，\s]+/)
                                  .map((alias) => alias.trim())
                                  .filter(Boolean),
                              }),
                          },
                        ),
                        h(
                          'div',
                          { className: 'agnes-actions' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'agnes-button agnes-ghost',
                              onClick: () => removeCast(character),
                            },
                            t('action.delete'),
                          ),
                        ),
                      ),
                    ),
                  ),
            )
          : null,
        pane === 'storyboard'
          ? h(
              'div',
              { className: 'agnes-view' },
              h('div', { className: 'agnes-view-hint' }, t('story.hint')),
              shots.length === 0
                ? h('div', { className: 'agnes-empty' }, h('b', null, t('drama.empty')))
                : h(
                    'div',
                    { className: 'agnes-story-grid' },
                    ...shots.map((shot) =>
                      h(
                        'div',
                        { key: shot.id, className: 'agnes-card agnes-story-card' },
                        h(
                          'div',
                          { className: 'agnes-cast-head' },
                          h('b', null, `#${shot.index}`),
                          h(
                            'span',
                            { className: 'agnes-chip', style: { color: statusColor(shot.status) } },
                            t(`status.${shot.status || 'draft'}`),
                          ),
                          shot.lockMode
                            ? h('span', { className: 'agnes-chip' }, t(`lock.${shot.lockMode}`))
                            : null,
                        ),
                        shot.storyboardUrl
                          ? h('img', {
                              className: 'agnes-story-img',
                              src: shot.storyboardUrl,
                              alt: `#${shot.index}`,
                            })
                          : h('div', { className: 'agnes-story-placeholder' }, t('story.none')),
                        h('div', { className: 'agnes-story-prompt' }, shot.prompt || '—'),
                        h(
                          'div',
                          { className: 'agnes-actions' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'agnes-button agnes-ghost',
                              disabled: Boolean(storyBusy[shot.id]),
                              onClick: () => generateStoryboard(shot),
                            },
                            storyBusy[shot.id] ? t('action.generating') : t('story.generate'),
                          ),
                          shot.storyboardUrl
                            ? h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'agnes-button agnes-primary',
                                  onClick: () => approveStoryboard(shot),
                                },
                                t('story.approve'),
                              )
                            : null,
                          shot.storyboardUrl
                            ? h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'agnes-button agnes-ghost',
                                  onClick: () => rejectStoryboard(shot),
                                },
                                t('story.reject'),
                              )
                            : null,
                        ),
                      ),
                    ),
                  ),
            )
          : null,
      )
    }

    function Page(props) {
      const t = props && typeof props.t === 'function' ? props.t : (key) => key
      const [tab, setTab] = useState('video')
      const [prompt, setPrompt] = useState('')
      const [imageSize, setImageSize] = useState('1024x1024')
      const [videoSize, setVideoSize] = useState('720P')
      const [seconds, setSeconds] = useState('auto')
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
      // Composer entry state: references (first frame), the compose mode behind
      // 「全能模式」, and which toolbar popover is open (only one at a time).
      const [attachments, setAttachments] = useState([])
      const [composeMode, setComposeMode] = useState('auto')
      const [menu, setMenu] = useState('')
      // Id of the attachment whose 首帧/参考 picker is open. A newly added single
      // image lands here instead of being silently promoted to a keyframe.
      const [roleFor, setRoleFor] = useState('')
      const activeRef = useRef(null)
      const promptRef = useRef(null)
      const fileRef = useRef(null)

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

      // Host-advertised submit route for this entry: a video task route
      // (`/v1/video`), never a chat completion route. A host from before 0.8
      // does not advertise it and still answers on `/video`, so that is the
      // fallback — the panel keeps working across an app restart either way.
      const videoPath = (status && status.videoPath) || '/video'
      // Roles are explicit: the first attachment defaults to the keyframe, the
      // rest to references, and a click on the chip's tag swaps them. 参考模式
      // ignores roles and treats every attachment as a reference.
      const frameAttachment = attachments.find((entry) => entry.role === 'frame') || null
      const referenceList =
        composeMode === 'reference'
          ? attachments
          : composeMode === 'auto'
            ? attachments.filter((entry) => entry.role === 'reference')
            : []
      const frameInUse = composeMode === 'reference' || composeMode === 'text' ? null : frameAttachment

      const toggleMenu = useCallback((name) => setMenu((current) => (current === name ? '' : name)), [])

      const addAttachment = useCallback((entry) => {
        // Four images is the upstream ceiling for one request.
        setAttachments((current) => {
          if (current.length >= 4) return current
          // The first image stays undecided on purpose: the panel asks whether it
          // is the opening frame or a reference before anything is submitted.
          const role = entry.role || (current.length === 0 ? 'pending' : 'reference')
          return [...current, { ...entry, role }]
        })
      }, [])

      const setAttachmentRole = useCallback((id, role) => {
        setAttachments((current) =>
          current.map((entry) => {
            if (entry.id === id) return { ...entry, role }
            // Only one keyframe at a time: whatever held the role gives it up.
            return role === 'frame' && entry.role === 'frame' ? { ...entry, role: 'reference' } : entry
          }),
        )
        // 首帧模式 / 参考模式 override per-image roles, so an explicit choice
        // switches back to 全能模式 where the choice actually decides.
        setComposeMode((current) =>
          (role === 'frame' && current === 'reference') || (role === 'reference' && current === 'keyframe')
            ? 'auto'
            : current,
        )
        setRoleFor('')
      }, [])

      const pickLocalFiles = useCallback(
        async (files) => {
          const picked = Array.from(files || []).filter((file) => APP_IMAGE_MIMES.test(String(file.type || '')))
          if (picked.length === 0) return
          const askRole = picked.length === 1 && attachments.length === 0
          for (let index = 0; index < picked.length; index += 1) {
            const file = picked[index]
            try {
              const dataUri = await readFileAsDataUri(file)
              const id = `${Date.now()}-${file.name}`
              // A multi-file drop keeps the old rule (first is the frame); a single
              // file waits for the picker.
              const role = askRole ? 'pending' : attachments.length === 0 && index === 0 ? 'frame' : 'reference'
              addAttachment({ id, name: file.name, dataUri, preview: dataUri, role })
              if (askRole) setRoleFor(id)
            } catch {
              setError(t('home.uploadFail').replace('{name}', file.name))
            }
          }
          setMenu('')
        },
        [addAttachment, attachments.length, t],
      )

      const addFromLibrary = useCallback(
        (item) => {
          const id = `lib-${item.id}`
          const askRole = attachments.length === 0
          addAttachment({
            id,
            name: item.prompt || t('home.assetFallback'),
            preview: item.url,
            taskId: item.id,
            // Agnes keeps results on a public CDN, so a library pick can be a
            // reference the renderer fetches itself — no re-upload involved.
            referenceUrl: isHttpsUrl(item.upstream) ? item.upstream : '',
            role: askRole ? 'pending' : undefined,
          })
          if (askRole) setRoleFor(id)
          setMenu('')
        },
        [addAttachment, attachments.length, t],
      )

      const removeAttachment = useCallback((id) => {
        setAttachments((current) => current.filter((entry) => entry.id !== id))
      }, [])

      // `@` cites one attachment inside the prompt, at the caret. The host keeps
      // the real binding (`referenceFrames` / `referenceTaskIds`); the token is
      // only how a user points at material while writing.
      const insertMention = useCallback((index = 0) => {
        if (attachments.length === 0) {
          setError(t('home.mention.empty'))
          return
        }
        const token = `@${t('home.mentionToken')}${Math.min(index, attachments.length - 1) + 1}`
        const node = promptRef.current
        let next = `${prompt}${prompt && !/\s$/.test(prompt) ? ' ' : ''}${token}`
        let caret = next.length
        if (node && typeof node.selectionStart === 'number') {
          const start = node.selectionStart
          const end = typeof node.selectionEnd === 'number' ? node.selectionEnd : start
          next = `${prompt.slice(0, start)}${token}${prompt.slice(end)}`
          caret = start + token.length
        }
        setPrompt(next)
        setError('')
        if (node && typeof node.setSelectionRange === 'function') setTimeout(() => node.setSelectionRange(caret, caret), 0)
      }, [attachments.length, prompt, t])

      const generate = useCallback(async () => {
        const text = prompt.trim()
        if (!text) {
          setError(t('error.prompt'))
          return
        }
        // 参考模式 uses every attachment as a reference and 纯文本 ignores them, so
        // an undecided role only blocks the modes that actually read roles.
        const rolesMatter = composeMode === 'auto' || composeMode === 'keyframe'
        if (tab !== 'image' && rolesMatter && attachments.some((entry) => entry.role === 'pending')) {
          setError(t('home.role.pending'))
          return
        }
        if (tab !== 'image' && composeMode === 'keyframe' && !frameAttachment) {
          setError(t('home.compose.required'))
          return
        }
        if (tab !== 'image' && composeMode === 'reference' && referenceList.length === 0) {
          setError(t('home.compose.needReference'))
          return
        }
        setError('')
        setMenu('')
        setProgress(0)
        setPhase(tab === 'image' ? t('phase.image') : t('phase.submitting'))
        setNote('')
        setResult(null)
        try {
          const payload = { prompt: text }
          const seedValue = Number(seed)
          if (seed.trim() !== '' && Number.isFinite(seedValue)) payload.seed = seedValue
          let data
          if (tab === 'image') {
            data = await postJson('/image', { ...payload, size: imageSize })
          } else {
            if (frameInUse) {
              if (frameInUse.taskId) payload.firstFrameTaskId = frameInUse.taskId
              else if (frameInUse.dataUri) payload.firstFrame = frameInUse.dataUri
            }
            if (referenceList.length > 0) {
              // Split by kind so the host does not have to guess: a public URL
              // is passed through, a library image is re-resolved there, an
              // upload travels as a data URI.
              const urls = referenceList.filter((entry) => entry.referenceUrl).map((entry) => entry.referenceUrl)
              const taskIds = referenceList.filter((entry) => !entry.referenceUrl && entry.taskId).map((entry) => entry.taskId)
              const frames = referenceList.filter((entry) => !entry.referenceUrl && !entry.taskId && entry.dataUri).map((entry) => entry.dataUri)
              if (urls.length > 0) payload.referenceUrls = urls
              if (taskIds.length > 0) payload.referenceTaskIds = taskIds
              if (frames.length > 0) payload.referenceFrames = frames
            }
            data = await postJson(videoPath, {
              ...payload,
              size: videoSize,
              seconds: seconds === 'auto' ? '5' : seconds,
            })
          }
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
      }, [
        prompt,
        tab,
        imageSize,
        videoSize,
        seconds,
        seed,
        t,
        refresh,
        composeMode,
        frameAttachment,
        frameInUse,
        referenceList,
        videoPath,
      ])

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


      /* ---------------------- composer entry (first nav item) ---------------------- */

      /**
       * The reference image's landing view: a hero title, one large composer, and
       * a toolbar of chips.
       *
       * None of the chips are decorative — `+` imports a reference that travels
       * upstream as the keyframe, `@` cites it inside the prompt, 「视频生成」
       * switches to the image entry, and the mode / 时长 / 分辨率 chips write the
       * same fields the flat form used to expose.
       */
      function renderComposer() {
        const model = (status && status.videoModel) || 'agnes-video-2.5-flash'
        const library = history.filter((item) => item.kind === 'image' && item.status === 'ready' && item.url)
        const composeLabel =
          composeMode === 'keyframe'
            ? t('home.compose.keyframe')
            : composeMode === 'reference'
              ? t('home.compose.reference')
              : composeMode === 'text'
                ? t('home.compose.text')
                : t('home.compose.auto')
        const composeHint =
          composeMode === 'keyframe'
            ? t('home.compose.keyframe.hint')
            : composeMode === 'reference'
              ? t('home.compose.reference.hint')
              : composeMode === 'text'
                ? t('home.compose.text.hint')
                : t('home.compose.auto.hint')
        const durationLabel = seconds === 'auto' ? t('home.duration.auto') : `${seconds}${t('note.seconds')}`
        // The attachment the role picker is talking about: an explicitly opened
        // one first, otherwise whichever upload is still undecided.
        const roleTarget =
          attachments.find((entry) => entry.id === roleFor) ||
          attachments.find((entry) => entry.role === 'pending') ||
          null
        const caret = h(Glyph, { name: 'chevron', size: 12 })

        // One popover at a time: `menu` holds the open one, so each chip just
        // toggles its own name and the backdrop clears it.
        const popover = (name, children, align) => {
          if (menu !== name) return null
          return [
            h('div', { key: `${name}-backdrop`, className: 'agnes-menu-backdrop', onClick: () => setMenu('') }),
            h(
              'div',
              { key: `${name}-panel`, className: 'agnes-menu', 'data-align': align || 'start' },
              ...children,
            ),
          ]
        }

        const chip = (name, glyph, label, title) =>
          h(
            'button',
            {
              type: 'button',
              className: 'agnes-pill',
              'data-open': menu === name ? 'true' : 'false',
              title: title || label,
              disabled: busy,
              onClick: () => toggleMenu(name),
            },
            glyph ? h(Glyph, { name: glyph, size: 13 }) : null,
            h('span', null, label),
            caret,
          )

        return h(
          'div',
          { className: 'agnes-hero' },
          h('div', { className: 'agnes-hero-title' }, t('home.title')),
          h(
            'div',
            { className: 'agnes-composer', 'data-busy': busy ? 'true' : 'false' },
            attachments.length > 0
              ? h(
                  'div',
                  { className: 'agnes-attach-row' },
                  ...attachments.map((entry, index) =>
                    h(
                      'div',
                      { key: entry.id, className: 'agnes-attach', 'data-pending': entry.role === 'pending' ? 'true' : 'false' },
                      h('img', { src: entry.preview, alt: entry.name }),
                      // The tag opens the role picker: a single upload is never
                      // promoted to a keyframe without an explicit choice.
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'agnes-attach-tag',
                          'data-role': entry.role || 'reference',
                          title: t('home.tagToggle'),
                          onClick: () => setRoleFor((current) => (current === entry.id ? '' : entry.id)),
                        },
                        entry.role === 'frame'
                          ? t('home.frame')
                          : entry.role === 'pending'
                            ? t('home.role.choose')
                            : t('home.reference'),
                      ),

                      h('button', {
                        type: 'button',
                        className: 'agnes-attach-del',
                        title: t('home.remove'),
                        onClick: () => removeAttachment(entry.id),
                      }, '×'),
                      h('span', { className: 'agnes-attach-name', title: entry.name }, entry.name),
                    ),
                  ),
                )
              : null,
            // An undecided single upload opens this in place instead of being
            // guessed at: nothing is submitted until the role is explicit.
            roleTarget
              ? h(
                  'div',
                  { className: 'agnes-role-inline' },
                  h(
                    'div',
                    { className: 'agnes-role-head' },
                    h('span', null, t('home.role.title')),
                    h('span', { className: 'agnes-role-name' }, roleTarget.name),
                  ),
                  h(
                    'div',
                    { className: 'agnes-role-cards' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'agnes-role-option',
                        'data-kind': 'frame',
                        'data-active': roleTarget.role === 'frame' ? 'true' : 'false',
                        onClick: () => setAttachmentRole(roleTarget.id, 'frame'),
                      },
                      h('b', null, t('home.frame')),
                      h('span', null, t('home.role.frameDesc')),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'agnes-role-option',
                        'data-kind': 'reference',
                        'data-active': roleTarget.role === 'reference' ? 'true' : 'false',
                        onClick: () => setAttachmentRole(roleTarget.id, 'reference'),
                      },
                      h('b', null, t('home.reference')),
                      h('span', null, t('home.role.referenceDesc')),
                    ),
                  ),
                  h('div', { className: 'agnes-role-foot' }, t('home.role.diff')),
                )
              : null,
            h('textarea', {
              className: 'agnes-composer-input',
              ref: promptRef,
              rows: 3,
              value: prompt,
              placeholder: t('home.placeholder'),
              disabled: busy,
              onChange: (event) => {
                setPrompt(event.target.value)
                if (error) setError('')
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  if (!busy && configured) generate().catch(() => {})
                }
              },
            }),
            h(
              'div',
              { className: 'agnes-composer-bar' },
              // + : import a reference from the device or from the library
              h(
                'div',
                { className: 'agnes-menu-wrap' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-round',
                    title: t('home.add'),
                    'aria-haspopup': 'menu',
                    'aria-expanded': menu === 'add' || menu === 'assets' ? 'true' : 'false',
                    disabled: busy,
                    onClick: () => toggleMenu('add'),
                  },
                  h(Glyph, { name: 'plus', size: 16 }),
                ),
                popover('add', [
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      onClick: () => setMenu('assets'),
                    },
                    h(Glyph, { name: 'image', size: 14 }),
                    h('span', null, t('home.add.library')),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      onClick: () => {
                        setMenu('')
                        if (fileRef.current && typeof fileRef.current.click === 'function') fileRef.current.click()
                      },
                    },
                    h(Glyph, { name: 'upload', size: 14 }),
                    h('span', null, t('home.add.local')),
                  ),
                  h('div', { className: 'agnes-menu-sep' }),
                  h('div', { className: 'agnes-menu-note' }, t('home.add.hint')),
                ]),
                popover('assets', [
                  h('div', { className: 'agnes-menu-note' }, t('home.assets.hint')),
                  library.length === 0
                    ? h('div', { className: 'agnes-menu-note' }, t('home.assets.empty'))
                    : h(
                        'div',
                        { className: 'agnes-menu-scroll' },
                        ...library.slice(0, 12).map((item) =>
                          h(
                            'button',
                            {
                              type: 'button',
                              key: item.id,
                              className: 'agnes-menu-item',
                              title: item.prompt,
                              onClick: () => addFromLibrary(item),
                            },
                            h('img', { src: item.url, alt: item.prompt || '' }),
                            h(
                              'span',
                              { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                              item.prompt || t('home.assetFallback'),
                            ),
                          ),
                        ),
                      ),
                ]),
              ),
              // 视频生成 / 图片生成
              h(
                'div',
                { className: 'agnes-menu-wrap' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-pill agnes-pill-accent',
                    'data-open': menu === 'mode' ? 'true' : 'false',
                    disabled: busy,
                    onClick: () => toggleMenu('mode'),
                  },
                  h(Glyph, { name: 'film', size: 13 }),
                  h('span', null, t('home.mode.video')),
                  caret,
                ),
                popover('mode', [
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      'data-active': 'true',
                      onClick: () => setMenu(''),
                    },
                    h(Glyph, { name: 'film', size: 14 }),
                    h('span', null, t('home.mode.video')),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      onClick: () => {
                        setMenu('')
                        setTab('image')
                      },
                    },
                    h(Glyph, { name: 'image', size: 14 }),
                    h('span', null, t('home.mode.image')),
                  ),
                ]),
              ),
              // model chip: shows what will actually be called, and on which route
              h(
                'div',
                { className: 'agnes-menu-wrap' },
                chip('model', 'sparkle', prettyModel(model), t('home.model.title')),
                popover('model', [
                  h('div', { className: 'agnes-menu-note' }, t('home.model.title')),
                  h('div', { className: 'agnes-menu-row' }, h('span', null, t('model.video')), h('b', null, model)),
                  h('div', { className: 'agnes-menu-row' }, h('span', null, t('home.model.route')), h('b', null, videoPath)),
                  h(
                    'div',
                    { className: 'agnes-menu-row' },
                    h('span', null, t('home.model.upstream')),
                    h('b', null, (status && status.baseURL) || '—'),
                  ),
                  h(
                    'div',
                    { className: 'agnes-menu-row' },
                    h('span', null, t('home.model.key')),
                    h('b', null, status && status.keyHint ? status.keyHint : t('status.key.missing')),
                  ),
                ]),
              ),
              // 全能模式 / 首帧模式 / 纯文本
              h(
                'div',
                { className: 'agnes-menu-wrap' },
                chip('compose', 'layers', composeLabel, composeHint),
                popover('compose', [
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      'data-active': composeMode === 'auto' ? 'true' : 'false',
                      onClick: () => {
                        setComposeMode('auto')
                        setMenu('')
                      },
                    },
                    t('home.compose.auto'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      'data-active': composeMode === 'reference' ? 'true' : 'false',
                      onClick: () => {
                        setComposeMode('reference')
                        setMenu('')
                      },
                    },
                    t('home.compose.reference'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      'data-active': composeMode === 'keyframe' ? 'true' : 'false',
                      onClick: () => {
                        setComposeMode('keyframe')
                        setMenu('')
                      },
                    },
                    t('home.compose.keyframe'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      'data-active': composeMode === 'text' ? 'true' : 'false',
                      onClick: () => {
                        setComposeMode('text')
                        setMenu('')
                      },
                    },
                    t('home.compose.text'),
                  ),
                  h('div', { className: 'agnes-menu-sep' }),
                  h('div', { className: 'agnes-menu-note' }, composeHint),
                ]),
              ),
              // duration
              h(
                'div',
                { className: 'agnes-menu-wrap' },
                chip('duration', null, durationLabel, t('home.duration')),
                popover('duration', [
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-menu-item',
                      'data-active': seconds === 'auto' ? 'true' : 'false',
                      onClick: () => {
                        setSeconds('auto')
                        setMenu('')
                      },
                    },
                    t('home.duration.auto'),
                  ),
                  h('div', { className: 'agnes-menu-sep' }),
                  ...VIDEO_SECONDS.map((value) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: value,
                        className: 'agnes-menu-item',
                        'data-active': seconds === value ? 'true' : 'false',
                        onClick: () => {
                          setSeconds(value)
                          setMenu('')
                        },
                      },
                      `${value}${t('note.seconds')}`,
                    ),
                  ),
                ]),
              ),
              // resolution
              h(
                'div',
                { className: 'agnes-menu-wrap' },
                chip('size', null, videoSize, t('home.size')),
                popover('size', [
                  ...VIDEO_SIZES.map((value) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: value,
                        className: 'agnes-menu-item',
                        'data-active': videoSize === value ? 'true' : 'false',
                        onClick: () => {
                          setVideoSize(value)
                          setMenu('')
                        },
                      },
                      value,
                    ),
                  ),
                ]),
              ),
              h('div', { className: 'agnes-bar-spacer' }),
              h(
                'div',
                { className: 'agnes-menu-wrap' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'agnes-round',
                    title: t('home.mention'),
                    'data-open': menu === 'mention' ? 'true' : 'false',
                    disabled: busy || attachments.length === 0,
                    onClick: () => toggleMenu('mention'),
                  },
                  h(Glyph, { name: 'at', size: 15 }),
                ),
                popover('mention', [
                  h('div', { className: 'agnes-menu-note' }, t('home.mention.hint')),
                  ...attachments.map((entry, index) =>
                    h(
                      'button',
                      {
                        type: 'button',
                        key: entry.id,
                        className: 'agnes-menu-item',
                        onClick: () => {
                          insertMention(index)
                          setMenu('')
                        },
                      },
                      h('img', { src: entry.preview, alt: entry.name }),
                      h(
                        'span',
                        { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        `@${t('home.mentionToken')}${index + 1} · ${entry.name}`,
                      ),
                    ),
                  ),
                ], 'end'),
              ),
              busy
                ? h(
                    'button',
                    { type: 'button', className: 'agnes-send agnes-send-stop', onClick: () => cancelActive() },
                    t('action.cancelTask'),
                  )
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'agnes-send',
                      disabled: !configured,
                      title: t('home.submit'),
                      onClick: () => generate().catch(() => {}),
                    },
                    h(Glyph, { name: 'sparkle', size: 14 }),
                    h('span', null, t('home.submit')),
                  ),
            ),
            busy
              ? h(
                  'div',
                  { className: 'agnes-composer-progress' },
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
            h(
              'div',
              { className: 'agnes-composer-foot' },
              h('span', { className: 'agnes-composer-hint' }, t('home.tip')),
            ),
            // Kept inside the composer so a picker fired from the `+` menu stays
            // scoped to this panel instance.
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/png,image/jpeg,image/webp',
              multiple: true,
              style: { display: 'none' },
              onChange: (event) => {
                const picked = event.target && event.target.files ? event.target.files : []
                pickLocalFiles(picked).catch(() => {})
                if (event.target) event.target.value = ''
              },
            }),
          ),
          h(
            'div',
            { className: 'agnes-hero-examples' },
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
          error ? h('div', { className: 'agnes-error' }, h('div', null, error)) : null,
        )
      }

      /* --------------------------- shared result cards --------------------------- */

      function renderImageForm() {
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'agnes-card' },
            h(
              'label',
              { className: 'agnes-label' },
              t('model.image'),
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
              placeholder: t('placeholder.image'),
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
                h(
                  'select',
                  {
                    className: 'agnes-select',
                    value: imageSize,
                    disabled: busy,
                    onChange: (event) => setImageSize(event.target.value),
                  },
                  ...IMAGE_SIZES.map((size) => h('option', { key: size, value: size }, size)),
                ),
              ),
              h(
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
                busy ? t('action.generating') : t('action.generate.image'),
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
        )

      }

      function renderResultCard() {
        return h(
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
                result.referenceDropped
                  ? h(
                      'div',
                      { className: 'agnes-warn', style: { marginTop: '10px' } },
                      t('home.refDropped').replace('{reason}', result.referenceDropped),
                    )
                  : result.referenceSkipped
                    ? h('div', { className: 'agnes-warn', style: { marginTop: '10px' } }, t('home.refSkipped'))
                    : result.referenceCount
                    ? h(
                        'div',
                        { className: 'agnes-foot' },
                        h('span', null, `${t('home.reference')} × ${result.referenceCount}`),
                      )
                    : null,
                h(
                  'div',
                  { className: 'agnes-foot' },
                  h(
                    'span',
                    { className: 'agnes-result-prompt', title: result.prompt },
                    result.prompt,
                  ),
                ),
              )
            : h(
                'div',
                { className: 'agnes-empty' },
                h('b', null, t('empty.title')),
                h('span', null, t('empty.hint')),
              ),
        )
      }

      function renderHistoryCard(style) {
        return h(
          'div',
          { className: 'agnes-card', style: style || undefined },
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
        )
      }

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
              // Shows which secret is really in use, so a 401 can be compared
              // against the key in the Agnes console without printing it.
              configured && status && status.keyHint
                ? h('span', { className: 'agnes-chip agnes-mono', title: t('status.keyHintTitle') }, status.keyHint)
                : null,
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
          configured && status && status.keyNeededCleaning
            ? h('div', { className: 'agnes-view-hint' }, t('status.keyCleaned'))
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
                    { className: tab === 'video' ? 'agnes-grid agnes-grid-single' : 'agnes-grid' },
                    tab === 'video' ? h('div', null, renderComposer()) : renderImageForm(),
                    renderResultCard(),
                  ),
                  renderHistoryCard({ marginTop: '16px' }),
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
