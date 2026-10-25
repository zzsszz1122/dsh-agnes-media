# dsh-agnes-media · Agnes 创作室

一个带**左侧栏入口**的 DeepSeek Harness Web UI 插件：在面板里直接调用 Agnes 的免费
**生视频**（`agnes-video-2.5-flash`）与**生图**（`agnes-image-2.5-flash`）模型。

![Agnes 创作室面板](docs/panel.jpg)

## 为什么需要它

DeepSeek Harness 的模型调用走 `POST /v1/chat/completions`，而 Agnes 的视频模型在
`POST /v1/videos`（提交任务 + 轮询 `GET /v1/videos/{id}`），生图在
`POST /v1/images/generations`。这些端点不在 chat 协议里，所以本插件用宿主侧 HTTP
代理直接调用它们，浏览器不接触 API Key。

## 后台任务：离开页面也不会丢

所有生成都在**宿主进程**里排队执行，面板只负责提交和读取历史：

- 提交后立刻返回任务，宿主在后台提交上游、轮询进度、失败重试（429/5xx 指数退避）。
- 轮询期间可以随时切走、刷新页面，甚至关闭面板；任务仍会跑完并落盘。
- 结果文件与历史索引保存在 `<DSH 主目录>/agnes-media/`（`history.json` + `media/`），
  默认保留最近 80 条，超出自动清理最旧的。
- Host 重启后会自动恢复「排队中 / 生成中」的任务继续轮询。

界面显示排队阶段、进度、上游繁忙重试提示；历史缩略图常驻，点一下即可回看。

## 用哪个 Key / 哪个模型

插件读取的就是「设置 → 模型」里 `agnes` 这条 provider 的凭据引用
（`apiKeyEnv: AGNES_API_KEY`），并默认使用该 provider 里已声明的：

- 视频：`agnes-video-2.5-flash`
- 图像：`agnes-image-2.5-flash`

模型名里的下划线会被归一化为连字符（`agnes_video_2.5_flash` → `agnes-video-2.5-flash`）。
接口地址默认 `https://api.agnes-ai.cn/v1`，可在这条插件行的 `config` 里改
`baseURL` / `apiKeyEnv` / `videoModel` / `imageModel`。

## 界面

- 左侧栏新增「Agnes 创作室」图标，点开是主面板页。
- 「生视频 / 生图」两个页签；提示词 + 示例、分辨率、时长（视频 4–12 秒）、种子。
- 结果区预览、下载（走宿主文件接口，支持 `Range` 拖动）、新窗口打开、复制链接。
- 右上角显示 Key 状态与接口地址；未配置 Key 时给出配置指引。
- 「生成历史」缩略图常驻，可删除单条。

## 宿主接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/agnes-media/api/status` | Key 状态、接口地址、模型名 |
| GET | `/agnes-media/api/history` | 生成历史（含状态/进度/重试提示） |
| GET | `/agnes-media/api/task/:id` | 单个任务状态 |
| POST | `/agnes-media/api/image` | 创建生图任务（后台执行） |
| POST | `/agnes-media/api/video` | 创建生视频任务（后台执行） |
| POST | `/agnes-media/api/history/delete` | 删除一条历史及其文件 |
| GET | `/agnes-media/api/media/:id?download=1` | 结果文件，支持 `Range` |

## 安装与生效

**方式一：本地目录**（开发用）

在 DSH 里用 `plugin_manager` 的 `install_bundle` 指向本目录，或：

```bash
dsh plugin add /absolute/path/to/dsh-agnes-media
```

**方式二：GitHub**（发布后）

```bash
dsh plugin add github:YOUR-GITHUB-NAME/dsh-agnes-media
```

**方式三：npm**（发布后）

```bash
dsh plugin add dsh-agnes-media
```

安装后在「设置 → 插件」里确认 `dsh-agnes-media` 行处于启用状态，左侧栏即出现「Agnes 创作室」。
改客户端（`client.js`）刷新页面即可；改宿主（`index.js`）需要**重启 DSH** 才会加载新代码。

## 兼容性

- DSH（DeepSeek Harness）**0.2.1-rc.3** 实测通过，`package.json` 用 `engines.dsh` 声明最低版本。
- Node.js ≥ 20（使用全局 `fetch` 与 `AbortSignal.timeout`）。
- 客户端只依赖宿主注入的 `react` 与 `slots` / `locale` 服务，不额外打包前端依赖。

## 安全说明

- API Key 只由宿主进程通过 DSH 凭据服务读取，浏览器端从不接触明文。
- 宿主代理只接受固定请求体字段，且只回传本插件自己生成、登记在历史里的文件；`/media/:id` 不能读取任意路径。
- 生成结果保存在本机 `<DSH 主目录>/agnes-media/`，不会上传到任何第三方。
- 本插件不是 Agnes 或 DeepSeek 官方产品，仅调用你已配置的 API。

## 许可证

[MIT](LICENSE)。

## 已知限制

- 一次只做文生视频（`mode: text`）与文生图；图生视频所需的公网可访问参考图暂未开放。
- 单个任务最长等待 40 分钟；超时记为失败，可重新提交。
- 历史最多 80 条（含文件），超出的最旧记录会被删除。
