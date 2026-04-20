import Btn from './Btn'
import { navigations } from '@/navigation'
import commonState from '@/store/common/state'
import { usePlayMusicInfo } from '@/store/player/hook'
import { useTheme } from '@/store/theme/hook'


export default () => {
  const theme = useTheme()
  const playMusicInfo = usePlayMusicInfo()
  const isLocalFile = !!playMusicInfo.musicInfo && !('progress' in playMusicInfo.musicInfo) && playMusicInfo.musicInfo.source == 'local'
  const handleShowCommentScreen = () => {
    if (isLocalFile) return
    navigations.pushCommentScreen(commonState.componentIds.playDetail!)
  }

  return <Btn icon="comment" color={isLocalFile ? theme['c-600'] : undefined} disabled={isLocalFile} onPress={handleShowCommentScreen} />
}
