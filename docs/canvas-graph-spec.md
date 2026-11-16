# 画布：ComfyUI 语义对齐规格（1.1.0）

> 本文件是 1.1.0 画布改造的**唯一契约**。Host 与 Client 两侧都必须照此实现；
> 任何偏离都应先改本文件再改代码。
>
> 背景：1.0 的画布只是「自由排版视图」——`canvas.edges` 从未进入执行逻辑，
> 拖不出线，也没有节点编辑。1.1.0 把它变成**真正的执行图**：有类型的端口、
> 可拖拽的连线、图驱动的执行顺序与首帧承接、按内容签名跳过的缓存、
> 静音/旁路、多选与撤销、节点检查器。
>
> 刻意不做的（成本远高于收益，1.1.0 明确排除）：子图/子流程嵌套、把工作流
> 写进媒体文件元数据、群组（纯装饰）、节点市场、自定义节点包。

---

## 0. 术语

| 术语 | 含义 |
|---|---|
| 节点 node | 画布上的一个方块。`shot`（镜头）、`image`（图片素材）、`clip`（视频素材）、`note`（便签）、`reroute`（转接点） |
| 端口 slot | 节点上的输入口/输出口，带类型 |
| 连线 link | 输出口 → 输入口，带类型；一个输入口最多一条连线 |
| 模式 mode | `0` 正常 / `2` 静音（不执行） / `4` 旁路（不执行但把上游数据透传给下游） |
| 线性模式 | `mode === 'linear'`：按 `shot.index` 顺序执行，上一镜尾帧自动接下一镜（1.0 行为） |
| 连线模式 | `mode === 'graph'`：执行顺序与首帧来源**只由连线决定** |

---

## 1. 数据模型（canvas.json v2）

```jsonc
{
  "version": 2,
  "projectId": "prj_xxx",
  "mode": "linear",              // 'linear' | 'graph'
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [
    {
      "id": "sht_ab12",           // shot 节点 id === shot.id；其余为自造 id（imp_/img_/note_/rr_）
      "type": "shot",             // shot | image | clip | note | reroute
      "pos": [120, 80],
      "size": [268, 220],
      "mode": 0,                  // 0 | 2 | 4
      "flags": { "collapsed": false, "pinned": false },
      "data": {}                  // image/clip: 素材对象；note: { text }
    }
  ],
  "links": [
    {
      "id": 7,                    // 画布内自增整数
      "origin_id": "sht_ab12",
      "origin_slot": 1,           // 输出口序号（见 §2 registry 的 slot）
      "target_id": "sht_cd34",
      "target_slot": 0,           // 输入口序号
      "type": "IMAGE",
      "disabled": false           // true = 保留但不参与执行
    }
  ],
  "updatedAt": 0
}
```

**归一化规则（Host `normalizeCanvas`）**

- `nodes[].id` 必须是非空字符串，否则丢弃该节点；`pos`/`size` 取整，`size` 夹在
  `[120,60] .. [640,900]`。
- `mode` 只接受 `0 | 2 | 4`，其余按 `0`。
- `links[].id` 转为整数，缺失/重复时按出现顺序重新编号。
- 丢弃：自环（`origin_id === target_id`）、端点不存在的连线、`target_slot`
  已被更靠后的连线占用的重复连线（后者胜，与 ComfyUI「一个输入口一条线」一致）。
- 保存时**不改** `viewport` 的合法范围（`zoom` 夹在 `0.25..2.5`）。
- `mode` 缺省：`nodes` 里存在 `shot` 且 `links` 为空 → `'linear'`；否则沿用入参。

**v1 → v2 迁移**（读取旧 `canvas.json` 或旧客户端 PUT 的 body 时自动做一次）

| v1 字段 | v2 映射 |
|---|---|
| `nodes[].type: 'media'` | 按 `data.kind` 映射为 `'clip'`（video）或 `'image'`（image） |
| `nodes[].x` / `.y` | `pos: [x, y]`；`size` 取默认值 |
| `edges[] { from, to, kind, autoFrame }` | `link { origin_id: from, origin_slot: 0, target_id: to, target_slot: 0, type: 'IMAGE' }`；`kind === 'reference'` → `target_slot: 1` |

迁移后 `mode` 保持 `'linear'`（老项目按老行为跑，除非用户自己切换或画出第一条线）。

**自动切换**：保存画布前若 `mode === 'linear'` 且（本次或已有）`links.length > 0`，
Host 与 Client **都**把它切成 `'graph'`。Client 在用户画下第一条线时立即切换并在
提示条上说明一次「已切到连线模式，执行顺序由连线决定」。用户随时可切回线性模式。

