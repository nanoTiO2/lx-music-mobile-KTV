import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Slider, { type SliderProps } from '../../components/Slider'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { setDesktopLyricBackgroundAlpha } from '@/core/desktopLyric'
import { updateSetting } from '@/core/common'

export default memo(() => {
  const opacity = useSettingValue('desktopLyric.style.backgroundOpacity')
  const theme = useTheme()
  const [sliderSize, setSliderSize] = useState(opacity)
  const [isSliding, setSliding] = useState(false)

  const handleSlidingStart = useCallback<NonNullable<SliderProps['onSlidingStart']>>(() => {
    setSliding(true)
  }, [])
  const handleValueChange = useCallback<NonNullable<SliderProps['onValueChange']>>(value => {
    setSliderSize(value)
  }, [])
  const handleSlidingComplete = useCallback<NonNullable<SliderProps['onSlidingComplete']>>(value => {
    if (opacity == value) return
    void setDesktopLyricBackgroundAlpha(value).then(() => {
      updateSetting({ 'desktopLyric.style.backgroundOpacity': value })
    }).finally(() => {
      setSliding(false)
    })
  }, [opacity])

  return (
    <SubTitle title="背景透明度">
      <View style={styles.content}>
        <Text style={{ color: theme['c-primary-font'] }}>{isSliding ? sliderSize : opacity}</Text>
        <Slider
          minimumValue={0}
          maximumValue={100}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={2}
          value={opacity}
        />
      </View>
    </SubTitle>
  )
})

const styles = createStyle({
  content: {
    flexGrow: 0,
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
  },
})
