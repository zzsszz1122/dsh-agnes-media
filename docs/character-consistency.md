# 人物一致性诊断与优化方案

> 基于 dsh-agnes-media 0.4.0（提交 17506a7）源码逐行核对，非推测。

---

## 一、逐条结论

### 1. 现在有跨片段的人物上下文记忆吗？

**有，但只是「文本级」的记忆，而且没有入口去填。**

`lib/context.js:8-46` 的 `composePrompt()` 按固定顺序拼提示词：

```
【风格】project.style
【角色】bible.characters 中、被 shot.context.characters 引用的那些 → "名称：外观描述"
【场景】bible.scenes 中匹配 shot.context.scene 的那条
【承接】shot.context.continuity，留空则用"上一镜以…结束"的模板
【本镜】shot.prompt
【镜头】shot.camera
【禁止】shot.negativePrompt
```

角色数据形如 `{ id, name, look }`，`look` 是一句自然语言外观描述。

**两个致命缺口：**

- **前端没有任何编辑入口**。`client.js` 里搜不到 `bible` 或 `characters` 关键字，这套结构只能手改 `project.json`。
- **剧本导入不填角色**。`index.js:898-906` 创建镜头时只写 `context: { continuity: '场景：…' }`，`characters` 是空的，`bible` 也不会被创建。

也就是说：**代码里留了角色记忆的接口，但实际运行中它永远是空的。**

### 2. 一致性是靠画布连线，还是靠上传三视图？

**两者都不是。画布连线根本不参与生成。**

| 机制 | 实际情况 |
| --- | --- |
| 画布连线（edges） | `lib/projects.js:360-367` 存了 `id/from/to/kind/autoFrame`，但 **`index.js` 里从未读取过 `edges`**。它只是可视化数据。 |
| 链路执行顺序 | `index.js:1262` → `sequence = allShots`，即**镜头数组顺序**，跟画布怎么连无关 |
| 首帧来源 | `index.js:1294-1298`：优先该镜 `firstFrame`（manual 上传），否则用**数组里上一个镜头**的 `tailFile` |
| 三视图 | **功能完全不存在**，全仓库无 `三视图` / `cast` / 角色参考图相关实现 |

所以"连线"目前只是画给人看的示意图，改了连线不影响生成结果。这个认知偏差本身就该在 UI 上说清楚。

### 3. 仅靠尾帧衔接，能固定下一段视频的人物吗？

**不能。你的判断是对的，而且比你想的更严重。**

当前视频请求体（`index.js:454-471`）只有：

```js
{ model, prompt, mode: firstFrameFile ? 'keyframe' : 'text', seconds, size, first_frame?, seed? }
```

`keyframe` 模式喂进去的是**一张首帧图**。它的作用是「让这个视频从这张图开始动」，**不是**「把这个人的长相固定住」。模型在 4–12 秒里有充分自由去重绘面部。

更糟的是**误差累积**：

```
镜1(文生) → 尾帧a → 镜2 用 a 作首帧 → 尾帧b → 镜3 用 b 作首帧 → 尾帧c → …
```

每一代都会引入一点漂移，10 个镜头之后可能已经判若两人。而尾帧往往是**运动模糊、侧脸、遮挡、极端姿态**的产物，拿它当下一镜首帧，等于把最差的一帧当基准。

### 4. 短剧模式现在会不会产生废案？

**会，而且是结构性的，不是偶发。**

一次链路 = N 个镜头串行排队，每镜视频生成 + 轮询 + 可能的重试，单镜上限 40 分钟。等到第 8 镜发现人不对，前面 7 镜的时间和额度已经花掉了。当前没有任何机制能在**花钱之前**拦住它。

### 5. 该不该做集中的人物三视图管理？

**必须做，而且这是整个问题的关键杠杆。** 但有一个硬约束要先知道。

**Agnes API 支持参考模式，但只收公网 HTTPS URL。** 证据来自上游同生态插件 `LittleBeaverStudio/agnes-media` 对同一套 API 的描述：

> `mode: 'reference'` + `reference_image_urls`（1 张或数组），「Optional publicly accessible HTTPS image URL used as the character reference in reference mode. **Local file paths are not accepted by Agnes.**」

也就是说：

- ✅ 技术上可以做到「用三视图锁人物」，路径是 **`mode: reference` + 公网图片 URL**
- ❌ 本地文件、`file://` 路径不行；项目里 `docs/design-context-canvas-drama.md:111` 也预判过这条：「只接受公网 URL → 退化为参考图 data URI 试探」
- ⚠️ data URI 是否被接受**未经验证**，必须做 spike，且必须有降级路径

**结论：方案的核心不是"上传三视图"这个动作，而是"如何让三视图变成一个可被 API 消费的公网 URL"。** 这决定了整个架构选择，下面分开处理。

