import { createAndStartDownloadTask, startDownloadTask } from '@/core/download'
import settingState from '@/store/setting/state'
import { usePlayMusicInfo } from '@/store/player/hook'
import { toast } from '@/utils/tools'
import Btn from './Btn'
import { useTheme } from '@/store/theme/hook'


export default () => {
  const theme = useTheme()
  const playMusicInfo = usePlayMusicInfo()
  const musicInfo = playMusicInfo.musicInfo
  const isLocalFile = !!musicInfo && !('progress' in musicInfo) && musicInfo.source == 'local'

  const handleDownload = () => {
    if (!musicInfo) return

    if ('progress' in musicInfo) {
      if (musicInfo.status == 'completed') {
        toast('\u5f53\u524d\u6b4c\u66f2\u5df2\u4e0b\u8f7d')
        return
      }
      void startDownloadTask(musicInfo.id).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '\u4e0b\u8f7d\u5931\u8d25'
        toast(message, 'long')
      })
      return
    }

    if (musicInfo.source == 'local') {
      toast('\u5f53\u524d\u6b4c\u66f2\u5df2\u662f\u672c\u5730\u6587\u4ef6')
      return
    }

    void createAndStartDownloadTask(musicInfo, settingState.setting['player.playQuality']).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : '\u4e0b\u8f7d\u5931\u8d25'
      toast(message, 'long')
    })
  }

  return <Btn icon="download-2" color={isLocalFile ? theme['c-600'] : undefined} disabled={isLocalFile} onPress={handleDownload} />
}
