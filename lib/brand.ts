export const LOGO =
  'https://imagedelivery.net/zqlO_f93Gilxz6zHS6qT_w/db0fec33-1eec-4867-e8bc-b3f063c84700/w=250'

/** Reviewer avatar palette — the only colours accepted from the client. All legible under white text. */
export const AVATAR_COLORS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#475569',
]

/** A reviewer's chosen colour, or a stable one hashed from their name. */
export function avatarColor(author: string, color?: string | null): string {
  if (color && AVATAR_COLORS.includes(color)) return color
  let h = 0
  for (const ch of author) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