---

## 二、优化方案

### 设计原则

1. **钱要花在便宜的介质上**：先用图片（几秒、便宜）确认人脸，再花视频（分钟、贵）。
2. **没有锁定能力的镜头，不允许进入队列**：宁可生成前报错，不要生成后报废。
3. **降级必须可见**：拿不到参考图就明说"本镜未使用角色参考"，不能静默降级。
4. **保持零运行时依赖**：插件至今 `dependencies` 为空，这个约束不能破。

---

### P0-1 角色库（Cast）

**数据结构**（`project.json` 的 `bible.characters[]` 扩展）：

```jsonc
{
  "id": "cha_xxx",
  "name": "林小满",
  "aliases": ["小满", "阿满"],      // 剧本匹配用
  "look": "二十出头，齐肩短发，浅灰风衣",  // 文本兜底，拼进提示词
  "refs": [                        // 新增
    { "id": "ref_1", "kind": "front", "file": "assets/cast/cha_xxx/front.jpg",
      "url": "https://…", "addedAt": 0 },   // url 可选，公网可访问才有意义
    { "id": "ref_2", "kind": "side",  "file": "assets/cast/cha_xxx/side.jpg" }
  ],
  "locked": false                  // 是否已具备可用的锁脸手段
}
```

**存储**：`<DSH home>/agnes-media/projects/<pid>/assets/cast/<characterId>/*.jpg`

**接口**：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/projects/:id/cast` | 新建角色 |
| PATCH | `/projects/:id/cast/:cid` | 改名、aliases、look |
| POST | `/projects/:id/cast/:cid/refs` | 上传参考图（base64，含 kind） |
| PATCH | `/projects/:id/cast/:cid/refs/:rid` | 设置公网 url |
| DELETE | `/projects/:id/cast/:cid` | 删除角色（保留还是清理引用，需明确） |

**UI**：短剧页新增「角色」页签——角色卡片、三视图三格上传位、缩略图、`locked` 状态徽章、出场镜头数。

---

### P0-2 角色与镜头的绑定

- 复用已有的 `shot.context.characters: string[]`。
- **剧本导入时自动匹配**：`lib/script.js` 解析完后，用角色 `name + aliases` 对每镜 prompt 做子串匹配，命中的写入 `context.characters`。匹配不到就留空，不猜。
- 短剧表格每行加角色多选；画布节点上也显示该镜角色。
- `composePrompt` 已支持，无需改；补一条：当 `look` 为空但 `refs` 存在时，用 refs 文件名生成兜底描述（避免空角色）。

---

### P0-3 参考模式接入（锁脸的技术核心）

**视频请求改造**（`index.js` videoTask）：

```js
// 优先级：显式参考 > 首帧 > 纯文本
const refUrls = collectReferenceUrls(shot, project)   // 该镜出场角色里、有公网 url 的 refs
if (refUrls.length > 0) {
  payload.mode = 'reference'
  payload.reference_image_urls = refUrls.slice(0, 4)
} else if (item.firstFrameFile) {
  payload.mode = 'keyframe'
  payload.first_frame = await hooks.frameDataUri(item.firstFrameFile)
}
```

**必须先做的 spike（不要跳过）**：拿 1 个真实角色三视图，验证三件事——

1. `mode: reference` + 公网 URL 是否真的能锁住人脸
2. `first_frame` + `reference_image_urls` **能否同时传**（能的话就是最优解：身份 + 构图双锁）
3. `data:image/jpeg;base64,…` 是否被接受（决定能不能绕开公网托管）

spike 结果直接决定 P0-3 的实现分支，**在没做之前不要写死架构**。

**降级策略（必须显式）**：
- 无公网 URL → 用 `keyframe`（有静帧时）或 `text`，并在 `shot` 上记 `lockMode: 'text'`，UI 用橙色徽章标「未锁脸」
- reference 请求失败（4xx）→ 自动降级一次，记录原因，不静默重试到超时

---

### P0-4 先静帧后视频（避免废案的核心）

这是把「废案成本」从视频降到图片的关键改造。

**新增镜头阶段**：`draft → storyboard → approved → video → ready`

```
1. 生成静帧：POST /projects/:id/shots/:sid/storyboard
   → 用 image 模型，prompt = composePrompt()（同一套角色/场景/风格上下文）
   → 落盘 assets/storyboard/<sid>.jpg，状态 pending-review
2. 人审：整集所有静帧拼成 contact sheet 一屏看完
   → 通过 = 该图成为 shot.firstFrame{ source:'manual', file }
   → 打回 = 改 prompt 重生成（几秒，成本可忽略）
