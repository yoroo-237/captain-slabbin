export default function Pagination({ page, totalPages, onChange }) {
  if (!totalPages || totalPages <= 1) return null

  function getPages() {
    const pages = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
      return pages
    }
    pages.push(1)
    if (page > 3) pages.push('…')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i)
    }
    if (page < totalPages - 2) pages.push('…')
    pages.push(totalPages)
    return pages
  }

  return (
    <div className="admin-pagination">
      <button
        className="admin-page-btn"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </button>

      {getPages().map((p, i) =>
        p === '…' ? (
          <span key={`dots-${i}`} className="admin-page-dots">…</span>
        ) : (
          <button
            key={p}
            className={'admin-page-btn' + (p === page ? ' active' : '')}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        )
      )}

      <button
        className="admin-page-btn"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  )
}
