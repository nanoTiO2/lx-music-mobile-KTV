import { useEffect } from 'react'
import { useHorizontalMode } from '@/utils/hooks'
import PageContent from '@/components/PageContent'
import { setComponentId, setNavActiveId } from '@/core/common'
import { COMPONENT_IDS } from '@/config/constant'
import Vertical from './Vertical'
import Horizontal from './Horizontal'
import { navigations } from '@/navigation'
import settingState from '@/store/setting/state'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { useCallback } from 'react'
import commonState from '@/store/common/state'


interface Props {
  componentId: string
}


export default ({ componentId }: Props) => {
  const isHorizontalMode = useHorizontalMode()

  useBackHandler(useCallback(() => {
    if (Object.keys(commonState.componentIds).length > 1) return false
    if (commonState.navActiveId == 'nav_setting') {
      setNavActiveId(commonState.lastNavActiveId)
      global.app_event.changeMenuVisible(true)
      return true
    }
    global.app_event.changeMenuVisible(true)
    return true
  }, []))

  useEffect(() => {
    setComponentId(COMPONENT_IDS.home, componentId)
    // eslint-disable-next-line react-hooks/exhaustive-deps

    if (settingState.setting['player.startupPushPlayDetailScreen']) {
      navigations.pushPlayDetailScreen(componentId, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PageContent>
      {
        isHorizontalMode
          ? <Horizontal />
          : <Vertical />
      }
    </PageContent>
  )
}