3. 生成视频：只对 approved 的镜头跑，keyframe + 已批准静帧
```

效果：
- 人脸在第 2 步就暴露，此时花的是图片钱
- 整集的构图/服化/光线能一屏对齐，不用等视频出来才发现不连戏
- 静帧本身还能作为 reference 的备选素材（有 URL 时）

---

### P1-1 生成前门禁（Preflight）

`startChain` 开头加校验，任一镜头不满足就**拒绝启动**：

```js
不通过条件（三选一即可放行）：
  a) 有 approved 静帧
  b) 能接上一镜尾帧（且上一镜已完成）
  c) 角色已 locked（有可用 reference）
否则 blocked，返回 [{ shotId, index, reason }]
```

返回体直接列给用户："第 7 镜缺少角色'林小满'的参考图，且无已批准静帧"。

目的很直接：**不要让人等 20 分钟后在第 7 镜收到一个 failed。**

---

### P1-2 失败预算与隔离

- 单镜最多重试 N 次（建议 2），超限标 `failed`，**不中断整条链路**，跳过继续
- 失败镜头单独列出，支持「只重跑失败镜」
- 已生成但被否的静帧保留在 `assets/storyboard/rejected/`，方便对比

---

### P2 体验增强

- **角色 × 镜头矩阵**：一眼看出谁在第几镜出场、哪镜缺参考
- **一键重跑角色 X 的所有镜头**
- **角色库跨项目复用**：把 cast 提到 `<DSH home>/agnes-media/cast/` 全局层，项目只引用 id

---

## 三、优先级与取舍

| 优先级 | 内容 | 解决的痛点 | 工作量 |
| --- | --- | --- | --- |
| P0 | spike 验证 reference 能力 | 决定架构，不做就是瞎猜 | 小（但要真跑） |
| P0 | 角色库 + 三视图存储 + UI | 有地方放素材、能填 | 中 |
| P0 | 先静帧后视频 | **废案成本降一个量级** | 中 |
| P1 | Preflight 门禁 | 不让人白等 | 小 |
| P1 | 剧本自动绑定角色 | 少手工 | 小 |
| P2 | 矩阵视图、批量重跑 | 长剧集效率 | 中 |

**如果只能做一件事：做「先静帧后视频」。** 它不依赖 reference API 能不能用，纯靠流程就能把废案成本压下来。角色库和 reference 模式是锦上添花——当然，真能锁脸的话效果最好。

---

## 四、给 AI 的实现提示词

> 直接整段复制给 AI，包含全部上下文，不需要它再问。

```
你在维护一个 DeepSeek Harness（DSH）插件，仓库路径 D:/桌面/Agnes/dsh-agnes-media。

