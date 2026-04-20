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

### 2. KTV / 变调 / 变速

- 新增 Android 原生 `MixerModule`
- 本地播放支持变调、变速、KTV 相关过渡能力
- 修复低版本和安卓 13 上变调不生效的问题

### 3. 歌词舞台 / 投影模式

- 新增独立歌词舞台页面
- 支持纯黑背景投影模式
- 支持低耗模式
- 支持 1 秒无操作自动收起菜单
- 支持跑马灯配色切换
- 支持手动横竖屏 / 镜像
- 支持内置中文字体 `思源黑体`

### 4. 调号 / 节拍分析

- 分析改为手动触发，减少低配设备负担
- 增加进度反馈
- 分析结果写入 `.lrc` 头部和 `.lx-profile.json`
- 下次优先读取已保存结果

### 5. 播放中拖动进度条修复

- 修复底部进度条公式错误
- 修复 seek 期间旧轮询抢写导致的回跳
- 修复拖动后歌词容易不同步
- 修复 Android 原生 mixer 播放中 seek 卡顿

### 6. Android 低版本兼容

- 补强 Android 7 / 魔改系统存储权限流程
- 避免把关键操作建立在系统设置手动授权之上
- 优化低内存设备和投影仪场景

## 关键目录

- `src/customModules/`
  - 二开功能模块清单
- `src/shared/`
  - 后续移动端 / 桌面端可共享的协议与纯逻辑
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
- `manual_profile_analysis`
- `lyric_stage_projection`
- `seek_sync`

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
subst X: "C:\Users\Administrator\Desktop\lx二开\lx-music-mobile-master\lx-music-mobile-master"
Set-Location X:\android
.\gradlew.bat assembleDebug
```

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

## 重要说明文档

推荐优先阅读：

- [docs/2026-04-20_定制模块清单与主线合并_桌面迁移说明.md](docs/2026-04-20_定制模块清单与主线合并_桌面迁移说明.md)
- [docs/2026-04-20_定制模块部署与合并清单.md](docs/2026-04-20_定制模块部署与合并清单.md)
- [docs/2026-04-19_2334_v1.91_播放中拖动卡顿与歌词对齐修复说明.md](docs/2026-04-19_2334_v1.91_播放中拖动卡顿与歌词对齐修复说明.md)

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
