import { memo } from 'react'
import { TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW } from '@/utils/pixelRatio'
import * as navigations from '@/navigation/navigation'
import commonState from '@/store/common/state'
import { createStyle } from '@/utils/tools'

const BTN_SIZES = {
  vertical: {
    width: scaleSizeW(36),
    icon: 24,
    marginLeft: 5,
  },
  horizontal: {
    width: scaleSizeW(32),
    icon: 22,
    marginBottom: 5,
  },
} as const

const getBtnOffsets = (direction: 'vertical' | 'horizontal') => {
  return direction == 'vertical'
    ? {
        marginLeft: BTN_SIZES.vertical.marginLeft,
        marginBottom: 0,
      }
    : {
        marginLeft: 0,
        marginBottom: BTN_SIZES.horizontal.marginBottom,
      }
}

export default memo(({ direction }: {
  direction: 'vertical' | 'horizontal'
}) => {
  const theme = useTheme()
  const btnStyle = BTN_SIZES[direction]
  const btnOffsets = getBtnOffsets(direction)

  const handleOpen = () => {
    const componentId = commonState.componentIds.playDetail
    if (!componentId) return
    navigations.pushLyricStageScreen(componentId)
  }

  return (
    <TouchableOpacity
      style={{
        ...styles.btn,
        width: btnStyle.width,
        height: btnStyle.width,
        marginLeft: btnOffsets.marginLeft,
        marginBottom: btnOffsets.marginBottom,
      }}
      activeOpacity={0.5}
      onPress={handleOpen}
    >
      <Icon name="lyric-on" color={theme['c-font-label']} size={btnStyle.icon} />
    </TouchableOpacity>
  )
})

const styles = createStyle({
  btn: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
})
