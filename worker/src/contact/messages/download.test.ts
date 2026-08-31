import assert from 'node:assert/strict'
import test from 'node:test'

import { safeDownloadFilename, safeDownloadHeaders, safeDownloadMime } from './download.ts'

test('download filenames cannot inject headers or escape a path', () => {
    assert.equal(safeDownloadFilename('../folder/evil\r\nX-Bad: yes.html'), 'evil__X-Bad: yes.html')
    const disposition = safeDownloadHeaders('..\\evil"\r\nX-Bad: yes.html', 'text/html')
        .get('Content-Disposition') || ''
    assert.equal(disposition.includes('\r'), false)
    assert.equal(disposition.includes('\n'), false)
    assert.match(disposition, /^attachment; filename=/)
})

test('active and malformed MIME types are forced to binary downloads', () => {
    for (const mime of ['text/html', 'image/svg+xml', 'application/javascript', 'bad\r\nvalue']) {
        assert.equal(safeDownloadMime(mime), 'application/octet-stream')
    }
    const headers = safeDownloadHeaders('report.pdf', 'application/pdf')
    assert.equal(headers.get('Content-Type'), 'application/pdf')
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(headers.get('Cache-Control'), 'private, no-store')
})
