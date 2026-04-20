import { createStyle } from '@/utils/tools'
import { View } from 'react-native'
import PlayModeBtn from './PlayModeBtn'
import MusicAddBtn from './MusicAddBtn'
import DownloadBtn from './DownloadBtn'
import TimeoutExitBtn from './TimeoutExitBtn'
import KtvBtn from '@/screens/PlayDetail/components/KtvBtn'
import LyricStageBtn from '@/screens/PlayDetail/components/LyricStageBtn'

export default () => {
  return (
    <View style={styles.container}>
      <TimeoutExitBtn />
      <LyricStageBtn direction="horizontal" />
      <KtvBtn direction="horizontal" />
      <DownloadBtn />
      <MusicAddBtn />
      <PlayModeBtn />
    </View>
  )
}


const styles = createStyle({
  container: {
    flexShrink: 0,
    flexGrow: 0,
    flexDirection: 'column',
    alignItems: 'center',
    // backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center',
    position: 'absolute',
    height: '100%',
    left: 12,
    top: 8,
    gap: 16,
    zIndex: 1,
  },
})
