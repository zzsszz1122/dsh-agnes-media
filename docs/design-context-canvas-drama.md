# 设计方案：上下文衔接 · 画布 · 短剧模式

> 目标版本：0.3.x
> 范围：`dsh-agnes-media` 插件（Host 半 + Client 半）
> 结论先行：三个需求共用同一套「项目 → 分镜 → 任务 → 素材」数据层和「尾帧 → 首帧」链路；
> 画布是这套数据的**自由编排视图**，短剧模式是**线性编排视图**，上下文衔接是**执行时的参数装配**。
> 先建数据层，再上两个视图，避免三套状态各自为政。

---

## 1. 现状评估

### 1.1 当前实现

| 层 | 现状 |
|---|---|
| 数据 | 只有 `history.json`（任务列表），没有项目、分镜、镜头关系、画布 |
| 任务 | `POST /image`、`POST /video` 独立提交，字段只有 prompt / size / seconds / seed |
| 视频入参 | 固定 `mode: "text"`，无首帧、无参考图、无父任务 |
| 素材 | 只存最终成片（`media/<taskId>.mp4`），不存帧 |
| 界面 | 顶部两个页签：生图 / 生视频；结果区 + 历史栏 |
| 依赖 | 无 ffmpeg，无法抽帧 |

### 1.2 缺口归因

1. **上下文断裂**：每次生成都是无状态请求，提示词之外没有任何「承接」信息，seed 也不复用。
2. **无画布**：任务之间没有边，无法表达「A 的尾帧 → B 的首帧」。
3. **无短剧模式**：没有集/场/镜头的层级，也没有批量串联与合成。

三个需求指向同一个根因：**缺少项目级实体与镜头间关系**。因此先做数据层，再做视图。

---

## 2. 总体架构

```
┌──────────────────────────── Client（React，单 bundle） ────────────────────────────┐
│  顶部导航： 生图 │ 生视频 │ 画布 │ 短剧模式                                        │
│              │         │      └─ 分镜表 / 剧本 / 时间线 / 合成                     │
│              │         └──────── 节点图 / 连线 / 批量执行                          │
│              └────────────────── 现有单镜生成                                      │
└───────────────────────────────┬───────────────────────────────────────────────────┘
                                │ 同源 HTTP（/agnes-media/api）
┌───────────────────────────────▼───────────────────────────────────────────────────┐
│ Host 领域层                                                                        │
│  projects（项目/集/场/镜头）  context（提示词装配）  frames（ffmpeg 抽帧）          │
│  chain（顺序执行器）          assemble（合成）        tasks（现有后台队列，扩展字段）│
├───────────────────────────────────────────────────────────────────────────────────┤
│ 存储：<DSH home>/agnes-media/projects/<projectId>/{project.json,shots/*.json,       │
│       canvas.json, assets/…}  +  兼容现有 history.json / media/                     │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**单一事实来源**：Host 的项目存储。所有视图都是投影；任务状态由现有任务队列写回镜头记录。

---

## 3. 需求一：多视频上下文衔接

### 3.1 三层上下文

| 层 | 内容 | 载体 |
|---|---|---|
| 视觉上下文 | 上一镜的**尾帧**作为下一镜首帧 | `firstFrame` + ffmpeg 抽帧 |
| 叙事上下文 | 上一镜发生了什么、本镜如何接上 | `context.continuity`（自动摘要 + 可编辑） |
| 风格上下文 | 全局风格、角色设定、镜头语言 | `project.style` + `project.bible` |

### 3.2 提示词装配（Host 侧 `context.compose()`）

固定顺序，保证前缀稳定、便于复现：

```
【风格】{project.style}
【角色】{character.name}：{character.look}（仅本镜出场角色）
【承接】上一镜结尾：{continuity.tailSummary}；本镜从该画面自然继续。
【本镜】{shot.prompt}
【镜头】{shot.camera ?? "固定机位，轻微手持呼吸感"}
【禁止】{shot.negativePrompt || project.negative}
```

- `tailSummary` 优先取用户填写的「衔接说明」；为空时由 Host 用模板生成：
  「上一镜以 `{prev.prompt}` 结束，本镜保持同一场景、同一角色造型与光线」。
- 可选增强：调用宿主 `ctx.llm` 对上一镜提示词做一句话摘要（异步、失败即降级，不阻塞生成）。
- seed 策略：`fixed`（全片同 seed）/ `increment`（每镜 +1）/ `random`，项目级默认。

### 3.3 尾帧提取（Host 侧 `frames.js`）

```bash
ffmpeg -sseof -0.1 -i shot.mp4 -frames:v 1 -q:v 2 tail.jpg
```

- 依赖：`ffmpeg` 可执行文件；探测顺序 `config.ffmpegPath` → `AGNES_FFMPEG` → `PATH`。
- 缺失时：任务仍可完成，但 `tailAssetId` 为空，链路上该边标记 `blocked: need-ffmpeg`，UI 给出安装指引，不静默降级。
- 产物存 `assets/frames/<shotId>-tail.jpg`，可重复生成，不占历史配额。
- 抽帧成功后立即写回镜头记录，画布缩略图直接复用。

### 3.4 传给上游

```jsonc
// 首选：首帧模式
{ "model": "agnes-video-2.5-flash", "mode": "keyframe",
  "prompt": "...", "seconds": "5", "size": "720P",
  "first_frame": "data:image/jpeg;base64,..." }

