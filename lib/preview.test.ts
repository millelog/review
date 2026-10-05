import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugBranch, previewUrl, previewSize, startUrl } from './preview.ts'

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

test('startUrl opens a page on the preview, never another origin', () => {
  const base = 'https://acme-site-git-main-cascade.vercel.app'
  assert.equal(startUrl(base, undefined), base)
  assert.equal(startUrl(base, '/dining?town=x#map'), `${base}/dining?town=x#map`)
  assert.equal(startUrl(base, '//evil.com/x'), base)
  assert.equal(startUrl(base, 'https://evil.com'), base)
  assert.equal(startUrl(base, ['/a', '/b']), base)
})
