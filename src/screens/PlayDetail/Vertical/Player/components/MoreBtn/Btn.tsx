import { TouchableOpacity } from 'react-native'
import { Icon } from '@/components/common/Icon'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { scaleSizeW } from '@/utils/pixelRatio'

export const BTN_WIDTH = scaleSizeW(36)
export const BTN_ICON_SIZE = 24

export default ({ icon, color, disabled = false, onPress, onLongPress }: {
  icon: string
  color?: string
  disabled?: boolean
  onPress: () => void
  onLongPress?: () => void
}) => {
  const theme = useTheme()
  return (
    <TouchableOpacity
      style={{ ...styles.cotrolBtn, width: BTN_WIDTH, height: BTN_WIDTH, opacity: disabled ? 0.45 : 1 }}
      activeOpacity={0.5}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <Icon name={icon} color={color ?? (disabled ? theme['c-600'] : theme['c-font-label'])} size={BTN_ICON_SIZE} />
    </TouchableOpacity>
  )
}

const styles = createStyle({
  cotrolBtn: {
    marginLeft: 5,
    justifyContent: 'center',
    alignItems: 'center',

    // backgroundColor: '#ccc',
    shadowOpacity: 1,
    textShadowRadius: 1,
  },
})
