import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proofUrlHash, sniffImage, decodeFiles, MAX_FILES, MAX_FILE_BYTES } from './proof.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from([6])])

test('same link written differently gives the same hash', () => {
  const base = proofUrlHash('https://imgur.com/a/abc')
  assert.equal(proofUrlHash('http://IMGUR.com/a/abc/'), base)
  assert.equal(proofUrlHash('https://imgur.com/a/abc?utm_source=x#top'), base)
  assert.notEqual(proofUrlHash('https://imgur.com/a/abd'), base)
  assert.notEqual(proofUrlHash('https://imgur.com/a/abc?id=2'), base)
})

test('empty link has no hash', () => {
  assert.equal(proofUrlHash(''), null)
  assert.equal(proofUrlHash('   '), null)
  assert.equal(proofUrlHash(null), null)
})

test('image type is read from the bytes', () => {
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(JPG), 'image/jpeg')
  assert.equal(sniffImage(WEBP), 'image/webp')
  assert.equal(sniffImage(Buffer.from('<svg></svg>')), null)
})

test('decodes base64 and data URLs, identical files count once', () => {
  const r = decodeFiles([PNG.toString('base64'), `data:image/png;base64,${PNG.toString('base64')}`, JPG.toString('base64')])
  assert.equal(r.files.length, 2)
  assert.deepEqual(r.files.map((f) => f.mime), ['image/png', 'image/jpeg'])
})

test('rejects bad files', () => {
  assert.deepEqual(decodeFiles(undefined), { files: [] })
  assert.equal(decodeFiles('x').error, 'invalid_file')
  assert.equal(decodeFiles([Buffer.from('hello').toString('base64')]).error, 'invalid_file')
  assert.equal(decodeFiles(Array(MAX_FILES + 1).fill(PNG.toString('base64'))).error, 'too_many_files')
  const big = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_BYTES)])
  assert.equal(decodeFiles([big.toString('base64')]).error, 'file_too_large')
})
