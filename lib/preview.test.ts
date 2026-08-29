import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugBranch, previewUrl, previewSize } from './preview.ts'

test('previewSize buckets the recorded width', () => {
  assert.equal(previewSize(0), null)
  assert.equal(previewSize(375), 'mobile')
  assert.equal(previewSize(753), 'tablet')
  assert.equal(previewSize(1440), 'desktop')
})

test('slugBranch follows Vercel alias rules', () => {
  assert.equal(slugBranch('main'), 'main')
  assert.equal(slugBranch('feature/x'), 'feature-x')
  assert.equal(slugBranch('Feature/New_Thing'), 'feature-new-thing')
  assert.equal(slugBranch('fix/--trailing--'), 'fix-trailing')
})

test('previewUrl builds the branch alias', () => {
  assert.equal(
    previewUrl('acme-site', 'feature/x', 'cascade'),
    'https://acme-site-git-feature-x-cascade.vercel.app',
  )
})
