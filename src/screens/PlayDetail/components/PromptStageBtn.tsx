import { memo } from 'react'
import { TouchableOpacity } from 'react-native'

import * as navigations from '@/navigation/navigation'
import commonState from '@/store/common/state'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW } from '@/utils/pixelRatio'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'

const BTN_SIZES = {
  vertical: {
    width: scaleSizeW(38),
    marginLeft: 6,
    marginBottom: 0,
  },
  horizontal: {
    width: scaleSizeW(34),
    marginLeft: 0,
    marginBottom: 6,
  },
} as const

export default memo(({ direction }: {
  direction: 'vertical' | 'horizontal'
}) => {
  const theme = useTheme()
  const btnStyle = BTN_SIZES[direction]

  const handleOpen = () => {
    const componentId = commonState.componentIds.playDetail
    if (!componentId) return
    navigations.pushPromptControlScreen(componentId)
  }

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        {
          width: btnStyle.width,
          height: btnStyle.width,
          borderColor: theme['c-primary'],
          backgroundColor: 'rgba(92, 135, 255, 0.14)',
          marginLeft: btnStyle.marginLeft,
          marginBottom: btnStyle.marginBottom,
        },
      ]}
      activeOpacity={0.5}
      onPress={handleOpen}
    >
      <Text color={theme['c-primary']} size={direction == 'vertical' ? 13 : 12}>提</Text>
    </TouchableOpacity>
  )
})

const styles = createStyle({
  btn: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 999,
  },
})
