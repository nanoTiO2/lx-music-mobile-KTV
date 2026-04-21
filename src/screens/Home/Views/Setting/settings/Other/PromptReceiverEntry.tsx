import { memo } from 'react'
import { StyleSheet, View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import commonState from '@/store/common/state'
import { pushPromptControlScreen, pushPromptReceiverScreen } from '@/navigation/navigation'

export default memo(() => {
  const t = useI18n()

  const handleOpenController = () => {
    const componentId = commonState.componentIds.home
    if (!componentId) return
    pushPromptControlScreen(componentId)
  }

  const handleOpenReceiver = () => {
    const componentId = commonState.componentIds.home
    if (!componentId) return
    pushPromptReceiverScreen(componentId)
  }

  return (
    <SubTitle title={t('setting_other_prompt_receiver')}>
      <View style={styles.desc}>
        <Text>{t('setting_other_prompt_receiver_desc')}</Text>
      </View>
      <View style={styles.btnRow}>
        <View style={styles.btn}>
          <Button onPress={handleOpenController}>{t('setting_other_prompt_control_open')}</Button>
        </View>
        <View style={styles.btn}>
          <Button onPress={handleOpenReceiver}>{t('setting_other_prompt_receiver_open')}</Button>
        </View>
      </View>
    </SubTitle>
  )
})

const styles = StyleSheet.create({
  desc: {
    marginBottom: 6,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flexDirection: 'row',
    flex: 1,
  },
})
