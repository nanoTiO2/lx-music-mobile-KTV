import { useState } from 'react'

import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import { useSettingValue } from '@/store/setting/hook'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import styles from './style'
import { setKtvVariantGain } from '@/plugins/player'

const MIN_GAIN = 60
const MAX_GAIN = 320

const SettingKtvVariantGain = () => {
  const theme = useTheme()
  const gain = Math.trunc(useSettingValue('player.ktvVariantGain') * 100)
  const [sliderValue, setSliderValue] = useState(gain)
  const [isSliding, setSliding] = useState(false)
  const t = useI18n()

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = value => {
    value = Math.trunc(value)
    setSliderValue(value)
    void setKtvVariantGain(value / 100)
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    value = Math.trunc(value)
    if (gain == value) return
    updateSetting({ 'player.ktvVariantGain': value / 100 })
  }

  return (
    <View style={styles.container}>
      <Text>{t('play_detail_setting_ktv_variant_gain')}</Text>
      <View style={styles.content}>
        <Text style={styles.label} color={theme['c-font-label']}>{`${isSliding ? sliderValue : gain}%`}</Text>
        <Slider
          minimumValue={MIN_GAIN}
          maximumValue={MAX_GAIN}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={1}
          value={gain}
        />
      </View>
    </View>
  )
}

export default SettingKtvVariantGain
