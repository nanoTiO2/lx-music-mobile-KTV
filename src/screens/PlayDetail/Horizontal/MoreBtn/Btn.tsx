import { TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW } from '@/utils/pixelRatio'

export const BTN_WIDTH = scaleSizeW(32)
export const BTN_ICON_SIZE = 22

export default ({ icon, color, onPress, disabled = false }: {
  icon: string
  color?: string
  onPress: () => void
  disabled?: boolean
}) => {
  const theme = useTheme()
  return (
    <TouchableOpacity disabled={disabled} style={{ ...styles.cotrolBtn, width: BTN_WIDTH, height: BTN_WIDTH, opacity: disabled ? 0.52 : 1 }} activeOpacity={0.5} onPress={onPress}>
      <Icon name={icon} color={color ?? theme['c-font-label']} size={BTN_ICON_SIZE} />
    </TouchableOpacity>
  )
}

const styles = createStyle({
  cotrolBtn: {
    marginBottom: 5,
    justifyContent: 'center',
    alignItems: 'center',

    // backgroundColor: '#ccc',
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
})