// 回退：参考图模式
{ "mode": "reference", "images": ["data:image/jpeg;base64,..."] }
```

> **技术验证项（P1 前置 spike）**：Agnes 的 `first_frame` 是否接受 data URI。
> - 接受 → 首选方案，闭环。
> - 只接受公网 URL → 退化为「参考图 data URI」试探；仍不行则降级为纯提示词衔接 + 画布预览首帧，并在 UI 明示「首帧未参与生成」。
> - 若存在文件上传端点，优先走上传递交。

---

## 4. 需求二：画布（参考即梦）

### 4.1 概念

- 一个项目一张画布；画布 = 节点 + 边 + 视口。
- 节点：`shot`（镜头/视频）、`image`（参考图/首帧）、`note`（文本备注）。
- 边：
  - `sequence`（顺序）：上游尾帧 → 下游首帧，`autoFrame: true`；
  - `reference`：图片参考，不参与抽帧。

### 4.2 交互

| 操作 | 行为 |
|---|---|
| 拖拽节点 | 更新坐标，自动保存（防抖 400ms） |
| 滚轮 / 空白拖拽 | 缩放 / 平移，视口持久化 |
| 端口拖线 | 从右侧输出口拖到左侧输入口建立 `sequence`，默认 `autoFrame: true` |
| 双击节点 | 打开右侧检查器（提示词、时长、首帧来源、状态） |
| 节点按钮 | 单镜生成 / 重跑 / 从此镜续跑 |
| 批量执行 | 按拓扑序执行选中子图；单并发，上游完成才提交下游 |
| 分支 | 一个节点可连多个下游；各自独立取尾帧 |
| 状态 | 节点角标：排队中 / 生成中 N% / 完成 / 失败 / 缺少 ffmpeg |

### 4.3 画布与链路的关系

- `sequence` 边是**声明**；执行器在提交下游时解析：`firstFrame = prev.tailAssetId`。
- 若上游未完成 → 下游任务进入 `blocked`，不占用上游队列。
- 用户手动指定首帧（上传图片）时，边的 `autoFrame` 置 false，手动优先。

### 4.4 存储

```jsonc
// canvas.json
{
  "projectId": "prj_1",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [
    { "id": "sht_1", "type": "shot", "x": 120, "y": 80 },
    { "id": "sht_2", "type": "shot", "x": 460, "y": 80 },
    { "id": "img_1", "type": "image", "x": 120, "y": 320, "assetId": "..." }
  ],
  "edges": [
    { "id": "e1", "from": "sht_1", "to": "sht_2", "kind": "sequence", "autoFrame": true }
  ]
}
```

### 4.5 渲染策略

- 节点用绝对定位 div，外层 `transform: translate() scale()`，仅渲染视口内节点（简单包围盒裁剪）。
- 边用一层 SVG 覆盖，贝塞尔曲线；拖线时只更新一条临时路径。
- 不使用第三方图库，避免额外依赖与体积。

---

## 5. 需求三：短剧模式（顶部导航新增）

### 5.1 信息结构

```
Project（剧）
└─ Episode（集）  EP01 / EP02 …
   └─ Scene（场）  SC01 雨夜街头 / SC02 天台 …
      └─ Shot（镜）  #1 5s  承接上一镜  待生成
