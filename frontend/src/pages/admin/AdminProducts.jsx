import { useState, useEffect, useCallback } from 'react'
import { adminFetch } from './utils/api.js'
import { BASE } from '../../utils/api.js'
import Pagination from '../../components/admin/Pagination.jsx'
import { askConfirm, showMessage } from './dialog'

const PLACEHOLDER = 'https://bestofthebay.net/wp-content/uploads/woocommerce-placeholder.webp'

function isVideoUrl(url = '') {
  return /\.(mp4|webm|ogg|mov|avi|mkv)(\?|$)/i.test(url)
}

async function uploadMediaFiles(productId, files) {
  const token = localStorage.getItem('token')
  const formData = new FormData()
  for (const file of files) formData.append('files', file)
  const res = await fetch(`${BASE}/api/admin/products/${productId}/images/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Upload failed')
  return json.data
}

// ─── Media Manager (images + videos) ─────────────────────────────────────────

function MediaManager({ productId, images, onUpdated }) {
  const [mode, setMode]     = useState('upload') // 'upload' | 'link'
  // Link mode state
  const [url, setUrl]       = useState('')
  const [thumb, setThumb]   = useState('')
  const [linkType, setLinkType] = useState('image')
  // Upload mode state
  const [files, setFiles]   = useState([])
  const [previews, setPreviews] = useState([])
  // Shared
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')

  function handleFileChange(e) {
    const selected = Array.from(e.target.files || [])
    previews.forEach(p => URL.revokeObjectURL(p))
    setFiles(selected)
    setPreviews(selected.map(f => URL.createObjectURL(f)))
    setErr('')
  }

  async function addByLink() {
    if (!url.trim()) return
    setBusy(true); setErr('')
    try {
      await adminFetch(`/admin/products/${productId}/images`, {
        method: 'POST',
        body: JSON.stringify({ url: url.trim(), thumbnail: thumb.trim() || null, mediaType: linkType, position: images.length }),
      })
      setUrl(''); setThumb(''); setLinkType('image')
      onUpdated()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function addByUpload() {
    if (files.length === 0) return
    setBusy(true); setErr('')
    try {
      await uploadMediaFiles(productId, files)
      previews.forEach(p => URL.revokeObjectURL(p))
      setFiles([])
      setPreviews([])
      const input = document.getElementById('media-file-input')
      if (input) input.value = ''
      onUpdated()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  async function remove(imgId) {
    if (!(await askConfirm('Remove this media?', { okLabel: 'Remove', danger: true }))) return
    try {
      await adminFetch(`/admin/products/${productId}/images/${imgId}`, { method: 'DELETE' })
      onUpdated()
    } catch (e) { showMessage(e.message) }
  }

  const tabStyle = active => ({
    padding: '5px 14px',
    fontSize: '13px',
    fontWeight: active ? 600 : 400,
    border: '1px solid',
    borderColor: active ? '#503AA8' : '#ced4da',
    background: active ? '#503AA8' : '#fff',
    color: active ? '#fff' : '#555',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  })

  return (
    <div>
      <p style={{ margin: '0 0 10px', fontWeight: 600, fontSize: '13px' }}>
        Media items ({images.length})
      </p>

      {images.length === 0 && (
        <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px' }}>No media yet. Add images or videos below.</p>
      )}

      {images.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '8px', marginBottom: '16px' }}>
          {images.map((img, idx) => {
            const isVid = img.mediaType === 'video' || isVideoUrl(img.url)
            return (
              <div
                key={img.id}
                style={{ position: 'relative', aspectRatio: '1', background: '#e8ecf0', borderRadius: '6px', overflow: 'hidden' }}
              >
                {isVid ? (
                  <>
                    {img.thumbnail
                      ? <img src={img.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{ width: '100%', height: '100%', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="#666"><path d="M8 5v14l11-7z"/></svg>
                        </div>
                    }
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <div style={{ background: 'rgba(0,0,0,0.55)', borderRadius: '50%', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="11" height="13" viewBox="0 0 11 13" fill="white"><polygon points="0,0 11,6.5 0,13"/></svg>
                      </div>
                    </div>
                    <div style={{ position: 'absolute', bottom: '2px', left: '3px', fontSize: '9px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '1px 4px', borderRadius: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      video
                    </div>
                  </>
                ) : (
                  <img
                    src={img.thumbnail || img.url}
                    alt={`Media ${idx + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { console.warn('Image failed to load:', e.currentTarget.src); e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER }}
                  />
                )}

                <div style={{ position: 'absolute', bottom: '2px', right: '2px', fontSize: '10px', background: 'rgba(0,0,0,0.5)', color: '#fff', padding: '1px 4px', borderRadius: '3px' }}>
                  #{idx + 1}
                </div>

                <button
                  onClick={() => remove(img.id)}
                  title="Remove"
                  style={{ position: 'absolute', top: '3px', right: '3px', background: 'rgba(220,53,69,0.9)', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', color: '#fff', fontSize: '15px', lineHeight: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >×</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add form */}
      <div style={{ background: '#f8f9fa', borderRadius: '8px', padding: '14px', border: '1px solid #e8ecf0' }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '13px', color: '#444' }}>Add media</p>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button style={tabStyle(mode === 'upload')} onClick={() => { setMode('upload'); setErr('') }}>
              Upload file
            </button>
            <button style={tabStyle(mode === 'link')} onClick={() => { setMode('link'); setErr('') }}>
              From URL
            </button>
          </div>
        </div>

        {mode === 'upload' ? (
          <div>
            {/* Drop zone / file picker */}
            <label
              htmlFor="media-file-input"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                border: '2px dashed', borderColor: files.length ? '#503AA8' : '#ced4da',
                borderRadius: '8px', padding: '16px 12px', cursor: 'pointer',
                background: files.length ? '#f5f3ff' : '#fff', transition: 'all 0.15s',
                marginBottom: '10px', minHeight: '90px',
              }}
            >
              {previews.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
                  {previews.map((p, i) => {
                    const isVid = files[i]?.type.startsWith('video/')
                    return isVid ? (
                      <video key={i} src={p} style={{ height: '60px', width: '60px', objectFit: 'cover', borderRadius: '4px', background: '#222' }} />
                    ) : (
                      <img key={i} src={p} alt="" style={{ height: '60px', width: '60px', objectFit: 'cover', borderRadius: '4px' }} />
                    )
                  })}
                  <span style={{ width: '100%', textAlign: 'center', fontSize: '12px', color: '#503AA8', marginTop: '4px', fontWeight: 600 }}>
                    {files.length} file{files.length > 1 ? 's' : ''} selected
                  </span>
                </div>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="1.5" style={{ marginBottom: '6px' }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span style={{ fontSize: '13px', color: '#888' }}>Click to choose files</span>
                  <span style={{ fontSize: '11px', color: '#bbb', marginTop: '2px' }}>Multiple selection allowed · jpg, png, webp, gif, mp4, webm, mov</span>
                </>
              )}
            </label>
            <input
              id="media-file-input"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/ogg,video/quicktime,video/x-msvideo,video/x-matroska"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                className="admin-btn admin-btn-primary admin-btn-sm"
                onClick={addByUpload}
                disabled={busy || files.length === 0}
                style={{ whiteSpace: 'nowrap' }}
              >
                {busy ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select
                value={linkType}
                onChange={e => setLinkType(e.target.value)}
                style={{ padding: '7px 8px', borderRadius: '6px', border: '1px solid #ced4da', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
              <input
                className="admin-input"
                style={{ flex: 1, fontSize: '13px', padding: '7px 10px' }}
                placeholder={linkType === 'video' ? 'Video URL (https://….mp4)' : 'Image URL (https://…)'}
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addByLink()}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                className="admin-input"
                style={{ flex: 1, fontSize: '13px', padding: '7px 10px' }}
                placeholder={linkType === 'video' ? 'Poster/thumbnail URL (optional)' : 'Thumbnail URL (optional)'}
                value={thumb}
                onChange={e => setThumb(e.target.value)}
              />
              <button
                className="admin-btn admin-btn-primary admin-btn-sm"
                onClick={addByLink}
                disabled={busy || !url.trim()}
                style={{ whiteSpace: 'nowrap' }}
              >
                {busy ? 'Adding…' : '+ Add'}
              </button>
            </div>
          </div>
        )}

        {err && <p style={{ margin: '8px 0 0', color: '#dc3545', fontSize: '12px' }}>{err}</p>}
      </div>
    </div>
  )
}

