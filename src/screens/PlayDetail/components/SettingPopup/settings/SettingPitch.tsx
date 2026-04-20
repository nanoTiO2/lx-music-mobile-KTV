import { useState } from 'react'
import { View } from 'react-native'
import { useTheme } from '@/store/theme/hook'
import Text from '@/components/common/Text'
import Slider, { type SliderProps } from '@/components/common/Slider'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import styles from './style'
import { setPitch } from '@/plugins/player'
import ButtonPrimary from '@/components/common/ButtonPrimary'
import settingState from '@/store/setting/state'
import { useSettingValue } from '@/store/setting/hook'

const MIN_VALUE = -12
const MAX_VALUE = 12

export default () => {
  const theme = useTheme()
  const t = useI18n()
  const pitchSemitones = useSettingValue('player.pitchSemitones')
  const [sliderValue, setSliderValue] = useState(pitchSemitones)
  const [isSliding, setSliding] = useState(false)

  const handleSlidingStart: SliderProps['onSlidingStart'] = () => {
    setSliding(true)
  }
  const handleValueChange: SliderProps['onValueChange'] = value => {
    value = Math.trunc(value)
    setSliderValue(value)
  }
  const handleSlidingComplete: SliderProps['onSlidingComplete'] = value => {
    setSliding(false)
    value = Math.trunc(value)
    void setPitch(value)
    if (pitchSemitones == value) return
    updateSetting({ 'player.pitchSemitones': value })
  }
  const handleReset = () => {
    if (settingState.setting['player.pitchSemitones'] == 0) return
    setSliderValue(0)
    void setPitch(0)
    updateSetting({ 'player.pitchSemitones': 0 })
  }

  const value = isSliding ? sliderValue : pitchSemitones
  const label = value > 0 ? `+${value}` : `${value}`

  return (
    <View style={styles.container}>
      <Text>{t('play_detail_setting_pitch_shift')}</Text>
      <View style={styles.content}>
        <Text style={styles.label} color={theme['c-font-label']}>{`${label} st`}</Text>
        <Slider
          minimumValue={MIN_VALUE}
          maximumValue={MAX_VALUE}
          onSlidingComplete={handleSlidingComplete}
          onValueChange={handleValueChange}
          onSlidingStart={handleSlidingStart}
          step={1}
          value={pitchSemitones}
        />
      </View>
      <ButtonPrimary onPress={handleReset}>{t('play_detail_setting_pitch_shift_reset')}</ButtonPrimary>
    </View>
  )
}
