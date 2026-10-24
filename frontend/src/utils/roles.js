// Roles allowed into the admin dashboard (superadmin can do everything an admin can)
export const STAFF_ROLES = ['moderator', 'admin', 'superadmin']
export const ADMIN_ROLES = ['admin', 'superadmin']

export const isStaff = user => !!user && STAFF_ROLES.includes(user.role)
export const isAdmin = user => !!user && ADMIN_ROLES.includes(user.role)
