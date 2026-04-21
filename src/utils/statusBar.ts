import { Dimensions, StatusBar } from 'react-native'

const getWindowStatusBarGap = () => {
  const screen = Dimensions.get('screen')
  const window = Dimensions.get('window')
  if (screen.height < screen.width) return 0
  const gap = Math.round(screen.height - window.height)
  return gap > 0 && gap < 80 ? gap : 0
}

export const getStatusBarHeightSafe = () => {
  return Math.max(StatusBar.currentHeight ?? 0, getWindowStatusBarGap())
}