---

## 2. 节点类型注册表（`lib/graph.js` 导出，Host 通过 `/canvas/schema` 下发）

类型名与颜色（Client 用同一份 schema 渲染端口与连线，不得自行硬编码另一套）：

```js
SLOT_TYPES = {
  IMAGE: { color: '#3b82f6', label: '图像' },
  VIDEO: { color: '#a855f7', label: '视频' },
  '*':   { color: '#94a3b8', label: '任意' },
}
```

```js
NODE_TYPES = {
  shot: {
    title: '镜头',
    executable: true,
    inputs: [
      { slot: 0, name: 'first_frame', type: 'IMAGE', label: '首帧' },   // 可选
      { slot: 1, name: 'reference',   type: 'IMAGE', label: '参考图' }, // 可选
      { slot: 2, name: 'prev',        type: 'VIDEO', label: '承接片段' }, // 可选
    ],
    outputs: [
      { slot: 0, name: 'video', type: 'VIDEO', label: '成片' },
      { slot: 1, name: 'tail',  type: 'IMAGE', label: '尾帧' },
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
    inputs:  [{ slot: 0, name: 'in',  type: '*', label: '' }],
    outputs: [{ slot: 0, name: 'out', type: '*', label: '' }],
  },
}
```

**类型相容**：`typesCompatible(a, b)` = `a === b || a === '*' || b === '*'`。
不合法的连线在 Client 端**不允许落位**（拖拽时目标口显示红色并且松手无效），Host 端
在校验时记为 `blocker`。**一个输入口最多一条连线**：新的连线替换旧的（Host 归一化与
Client 交互都如此）。

**reroute** 的类型是上游推出来的：解析输入时若目标类型为 `'*'`，一路向源头取值。

---

## 3. 执行语义

### 3.1 执行顺序（连线模式）

对 `shot` 节点做拓扑排序：

1. 依赖边 = 所有 `disabled !== true` 且两端都是 `shot`、且 `target_slot ∈ {0,1,2}` 的连线
   （经过 reroute 与 `image`/`clip` 的连线也参与依赖：上游素材节点必须存在即可，不执行）。
2. 入度为 0 的节点按 `(shot.index, shot.id)` 升序出队；同层里 index 小的先跑。
3. 存在环 → `blockers` 里给出环上的节点 id 列表，**拒绝启动**。
4. `mode === 2`（静音）的 shot **不执行**，也不存在于顺序里；若有下游依赖它的输出，
   下游记为 `blocker`：「上游第 N 镜被静音，拿不到画面」。
5. `mode === 4`（旁路）的 shot **不执行**，但下游解析它时会**穿透**到它的第一个可用
   图像输入（`first_frame` → `reference` → `prev` 的尾帧），即数据绕过它继续流。
6. `nodeIds` 给了的话，只执行「这些节点及其全部上游祖先」的子图（ComfyUI 的
   Queue Selected Output Nodes）。

线性模式完全沿用 1.0：`shots` 按 `index` 排，上一镜尾帧接下一镜；`canvas` 只影响排版。

### 3.2 首帧来源优先级（连线模式）

对每个要执行的 shot，按顺序取第一个可用的：

1. 手动上传的首帧（`shot.firstFrame.source === 'manual' && file`）。
2. `first_frame` 输入上的连线解析出来的**图片文件**。
3. `prev` 输入上的连线解析出来的**片段**，取其尾帧（ffmpeg 抽帧，缓存到
   `assets/frames/<shotId>-prev.jpg`）。
4. 都没有 → 无首帧（纯文本出片，`lockMode = 'text'`）。

解析连线（含 reroute 穿透）时，按生产者节点与端口取值：

| 生产者 | 端口 | 取值 |
|---|---|---|
| `shot` | `tail` (1) | 该镜 `tailFile`；缺失 → blocker「第 N 镜还没有尾帧」 |
| `shot` | `still` (2) | 该镜 `storyboardFile` → 其次 `firstFrame.file`；都缺 → blocker |
| `shot` | `video` (0) | 与 `tail` 相同（语义是「接着这段视频」） |
| `image` | `image` (0) | `node.data.file`（相对项目目录，`imports/…`） |
| `clip` | `frame` (1) | 该片段尾帧，抽到 `assets/frames/import-<assetId>.jpg`（已存在则复用） |
| `clip` | `video` (0) | 同 `frame` |

线性模式下「上一镜尾帧」保持 1.0 行为，作为第 3.5 优先级（仅当 `previous` 存在）。

### 3.3 内容签名与缓存（ComfyUI 的 cache key set）

