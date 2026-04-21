# LX Music Mobile KTV Fork

这是基于 `lyswhut/lx-music-mobile` 的二开分支，当前重点不是保持上游原样，而是面向：

- 本地音乐 / KTV 使用场景
- Android 7 到 Android 13 的兼容与稳定性
- 投影歌词展示
- 低配设备可用性
- 后续桌面端迁移

当前仓库地址：

- Fork 仓库：`https://github.com/nanoTiO2/lx-music-mobile-KTV`
- 上游仓库：`https://github.com/lyswhut/lx-music-mobile`

当前二开版本：

- `versionName`: `1.91`
- `versionCode`: `75`

## 已完成的定制能力

### 1. 本地播放 / 导入

- 新增本地音乐入口与目录导入增强
- 本地列表导入支持缓存复用，避免重复读取元数据
- 本地歌曲已有歌词和元数据时默认离线优先
- 手动“在线匹配”才允许联网补歌词 / 图片
- 同一首歌的本地同名主体文件 / KTV 分轨文件会折叠为一个展示项，不在列表里重复显示多个同名文件

### 2. KTV / 变调 / 变速

- 新增 Android 原生 `MixerModule`
- 本地播放支持变调、变速、KTV 相关过渡能力
- 修复低版本和安卓 13 上变调不生效的问题
- 点击 `KTV` 按键切换已有本地分轨时，优先走已接管的原生混音无痕切换链路，尽量保留当前播放位置、歌词和主体元数据

### 3. 歌词舞台 / 投影模式

- 新增独立歌词舞台页面
- 支持纯黑背景投影模式
- 支持低耗模式
- 支持 1 秒无操作自动收起菜单
- 支持跑马灯配色切换
- 支持手动横竖屏 / 镜像
- 支持内置中文字体 `思源黑体`

### 4. 舞台提词系统骨架

- 新增 `PromptStage` 页面，作为独立提词展示端原型
- 新增 `PromptControl` 页面，作为当前仓内的本地控制端联调原型
- 新增 `PromptReceiver` 页面，作为设置页进入的独立被控端原型
- 新增共享提词协议层 `src/shared/prompt/`
- 新增共享会话层 `src/shared/prompt/session.ts`
- 新增 WebSocket 客户端接入能力，可通过 `transportHost + sessionId` 连接提词会话
- 新增仓内 WebSocket relay 脚本 `scripts/prompt_ws_relay.js` 与一键启动脚本 `run_prompt_relay.bat`
- 支持 `.lrc` `.srt` `.ass` `.txt` 标准化解析入口
- 支持本地文件导入、剪贴板导入和手动粘贴文本加载
- 已落地顺序点按与 `JK` 接力状态机
- 已预留多展示端镜像、链路切换、控制端仓复用所需的共享模型
- 播放详情页新增“提”按钮，当前先进入控制端页，再可继续打开展示端
- 设置页新增“提词被控端”入口，可直接进入简化独立的被控屏
- 修复歌词舞台退出后偶发残留沉浸式状态，避免返回播放页时与系统状态栏重叠

### 5. 调号 / 节拍分析

- 分析改为手动触发，减少低配设备负担
- 增加进度反馈
- 分析结果写入 `.lrc` 头部和 `.lx-profile.json`
- 下次优先读取已保存结果

### 6. 播放中拖动进度条修复

- 修复底部进度条公式错误
- 修复 seek 期间旧轮询抢写导致的回跳
- 修复拖动后歌词容易不同步
- 修复 Android 原生 mixer 播放中 seek 卡顿

### 7. Android 低版本兼容

- 补强 Android 7 / 魔改系统存储权限流程
- 避免把关键操作建立在系统设置手动授权之上
- 优化低内存设备和投影仪场景

## 关键目录

- `src/customModules/`
  - 二开功能模块清单
- `src/shared/`
  - 后续移动端 / 桌面端可共享的协议与纯逻辑
- `src/shared/prompt/`
  - 独立提词与控制端共享的文档、状态机、快照模型
- `src/desktopPort/`
  - 桌面迁移骨架与适配接口
- `docs/`
  - 每一轮重要改动的时间戳说明
- `scripts/`
  - 日志数据库与辅助脚本

## 本次已经沉淀的模块索引

模块总表：

- [src/customModules/moduleManifest.ts](src/customModules/moduleManifest.ts)

当前已归档的模块包括：

- `permission_compat`
- `local_offline_import_cache`
- `mixer_pitch_seek`
- `ktv_grouping_and_seamless_switch`
- `manual_profile_analysis`
- `lyric_stage_projection`
- `seek_sync`
- `prompt_system_foundation`
- `prompt_control_loopback`

以后新增功能，先登记到 `moduleManifest.ts`，再改代码。

## 桌面端迁移骨架

本仓库已经补了桌面迁移准备层，不再从零开始：

- [src/shared/musicProfileTag.ts](src/shared/musicProfileTag.ts)
  - `lx_music_profile` 的 LRC 标签读写协议