```

### 5.2 页面分区

```
┌ 左：集/场/镜头树 ┬ 中：分镜表（可编辑） ┬ 右：镜头详情 ┐
│ EP01            │ #1  5s  雨夜街头  ✅ │ 提示词        │
│  SC01 雨夜街头   │ #2  5s  推门而入  ⏳ │ 首帧：上一镜尾帧│
│  SC02 天台       │ #3  4s  回头      ⬜ │ 角色/风格      │
└─────────────────┴────────────────────┴───────────────┘
[底部] 一键生成 · 断点续跑 · 预览播放器 · 合成导出
```

### 5.3 新增功能

1. **剧本导入**：粘贴文本 / 上传 `.txt`/`.md`；规则切分（场景标题、换行）或调用宿主 LLM 生成分镜草案。
2. **分镜表**：镜号、时长、提示词、首帧来源、状态；支持批量改时长/风格、上下移动、拆分/合并。
3. **角色与场景卡（bible）**：角色外观、场景光线；生成时自动注入提示词。
4. **一键链路生成**：按集/场顺序调用链路执行器；失败停在该镜，支持「从此镜续跑」。
5. **时间线预览**：所有就绪镜头顺序播放，显示总时长；缺镜高亮。
6. **合成导出**：ffmpeg concat（必要时统一分辨率/帧率），可选字幕烧录与简单转场；导出到项目目录并提供下载。
7. **模板**：悬疑 / 甜宠 / 爽文等节奏模板（镜头时长分布、常用镜头语言）。

### 5.4 与画布、上下文的关系

- **同一份数据**：短剧模式编辑的就是 `Shot`；画布读同一批 `Shot` + `sequence` 边。
- **线性 vs 自由**：短剧模式按 `episode/scene/index` 线性排序；画布按坐标自由布局；两者都能触发链路执行。
- **上下文注入**：短剧模式写入 `shot.context`（角色、场景、承接说明），生成时与画布共用 `context.compose()`。
- **同步**：任一侧修改镜头，另一侧通过 Host 事件（轮询 history 已有机制 + `GET /projects/:id`）刷新，不做双向本地状态。

---

## 6. 数据模型

```jsonc
// project.json
{
  "id": "prj_1", "name": "雨夜", "style": "赛博朋克，青橙对比，35mm",
  "negative": "文字，水印，畸形手",
  "seedPolicy": "increment",
  "bible": {
    "characters": [{ "id": "c1", "name": "阿岚", "look": "短发，黑风衣，左眉疤" }],
    "scenes": [{ "id": "sc1", "name": "雨夜街头", "look": "霓虹，湿地反光" }]
  },
  "createdAt": 0, "updatedAt": 0
}

// shots/sht_1.json
{
  "id": "sht_1", "projectId": "prj_1", "episodeId": "ep1", "sceneId": "sc1",
  "index": 1, "duration": 5, "size": "720P",
  "prompt": "阿岚推开锈门，雨顺着门框流下",
  "camera": "低机位，缓慢推近",
  "negativePrompt": "",
  "context": { "characters": ["c1"], "scene": "sc1", "continuity": "承接上一镜的雨夜门口" },
  "firstFrame": { "source": "tail", "fromShotId": null },
  "seed": 12345,
  "taskId": "…", "status": "ready", "assetId": "vid_…", "tailAssetId": "img_…",
  "canvas": { "x": 120, "y": 80 }
}
```

关系：

- `Shot.firstFrame.fromShotId` 与画布 `sequence` 边互为冗余；以画布边为准，镜头字段是缓存投影。
- `tailAssetId` 由执行器写回；无 ffmpeg 时为空并带 `blocked` 原因。
- 任务记录继续写现有 `history.json`，新增 `projectId/shotId/parentTaskId` 字段，历史面板可筛选。

---

## 7. Host API 设计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/projects` | 列表 / 新建 |
| GET/PUT/DELETE | `/projects/:id` | 详情 / 更新（含 bible）/ 删除 |
| GET/POST | `/projects/:id/shots` | 镜头列表 / 新建 |
| PATCH/DELETE | `/projects/:id/shots/:shotId` | 更新 / 删除 |
| PUT | `/projects/:id/canvas` | 保存节点、边、视口 |
| POST | `/projects/:id/chain` | 顺序执行（`{shotIds?, resumeFrom?}`） |
| POST | `/projects/:id/shots/:shotId/rerun` | 重跑单镜 |
| GET | `/assets/frames/:shotId/tail` | 取尾帧（jpg，支持缓存头） |
| POST | `/projects/:id/script/parse` | 剧本 → 分镜草案 |
| POST | `/projects/:id/assemble` | 合成导出 |
| GET | `/projects/:id/timeline` | 时间线（就绪镜头 + 总时长） |

