import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  proofUrlHash, sniffImage, sniffMedia, decodeFiles, decodeItems, hasProof, minWithProof, MAX_FILES, MAX_FILE_BYTES, MAX_BYTES,
} from './proof.js'

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

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4)])
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(8)])
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0])
const b64 = (buf) => buf.toString('base64')

test('videos and voice messages are read from the bytes', () => {
  assert.equal(sniffMedia(MP4), 'video/mp4')
  assert.equal(sniffMedia(WEBM), 'video/webm')
  assert.equal(sniffMedia(OGG), 'audio/ogg')
  assert.equal(sniffMedia(Buffer.from('ID3abc')), 'audio/mpeg')
  assert.equal(sniffMedia(PNG), 'image/png')
  assert.equal(sniffMedia(Buffer.from('%PDF-1.7')), null)
})

test('a video can be larger than an image, within its own limit', () => {
  const video = Buffer.concat([MP4, Buffer.alloc(MAX_FILE_BYTES)])
  assert.equal(decodeFiles([b64(video)]).files[0].mime, 'video/mp4')
  const tooBig = Buffer.concat([MP4, Buffer.alloc(MAX_BYTES.video)])
  assert.equal(decodeFiles([b64(tooBig)]).error, 'file_too_large')
})

test('each report of a batch brings its own proof', () => {
  const r = decodeItems([{ files: [b64(PNG)] }, { proofUrl: 'https://t.me/scam/12' }, {}])
  assert.equal(r.items.length, 3)
  assert.deepEqual(r.items.map(hasProof), [true, true, false])
  // The same file or link in two reports is refused
  assert.equal(decodeItems([{ files: [b64(PNG)] }, { files: [b64(PNG)] }]).error, 'duplicate_proof')
  assert.equal(decodeItems([{ proofUrl: 'https://t.me/scam/12' }, { proofUrl: 'http://T.ME/scam/12/' }]).error, 'duplicate_proof')
  assert.equal(decodeItems([]).error, 'invalid_count')
  assert.equal(decodeItems([{ proofUrl: 'javascript:alert(1)' }]).error, 'invalid_proof')
})

test('at least a third of a batch carries a proof', () => {
  assert.equal(minWithProof(1), 0)
  assert.equal(minWithProof(2), 1)
  assert.equal(minWithProof(3), 1)
})