`shotSignature(project, shot, sourceSig)` 用 `node:crypto` 的 sha1，取前 16 位十六进制，
**输入按下述顺序串接后 hash**：

```
version(1) | prompt | duration | size | seed | negativePrompt | camera |
continuity | castIds(排序) | refs(排序) | firstFrameMode | sourceSig
```

- `firstFrameMode` ∈ `manual:<文件名> | link:<producerId>:<producerSig 或 asset 指纹> | prev:<producerId>:<sig> | text`
- `sourceSig` 递归取上游 shot 的签名；素材节点用 `<id>:<bytes>:<mtimeMs>` 作指纹。
- 若 `shot.signature === 计算值` 且 `shot.status === 'ready'` 且 `assetFile` 存在 →
  **跳过**，标 `cached: true`（除非 `force: true`）。
- 任何上游改动会改变下游签名 → 下游自动重跑。这就是「只跑改动过的镜头」。
- 成功时把**提交时算出的**签名写回 `shot.signature`（执行前先写 `runSignature`，
  收到 ready 时 `signature = runSignature`；失败则 `signature` 不动）。

### 3.4 校验（`validateGraph` → blockers）

按此顺序检查，全部收集（不是遇错即停）：

1. 连线类型不相容：`类型不兼容：「镜头#2 尾帧」是 IMAGE，但「镜头#3 首帧」要 …`。
2. 连线端点缺失 / 自环（归一化时已丢，但 API 层再报一次）。
3. 同一输入口多于一条连线。
4. 环：`环：镜头#3 → 镜头#4 → 镜头#3`。
5. 静音节点被下游依赖。
6. 依赖上游尾帧/静帧但上游尚未生成（`status !== 'ready'` 或无 `tailFile`）——
   作为**警告**而不是 blocker（生成时上游会先跑完，所以只在「上游被静音/被排除在
   本次子图之外」时才是 blocker）。
7. 另外沿用 1.0 的锁脸门禁（`preflight`），未通过时同样列在 blockers 里。

`POST /projects/:id/chain` 在 `skipPreflight !== true` 时先跑校验；任何 blocker → 422，
`payload.blockers` 里带条目（`{ nodeId, shotIndex, reason }`）。

---

## 4. Host API

所有路由前缀 `/agnes-media/api`。

### 新增

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/canvas/schema` | `{ ok, version: 2, slotTypes, nodeTypes, modes }`，Client 启动时取一次，失败则用内置同构副本 |
| GET | `/projects/:id/graph` | `{ ok, mode, nodes: [nodeId], links: n, order: [{ nodeId, shotId, index }], cycle: [ids], blockers: [...], cached: [{ shotId, reason }] }` |
| POST | `/projects/:id/graph/validate` | 同 `graph` 的内容（供「为什么不能跑」面板）；不启动任何任务 |

### 变化

- `GET /projects/:id`：`canvas` 改为 v2；新增 `graph`（同 `/graph` 的 payload，可复用同一函数）。
  每个 shot 额外返回 `progress` / `stage`（由 `shot.taskId` 反查任务队列，没有则 0/''）与
  `signature`、`cached`。
- `GET · PUT /projects/:id/canvas`：接受并返回 v2；PUT 的 body 可含 `mode`。
- `POST /projects/:id/chain`：body 增加 `nodeIds?: string[]`；响应
  `{ started, mode: 'graph'|'linear', order: [...], count, cached: [...] }`。

---

## 5. Client 画布

### 5.1 结构

```
CanvasView
├─ ProjectToolbar（复用现有组件：项目选择 / 新建 / 删除）
├─ 画布工具条 .agnes-graph-toolbar
│   模式切换（连线 / 线性）· 生成（按当前选择或全图）· 停止 · 适应视图 ·
│   撤销 / 重做 · 添加节点 · ffmpeg 缺失提示 · blockers 计数
├─ .agnes-graph-main
│   ├─ .agnes-graph（画布本体：网格背景 + 节点层 + 连线层 + 选区层 + 拖拽虚影）
│   └─ 节点检查器 .agnes-inspector（右侧抽屉，选中单节点时出现）
├─ blocker 面板 .agnes-blockers（有 blocker 时展开，逐条给出 reason 与「跳转到节点」）
└─ 提示条 .agnes-view-hint（模式说明、连接提示、错误）
```

### 5.2 状态

```js
{
  canvas: { mode, viewport, nodes, links },
  shots,                       // 来自 GET /projects/:id
  selection: new Set(nodeIds),
  selectedLinkId: null,
  draft: null,                 // { originId, originSlot, type, x, y, targetId|null, valid }
  marquee: null,               // { x1, y1, x2, y2 }  画布坐标
  drag: null,                  // { ids, startX, startY, origin: Map<id, [x,y]>, moved }
  pan: null,
  palette: null,               // { x, y, fromType|null, query, index }
  menu: null,                  // { kind:'node'|'link'|'canvas', id, x, y }
  inspector: null,             // nodeId
  history: { past: [], future: [] },
  dirty: bool, saving: bool,
  graph: { order, blockers, cycle, cached },
}
```

### 5.3 交互（逐条实现，这是验收清单）

**视口**

- 滚轮：以光标为锚点缩放（`x' = mx - (mx - x) * k`），`k ∈ [0.25, 2.5]`；
  缩放/平移结束后 400ms 防抖保存（1.0 的缩放从未被保存，这是 bug）。
