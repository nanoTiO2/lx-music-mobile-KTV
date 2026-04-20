export type DesktopPortStage = 'ready_now' | 'needs_adapter' | 'rewrite_required'

export interface DesktopPortModulePlan {
  id: string
  stage: DesktopPortStage
  why: string
  firstFiles: string[]
}

export const desktopPortModulePlan: DesktopPortModulePlan[] = [
  {
    id: 'local_offline_import_cache',
    stage: 'ready_now',
    why: '主要是 TypeScript 业务逻辑，本地优先和缓存复用策略可以直接平移。',
    firstFiles: [
      'src/core/music/local.ts',
      'src/screens/Home/Views/Mylist/MyList/listAction.ts',
      'src/components/MetadataEditModal/MetadataForm.tsx',
    ],
  },
  {
    id: 'manual_profile_analysis',
    stage: 'needs_adapter',
    why: 'LRC 写回协议已经抽到 shared 层，但分析执行器需要接桌面音频引擎。',
    firstFiles: [
      'src/shared/musicProfileTag.ts',
      'src/core/musicProfile.ts',
      'src/desktopPort/contracts.ts',
    ],
  },
  {
    id: 'lyric_stage_projection',
    stage: 'needs_adapter',
    why: '页面状态和配色配置可复用，但全屏/置顶/窗口控制需要桌面窗口适配层。',
    firstFiles: [
      'src/shared/lyricStagePresets.ts',
      'src/screens/LyricStage/index.tsx',
      'src/desktopPort/contracts.ts',
    ],
  },
  {
    id: 'seek_sync',
    stage: 'needs_adapter',
    why: '歌词重同步逻辑可复用，但 seek 完成时机要由桌面播放器驱动。',
    firstFiles: [
      'src/core/init/player/playProgress.ts',
      'src/core/init/player/lyric.ts',
      'src/desktopPort/contracts.ts',
    ],
  },
  {
    id: 'mixer_pitch_seek',
    stage: 'rewrite_required',
    why: 'Android 原生 MixerModule 无法直接迁移，桌面端要另做音频底层实现。',
    firstFiles: [
      'android/app/src/main/java/cn/toside/music/mobile/mixer/MixerModule.java',
      'src/utils/nativeModules/mixer.ts',
      'src/plugins/player/utils.ts',
    ],
  },
]

export default desktopPortModulePlan
