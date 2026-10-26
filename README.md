# dsh-agnes-media · Agnes 创作室

**在 DeepSeek Harness 侧边栏里直接生图、生视频，任务跑在宿主进程，关掉页面也不中断。**

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-%E2%89%A50.2.1--rc.3-4B6BFB)](https://github.com/deepseek-ai)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933)](https://nodejs.org)

![Agnes 创作室面板](docs/panel.jpg)

---

## 安装

**从插件市场安装**（推荐）

DeepSeek Harness →「设置 → 插件市场」→ 搜索 `dsh-agnes-media` → 一键安装。

**从 GitHub 安装**

```bash
dsh plugin add github:zzsszz1122/dsh-agnes-media
```

> 桌面版请在应用内「设置 → 插件」里安装；CLI 在应用运行时不会改动桌面版的 profile。

安装后在「设置 → 插件」确认 `dsh-agnes-media` 已启用，左侧栏即出现「Agnes 创作室」图标。

---

## 它解决什么问题

DeepSeek Harness 的模型调用统一走 `POST /v1/chat/completions`，而 Agnes 的媒体模型在另外两个端点上：

| 能力 | 端点 |
|---|---|
| 生图 | `POST /v1/images/generations` |
| 生视频 | `POST /v1/videos` 提交，再轮询 `GET /v1/videos/{id}` |

这些端点不在 chat 协议里。本插件由**宿主进程**直接调用它们，并把结果落盘——浏览器全程接触不到 API Key。

---

## 特性

**后台任务，离开页面不丢**

- 提交后立即返回任务；宿主在后台提交上游、每 6 秒轮询进度。
- 上游忙碌时对 `429` / `5xx` 退避重试，面板显示重试次数。
- 切换面板、刷新页面、关闭标签页都不影响任务；Host 重启后，「排队中 / 生成中」的任务自动恢复轮询。
- 单任务最长等待 **40 分钟**（`TASK_DEADLINE_MS`），超时记为失败，可重新提交。

**生成能力**

| | 参数 |
|---|---|
| 生图 | 7 种尺寸：`1024×1024`、`1024×768`、`768×1024`、`1280×720`、`720×1280`、`1536×1536`、`2048×2048` |
| 生视频 | 分辨率 `720P` / `1080P`；时长 `4 / 5 / 6 / 8 / 10 / 12` 秒 |
| 通用 | 提示词最多 4000 字符，支持固定 seed 复现 |

**界面**

- 左侧栏独立入口，顶部四个页签：**生视频 / 生图 / 画布 / 短剧模式**。
- 结果区支持预览、下载（宿主接口支持 `Range` 拖动）、新窗口打开、复制链接。
- 顶部显示 Key 状态与接口地址；未配置时给出配置指引。
- 生成历史缩略图常驻，可单条删除。

**画布与短剧模式（0.3.0 新增）**

- **画布**：节点图编辑，拖拽排版、滚轮缩放、空白拖拽平移；点节点上的「连线」再点目标节点即建立「尾帧 → 首帧」链路（SVG 连线，自动保存）。
- **短剧模式**：集/场/镜头线性编排，镜头列表 + 提示词/时长/镜头语言编辑 + 时间线总时长；「一键生成」按顺序执行，失败停在该镜，可从选中镜头续跑。
- **尾帧接首帧**：上游完成后由宿主用 ffmpeg 抽尾帧，下一镜以 `mode: keyframe` + `first_frame`（base64）提交；需要本机安装 ffmpeg（或设置 `AGNES_FFMPEG` / 插件 `config.ffmpegPath`）。缺失时画布会提示「ffmpeg 未安装」，该镜之后的链路会标记为被阻塞而不是静默降级。
- **上下文装配**：全局风格 + 角色卡 + 场景卡 + 承接说明 + 本镜提示词 + 镜头语言 + 禁止项，由宿主统一拼装后提交。
- **剧本导入（0.4.0）**：粘贴纯文本剧本（`第X集 / EP / 场… / 1.` 标记），按规则确定性地拆成集/场/镜头草稿，不依赖大模型，导入后可在分镜表逐条改。
- **合成导出（0.4.0）**：一键把已完成镜头用 ffmpeg 归一化并拼成一集 mp4（仅当每段都含音轨时才混音），面板内预览、下载。
- **随时取消（0.4.0）**：单镜、链路都能在宿主侧真正中断（停轮询/退避），新状态「已取消」；生图/生视频、画布、短剧模式每个界面都有取消入口。

**本地存储**

- 结果与索引保存在 `<DSH 主目录>/agnes-media/`（`history.json` + `media/`）。
- 项目数据在 `agnes-media/projects/<projectId>/`：`project.json`、`shots/*.json`、`canvas.json`、`assets/frames/`。
- 保留最近 **80** 条历史，超出自动清理最旧记录。单个结果文件上限 512MB。
- 不上传任何第三方。

---

## 和 `LittleBeaverStudio/agnes-media` 的区别

同一个模型、同一个宿主，但交互方式不同，两者可以并存：

| | 本项目 | `LittleBeaverStudio/agnes-media` |
|---|---|---|
| 使用方式 | **人**在侧边栏面板点按钮填参数 | **模型**在对话中调用 `generate_image` / `generate_video` 工具 |
| 任务生命周期 | 宿主后台执行，关页面不中断 | 随对话请求完成 |
| 历史记录 | 本地落盘，80 条，可回看 | 无 |
| 输出形态 | 文件存本地，可预览/下载 | 返回结果链接 |
| 多图参考 | 暂不支持 | 支持 `reference_image_urls` |

简单说：**要 AI 自己在对话里画，用那个；要自己盯着调到满意，用这个。**

---

## 配置

插件读取「设置 → 模型」里 `agnes` 这条 provider 的凭据引用（默认 `apiKeyEnv: AGNES_API_KEY`），模型默认取该 provider 已声明的那两个：

- 视频：`agnes-video-2.5-flash`
- 图像：`agnes-image-2.5-flash`

模型名里的下划线会归一化为连字符（`agnes_video_2.5_flash` → `agnes-video-2.5-flash`）。

接口地址默认 `https://api.agnes-ai.cn/v1`。要改，在这条插件行的 `config` 里覆盖：

```yaml
- id: dsh-agnes-media
  config:
    baseURL: https://api.agnes-ai.cn/v1
    apiKeyEnv: AGNES_API_KEY
    videoModel: agnes-video-2.5-flash
    imageModel: agnes-image-2.5-flash
    ffmpegPath: '' # 可选；留空依次尝试 AGNES_FFMPEG 与 PATH
```

---

## 宿主接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/agnes-media/api/status` | Key 状态、接口地址、模型名 |
| GET | `/agnes-media/api/history` | 生成历史（含状态、进度、重试提示） |
| GET | `/agnes-media/api/task/:id` | 单个任务状态 |
| POST | `/agnes-media/api/image` | 创建生图任务（后台执行） |
| POST | `/agnes-media/api/video` | 创建生视频任务（后台执行） |
| POST | `/agnes-media/api/history/delete` | 删除一条历史及其文件 |
| GET | `/agnes-media/api/media/:id?download=1` | 结果文件，支持 `HEAD` 与 `Range` |
| GET/POST | `/agnes-media/api/projects` | 项目列表 / 新建 |
| GET/PATCH/DELETE | `/agnes-media/api/projects/:id` | 项目详情（含镜头、画布、ffmpeg 状态）/ 更新 / 删除 |
| GET | `/agnes-media/api/projects/:id/canvas` · PUT 同路径 | 读取 / 保存画布节点、连线、视口 |
| POST | `/agnes-media/api/projects/:id/chain` | 顺序执行链路（`{shotIds?, from?, force?}`） |
| POST | `/agnes-media/api/projects/:id/chain/cancel` | 取消整条链路并中断当前任务 |
| POST | `/agnes-media/api/task/:id/cancel` | 取消单个任务（宿主侧停轮询/退避） |
| POST | `/agnes-media/api/projects/:id/script/parse` | 解析剧本生成分镜（`{text, replace?}`） |
| POST | `/agnes-media/api/projects/:id/assemble` | ffmpeg 合成导出成片 |
| GET | `/agnes-media/api/projects/:id/episode/:file?download=1` | 下载/预览合成结果 mp4 |
| GET/POST | `/agnes-media/api/projects/:id/shots` | 镜头列表 / 新建 |
| PATCH/DELETE | `/agnes-media/api/projects/:id/shots/:shotId` | 更新 / 删除镜头 |
| POST | `/agnes-media/api/projects/:id/shots/:shotId/first-frame` | 上传手动首帧（base64 data URI） |
| GET | `/agnes-media/api/projects/:id/shots/:shotId/tail` | 读取该镜尾帧（jpg） |
| GET | `/agnes-media/api/projects/:id/timeline` | 时间线与总时长 |

所有路由挂在 `/agnes-media/api` 前缀下，由宿主进程提供，需要已登录的 DSH Web 会话。

---

## 兼容性

- DeepSeek Harness **0.2.1-rc.3** 实测通过，最低版本由 `package.json` 的 `engines.dsh` 声明。
- Node.js **≥ 20**（依赖全局 `fetch` 与 `AbortSignal.timeout`）。
- 链路功能需要 **ffmpeg**（抽尾帧）；缺失时其余功能不受影响。
- 客户端只使用宿主注入的 `react` 与 `slots` / `locale` 服务，不额外打包前端依赖，零运行时依赖。

---

## 安全

- API Key 只在宿主进程内经 DSH 凭据服务解析，浏览器从不接触明文。
- 宿主代理只接受固定请求体字段；`/media/:id` 只回传本插件自己生成并登记在历史里的文件，无法读取任意路径。
- 生成结果留在本机，不上传任何第三方。
- 本插件非 Agnes 或 DeepSeek 官方产品，仅调用你已配置的 API。

---

## 常见问题

**左侧栏没有出现图标**
「设置 → 插件」里确认 `dsh-agnes-media` 处于启用状态；宿主代码变更需重启 DSH 才生效。

**提示未配置 Key**
先在「设置 → 模型」里为 `agnes` 这条 provider 填好 `AGNES_API_KEY`，面板顶部会显示 Key 就绪状态。

**任务一直显示排队中**
上游队列繁忙，插件会对 `429` / `5xx` 自动退避重试，面板会显示重试次数。若超过 40 分钟仍未完成，会记为失败，可重新提交。

**改了代码没反应**
`client.js` 属前端，刷新页面即可；`index.js` 属宿主，必须重启 DSH。

**画布提示「ffmpeg 未安装」**
链路需要 ffmpeg 抽尾帧。安装 ffmpeg 并加入 PATH，或在插件行的 `config` 里设置 `ffmpegPath`，或设置环境变量 `AGNES_FFMPEG`。未安装时仍可生成单镜，但下游无法自动接首帧。

**链路停在中途**
上游失败或缺少尾帧时，链路会停在当前镜并把后续标为阻塞。安装 ffmpeg / 重试该镜后，用「从此镜续跑」继续，已完成的镜头不会重跑。

---

## 已知限制

- 文生图、文生视频（`mode: text`）稳定可用；链路用 `mode: keyframe` + base64 首帧，**待上游队列恢复后完成真实两镜串联验收**（参数已按接口文档实现并有模拟测试覆盖）。
- 链路串行执行（单并发），一个项目同时只允许一条链路在跑。
- 单任务最长 40 分钟。
- 历史最多 80 条，超出的最旧记录连同文件一起删除。
- 画布暂不支持框选/多选与分组。

---

## 许可证

[MIT](LICENSE) · 非官方插件，与 Agnes、DeepSeek 无隶属关系。
