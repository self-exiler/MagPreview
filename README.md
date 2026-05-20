# MagPreview

磁力链接视频预览工具 — 在下载前鉴别资源质量，最小化流量消耗。

## 功能特性

- 🔍 **磁力链接解析** — 输入磁力链接，快速获取种子文件列表
- 🎬 **视频截图预览** — 选中视频文件，生成指定张数的截图预览
- 🎲 **随机截取 / 等分截取** — 两种截图模式，随机时间轴或等分时长截取
- 🔗 **Tracker 管理** — 从远程更新 Tracker 列表，加速无 Tracker 磁力链接的解析
- 🔥 **Aria2 推送** — 配置 Aria2 JSON-RPC，一键推送磁力链接到 Aria2 下载
- 🖼️ **大图查看** — 点击截图查看大图，支持键盘左右箭头导航
- 💡 **最小化流量** — WebTorrent deselect 模式 + HTTP Range 请求，仅下载必要数据

## 技术栈

| 组件 | 技术 |
|---|---|
| 后端 | Node.js (ESM) + Express |
| BT 引擎 | WebTorrent v2.x |
| 帧提取 | FFmpeg (ffmpeg-static + ffprobe-static + fluent-ffmpeg) |
| 前端 | 原生 HTML/CSS/JS，Windows Settings 风格布局 |

## 项目结构

```
MagPreview/
├── server/
│   ├── index.js            # Express 服务入口，API 路由
│   ├── torrentManager.js   # WebTorrent 种子管理
│   ├── frameExtractor.js   # FFmpeg 帧提取（随机/等分模式）
│   ├── taskManager.js      # 预览任务状态管理
│   ├── trackerList.js      # Tracker 列表管理（远程/本地/默认）
│   └── aria2Service.js     # Aria2 JSON-RPC 推送服务
├── public/
│   └── index.html          # 前端页面
├── data/
│   ├── trackers.json       # Tracker 缓存
│   └── aria2.json          # Aria2 配置
├── temp/                   # 临时截图（自动清理）
└── package.json
```

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

服务启动后访问 [http://localhost:3000](http://localhost:3000)

## 使用说明

### 1. 解析磁力链接

在"主程序"页面粘贴磁力链接，点击"解析"。程序会自动补充 Tracker 列表以加速解析。

### 2. 选择视频文件

解析成功后，勾选需要预览的视频文件。非视频文件不可选择。

### 3. 配置预览参数

| 参数 | 说明 |
|---|---|
| 截图模式 | **随机截取**：随机时间点截图；**等分截取**：按时间轴等分截图 |
| 截图张数 | 1-20 张，默认 6 张 |

### 4. 查看预览

点击"生成预览"后，截图会逐帧显示。点击任意截图可查看大图，支持键盘 ← → 翻页。

### 5. 推送到 Aria2

切换到"Aria2 推送"页面，配置 Aria2 连接参数后，点击"推送当前链接"即可将磁力链接发送到 Aria2 下载。

### 6. 管理 Tracker

切换到"Tracker 管理"页面，可从远程更新 Tracker 列表或恢复默认列表。

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/parse` | 解析磁力链接，返回文件列表 |
| POST | `/api/preview` | 创建预览任务 |
| GET | `/api/status/:taskId` | 查询任务状态 |
| GET | `/api/frames/:taskId/:frameIndex` | 获取截图 |
| GET | `/api/trackers` | 获取 Tracker 状态 |
| POST | `/api/trackers/update` | 从远程更新 Tracker |
| POST | `/api/trackers/reset` | 恢复默认 Tracker |
| GET | `/api/aria2/config` | 获取 Aria2 配置 |
| POST | `/api/aria2/config` | 保存 Aria2 配置 |
| POST | `/api/aria2/test` | 测试 Aria2 连接 |
| POST | `/api/aria2/push` | 推送磁力链接到 Aria2 |

## 工作原理

```
用户输入磁力链接
       ↓
WebTorrent (deselect 模式) → 仅获取元数据
       ↓
展示文件列表，用户选择视频
       ↓
WebTorrent 内置 HTTP Server → 提供 Range 请求
       ↓
FFmpeg -ss seek → 按需读取视频数据提取帧
       ↓
返回截图预览（最小化下载数据量）
```

核心策略：WebTorrent 以 deselect 模式添加种子，不主动下载任何文件数据。FFmpeg 通过 WebTorrent 内置的 HTTP 服务器发起 Range 请求，仅读取提取帧所需的少量数据，从而实现最小化流量。

## 许可证

ISC
