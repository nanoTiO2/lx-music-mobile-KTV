import { memo, useRef, useState } from 'react'
import { View } from 'react-native'

import SubTitle from '../../components/SubTitle'
import Button from '../../components/Button'
import ChoosePath, { type ChoosePathType } from '@/components/common/ChoosePath'
import Text from '@/components/common/Text'
import { updateSetting } from '@/core/common'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle, toast } from '@/utils/tools'

export default memo(() => {
  const t = useI18n()
  const choosePathRef = useRef<ChoosePathType>(null)
  const [visible, setVisible] = useState(false)
  const importMusicDir = useSettingValue('list.importMusicDir')

  const handleSelect = () => {
    if (visible) {
      choosePathRef.current?.show({
        title: t('list_select_local_file_desc'),
        dirOnly: true,
        isPersist: true,
        initialDir: importMusicDir,
      })
      return
    }
    setVisible(true)
    requestAnimationFrame(() => {
      choosePathRef.current?.show({
        title: t('list_select_local_file_desc'),
        dirOnly: true,
        isPersist: true,
        initialDir: importMusicDir,
      })
    })
  }

  const handleClear = () => {
    updateSetting({ 'list.importMusicDir': '' })
  }

  const handleConfirm = (path: string) => {
    updateSetting({ 'list.importMusicDir': path })
    toast(t('setting_list_import_music_dir_saved_tip'))
  }

  return (
    <SubTitle title={t('setting_list_import_music_dir')}>
      <Text style={styles.desc}>{t('setting_list_import_music_dir_desc')}</Text>
      <Text selectable style={styles.path}>
        {importMusicDir || t('setting_list_import_music_dir_empty')}
      </Text>
      <View style={styles.actions}>
        <Button onPress={handleSelect}>{t('setting_list_import_music_dir_select')}</Button>
        <Button onPress={handleClear} disabled={!importMusicDir}>{t('setting_list_import_music_dir_clear')}</Button>
      </View>
      {visible ? <ChoosePath ref={choosePathRef} onConfirm={handleConfirm} /> : null}
    </SubTitle>
  )
})

const styles = createStyle({
  desc: {
    marginBottom: 8,
    opacity: 0.8,
  },
  path: {
    marginBottom: 10,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
})
