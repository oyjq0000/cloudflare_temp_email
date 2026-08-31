const CONTACT_MAILBOX_TABLE = 'contact_mailboxes'

export const hasContactMailboxTable = async (db: D1Database): Promise<boolean> => {
    const row = await db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    ).bind(CONTACT_MAILBOX_TABLE).first<{ name: string }>()
    return Boolean(row)
}

export const isContactMailboxAddressId = async (
    db: D1Database,
    addressId: string | number,
): Promise<boolean> => {
    if (!await hasContactMailboxTable(db)) return false
    const row = await db.prepare(
        `SELECT id FROM contact_mailboxes WHERE address_id = ? LIMIT 1`
    ).bind(addressId).first<{ id: number }>()
    return Boolean(row)
}

export const isContactMailboxAddress = async (
    db: D1Database,
    address: string,
): Promise<boolean> => {
    if (!await hasContactMailboxTable(db)) return false
    const row = await db.prepare(
        `SELECT id FROM contact_mailboxes WHERE address = ? LIMIT 1`
    ).bind(address).first<{ id: number }>()
    return Boolean(row)
}

export const protectLegacyAddressCondition = async (
    db: D1Database,
    condition: string,
): Promise<string> => {
    if (!await hasContactMailboxTable(db)) return condition
    return `(${condition}) AND id NOT IN (SELECT address_id FROM contact_mailboxes)`
}

export const protectLegacyMessageSelection = async (
    db: D1Database,
    tableName: 'raw_mails' | 'sendbox',
    condition: string,
): Promise<string> => {
    if (!await hasContactMailboxTable(db)) return condition
    return `(${condition}) AND NOT EXISTS (`
        + `SELECT 1 FROM contact_mailboxes cm WHERE cm.address = ${tableName}.address)`
}
