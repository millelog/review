import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { selectorFor, textOf } = createRequire(import.meta.url)('../public/embed.js')

type Attr = { name: string; value: string }
type El = {
  tagName: string
  id: string
  attributes: Attr[]
  parentElement: El | null
  children: El[]
}

function el(tagName: string, attrs: Record<string, string> = {}, children: El[] = []): El {
  const node: El = {
    tagName: tagName.toUpperCase(),
    id: attrs.id || '',
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    parentElement: null,
    children,
  }
  for (const child of children) child.parentElement = node
  return node
}

// Fake uniqueness oracle: a selector is unique unless listed as duplicated.
const uniq = (dupes: string[] = []) => (sel: string) => !dupes.includes(sel)

test('prefers a unique id', () => {
  assert.equal(selectorFor(el('div', { id: 'hero' }), uniq()), '#hero')
})

test('falls through a non-unique or invalid id', () => {
  assert.equal(selectorFor(el('div', { id: '2bad' }), uniq()), 'div')
  assert.equal(selectorFor(el('div', { id: 'dup' }), uniq(['#dup'])), 'div')
})

test('uses a stable data attribute when there is no id', () => {
  const node = el('button', { 'data-testid': 'save' })
  assert.equal(selectorFor(node, uniq()), 'button[data-testid="save"]')
})

test('ignores framework-generated data attributes', () => {
  const root = el('main', {}, [el('span', { 'data-nextjs-scroll-focus-boundary': '1' })])
  assert.equal(selectorFor(root.children[0], uniq()), 'main > span:nth-child(1)')
})

test('builds a structural path anchored at the nearest unique ancestor', () => {
  const target = el('a', {})
  const list = el('ul', {}, [el('li', {}), el('li', {}, [target])])
  el('section', { id: 'nav' }, [list])
  assert.equal(selectorFor(target, uniq()), '#nav > ul:nth-child(1) > li:nth-child(2) > a:nth-child(1)')
})

test('walks to the root when no ancestor is identifiable', () => {
  const target = el('p', {})
  el('html', {}, [el('body', {}, [target])])
  assert.equal(selectorFor(target, uniq()), 'html > body:nth-child(1) > p:nth-child(1)')
})

test('escapes quotes in data attribute values', () => {
  const node = el('div', { 'data-label': 'say "hi"' })
  assert.equal(selectorFor(node, uniq()), 'div[data-label="say \\"hi\\""]')
})

test('returns null for a non-element', () => {
  assert.equal(selectorFor(null, uniq()), null)
})

// textOf: the greppable handle an agent uses to find the element in source.
const node = (props: Record<string, string>) => ({
  innerText: props.innerText ?? '',
  textContent: props.textContent ?? '',
  getAttribute: (name: string) => props[name] ?? null,
})

test('collapses whitespace in the element text', () => {
  assert.equal(textOf(node({ innerText: '  Built for teams\n  that ship  ' })), 'Built for teams that ship')
})

test('falls back to alt then aria-label', () => {
  assert.equal(textOf(node({ alt: 'Team photo' })), 'Team photo')
  assert.equal(textOf(node({ 'aria-label': 'Close' })), 'Close')
  assert.equal(textOf(node({})), '')
})

test('truncates long text', () => {
  assert.equal(textOf(node({ innerText: 'x'.repeat(300) })).length, 120)
})
