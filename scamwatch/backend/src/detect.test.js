import test from 'node:test'
import assert from 'node:assert/strict'
import { detectType } from './detect.js'
import { parseTarget } from './target.js'

test('detects crypto scams', () => {
  const r = detectType('Send USDT to double your money, guaranteed profit')
  assert.equal(r.type, 'crypto_scam')
})

test('detects phishing', () => {
  const r = detectType('Verify your login here https://evil.example/x, account suspended')
  assert.equal(r.type, 'phishing')
})

test('detects impersonation (French)', () => {
  const r = detectType("Ce compte se fait passer pour moi, il usurpe mon identité")
  assert.equal(r.type, 'impersonation')
})

test('falls back to other', () => {
  assert.equal(detectType('hello').type, 'other')
})

test('parses targets', () => {
  assert.deepEqual(parseTarget('https://t.me/Some_Bot'), { tgId: null, username: 'some_bot', kind: 'bot' })
  assert.equal(parseTarget('@john_doe_99').username, 'john_doe_99')
  assert.equal(parseTarget('123456789').tgId, '123456789')
  assert.equal(parseTarget('x'), null)
})
