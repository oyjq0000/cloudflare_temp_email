export const normalizeAppMode = (value) => value === 'contact' ? 'contact' : 'temp'

export const getModeRedirect = (path, mode) => {
    const normalizedMode = normalizeAppMode(mode)
    if (normalizedMode === 'contact') {
        if (path === '/' || path === '/user' || path.startsWith('/user/')) return '/hub'
        return null
    }
    if (path === '/hub' || path.startsWith('/hub/')) return '/'
    return null
}