- 空白处左键拖拽 = 平移；中键拖拽 = 平移；空格按住 + 左键 = 平移。
- `.` 或工具条「适应视图」= 按所有节点包围盒 fit（含 min zoom 0.25）。
- 平移/缩放都不得冒泡到页面滚动（非 passive wheel 监听，1.0 已有做法）。

**选择**

- 单击节点 = 单选；Shift/Ctrl/Cmd + 单击 = 切换加入选择。
- 空白处拖拽超过 4px = 框选（实时选中，像 ComfyUI 的 live selection）。
- `Ctrl/Cmd+A` 全选；`Esc` 清空选择并取消拖线/菜单。
- 单击连线 = 选中该连线（比 1.0 的「点不到」重要）；`Delete` 删除选中的节点或连线。
- 删除 `shot` 节点前必须出现**应用内确认条**（不能 `window.confirm`，WebView 里无效），
  确认文案说明「其生成结果与连线一并删除」。

**拖动节点**

- 在节点头部或节点体空白处按下 = 拖动；若该节点在选区里，整选区一起移动。
- 按住 `Shift` 吸附 10px 网格。
- 松手后保存（拖动过程中不写盘）。

**连线（核心）**

- 从**输出口**按下 → 拖出虚影线，跟随光标；光标附近的**相容**输入口高亮并吸附
  （阈值 24px 屏幕距离）；不相容的口显示禁止态。
- 松手在相容输入口 → 建立连线（同输入口旧线被替换），触发保存与自动切连线模式。
- 松手在空白处 → 弹出**添加节点面板**，只列出「能产出该类型」的节点类型；
  选中后在该位置创建节点并自动连线。`Shift` + 松手 = 强制弹出面板。
- 从**已有连线的输入口**按下 = 摘下这条线，改从它的上游输出口重新拖（ComfyUI 的
  「拖输入口等于重连」）。
- 右键连线 → 菜单：删除连线 / 禁用（`disabled: true`，虚线显示）/ 启用。
- 连线颜色取类型色；选中态加粗发光；`disabled` 虚线；拖拽虚影为虚线动画。

**节点**

- 头部：类型图标 + 标题（shot 显示 `#index` + 标题；“图片/视频/便签/转接”显示类型名），
  右侧模式徽标（静音 🚫 / 旁路 ≡）、折叠按钮。
- 输入口在左边缘，输出口在右边缘，圆形，颜色 = 类型色；hover 显示 label。
- 折叠后只留头部，连线端点跟随头部中线。
- 双击节点 = 打开检查器；双击空白 = 添加节点面板。
- 右键节点菜单：编辑（检查器）/ 生成此镜 / 从此镜续跑 / 上传首帧 / 静音·解除 /
  旁路·取消 / 克隆 / 置顶 / 删除。
- 运行中：边框呼吸 + 节点底部进度条（取 `shot.progress`）；失败红色；完成绿色；
  blocker 琥珀；`cached` 虚线边框 + 「已缓存」角标；静音半透明；旁路洋红斜纹。
- 卡片内保留 1.0 的预览（video/img 缩略）与错误提示，尺寸不再硬编码 232×168。

**检查器（右侧抽屉，宽 300px）**

- 单节点选中时出现。shot 节点可编辑：标题、提示词、镜头语言、承接说明、时长、
  分辨率、seed、负面提示词、角色多选（`context.characters`）、关联参考镜（`shot.refs`）。
- 展示：状态、进度、锁脸模式、首帧来源（手动/连线/上一镜/无）与对应缩略图、错误。
- 按钮：保存（或失焦自动保存 + 400ms 防抖）、生成此镜、从此镜续跑、上传首帧、
  通过静帧 / 打回（有静帧时）。
- 编辑走 `PATCH /projects/:id/shots/:sid`，成功后刷新 detail。
- 便签节点：编辑文本；`image`/`clip` 节点：显示素材信息 + 删除。

