export const safeDownloadFilename = (value) => {
  const leaf = String(value || 'attachment').split(/[\\/]/).at(-1) || 'attachment'
  const normalized = Array.from(leaf).map((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 || character === '"' ? '_' : character
  }).join('').trim().slice(0, 180)
  return normalized || 'attachment'
}