现有 `/status`、`/history`、`/media/:id` 保持不变；`/history` 增加可选 `projectId` 过滤。

---

## 8. 协同工作流

```
写剧本/导入
   ↓
分镜表（Shot + context 草稿）        ← 短剧模式
   ↓
画布布局（节点/sequence 边）          ← 画布
   ↓
链路执行器（拓扑序、单并发）
   ↓  ┌─────────────────────────────────────────────┐
   │ 1. compose(context) → prompt                 │
   │ 2. 若 autoFrame：读上游 tailAssetId → dataURI │
   │ 3. 提交任务（mode=keyframe / reference）      │
   │ 4. 轮询完成 → 下载成片 → ffmpeg 抽尾帧        │
   │ 5. 写回 shot（asset/tail/status）→ 下一个      │
   └─────────────────────────────────────────────┘
   ↓
时间线预览 / 合成导出
```

失败处理：某镜失败即停，后续镜头置 `blocked`；修复后从该镜续跑，已完成镜头不重跑。

---

## 9. 分阶段实施

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** 数据层 | Project/Shot 存储、`projects` 路由、任务字段扩展、历史关联 | 建项目、增删镜头、刷新后仍在 |
| **P1** 帧链路 | ffmpeg 探测与抽帧、`first_frame` spike、`/assets/frames` | 两镜真实串联：B 的首帧 = A 的尾帧 |
| **P2** 上下文 | `context.compose()`、角色/风格注入、衔接说明 | 同一角色两镜造型/风格一致 |
| **P3** 画布 | 节点/边/视口、拖线、批量执行、状态投影 | 画布连两节点可一键生成 |
| **P4** 短剧模式 | 集/场/镜头树、分镜表、剧本解析、一键生成、合成 | 3 镜短剧端到端出片 |

依赖顺序：P0 → P1 →（P2/P3 并行）→ P4。P1 的 API spike 决定首帧方案，需最先验证。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Agnes `first_frame` 不接受 data URI | 尾帧无法参与生成 | 先 spike；回退 reference 图片；再不行降级提示词衔接并在 UI 明示 |
| 本机无 ffmpeg | 无法抽帧 | 检测 + 安装指引 + `AGNES_FFMPEG`；可选一键下载静态包 |
| 上游排队久 | 链路耗时长 | 单并发顺序执行 + 断点续跑 + 明确进度与重试提示 |
| 画布节点多 | 渲染卡顿 | 视口裁剪、CSS transform、避免每帧 setState |
| 素材膨胀 | 占盘 | 帧缓存按项目清理、成片沿用 80 条上限 |
| 数据迁移 | 旧历史丢失 | 旧 `history.json` 保留，新数据独立目录 |

---

## 11. 文件改动清单

```
index.js                  现有入口，注册新路由与领域模块
host/projects.js          项目/镜头 CRUD + JSON 持久化
host/frames.js            ffmpeg 探测、抽尾帧、dataURI 转换
host/context.js           提示词装配、角色/风格注入
host/chain.js             拓扑序执行器、断点续跑
host/assemble.js          concat / 统一分辨率 / 字幕
client.js                 顶部导航新增 画布 / 短剧模式；共享状态
client/canvas.js          节点图渲染与交互（最终并入 client bundle）
client/drama.js           分镜表、镜头树、时间线
docs/design-*.md          本文件
```

> 客户端仍由 `window.__ModuleLoader__` 以单 bundle 加载，canvas/drama 作为内部模块并入
> `client.js` 构建产物（或先按函数分区，后续再引入打包步骤）。

---

## 12. 验收标准（摘要）

1. 建 3 镜短剧，连续生成，后一镜首帧与前一镜尾帧**像素级一致**（抽帧同一文件）。
2. 关掉面板/重启 Host 后，项目、画布、链路状态不丢，可从断点续跑。
3. 画布上拖一条 `sequence` 边，批量执行只跑该子图。
4. 同一项目内角色造型与全局风格在至少 3 个镜头间保持稳定。
5. 合成导出得到可在浏览器播放的 mp4，时长等于镜头时长之和。