- [src/shared/lyricStagePresets.ts](src/shared/lyricStagePresets.ts)
  - 歌词舞台的字体、配色、模式预设
- [src/desktopPort/contracts.ts](src/desktopPort/contracts.ts)
  - 桌面端音频、窗口、文件系统适配接口
- [src/desktopPort/modulePlan.ts](src/desktopPort/modulePlan.ts)
  - 哪些模块可直接迁移，哪些必须重写

这套骨架的目标是：

1. 共享纯逻辑与协议
2. 把平台差异收口到 adapter 层
3. 未来接 Electron / Node 音频引擎时不再重拆业务代码

## 开发环境

建议环境：

- Windows Terminal / PowerShell 7
- Node.js `>= 18`
- npm `>= 8.5.2`
- JDK 17
- Android SDK / ADB

## 安装依赖

```bash
npm install
```

## 常用命令

### Android 调试

```bash
npm run dev
```

### 启动 Metro

```bash
npm start
```

### 清缓存启动 Metro

```bash
npm run sc
```

### 构建 Debug APK

```bash
cd android
gradlew.bat assembleDebug
```

### 推荐的 Windows 短路径构建方式

中文路径下 Gradle / Android 构建容易出问题，建议：

```powershell
.\build_debug_shortpath.bat
```

如需直接安装到已连接设备：

```powershell
.\install_debug_shortpath.bat
```

### 启动提词联机中继

```powershell
.\run_prompt_relay.bat
```

或：

```powershell
npm run prompt:relay
```

默认监听地址：

- `ws://127.0.0.1:9528/prompt`
- `ws://<电脑局域网IP>:9528/prompt`

## 测试机部署

查看设备：

```bash
adb devices
```

覆盖安装：

```bash
adb install -r -d C:\Users\Administrator\Desktop\lx-music-mobile-v1.91-universal.apk
```

## 日志与协作

本项目要求把过程写入 SQLite 日志数据库：

- `codex_lx二开_log.db`

每次新会话建议先读取数据库，再继续开发，避免重复劳动和遗漏遗留问题。

当前日志脚本：

```bash
python main.py summary
python main.py init --task-id demo --session-id demo --requirement "..." --summary "..." --status planning
python main.py log --task-id demo --session-id demo --requirement "..." --key-steps "..." --status running
```

`scripts/codex_log_db.py` 已升级为多表结构，可记录：

- `sessions`
- `task_logs`
- `task_artifacts`
- `agent_activity`
- `issues`
- `decisions`

## 提词系统当前测试路径

### 控制端

- 播放详情页 -> `提`
- 可导入文档、编辑会话号、填写 `WebSocket` 地址
- 可打开提词展示端 / 被控端
- 跨设备联调前，先在电脑执行 `run_prompt_relay.bat`
- 控制端和被控端填写同一个 `WebSocket` 地址与同一个 `sessionId`

### 被控端

- 设置 -> 其他 -> `开启被控端`
- 可填写相同 `WebSocket` 地址和会话号接入
- 若不接远端，也可直接查看本机共享会话

## 重要说明文档

推荐优先阅读：

- [docs/2026-04-20_定制模块清单与主线合并_桌面迁移说明.md](docs/2026-04-20_定制模块清单与主线合并_桌面迁移说明.md)
- [docs/2026-04-20_定制模块部署与合并清单.md](docs/2026-04-20_定制模块部署与合并清单.md)
- [docs/2026-04-19_2334_v1.91_播放中拖动卡顿与歌词对齐修复说明.md](docs/2026-04-19_2334_v1.91_播放中拖动卡顿与歌词对齐修复说明.md)
- [docs/2026-04-21_114500_舞台提词系统骨架一期说明.md](docs/2026-04-21_114500_舞台提词系统骨架一期说明.md)
- [docs/2026-04-21_123500_舞台提词控制端本地联调一期说明.md](docs/2026-04-21_123500_舞台提词控制端本地联调一期说明.md)
- [docs/2026-04-21_132500_歌词舞台退出修复_提词被控端入口说明.md](docs/2026-04-21_132500_歌词舞台退出修复_提词被控端入口说明.md)

## 主线升级建议

不要直接把上游新版本覆盖到当前目录。

建议使用三层结构：

- `upstream/`
- `custom/`
- `patches or docs/`

主线升级时，优先对照：

- `src/customModules/moduleManifest.ts`
- `docs/2026-04-20_定制模块清单与主线合并_桌面迁移说明.md`

按模块迁移，不按整仓硬合并。

## 许可证与原始协议

本项目仍基于上游 `Apache License 2.0`。

上游项目与相关协议说明：

- 上游仓库：`https://github.com/lyswhut/lx-music-mobile`
- 许可证：`LICENSE`
- 常见问题：`FAQ.md`

如果你要继续对外发布，请自行确认当地法律法规、音乐版权与数据来源合规问题。
