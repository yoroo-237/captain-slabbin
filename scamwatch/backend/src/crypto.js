// Deposit addresses, on-chain checks and sweeps, taken from the shops' crypto.service.
// Differences: every deposit goes 100 % to the super admin's reserve (one sweep, no
// commission share), and addresses are derived on account 7' so a seed shared with
// a shop never gives the same address for the same deposit number.

import axios from 'axios'
import { HDNodeWallet, JsonRpcProvider, formatEther, isAddress } from 'ethers'
import { BIP32Factory } from 'bip32'
import * as ecc from 'tiny-secp256k1'
import * as bitcoin from 'bitcoinjs-lib'
import { mnemonicToSeedSync } from 'bip39'

const bip32 = BIP32Factory(ecc)

const ACCOUNT = 7
const CHAIN_MAP = { BTC: 'btc/main', LTC: 'ltc/main', DOGE: 'doge/main' }
const BIP44_COIN = { BTC: 0, LTC: 2, DOGE: 3 }
export const UTXO_CURRENCIES = ['BTC', 'LTC', 'DOGE']
export const DEPOSIT_CURRENCIES = ['BTC', 'LTC', 'DOGE', 'ETH', 'XMR']

const BTC_NETWORKS = {
  BTC: bitcoin.networks.bitcoin,
  LTC: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bip32: { public: 0x019da462, private: 0x019d9cfe },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
  },
  DOGE: {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: 'doge',
    bip32: { public: 0x02facafd, private: 0x02fac398 },
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e,
  },
}

const DUST_SATS = { BTC: 546, LTC: 5460, DOGE: 1_000_000 }
const trimAmount = (sats) => (sats / 1e8).toFixed(8).replace(/\.?0+$/, '') || '0'

const env = () => ({
  btcSeed: process.env.BTC_HD_SEED?.trim(),
  ethSeed: process.env.ETH_HD_SEED?.trim(),
  blockcypher: process.env.BLOCKCYPHER_TOKEN?.trim(),
  alchemyKey: process.env.ALCHEMY_API_KEY?.trim(),
  alchemyWebhookId: process.env.ALCHEMY_WEBHOOK_ID?.trim(),
  alchemyAuthToken: process.env.ALCHEMY_AUTH_TOKEN?.trim(),
  publicUrl: process.env.PUBLIC_URL?.trim().replace(/\/$/, ''),
})

export const fail = (code, status = 400) => Object.assign(new Error(code), { status, code })

export function deriveUtxoKey(currency, depositId, mnemonic = env().btcSeed) {
  const network = BTC_NETWORKS[currency]
  if (!network) throw fail('unsupported_currency')
  if (!mnemonic) throw fail('wallet_not_configured', 503)
  const root = bip32.fromSeed(mnemonicToSeedSync(mnemonic), network)
  const child = root.derivePath(`m/44'/${BIP44_COIN[currency]}'/${ACCOUNT}'/0/${depositId}`)
  const { address } = bitcoin.payments.p2pkh({ pubkey: Buffer.from(child.publicKey), network })
  return { child, address, network }
}

const ethWallet = (index, seed = env().ethSeed) => {
  if (!seed) throw fail('wallet_not_configured', 503)
  return HDNodeWallet.fromPhrase(seed, undefined, `m/44'/60'/${ACCOUNT}'/0/${index}`)
}

export function isValidAddress(currency, address) {
  if (currency === 'ETH') return isAddress(address)
  try { bitcoin.address.toOutputScript(address, BTC_NETWORKS[currency]); return true } catch { return false }
}

// Address for a deposit. Webhooks are registered when configured, but they only
// trigger an on-chain check: a webhook's own figures are never credited.
export async function generateAddress(currency, depositId, xmrAddress) {
  const e = env()
  if (UTXO_CURRENCIES.includes(currency)) {
    const { address } = deriveUtxoKey(currency, depositId)
    let hookId = null
    if (e.publicUrl && e.blockcypher) {
      try {
        const { data } = await axios.post(`https://api.blockcypher.com/v1/${CHAIN_MAP[currency]}/hooks?token=${e.blockcypher}`, {
          event: 'confirmed-tx', address, url: `${e.publicUrl}/api/webhooks/blockcypher`, confirmations: 1,
        })
        hookId = data.id || null
      } catch (err) {
        console.warn(`[BlockCypher] webhook not registered for ${address}:`, err.message)
      }
    }
    return { address, hookId }
  }
  if (currency === 'ETH') {
    const { address } = ethWallet(depositId)
    if (e.alchemyWebhookId && e.alchemyAuthToken) {
      await axios.patch('https://dashboard.alchemy.com/api/update-webhook-addresses',
        { webhook_id: e.alchemyWebhookId, addresses_to_add: [address], addresses_to_remove: [] },
        { headers: { 'X-Alchemy-Token': e.alchemyAuthToken } },
      ).catch((err) => console.warn('[Alchemy] webhook not updated:', err.message))
    }
    return { address, ethIndex: depositId }
  }
  if (currency === 'XMR') {
    if (!xmrAddress) throw fail('wallet_not_configured', 503)
    return { address: xmrAddress }
  }
  throw fail('unsupported_currency')
}

export async function deleteHook(hookId, currency) {
  const e = env()
  if (!hookId || !CHAIN_MAP[currency] || !e.blockcypher) return
  await axios.delete(`https://api.blockcypher.com/v1/${CHAIN_MAP[currency]}/hooks/${hookId}?token=${e.blockcypher}`)
    .catch((err) => console.warn(`[BlockCypher] hook ${hookId} not deleted:`, err.message))
}

