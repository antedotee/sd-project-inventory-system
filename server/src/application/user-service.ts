import { newId } from '../domain/id';
import { type Role, User } from '../domain/user';
import type { PasswordHasher } from './ports';
import type { UserRepository } from './repositories';

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role: Role;
}

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async create(input: CreateUserInput): Promise<User> {
    // Duplicate emails are rejected by the repository (unique index -> DuplicateError).
    const email = input.email.trim().toLowerCase();
    const hash = await this.hasher.hash(input.password);
    return this.users.create(new User(newId(), email, input.name.trim(), hash, input.role, true, new Date()));
  }

  /**
   * Creates the first ADMIN from environment variables when there are no
   * users at all. Running it again is a no-op (idempotent startup).
   */
  async bootstrapAdmin(email: string | undefined, password: string | undefined): Promise<'created' | 'skipped'> {
    if ((await this.users.count()) > 0) return 'skipped';
    if (!email || !password) {
      throw new Error('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.');
    }
    await this.create({ email, password, name: 'Administrator', role: 'ADMIN' });
    return 'created';
  }
}
