import { describe, expect, it } from 'vitest'

import { safeDownloadFilename } from '../download-filename'

describe('Contact client download filenames', () => {
  it('removes paths and header control characters', () => {
    expect(safeDownloadFilename('../folder/evil\r\nX-Test: yes.svg')).toBe('evil__X-Test: yes.svg')
    expect(safeDownloadFilename('..\\browser.svg')).toBe('browser.svg')
  })

  it('falls back for empty or control-only names', () => {
    expect(safeDownloadFilename('')).toBe('attachment')
    expect(safeDownloadFilename('\r\n')).toBe('__')
  })
})