【技术约束，不得违反】
- ESM，Node >= 20，零运行时依赖（package.json 的 dependencies 必须保持为空）
- 宿主代码在 index.js，前端在 client.js，纯函数模块在 lib/
- 前端只能用宿主注入的 react 与 slots/locale 服务，不打包前端依赖
- 所有对上游 Agnes API 的调用必须走 index.js 里的 upstreamRetry()，以复用退避重试与取消
- package.json 的 files 白名单要包含新增目录（当前是 lib/*.js，新增 lib 子目录需补）
- 不要引入 LLM 调用；解析类逻辑必须确定性可测

【现有架构，先读懂再动手】
- lib/context.js  composePrompt()：按 风格→角色→场景→承接→本镜→镜头→禁止 拼提示词；
  角色取自 project.bible.characters，按 shot.context.characters 的 id 过滤，只用了 name 与 look 两个文本字段
- lib/projects.js 项目/镜头/画布持久化，根目录 <DSH home>/agnes-media/projects/<pid>/
                  含 project.json、shots/*.json、canvas.json、assets/frames/
- lib/frames.js   用 ffmpeg 抽尾帧，返回 data URI
- lib/script.js   规则式剧本解析，产出镜头草稿（prompt/duration/episodeId/sceneId）
- lib/assemble.js 用 ffmpeg 把完成的镜头拼成整集 mp4
- index.js        HTTP 路由 + 后台任务（生图/生视频）+ 链路执行器
- 链路执行器：sequence = 镜头数组顺序；每镜首帧优先 manual firstFrame，否则用数组里上一镜的 tailFile；
  视频请求体只有 { model, prompt, mode: keyframe|text, seconds, size, first_frame, seed }

【已确认的缺陷，本次要修】
1. 角色信息只有文本（bible.characters[].look），没有参考图，无法锁脸
2. client.js 里没有任何 bible/characters 编辑 UI，这套结构目前只能手改 project.json
3. 剧本导入（index.js 中创建 shot 的那段）只写 context.continuity，不填 context.characters
4. 画布 edges 只被存储、从不被读取，连线和生成行为无关（要么实现它，要么在 UI 上说明它不影响生成）
5. 没有生成前校验，缺素材的镜头要等到执行到才失败，前面的镜头钱已经花了

【要实现的功能，按顺序做】

第一步：spike 验证，先写一个临时脚本（不要提交），用真实 API Key 验证三件事并报告结果：
  a) 视频请求加 mode:'reference' + reference_image_urls:['https://…公网图片'] 能否成功，效果是否真的锁住人脸
  b) first_frame（base64）+ reference_image_urls 能否同时传
  c) reference_image_urls 传 data:image/jpeg;base64,… 是否被接受
  注意：上游文档说明参考模式只接受公网 HTTPS URL，本地路径不行。三个结果直接决定后面的实现分支。

第二步：角色库
  - 扩展 project.bible.characters 结构为 { id, name, aliases[], look, locked, refs:[{ id, kind:'front'|'side'|'back'|'extra', file, url, addedAt }] }
  - 参考图存 projects/<pid>/assets/cast/<cid>/<kind>.jpg
  - 新增路由：POST /projects/:id/cast、PATCH /projects/:id/cast/:cid、
             POST /projects/:id/cast/:cid/refs（base64 上传，写文件）、
             PATCH /projects/:id/cast/:cid/refs/:rid（设置公网 url）、DELETE /projects/:id/cast/:cid
  - client.js 新增「角色」页签：卡片列表、三视图三格上传、缩略图、locked 徽章、出场镜头数

第三步：剧本导入自动绑定角色
  - lib/script.js 解析完成后，用 name + aliases 对每镜 prompt 做子串匹配
  - 命中的 id 写入 shot.context.characters；匹配不到就留空，不要猜
  - 保持零依赖，纯字符串匹配即可

第四步：先静帧后视频（最重要）
  - 镜头状态机扩展为 draft → storyboard → approved → video → ready/failed
  - 新增 POST /projects/:id/shots/:sid/storyboard：用生图模型、以 composePrompt() 的输出为 prompt，
    生成该镜静帧，落盘 assets/storyboard/<sid>.jpg，状态置 pending-review
  - 新增 POST /projects/:id/shots/:sid/approve 与 /reject：approve 把该图写成 shot.firstFrame{source:'manual',file}
  - 链路执行器只处理 approved（或已有 firstFrame）的镜头；视频请求用 keyframe + 已批准静帧
  - 前端提供整集静帧的网格预览，支持逐张通过/打回/重生成

第五步：参考模式接入（按 spike 结果决定分支）
  - videoTask 里按优先级选模式：该镜出场角色且有公网 url → mode:'reference' + reference_image_urls(最多 4 张)
    否则有 firstFrameFile → mode:'keyframe' + first_frame；否则 mode:'text'
  - 每镜记录 lockMode: 'reference' | 'keyframe' | 'text'，前端用徽章显示；text 时明确提示「未锁脸」
  - reference 请求 4xx 时降级一次到 keyframe/text，记录降级原因，不要静默重试到超时

第六步：生成前门禁
  - startChain 开头校验每个镜头，满足任一即可放行：有 approved 静帧 / 能接上一镜尾帧 / 角色已 locked
  - 不满足则拒绝启动，返回 [{ shotId, index, reason }]，前端直接列出「第 N 镜缺少 X」
  - 单镜失败不中断整条链路，标记 failed 后继续；支持「只重跑失败镜」

【验收标准】
- 新建项目 → 导入剧本 → 创建 2 个角色并各上传 3 张参考图 → 镜头自动绑定角色（能在表格里看到）
- 整集生成静帧 → 网格预览可见 → 打回一张重生成 → 通过其余
- 启动链路：未批准的镜头被门禁拦住并给出具体原因；批准后能正常生成视频
- 视频请求确实带上了 reference_image_urls（注意：参考模式要求公网 HTTPS URL，本地文件不行，此路径必须单独验证）或 first_frame，且 shot.lockMode 记录正确
- npm run check 通过；node --check 全部 js 文件通过；package.json 仍无 dependencies

【不要做的事】
- 不要引入任何 npm 依赖（包括人脸检测库）
- 不要调用 LLM 做解析或判断
- 不要在没跑 spike 的情况下假设 reference 模式可用
- 不要改动画布 edges 的语义（若实现连线影响生成，必须同时更新 UI 说明）
- 不要提交临时 spike 脚本
```

---

## 五、一句话总结

现在的短剧链路是**「文本描述 + 上一镜尾帧」**，前者因为没 UI 而实际为空，后者只能约束起点像素、约束不了人脸；画布连线是纯装饰。真正能解决问题的是三件事的组合：**角色三视图（锁身份）+ 先静帧后视频（把废案成本前置到图片）+ 生成前门禁（不让人白等）**。