// ─── Product Modal (create + edit) ───────────────────────────────────────────

function ProductModal({ product, onClose, onSaved, categories, source = 'site', shopLabel = 'Website' }) {
  const isEdit = Boolean(product?.id)

  const [form, setForm] = useState({
    name:        '',
    slug:        '',
    price:       '',
    stock:       0,
    description: '',
    categoryId:  '',
    isActive:    true,
    sku: '', compareAtPrice: '', unitLabel: '', badge: '', isFeatured: false,
  })
  const [images, setImages]   = useState([])
  const [tab, setTab]         = useState('info')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(isEdit)
  const [error, setError]     = useState('')
  const [createdId, setCreatedId] = useState(null)

  const effectiveId = product?.id || createdId

  // Fetch full product (with all images) when editing
  useEffect(() => {
    if (!isEdit) return
    setFetching(true)
    adminFetch(`/admin/products/${product.id}`)
      .then(data => {
        setForm({
          name:        data.name        || '',
          slug:        data.slug        || '',
          price:       data.price       ?? '',
          stock:       data.stock       ?? 0,
          description: data.description || '',
          categoryId:  data.categoryId  || '',
          isActive:    data.isActive    ?? true,
          sku: data.sku || '', compareAtPrice: data.compareAtPrice ?? '', unitLabel: data.unitLabel || '', badge: data.badge || '', isFeatured: !!data.isFeatured,
        })
        setImages(data.images || [])
      })
      .catch(() => {
        // fallback to list data
        setForm({
          name:        product.name        || '',
          slug:        product.slug        || '',
          price:       product.price       ?? '',
          stock:       product.stock       ?? 0,
          description: product.description || '',
          categoryId:  product.categoryId  || '',
          isActive:    product.isActive    ?? true,
          sku: product.sku || '', compareAtPrice: product.compareAtPrice ?? '', unitLabel: product.unitLabel || '', badge: product.badge || '', isFeatured: !!product.isFeatured,
        })
        setImages(product.images || [])
      })
      .finally(() => setFetching(false))
  }, [isEdit, product?.id])

  async function refreshImages() {
    if (!effectiveId) return
    try {
      const data = await adminFetch(`/admin/products/${effectiveId}`)
      setImages(data.images || [])
    } catch {}
  }

  function handleNameChange(v) {
    setForm(f => ({
      ...f,
      name: v,
      ...(!isEdit ? { slug: v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') } : {}),
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const body = {
        name:        form.name,
        slug:        form.slug,
        price:       parseFloat(form.price),
        stock:       parseInt(form.stock, 10),
        description: form.description || null,
        categoryId:  form.categoryId  || null,
        isActive:    form.isActive,
        sku:            form.sku,
        compareAtPrice: form.compareAtPrice === '' ? null : parseFloat(form.compareAtPrice),
        unitLabel:      form.unitLabel,
        badge:          form.badge,
        isFeatured:     form.isFeatured,
        ...(!isEdit ? { source } : {}),
      }
      if (isEdit) {
        await adminFetch(`/admin/products/${product.id}`, { method: 'PUT', body: JSON.stringify(body) })
        onSaved()
      } else {
        const created = await adminFetch(`/admin/products`, { method: 'POST', body: JSON.stringify(body) })
        onSaved()
        setCreatedId(created.id)
        setTab('media')
      }
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  return (
    <div
      className="admin-modal-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="admin-modal"
        style={{ maxWidth: '660px', width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', padding: 0, borderRadius: '12px', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px 0' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{isEdit ? 'Edit Product' : 'New Product'}</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#666', lineHeight: 1, padding: '2px 6px' }}
          >×</button>
        </div>

        {/* Tabs (edit or just created) */}
        {(isEdit || createdId) && (
          <div style={{ display: 'flex', padding: '12px 22px 0', borderBottom: '1px solid #e8ecf0', gap: '2px' }}>
            {[
              { key: 'info',  label: 'Product Info' },
              { key: 'media', label: `Media (${images.length})` },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '8px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: tab === t.key ? '2px solid #503AA8' : '2px solid transparent',
                  cursor: 'pointer',
                  fontWeight: tab === t.key ? 700 : 400,
                  color:      tab === t.key ? '#503AA8' : '#666',
                  fontSize: '14px',
                  marginBottom: '-1px',
                  transition: 'color 0.15s',
                }}
              >{t.label}</button>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px 22px' }}>
          {fetching ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading…</div>
          ) : tab === 'info' ? (
            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{ background: '#fff5f5', border: '1px solid #fcc', borderRadius: '6px', padding: '10px 14px', color: '#c00', fontSize: '14px', marginBottom: '14px' }}>
                  {error}
                </div>
              )}

              <div className="admin-form-group">
                <label className="admin-label">Name *</label>
                <input
                  className="admin-input"
                  value={form.name}
                  onChange={e => handleNameChange(e.target.value)}
                  required
                  placeholder="Product name"
                />
              </div>

              <div className="admin-form-group">
                <label className="admin-label">Slug *</label>
                <input
                  className="admin-input"
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                  required
                  placeholder="product-url-slug"
                  style={{ fontFamily: 'monospace', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="admin-form-group">
                  <label className="admin-label">Price ($) *</label>
                  <input
                    className="admin-input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    required
                    placeholder="0.00"
                  />
                </div>
                <div className="admin-form-group">
                  <label className="admin-label">Stock</label>
                  <input
                    className="admin-input"
                    type="number"
                    min="0"
                    value={form.stock}
                    onChange={e => setForm(f => ({ ...f, stock: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="admin-form-group">
                  <label className="admin-label">SKU</label>
                  <input className="admin-input" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value.toUpperCase() }))} placeholder="FL-101" />
                </div>
                <div className="admin-form-group">
                  <label className="admin-label">Was price ($) — puts it on Fire Sale</label>
                  <input className="admin-input" type="number" step="0.01" min="0" value={form.compareAtPrice} onChange={e => setForm(f => ({ ...f, compareAtPrice: e.target.value }))} placeholder="Leave empty if not on sale" />
                </div>
                <div className="admin-form-group">
                  <label className="admin-label">Unit label</label>
                  <input className="admin-input" value={form.unitLabel} onChange={e => setForm(f => ({ ...f, unitLabel: e.target.value }))} placeholder="per lb / per unit" />
                </div>
                <div className="admin-form-group">
                  <label className="admin-label">Card badge</label>
                  <input className="admin-input" value={form.badge} onChange={e => setForm(f => ({ ...f, badge: e.target.value }))} placeholder="New / Top Shelf" maxLength={20} />
                </div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14, fontSize: '0.875rem' }}>
                <input type="checkbox" checked={form.isFeatured} onChange={e => setForm(f => ({ ...f, isFeatured: e.target.checked }))} />
                Featured in “Captain’s picks” on the home page
              </label>

              <div className="admin-text-muted" style={{ marginBottom: 10, fontSize: 13 }}>Shop: <b>{shopLabel}</b></div>
              <div className="admin-form-group">
                <label className="admin-label">Category</label>
                <select
                  className="admin-input"
                  value={form.categoryId}
                  onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
                >
                  <option value="">— No category —</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div className="admin-form-group">
                <label className="admin-label">Description</label>
                <textarea
                  className="admin-input"
                  rows={4}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Product description…"
                  style={{ resize: 'vertical', minHeight: '80px' }}
                />
              </div>

              {isEdit && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                  <label className="admin-label" style={{ margin: 0 }}>Active (visible in shop)</label>
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                </div>
              )}

              <div className="admin-modal-actions" style={{ marginTop: '8px' }}>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>Cancel</button>
                <button type="submit" className="admin-btn admin-btn-primary" disabled={loading}>
                  {loading ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
                </button>
              </div>
            </form>
          ) : (
            <MediaManager productId={effectiveId} images={images} onUpdated={refreshImages} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AdminProducts() {
  const [products, setProducts]     = useState([])
  const [page, setPage]             = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [editProduct, setEditProduct]   = useState(null)
  const [deleteProduct, setDeleteProduct] = useState(null)
  const [deleting, setDeleting]         = useState(false)
  const [showCreate, setShowCreate]   = useState(false)
  const [categories, setCategories]   = useState([])
  // The website and each bot catalog are separate shops; the one picked is remembered
  const [shops, setShops]             = useState([])
  const [shop, setShopState]          = useState(() => { try { return localStorage.getItem('admin_products_shop') || 'all' } catch { return 'all' } })
  const setShop = v => { setShopState(v); setPage(1); try { localStorage.setItem('admin_products_shop', v) } catch { /* storage blocked */ } }
  const shopOf = key => shops.find(s => s.key === (key || 'site'))

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 20 })
      if (search) params.set('search', search)
      if (shop !== 'all') params.set('shop', shop)
      const data = await adminFetch(`/admin/products?${params}`)
      setProducts(data.products || [])
      setTotalPages(data.pagination?.totalPages || 1)
    } catch {
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [page, search, shop])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const loadShops = useCallback(() => adminFetch('/admin/products/shops').then(d => setShops(d || [])).catch(() => {}), [])
  useEffect(() => {
    adminFetch('/admin/categories').then(d => setCategories(d || [])).catch(() => {})
    loadShops()
  }, [loadShops])
  // A shop that no longer exists falls back to all of them
  useEffect(() => { if (shops.length && shop !== 'all' && !shopOf(shop)) setShop('all') }, [shops]) // eslint-disable-line react-hooks/exhaustive-deps
  // Shelves of the shop a product belongs to (the website's have no source)
  const shelvesOf = key => categories.filter(c => (c.source || 'site') === (key || 'site'))

  async function handleDelete() {
    if (!deleteProduct) return
    setDeleting(true)
    try {
      await adminFetch(`/admin/products/${deleteProduct.id}`, { method: 'DELETE' })
      setDeleteProduct(null)
      fetchProducts()
    } catch (e) {
      showMessage(e.message)
    } finally {
      setDeleting(false)
    }
  }

  function handleSearch(v) {
    setSearch(v)
    setPage(1)
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Products</h1>
          <p className="admin-page-subtitle">Manage product catalog — images and videos</p>
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => setShowCreate(true)}>
          + New Product
        </button>
      </div>

      <div className="admin-card" style={{ marginBottom: '12px', padding: '12px 16px', display: 'grid', gap: 10 }}>
        {shops.length > 1 && (
          <div className="admin-tabs" style={{ margin: 0, flexWrap: 'wrap' }} role="tablist" aria-label="Shop">
            {[{ key: 'all', label: 'All shops', count: shops.reduce((n, s) => n + s.count, 0) }, ...shops].map(s => (
              <button key={s.key} type="button" role="tab" aria-selected={shop === s.key} className={'admin-tab' + (shop === s.key ? ' active' : '')}
                title={s.bots?.length ? `Sold by ${s.bots.join(', ')}` : s.key === 'site' ? 'The website and the shop’s own bot' : undefined}
                onClick={() => setShop(s.key)}>
                {s.label} <span style={{ color: '#888', fontWeight: 400 }}>({s.count})</span>
              </button>
            ))}
          </div>
        )}
        {shopOf(shop)?.bots?.length > 0 && <div className="admin-text-muted" style={{ fontSize: 13 }}>Sold by {shopOf(shop).bots.join(', ')}</div>}
        <input
          className="admin-input"
          placeholder="Search by name…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
          style={{ maxWidth: '360px', margin: 0 }}
        />
      </div>

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: '56px' }}>Media</th>
                <th>Name</th>
                {shop === 'all' && <th>Shop</th>}
                <th>Category</th>
                <th>Price</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: shop === 'all' ? 8 : 7 }).map((_, j) => (
                      <td key={j}><span className="admin-skel" style={{ width: j === 0 ? '48px' : '80px', height: j === 0 ? '48px' : '16px', borderRadius: j === 0 ? '4px' : '3px' }} /></td>
                    ))}
                  </tr>
                ))
              ) : products.length === 0 ? (
                <tr><td colSpan={shop === 'all' ? 8 : 7} className="admin-table-empty">No products found.</td></tr>
              ) : products.map(p => {
                const firstMedia   = p.images?.[0]
                const mediaCount   = p._count?.images ?? p.images?.length ?? 0
                const isVid        = firstMedia?.mediaType === 'video' || isVideoUrl(firstMedia?.url || '')

                return (
                  <tr key={p.id}>
                    {/* Thumbnail */}
                    <td>
                      {firstMedia ? (
                        <div style={{ position: 'relative', width: '48px', height: '48px', borderRadius: '4px', overflow: 'hidden', background: isVid ? '#111' : '#e8ecf0', flexShrink: 0 }}>
                          <img
                            src={firstMedia.thumbnail || (isVid ? '' : firstMedia.url)}
                            alt={p.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={e => { console.warn('Image failed to load:', e.currentTarget.src); e.currentTarget.onerror = null; e.currentTarget.src = PLACEHOLDER }}
                          />
                          {isVid && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <svg width="14" height="16" viewBox="0 0 14 16" fill="white"><polygon points="0,0 14,8 0,16"/></svg>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ width: '48px', height: '48px', background: '#e8ecf0', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: '1.4rem' }}>?</div>
                      )}
                    </td>

                    {/* Name + media count badge */}
                    <td>
                      <span style={{ fontWeight: 500 }}>{p.name}</span>
                      {mediaCount > 0 && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', background: '#ede9fa', color: '#503AA8', borderRadius: '10px', padding: '1px 7px', fontWeight: 600 }}>
                          {mediaCount} {mediaCount === 1 ? 'media' : 'media'}
                        </span>
                      )}
                    </td>

                    {shop === 'all' && <td style={{ color: '#555', whiteSpace: 'nowrap' }}>{shopOf(p.source)?.label || p.source || 'Website'}</td>}
                    <td style={{ color: '#555' }}>{p.category?.name || '—'}</td>

                    <td style={{ fontWeight: 600 }}>${Number(p.price || 0).toFixed(2)}</td>

                    <td>
                      <span style={{ color: (p.stock ?? 99) <= 5 ? '#dc3545' : '#333', fontWeight: (p.stock ?? 99) <= 5 ? 700 : 400 }}>
                        {p.stock ?? '—'}
                      </span>
                    </td>

                    <td>
                      <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: '12px', fontSize: '12px', fontWeight: 600, background: p.isActive ? '#d4edda' : '#f8d7da', color: p.isActive ? '#155724' : '#721c24' }}>
                        {p.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    <td>
                      <div className="admin-gap-actions">
                        <button
                          className="admin-btn admin-btn-secondary admin-btn-sm"
                          onClick={() => setEditProduct(p)}
                        >
                          Edit
                        </button>
                        <button
                          className="admin-btn admin-btn-danger admin-btn-sm"
                          onClick={() => setDeleteProduct(p)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>

      {deleteProduct && (
        <div className="admin-modal-overlay" onClick={e => e.target === e.currentTarget && setDeleteProduct(null)}>
          <div className="admin-modal" style={{ maxWidth: '420px' }}>
            <button className="admin-modal-close" onClick={() => setDeleteProduct(null)}>×</button>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#fef2f2', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                </svg>
              </div>
              <div>
                <h2 className="admin-modal-title" style={{ margin: '0 0 4px' }}>Delete Product</h2>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#555' }}>
                  Are you sure you want to delete <strong>{deleteProduct.name}</strong>? This will also remove all its media. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="admin-modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setDeleteProduct(null)} disabled={deleting}>Cancel</button>
              <button className="admin-btn admin-btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editProduct && (
        <ProductModal
          key={editProduct.id}
          product={editProduct}
          categories={shelvesOf(editProduct.source)}
          shopLabel={shopOf(editProduct.source)?.label || 'Website'}
          onClose={() => setEditProduct(null)}
          onSaved={fetchProducts}
        />
      )}

      {showCreate && (
        <ProductModal
          key="create"
          product={null}
          // "All shops" creates on the website; a shop's tab creates in that shop
          source={shop === 'all' ? 'site' : shop}
          categories={shelvesOf(shop === 'all' ? 'site' : shop)}
          shopLabel={shopOf(shop === 'all' ? 'site' : shop)?.label || 'Website'}
          onClose={() => setShowCreate(false)}
          onSaved={() => { fetchProducts(); loadShops(); setShowCreate(false) }}
        />
      )}
    </div>
  )
}
