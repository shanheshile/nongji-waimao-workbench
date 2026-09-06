import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLocalImageCandidates,
  isLocalDemoSvg,
  localImageCandidateAt,
} from '../src/lib/product-media.js'

test('图片候选仅保留本地 SVG，按精确归属顺序去重', () => {
  const candidates = buildLocalImageCandidates('/assets/demo-main.svg', [
    '/assets/demo-main.svg',
    '/assets/demo-main-side.svg',
    'assets/missing-leading-slash.svg',
    '/other/outside.svg',
    '/assets/../outside.svg',
    '/assets/demo-photo.png',
  ])

  assert.deepEqual(candidates, ['/assets/demo-main.svg', '/assets/demo-main-side.svg'])
  assert.equal(isLocalDemoSvg('/assets/sub/demo-view.svg'), true)
  assert.equal(isLocalDemoSvg('/assets/../../private.svg'), false)
})

test('候选可逐个回退，耗尽后明确返回空而不借用其他产品图', () => {
  const candidates = buildLocalImageCandidates('/assets/demo-main.svg', ['/assets/demo-side.svg'])

  assert.equal(localImageCandidateAt(candidates, 0), '/assets/demo-main.svg')
  assert.equal(localImageCandidateAt(candidates, 1), '/assets/demo-side.svg')
  assert.equal(localImageCandidateAt(candidates, 2), null)
  assert.equal(localImageCandidateAt(candidates, -1), null)
})
