export const ROLES = ['ADMIN', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

/** A person who can sign in. `passwordHash` never leaves the server (see toPublic). */
export class User {
  constructor(
    readonly id: string,
    readonly email: string,
    readonly name: string,
    readonly passwordHash: string,
    readonly role: Role,
    readonly active: boolean,
    readonly createdAt: Date,
  ) {}

  hasRole(...roles: Role[]): boolean {
    return roles.includes(this.role);
  }

  toPublic() {
    return { id: this.id, email: this.email, name: this.name, role: this.role, active: this.active };
  }
}

export type PublicUser = ReturnType<User['toPublic']>;