**添加节点面板**

- 输入框搜索（匹配标题与拼音首字母不做，只匹配标题/类型名），回车插入、方向键上下移动、
  `Esc` 关闭。位置 = 打开面板时的画布坐标。
- 「添加镜头」会 `POST /projects/:id/shots` 建镜头再落节点；其余节点本地创建。

**撤销 / 重做**

- 任何改动 `nodes`/`links`/`mode` 的操作前压栈快照（`{nodes, links, mode}`，最多 50 步，
  拖动与连续输入合并为一步）。
- `Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 或 `Ctrl+Y` 重做。撤销后自动保存。

**键盘总表**

| 键 | 行为 |
|---|---|
| `Delete` / `Backspace` | 删除选中节点或连线 |
| `Ctrl/Cmd+A` | 全选节点 |
| `Ctrl/Cmd+Z` | 撤销 |
| `Ctrl/Cmd+Shift+Z` / `Ctrl+Y` | 重做 |
| `Esc` | 清空选择 / 取消拖线与菜单 |
| `.` | 适应视图 |
| `Shift`（拖动时） | 吸附网格 |
| `空格`（按住） | 临时平移 |

> 键盘处理挂在画布容器的 `tabIndex=0` + `onKeyDown` 上，或 `window` 上但必须
> 判断「焦点不在输入框/文本域/可编辑元素里」，否则会吃掉用户打字的 Delete。

**拖入文件**

保留 1.0 行为：从资源管理器拖视频/图片进画布 → 上传到 `assets/imports/` → 生成
`clip`/`image` 节点落在光标处。同时保留「拖到画布」的高亮态。

### 5.4 视觉

- 网格背景、节点圆角 10px、1px 边框、hover 提亮；全部沿用 `--dsw-alias-*` 变量。
- 强调色沿用 `--agnes-accent`（`#2563eb`），不要引入新的主色。
- 端口类型色来自 schema（`#3b82f6` / `#a855f7` / `#94a3b8`）。
- 静音、旁路、缓存、blocker 的外观差异必须能在**截图里一眼分辨**。

### 5.5 约束

- `client.js` 是单文件 bundle，**不引入打包步骤**；只允许 `React.createElement` 与
  `useState / useEffect / useRef / useCallback`（不要新增 hook 解构）。
- 不得使用 `window.confirm` / `window.alert` / `window.prompt`。
- 所有文案走 `t('…')`，`ZH` 与 `EN` 两份字典都要补全。
- 生视频 / 生图 / 短剧三个页签的渲染输出**必须逐字节不变**（用
  `test-harness/ui.mjs` 快照对比验证）。

---

## 6. 验证

```bash
node --check index.js && node --check client.js
node --test test/                       # 新增：graph 引擎单测
node ../test-harness/route.mjs          # 宿主路由契约（旧断言必须仍然通过）
node ../test-harness/ui.mjs --out .tmp-shots/after   # 四个页签快照
```

`test/graph.test.mjs` 至少覆盖：

1. v1 → v2 迁移（media 节点、edges → links）。
2. 类型相容与「一输入口一条线」。
3. 拓扑顺序、环检测、静音/旁路。
4. 签名稳定性：同输入同签名；改 prompt / 改上游 → 签名变化。
5. `normalizeCanvas` 丢弃自环、悬空连线、非法 mode。

---

## 7. 验收（人工）

1. 新建项目 → 加 3 个镜头 → 从 `镜头#1 尾帧` 拖到 `镜头#2 首帧`：线能拖出来、
   端口高亮、松手落位、模式自动切到「连线」。
2. 点「生成」：只跑 1、2 两镜（第 3 镜无连线也从 index 顺序里跑，若在子图内），
   第 2 镜首帧 = 第 1 镜尾帧（检查器里显示「来自 #1 尾帧」）。
3. 改第 1 镜提示词再点生成：第 1、2、3 镜全部重跑（签名递归折叠：第 1 镜的尾帧变了，
   第 2 镜的首帧就变了，第 3 镜同理——这正是成片接缝不出错的原因）；只改第 3 镜则只跑第 3 镜；
   什么都不改再点生成则三镜全部「已缓存」跳过。
4. 把第 1 镜设为静音再生成：面板报 blocker「上游被静音」；设为旁路时下游穿过去拿再上游的画面。
5. 撤销/重做能回退拖动、连线、删除；刷新页面后布局与连线都在，缩放也保持。
6. 多选 3 个节点拖动、框选、Delete 删除；删除镜头有应用内确认。
7. 控制台无报错；生视频/生图/短剧三页签视觉与 1.0 一致。
