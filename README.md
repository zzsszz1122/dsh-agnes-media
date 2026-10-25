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

- 左侧栏独立入口，「生图 / 生视频」两个页签，带提示词示例。
- 结果区支持预览、下载（宿主接口支持 `Range` 拖动）、新窗口打开、复制链接。
- 顶部显示 Key 状态与接口地址；未配置时给出配置指引。
- 生成历史缩略图常驻，可单条删除。

**本地存储**

- 结果与索引保存在 `<DSH 主目录>/agnes-media/`（`history.json` + `media/`）。
- 保留最近 **80** 条，超出自动清理最旧记录。单个结果文件上限 512MB。
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

所有路由挂在 `/agnes-media/api` 前缀下，由宿主进程提供，需要已登录的 DSH Web 会话。

---

## 兼容性

- DeepSeek Harness **0.2.1-rc.3** 实测通过，最低版本由 `package.json` 的 `engines.dsh` 声明。
- Node.js **≥ 20**（依赖全局 `fetch` 与 `AbortSignal.timeout`）。
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

---

## 已知限制

- 只支持文生图、文生视频（`mode: text`）。图生视频需要公网可访问的参考图，暂未开放。
- 单任务最长 40 分钟。
- 历史最多 80 条，超出的最旧记录连同文件一起删除。

---

## 许可证

[MIT](LICENSE) · 非官方插件，与 Agnes、DeepSeek 无隶属关系。
