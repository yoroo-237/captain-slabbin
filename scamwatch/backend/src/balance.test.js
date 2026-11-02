import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateUsd, valueHoldings, tokensFor } from './balance.js'

const prices = { BTC: 50000, LTC: 100, ETH: null }

test('tokens come from the live USD balance', () => {
  const { balance } = valueHoldings([{ currency: 'BTC', amount: 0.0001 }, { currency: 'LTC', amount: 0.5 }], prices)
  assert.equal(balance, 55)
  assert.equal(tokensFor(balance, 1), 55)
  assert.equal(tokensFor(balance, 2.5), 22)
  assert.equal(tokensFor(0.99, 1), 0)
})

test('a holding without price is left out of the balance', () => {
  const v = valueHoldings([{ currency: 'ETH', amount: 1 }], prices)
  assert.equal(v.balance, 0)
  assert.equal(v.pricesComplete, false)
})

test('a report is paid from the largest holding first', () => {
  const pay = allocateUsd([{ currency: 'LTC', amount: 0.2 }, { currency: 'BTC', amount: 0.001 }], prices, 3)
  assert.deepEqual(pay, [{ currency: 'BTC', amount: 0.00006, rate: 50000, usd: 3 }])
})

test('several holdings are used when one is not enough', () => {
  const pay = allocateUsd([{ currency: 'LTC', amount: 0.02 }, { currency: 'BTC', amount: 0.00002 }], prices, 2.5)
  assert.equal(pay.length, 2)
  assert.equal(pay.reduce((s, p) => s + p.usd, 0), 2.5)
})

test('insufficient balance is refused with a 402', () => {
  assert.throws(() => allocateUsd([{ currency: 'LTC', amount: 0.001 }], prices, 1), (e) => e.status === 402 && e.code === 'insufficient_tokens')
  assert.throws(() => allocateUsd([{ currency: 'ETH', amount: 5 }], prices, 1), (e) => e.code === 'insufficient_tokens')
})