// What the deposit address really received, read from the blockchain
export async function checkOnChain(deposit) {
  const e = env()
  if (UTXO_CURRENCIES.includes(deposit.currency)) {
    if (!e.blockcypher) throw fail('wallet_not_configured', 503)
    const { data } = await axios.get(
      `https://api.blockcypher.com/v1/${CHAIN_MAP[deposit.currency]}/addrs/${deposit.address}?token=${e.blockcypher}`,
      { timeout: 8000 },
    )
    // total_received only counts confirmed transactions
    const received = data.total_received || 0
    if (received === 0) return { confirmed: false, pending: (data.unconfirmed_balance || 0) > 0 }
    return { confirmed: true, cryptoAmount: received / 1e8 }
  }
  if (deposit.currency === 'ETH') {
    if (!e.alchemyKey) throw fail('wallet_not_configured', 503)
    const provider = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${e.alchemyKey}`)
    const eth = parseFloat(formatEther(await provider.getBalance(deposit.address)))
    if (eth <= 0.0001) return { confirmed: false, pending: false }
    return { confirmed: true, cryptoAmount: eth }
  }
  return { confirmed: false, pending: false } // XMR: confirmed by the super admin
}

// Sends everything on each unswept deposit address to the reserve address.
// One result per deposit; the caller records what was swept.
export async function sweepUtxo(currency, deposits, destination) {
  const e = env()
  const chain = CHAIN_MAP[currency]
  if (!chain) throw fail('unsupported_currency')
  if (!e.blockcypher) throw fail('wallet_not_configured', 503)
  if (!isValidAddress(currency, destination)) throw fail('invalid_address')

  const network = BTC_NETWORKS[currency]
  const dust = DUST_SATS[currency]

  let feePerByte = { BTC: 10, LTC: 10, DOGE: 1000 }[currency]
  try {
    const { data } = await axios.get(`https://api.blockcypher.com/v1/${chain}?token=${e.blockcypher}`)
    feePerByte = Math.ceil((data.low_fee_per_kb || feePerByte * 1000) / 1000)
  } catch { /* fallback */ }
  // P2PKH size: 10 + inputs*148 + outputs*34
  const feeFor = (inputs) => feePerByte * (10 + inputs * 148 + 34)

  const results = []
  for (const dep of deposits) {
    const { child, address } = deriveUtxoKey(currency, dep.id)
    let utxos
    try {
      const { data } = await axios.get(`https://api.blockcypher.com/v1/${chain}/addrs/${address}?unspentOnly=true&token=${e.blockcypher}`)
      utxos = data.txrefs || []
    } catch (err) {
      results.push({ depositId: dep.id, status: 'error', reason: `UTXO fetch failed: ${err.message}` })
      continue
    }

    const total = utxos.reduce((s, u) => s + u.value, 0)
    if (total === 0) { results.push({ depositId: dep.id, status: 'empty' }); continue }

    const fee = feeFor(utxos.length)
    const send = total - fee
    if (send < dust) {
      results.push({ depositId: dep.id, status: 'skipped', reason: `too small for the network fee (${fee} sats)` })
      continue
    }

    try {
      const psbt = new bitcoin.Psbt({ network })
      for (const u of utxos) {
        const { data } = await axios.get(`https://api.blockcypher.com/v1/${chain}/txs/${u.tx_hash}?includeHex=true&token=${e.blockcypher}`)
        psbt.addInput({ hash: u.tx_hash, index: u.tx_output_n, nonWitnessUtxo: Buffer.from(data.hex, 'hex') })
      }
      psbt.addOutput({ address: destination, value: send })
      utxos.forEach((_, i) => psbt.signInput(i, child))
      psbt.finalizeAllInputs()

      const { data: pushed } = await axios.post(`https://api.blockcypher.com/v1/${chain}/txs/push?token=${e.blockcypher}`, {
        tx: psbt.extractTransaction().toHex(),
      })
      results.push({ depositId: dep.id, status: 'swept', txHash: pushed.tx?.hash, amount: trimAmount(send), fee: trimAmount(fee) })
    } catch (err) {
      results.push({ depositId: dep.id, status: 'error', reason: err.response?.data?.error || err.message })
    }
  }
  return results
}

export async function sweepEth(deposits, destination) {
  const e = env()
  if (!e.alchemyKey) throw fail('wallet_not_configured', 503)
  if (!isAddress(destination)) throw fail('invalid_address')

  const provider = new JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${e.alchemyKey}`)
  const GAS_LIMIT = 21000n
  const feeData = await provider.getFeeData()
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas
  if (!gasPrice) throw fail('gas_price_unavailable', 503)
  const gasCost = GAS_LIMIT * gasPrice

  const results = []
  for (const dep of deposits) {
    const wallet = ethWallet(dep.ethIndex ?? dep.id).connect(provider)
    const balance = await provider.getBalance(wallet.address)
    if (balance === 0n) { results.push({ depositId: dep.id, status: 'empty' }); continue }
    const value = balance - gasCost
    if (value <= 0n) { results.push({ depositId: dep.id, status: 'skipped', reason: 'too small for gas' }); continue }
    try {
      const tx = await wallet.sendTransaction({ to: destination, value, gasLimit: GAS_LIMIT, gasPrice })
      results.push({ depositId: dep.id, status: 'swept', txHash: tx.hash, amount: formatEther(value) })
    } catch (err) {
      results.push({ depositId: dep.id, status: 'error', reason: err.shortMessage || err.message })
    }
  }
  return results
}
