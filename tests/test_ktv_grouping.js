const assert = require('node:assert/strict')

const { buildKtvGroups, filterKtvDisplayFiles } = require('../src/utils/ktv')

const files = [
  '阿梨粤&R7-晚风心里吹(DJ版).lrc',
  '阿梨粤&R7-晚风心里吹(DJ版).mp3',
  '阿梨粤&R7-晚风心里吹(DJ版)htdemucs_minus_other.mp3',
  '阿梨粤&R7-晚风心里吹(DJ版)htdemucs_minus_vocals.mp3',
  '阿梨粤&R7-晚风心里吹(DJ版)htdemucs_vocals.mp3',
  '别怕我伤心 (DJ九零版) - 半吨兄弟.lrc',
  '别怕我伤心 (DJ九零版) - 半吨兄弟.mp3',
  '别怕我伤心 (DJ九零版) - 半吨兄弟htdemucs_minus_other.mp3',
  '别怕我伤心 (DJ九零版) - 半吨兄弟htdemucs_minus_vocals.mp3',
  '别怕我伤心 (DJ九零版) - 半吨兄弟htdemucs_vocals.mp3',
]
  .filter(name => /\.(mp3|flac|wav|ogg|m4a|aac|ape)$/i.test(name))
  .map(name => ({
    name,
    path: `C:/fixture/${name}`,
  }))

const displayFiles = filterKtvDisplayFiles(files)
assert.deepEqual(displayFiles.map(file => file.name).sort(), [
  '阿梨粤&R7-晚风心里吹(DJ版).mp3',
  '别怕我伤心 (DJ九零版) - 半吨兄弟.mp3',
].sort())

const variantOnlyFiles = [
  '测试歌曲htdemucs_minus_other.mp3',
  '测试歌曲htdemucs_minus_vocals.mp3',
  '测试歌曲htdemucs_vocals.mp3',
].map(name => ({
  name,
  path: `C:/fixture/${name}`,
}))
assert.deepEqual(filterKtvDisplayFiles(variantOnlyFiles), [])

const groups = [...buildKtvGroups(files).values()]
assert.equal(groups.length, 2)

const firstGroup = groups.find(group => group.baseName === '阿梨粤&R7-晚风心里吹(DJ版)')
assert.ok(firstGroup)
assert.equal(firstGroup.mains[0].name, '阿梨粤&R7-晚风心里吹(DJ版).mp3')
assert.equal(firstGroup.variants.htdemucs_minus_other[0].name, '阿梨粤&R7-晚风心里吹(DJ版)htdemucs_minus_other.mp3')
assert.equal(firstGroup.variants.htdemucs_minus_vocals[0].name, '阿梨粤&R7-晚风心里吹(DJ版)htdemucs_minus_vocals.mp3')
assert.equal(firstGroup.variants.htdemucs_vocals[0].name, '阿梨粤&R7-晚风心里吹(DJ版)htdemucs_vocals.mp3')

const secondGroup = groups.find(group => group.baseName === '别怕我伤心 (DJ九零版) - 半吨兄弟')
assert.ok(secondGroup)
assert.equal(secondGroup.mains[0].name, '别怕我伤心 (DJ九零版) - 半吨兄弟.mp3')
assert.equal(secondGroup.variants.htdemucs_minus_other[0].name, '别怕我伤心 (DJ九零版) - 半吨兄弟htdemucs_minus_other.mp3')
assert.equal(secondGroup.variants.htdemucs_minus_vocals[0].name, '别怕我伤心 (DJ九零版) - 半吨兄弟htdemucs_minus_vocals.mp3')
assert.equal(secondGroup.variants.htdemucs_vocals[0].name, '别怕我伤心 (DJ九零版) - 半吨兄弟htdemucs_vocals.mp3')

console.log('KTV grouping test passed')
