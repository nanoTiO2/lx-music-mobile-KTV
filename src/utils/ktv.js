const EXACT_SUFFIX_RULES = [
  { key: 'htdemucs_minus_vocals', suffixes: ['htdemucs_minus_vocals'] },
  { key: 'htdemucs_minus_other', suffixes: ['htdemucs_minus_other'] },
  { key: 'htdemucs_vocals', suffixes: ['htdemucs_vocals'] },
  { key: 'minus_vocals', suffixes: ['minus_vocals', 'minus-vocals', 'minus vocals'] },
  { key: 'minus_other', suffixes: ['minus_other', 'minus-other', 'minus other'] },
  { key: 'vocals', suffixes: ['vocals', 'vocal'] },
  { key: 'bgm', suffixes: ['bgm', '伴奏', 'karaoke', 'instrumental', 'inst'] },
  { key: 'others', suffixes: ['others', 'other'] },
  { key: 'bass', suffixes: ['bass'] },
  { key: 'drums', suffixes: ['drums', 'drum'] },
]

const TRAILING_SEPARATOR = /[\s_.-]+$/u
const LEADING_SEPARATOR = /^[\s_.-]+/u

const splitExt = (name) => {
  const index = name.lastIndexOf('.')
  return index > -1
    ? { baseName: name.slice(0, index), ext: name.slice(index + 1) }
    : { baseName: name, ext: '' }
}

const trimTrailingSeparator = (name) => name.replace(TRAILING_SEPARATOR, '').trim()
const trimLeadingSeparator = (name) => name.replace(LEADING_SEPARATOR, '').trim()

const normalizeGroupText = (name) => name
  .toLowerCase()
  .replace(/[\s_.\-()[\]\u3010\u3011\uff08\uff09]+/gu, '')
  .trim()

const createGroupKey = (info) => normalizeGroupText(info.baseName) || info.baseName.toLowerCase()
const getComparableBaseName = (name) => normalizeGroupText(name)

const getLongestCommonPrefixLength = (a, b) => {
  const size = Math.min(a.length, b.length)
  let index = 0
  while (index < size && a[index] === b[index]) index += 1
  return index
}

const getLevenshteinDistance = (a, b) => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1]
    for (let j = 0; j < b.length; j += 1) {
      const insert = current[j] + 1
      const remove = previous[j + 1] + 1
      const replace = previous[j] + (a[i] === b[j] ? 0 : 1)
      current.push(Math.min(insert, remove, replace))
    }
    previous = current
  }
  return previous[b.length]
}

const isHighlySimilarBaseName = (source, target) => {
  if (!source || !target) return false
  if (source === target) return true
  if (source.includes(target) || target.includes(source)) return true

  const prefixLength = getLongestCommonPrefixLength(source, target)
  const prefixRatio = prefixLength / Math.max(source.length, target.length)
  if (prefixLength >= 8 && prefixRatio >= 0.72) return true

  const distance = getLevenshteinDistance(source, target)
  const maxLength = Math.max(source.length, target.length)
  return distance <= 2 || distance / maxLength <= 0.12
}

const matchSuffix = (stem, suffix) => {
  const lowerStem = stem.toLowerCase()
  const lowerSuffix = suffix.toLowerCase()
  if (!lowerStem.endsWith(lowerSuffix)) return null
  const cutIndex = stem.length - suffix.length
  const prefix = trimTrailingSeparator(stem.slice(0, cutIndex))
  if (!prefix) return null
  return {
    baseName: prefix,
    variant: lowerSuffix.replace(/[\s-]+/g, '_'),
    variantLabel: trimLeadingSeparator(stem.slice(cutIndex)),
  }
}

const detectKtvVariant = (name) => {
  const { baseName, ext } = splitExt(name)
  const stem = baseName.trim()
  for (const rule of EXACT_SUFFIX_RULES) {
    const sortedSuffixes = [...rule.suffixes].sort((a, b) => b.length - a.length)
    for (const suffix of sortedSuffixes) {
      const matched = matchSuffix(stem, suffix)
      if (!matched) continue
      return {
        baseName: matched.baseName,
        ext,
        variant: rule.key,
        variantLabel: matched.variantLabel,
      }
    }
  }

  return {
    baseName: stem,
    ext,
    variant: 'main',
    variantLabel: '',
  }
}

const createDecoratedFile = (file, info) => ({
  ...file,
  variant: info.variant,
  variantLabel: info.variantLabel,
})

const selectRepresentativeMain = (mains) => {
  return [...mains].sort((a, b) => {
    if (a.name.length !== b.name.length) return a.name.length - b.name.length
    return a.name.localeCompare(b.name)
  })[0]
}

const buildKtvGroups = (files) => {
  const groups = new Map()
  for (const file of files) {
    const info = detectKtvVariant(file.name)
    const groupKey = createGroupKey(info)
    let group = groups.get(groupKey)
    if (!group) {
      group = {
        baseName: info.baseName,
        ext: info.ext,
        mains: [],
        variants: {},
      }
      groups.set(groupKey, group)
    } else if (info.baseName.length < group.baseName.length) {
      group.baseName = info.baseName
    }

    const decoratedFile = createDecoratedFile(file, info)
    if (info.variant === 'main') {
      group.mains.push(decoratedFile)
      if (!group.ext && info.ext) group.ext = info.ext
    } else {
      if (!group.variants[info.variant]) group.variants[info.variant] = []
      group.variants[info.variant].push(decoratedFile)
    }
  }
  return mergeSimilarGroups(groups)
}

const mergeGroupInto = (target, source) => {
  target.baseName = target.baseName.length <= source.baseName.length ? target.baseName : source.baseName
  if (!target.ext && source.ext) target.ext = source.ext
  if (source.mains.length) target.mains.push(...source.mains)
  for (const [variant, files] of Object.entries(source.variants)) {
    if (!target.variants[variant]) target.variants[variant] = []
    target.variants[variant].push(...files)
  }
}

const mergeSimilarGroups = (groups) => {
  const mergedGroups = []
  for (const group of groups.values()) {
    const groupComparableName = getComparableBaseName(group.baseName)
    const targetGroup = mergedGroups.find(item => {
      if (item.ext && group.ext && item.ext !== group.ext) return false
      return isHighlySimilarBaseName(item.comparableName, groupComparableName)
    })
    if (targetGroup) {
      mergeGroupInto(targetGroup.group, group)
      targetGroup.comparableName = getComparableBaseName(targetGroup.group.baseName)
      continue
    }
    mergedGroups.push({
      comparableName: groupComparableName,
      group,
    })
  }

  return new Map(mergedGroups.map((item, index) => [String(index), item.group]))
}

const filterKtvDisplayFiles = (files) => {
  const result = []
  for (const group of buildKtvGroups(files).values()) {
    if (!group.mains.length) continue
    result.push(selectRepresentativeMain(group.mains))
  }
  return result
}

module.exports = {
  detectKtvVariant,
  buildKtvGroups,
  filterKtvDisplayFiles,
}
