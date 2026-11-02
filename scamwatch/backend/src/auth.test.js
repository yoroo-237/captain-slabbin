import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from './auth.js'

test('password hash verifies the right password only', async () => {
  const stored = await hashPassword('correct horse')
  assert.match(stored, /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/)
  assert.equal(await verifyPassword('correct horse', stored), true)
  assert.equal(await verifyPassword('wrong horse', stored), false)
})

test('two hashes of the same password differ (random salt)', async () => {
  assert.notEqual(await hashPassword('same'), await hashPassword('same'))
})

test('malformed stored hash is refused', async () => {
  assert.equal(await verifyPassword('x', 'plain-text'), false)
  assert.equal(await verifyPassword('x', ''), false)
})
