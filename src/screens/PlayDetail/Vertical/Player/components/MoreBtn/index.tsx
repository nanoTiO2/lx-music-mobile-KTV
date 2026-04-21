import { createStyle } from '@/utils/tools'
import { View } from 'react-native'
import PlayModeBtn from './PlayModeBtn'
import MusicAddBtn from './MusicAddBtn'
import DownloadBtn from './DownloadBtn'
import CommentBtn from './CommentBtn'
import KtvBtn from '@/screens/PlayDetail/components/KtvBtn'
import LyricStageBtn from '@/screens/PlayDetail/components/LyricStageBtn'
import KeyInfoBtn from '@/screens/PlayDetail/components/KeyInfoBtn'
import SystemVolumeBtn from '@/screens/PlayDetail/components/SystemVolumeBtn'

export default () => {
  return (
    <View style={styles.container}>
      <KeyInfoBtn direction="vertical" />
      <SystemVolumeBtn direction="vertical" />
      <LyricStageBtn direction="vertical" />
      <KtvBtn direction="vertical" />
      <DownloadBtn />
      <MusicAddBtn />
      <PlayModeBtn />
      <CommentBtn />
    </View>
  )
}


const styles = createStyle({
  container: {
    // flexShrink: 0,
    // flexGrow: 0,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    // backgroundColor: 'rgba(0,0,0,0.1)',
  },
})
