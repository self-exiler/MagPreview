# MagPreview

**磁力链接视频预览工具** — 在下载前鉴别资源质量，最小化流量消耗。

通过 WebTorrent（deselect 模式）和 FFmpeg 的精妙配合，仅下载种子元数据和少量视频数据即可生成截图预览，告别"下了才知道"的尴尬。

---

## 功能特性

| 特性 | 说明 |
|------|------|
| **磁力链接解析** | 输入 magnet 链接或上传 `.torrent` 文件，快速获取种子文件列表 |
| **视频截图预览** | 选中视频文件，生成指定张数的截图预览（1-20 张） |
| **随机 / 等分截取** | 两种截图模式：随机时间轴截取或按时长等分截取 |
| **大图查看** | 点击截图查看大图，支持键盘 ← → 箭头导航 |
| **Tracker 管理** | 从远程更新 Tracker 列表，自动补充无 tracker 的磁力链接 |
| **Aria2 推送** | 配置 Aria2 JSON-RPC，一键推送磁力链接到 Aria2 下载 |
| **系统日志** | 内置日志查看器，支持级别筛选、内容搜索和自动刷新 |
| **关于页面** | 动态加载 README.md 作为项目介绍，支持 Markdown 渲染 |

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 后端框架 | Node.js (ESM) + Express 5 |
| BT 引擎 | WebTorrent 2.x（deselect 模式，仅获取元数据） |
| 帧提取 | FFmpeg（ffmpeg-static + ffprobe-static + fluent-ffmpeg） |
| 文件上传 | Multer |
| 前端 | 原生 HTML / CSS / JS，Windows Settings 风格布局 |
| 字体 | DM Sans + Space Grotesk (Google Fonts) |
| 部署 | 内置 Ubuntu systemd 管理脚本 |

---

## 项目结构

```
MagPreview/
├── public/
│   ├── index.html          # HTML 结构
│   ├── style.css           # 样式表（Windows Settings 风格）
│   └── app.js              # 前端逻辑（页面切换、API 交互、Markdown 渲染）
├── server/
│   ├── index.js            # Express 服务入口，API 路由
│   ├── torrentManager.js   # WebTorrent 种子管理（deselect 模式）
│   ├── frameExtractor.js   # FFmpeg 帧提取（随机/等分模式）
│   ├── taskManager.js      # 预览任务状态管理（Map 存储）
│   ├── trackerList.js      # Tracker 列表管理（远程更新/默认回退）
│   ├── aria2Service.js     # Aria2 JSON-RPC 推送服务
│   ├── logger.js           # 日志系统（文件轮转 + 内存环形缓冲区）
│   └── config.json         # 服务器配置（端口等）
├── data/
│   ├── trackers.json       # Tracker 缓存（自动生成）
│   └── logs/               # 日志文件（按天轮转，自动清理 7 天前的日志）
├── temp/
│   └── uploads/            # 上传的种子文件缓存（30 分钟自动清理）
├── script/
│   └── magpreview.sh       # Ubuntu systemd 管理脚本（安装/启动/更新/卸载）
├── docs/
│   └── code-review-report.md # 代码走查报告
├── package.json
└── README.md
```

---

## 快速开始

### 前置要求

- **Node.js** >= 18（需支持 ESM 和内置 fetch）
- **FFmpeg** — 已通过 ffmpeg-static 内置，无需单独安装

### 安装

```bash
git clone <repo-url>
cd MagPreview
npm install
```

### 启动

```bash
npm start
```

