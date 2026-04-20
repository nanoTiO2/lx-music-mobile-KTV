export const LYRIC_STAGE_FONT_OPTIONS = [
  { label: '默认', value: '' },
  { label: '思源黑体', value: 'NotoSansCJKsc-Regular' },
  { label: '黑体', value: 'sans-serif' },
  { label: '雅黑', value: 'sans-serif-light' },
  { label: '中黑', value: 'sans-serif-medium' },
  { label: '特黑', value: 'sans-serif-black' },
  { label: '圆体', value: 'sans-serif-smallcaps' },
  { label: '衬线', value: 'serif' },
  { label: '等宽', value: 'monospace' },
  { label: '窄体', value: 'sans-serif-condensed' },
] as const

export const LYRIC_STAGE_COLOR_THEMES = {
  emerald: {
    label: '翠绿',
    background: '#050505',
    backgroundProjector: '#07110b',
    active: '#80f7a6',
    inactive: '#f0f0f0',
    sub: '#9ee4b0',
    accent: 'rgba(128,247,166,0.18)',
  },
  amber: {
    label: '琥珀',
    background: '#080604',
    backgroundProjector: '#1a1208',
    active: '#ffd36a',
    inactive: '#fff5d6',
    sub: '#ffdd98',
    accent: 'rgba(255,211,106,0.18)',
  },
  ice: {
    label: '冰蓝',
    background: '#03070b',
    backgroundProjector: '#07131a',
    active: '#87e7ff',
    inactive: '#e8fbff',
    sub: '#afefff',
    accent: 'rgba(135,231,255,0.18)',
  },
  rose: {
    label: '玫红',
    background: '#0a0407',
    backgroundProjector: '#17080e',
    active: '#ff95b8',
    inactive: '#ffe9f0',
    sub: '#ffc2d5',
    accent: 'rgba(255,149,184,0.18)',
  },
  mono: {
    label: '黑白',
    background: '#050505',
    backgroundProjector: '#0d0d0d',
    active: '#ffffff',
    inactive: '#d6d6d6',
    sub: '#a8a8a8',
    accent: 'rgba(255,255,255,0.12)',
  },
} as const

export const LYRIC_STAGE_MODE_LABELS = {
  full: '满屏',
  threeLine: '三行',
  teleprompter: '提词器',
} as const

export const LYRIC_STAGE_MIRROR_LABELS = {
  none: '正常',
  horizontal: '左右镜像',
  vertical: '上下镜像',
} as const

export const LYRIC_STAGE_MODE_ORDER = ['full', 'threeLine', 'teleprompter'] as const
export const LYRIC_STAGE_MIRROR_ORDER = ['none', 'horizontal', 'vertical'] as const
export const LYRIC_STAGE_ROTATE_ORDER = ['auto', 'landscape', 'portrait'] as const
export const LYRIC_STAGE_ROTATE_LABELS = {
  auto: '自动转向',
  landscape: '锁横屏',
  portrait: '锁竖屏',
} as const
export const LYRIC_STAGE_MARQUEE_THEME_ORDER = ['emerald', 'amber', 'ice', 'rose', 'mono'] as const
