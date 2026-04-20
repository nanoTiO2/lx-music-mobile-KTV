export type CustomModuleDefinition = {
  id: string
  name: string
  summary: string
  platform: Array<'android' | 'mobile-js' | 'desktop-portable'>
  files: string[]
  upstreamMergeRisk: 'low' | 'medium' | 'high'
  desktopPortNotes: string
}

export const customModuleManifest: CustomModuleDefinition[] = [
  {
    id: 'permission_compat',
    name: '低版本存储权限兼容模块',
    summary: '兼容 Android 7/13 的存储授权与目录选择，减少魔改系统上无法手动授权的问题。',
    platform: ['android', 'mobile-js'],
    files: [
      'src/core/common.ts',
      'src/utils/tools.ts',
      'src/components/common/ChoosePath/index.tsx',
      'android/app/src/main/AndroidManifest.xml',
    ],
    upstreamMergeRisk: 'medium',
    desktopPortNotes: '桌面端通常不需要运行时权限弹窗，但目录授权与文件选择逻辑可复用为统一入口。',
  },
  {
    id: 'local_offline_import_cache',
    name: '本地导入缓存与离线优先模块',
    summary: '本地歌曲导入采用缓存复用，默认不自动联网补歌词/图片，减少重复读标签和横屏提示反复出现。',
    platform: ['mobile-js', 'desktop-portable'],
    files: [
      'src/screens/Home/Views/Mylist/MyList/listAction.ts',
      'src/core/music/local.ts',
      'src/core/music/index.ts',
      'src/components/MetadataEditModal/MetadataForm.tsx',
      'src/lang/zh-cn.json',
      'src/lang/zh-tw.json',
      'src/lang/en-us.json',
    ],
    upstreamMergeRisk: 'low',
    desktopPortNotes: '桌面端同样适合保留“本地优先、手动联网”的策略，几乎可以原样迁移业务逻辑。',
  },
  {
    id: 'mixer_pitch_seek',
    name: '原生混音器变调与稳定拖动模块',
    summary: '引入 Android 原生 MixerModule，负责本地播放变调、变速、KTV 过渡与播放中拖动进度条稳定性。',
    platform: ['android', 'mobile-js'],
    files: [
      'android/app/src/main/java/cn/toside/music/mobile/mixer/MixerModule.java',
      'android/app/src/main/java/cn/toside/music/mobile/mixer/MixerPackage.java',
      'android/app/src/main/java/cn/toside/music/mobile/MainApplication.java',
      'src/utils/nativeModules/mixer.ts',
      'src/plugins/player/utils.ts',
      'src/plugins/player/index.ts',
      'src/screens/PlayDetail/components/SettingPopup/settings/SettingPitch.tsx',
      'src/screens/PlayDetail/components/SettingPopup/settings/SettingPlaybackRate.tsx',
      'src/config/defaultSetting.ts',
      'src/types/app_setting.d.ts',
    ],
    upstreamMergeRisk: 'high',
    desktopPortNotes: '桌面端不能直接复用 Android 原生模块，但变调/变速状态管理、接口定义和 seek 稳定策略可以复用，底层实现需改为 Electron/Node 原生音频引擎。',
  },
  {
    id: 'manual_profile_analysis',
    name: '手动调号节拍分析与 LRC 写回模块',
    summary: '将耗资源的节拍/调号分析改成手动触发，提供进度反馈，并把分析结果写入 LRC 头部与本地 profile 缓存。',
    platform: ['android', 'mobile-js', 'desktop-portable'],
    files: [
      'android/app/src/main/java/cn/toside/music/mobile/mixer/MixerModule.java',
      'src/core/musicProfile.ts',
      'src/core/music/local.ts',
      'src/screens/PlayDetail/components/KeyInfoBtn.tsx',
    ],
    upstreamMergeRisk: 'medium',
    desktopPortNotes: '分析结果写回 LRC 的格式和缓存协议可直接复用，桌面端只需替换原生解码/分析执行层。',
  },
  {
    id: 'lyric_stage_projection',
    name: '歌词舞台投影模块',
    summary: '新增独立歌词舞台页面，包含纯黑投影、低耗模式、1 秒自动收起菜单、跑马灯配色、手动横竖屏、内置中文字体与更强全屏沉浸。',
    platform: ['android', 'mobile-js', 'desktop-portable'],
    files: [
      'src/screens/LyricStage/index.tsx',
      'src/screens/PlayDetail/components/LyricStageBtn.tsx',
      'src/navigation/screenNames.ts',
      'src/navigation/navigation.ts',
      'src/navigation/registerScreens.tsx',
      'src/screens/index.ts',
      'src/utils/nativeModules/utils.ts',
      'android/app/src/main/java/cn/toside/music/mobile/utils/UtilsModule.java',
      'android/app/src/main/assets/fonts/NotoSansCJKsc-Regular.otf',
    ],
    upstreamMergeRisk: 'high',
    desktopPortNotes: '桌面端最适合迁移这一块。页面状态和样式可基本复用，原生全屏/屏幕方向/状态栏控制需替换为 Electron BrowserWindow API。',
  },
  {
    id: 'seek_sync',
    name: '进度条拖动与歌词重同步模块',
    summary: '修复底部进度条公式、seek 期间的旧轮询抢写、seek 后歌词重同步与原生 mixer seek 稳定恢复。',
    platform: ['android', 'mobile-js'],
    files: [
      'src/store/player/action.ts',
      'src/core/init/player/playProgress.ts',
      'src/core/init/player/lyric.ts',
      'src/components/player/Progress.tsx',
      'src/components/player/ProgressBar.tsx',
      'android/app/src/main/java/cn/toside/music/mobile/mixer/MixerModule.java',
    ],
    upstreamMergeRisk: 'high',
    desktopPortNotes: '桌面端进度条与歌词同步逻辑可复用，但底层 seek 完成时机需重新对接桌面播放器接口。',
  },
]

export default customModuleManifest
