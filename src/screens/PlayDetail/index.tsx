import { useEffect } from 'react'
import { StatusBar as RNStatusBar } from 'react-native'
import { Navigation } from 'react-native-navigation'
// import { View, StyleSheet } from 'react-native'
import { useHorizontalMode } from '@/utils/hooks'

import Vertical from './Vertical'
import Horizontal from './Horizontal'
import PageContent from '@/components/PageContent'
import StatusBar from '@/components/common/StatusBar'
import { setComponentId, setStatusbarHeight } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import { useNavigationComponentDidAppear } from '@/navigation/hooks'
import { getStatusBarStyle } from '@/navigation/utils'
import { screenUnkeepAwake, setImmersiveMode, setScreenOrientation } from '@/utils/nativeModules/utils'
import { getStatusBarHeightSafe } from '@/utils/statusBar'
import themeState from '@/store/theme/state'

export default ({ componentId }: { componentId: string }) => {
  const isHorizontalMode = useHorizontalMode()

  useEffect(() => {
    setComponentId(COMPONENT_IDS.playDetail, componentId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useNavigationComponentDidAppear(componentId, () => {
    const theme = themeState.theme
    const syncStatusbarHeight = () => {
      setStatusbarHeight(getStatusBarHeightSafe())
    }
    screenUnkeepAwake()
    void setScreenOrientation('auto').catch(() => {})
    void setImmersiveMode(false).catch(() => {})
    RNStatusBar.setHidden(false, 'fade')
    RNStatusBar.setBarStyle(theme.isDark ? 'light-content' : 'dark-content', true)
    RNStatusBar.setTranslucent(true)
    RNStatusBar.setBackgroundColor('transparent', true)
    syncStatusbarHeight()
    setTimeout(syncStatusbarHeight, 32)
    setTimeout(syncStatusbarHeight, 120)
    setTimeout(syncStatusbarHeight, 260)
    Navigation.mergeOptions(componentId, {
      statusBar: {
        drawBehind: true,
        visible: true,
        style: getStatusBarStyle(theme.isDark),
        backgroundColor: 'transparent',
      },
      navigationBar: {
        backgroundColor: theme['c-content-background'],
      },
      layout: {
        componentBackgroundColor: theme['c-content-background'],
      },
    })
  })

  return (
    <PageContent>
      <StatusBar />
      {
        isHorizontalMode
          ? <Horizontal componentId={componentId} />
          : <Vertical componentId={componentId} />
      }
    </PageContent>
  )
}
