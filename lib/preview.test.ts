import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugBranch, previewUrl } from './preview.ts'

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