服务启动后访问 [http://localhost:3000](http://localhost:3000)。可通过 `server/config.json` 修改端口号：

```json
{ "port": 8080 }
```

### Ubuntu 部署

项目内置一键管理脚本，支持 systemd 服务管理：

```bash
# 交互式菜单
sudo bash script/magpreview.sh

# 或直接执行
sudo bash script/magpreview.sh install   # 安装
sudo bash script/magpreview.sh start     # 启动
sudo bash script/magpreview.sh stop      # 停止
sudo bash script/magpreview.sh status    # 状态
sudo bash script/magpreview.sh update    # 更新
sudo bash script/magpreview.sh uninstall # 卸载
```

---

## 使用说明

### 1. 解析磁力链接

在「主程序」页面粘贴磁力链接，点击「解析」。程序会自动补充 Tracker 列表以加速解析。也可以上传 `.torrent` 种子文件。

### 2. 选择视频文件

解析成功后，勾选需要预览的视频文件。非视频文件不可选择（灰显）。支持格式：mp4、mkv、avi、wmv、flv、mov、ts、rmvb、webm、m2ts 等。

### 3. 配置预览参数

| 参数 | 说明 |
|------|------|
| 截图模式 | **随机截取**：随机时间点截图；**等分截取**：按时间轴等分截图 |
| 截图张数 | 1-20 张，默认 6 张 |

### 4. 查看预览

点击「生成预览」后，截图会逐帧显示。点击任意截图可查看大图，支持键盘 ← → 翻页。

### 5. 推送到 Aria2

切换到「Aria2 推送」页面，配置 Aria2 连接参数（地址、端口、Secret Token、下载目录），点击「测试连接」验证，之后可一键推送解析过的磁力链接到 Aria2 下载。

### 6. 管理 Tracker

切换到「Tracker 管理」页面，可从远程更新 Tracker 列表或恢复默认列表。默认集成 15+ 公共 Tracker 节点。

### 7. 查看日志

切换到「日志」页面，支持按级别筛选（ERROR/WARN/INFO/DEBUG）、内容搜索和 3 秒间隔的自动刷新。历史日志文件按天存储，可直接查看完整内容。

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/parse` | 解析磁力链接，返回文件列表 |
| POST | `/api/upload` | 上传 `.torrent` 种子文件 |
| POST | `/api/preview` | 创建预览任务，返回 taskId |
| GET | `/api/status/:taskId` | 查询任务状态（进度、完成数、帧列表） |
| GET | `/api/frames/:taskId/:frameIndex` | 获取截图 JPEG |
| GET | `/api/trackers` | 获取 Tracker 状态（数量、来源、更新时间） |
| POST | `/api/trackers/update` | 从远程更新 Tracker |
| POST | `/api/trackers/reset` | 恢复默认 Tracker |
| GET | `/api/aria2/config` | 获取 Aria2 配置 |
| POST | `/api/aria2/config` | 保存 Aria2 配置 |
| POST | `/api/aria2/test` | 测试 Aria2 连接 |
| POST | `/api/aria2/push` | 推送磁力链接到 Aria2 |
| GET | `/api/logs` | 查询日志（支持 level/search/limit/offset） |
| GET | `/api/logs/files` | 查看日志文件列表 |
| GET | `/api/logs/files/:filename` | 查看日志文件内容 |
| GET | `/api/about` | 获取项目介绍（README.md 内容，返回 Markdown） |

---

## 工作原理

```
用户输入磁力链接
       ↓
WebTorrent (deselect 模式) → 仅获取元数据，不下载文件数据
       ↓
展示文件列表，用户选择视频文件
       ↓
FFmpeg 通过 WebTorrent 内置 HTTP Server 发起 Range 请求
       ↓
仅读取提取帧所需的少量视频数据
       ↓
返回截图预览（最小化流量消耗）
```

**核心策略**：

1. **deselect 模式** — WebTorrent 以 `deselect: true` 添加种子，不主动下载任何文件数据块
2. **按需读取** — FFmpeg 通过 WebTorrent 内置的 HTTP 服务器发起 HTTP Range 请求，仅读取提取帧所需的少量视频数据
3. **并行支持** — 多个截图任务可并行处理，各自维护独立的进度状态
4. **自动清理** — 临时截图文件 30 分钟后自动清理，任务 5 分钟后自动移除

---

## 配置说明

### 端口配置

`server/config.json`：
```json
{
  "port": 3000
}
```

### Aria2 配置

在 Web UI 的「Aria2 推送」页面配置，保存到 `data/aria2.json`（自动生成）：
```json
{
  "host": "localhost",
  "port": 6800,
  "token": "",
  "dir": ""
}
```

### Tracker 配置

默认集成 15+ 公共 Tracker，可通过 Web UI 从远程更新（数据源：ngosang/trackerslist），缓存到 `data/trackers.json`。

---

## 许可证

ISC
