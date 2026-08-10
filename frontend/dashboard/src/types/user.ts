import type { Role } from './auth';

/** Usuário do painel, como a tela de acessos enxerga. */
export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  /** Vazio = todas as telas que o perfil já permite. */
  allowedRoutes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  role: Role;
  allowedRoutes: string[];
}

export interface UpdateUserPayload {
  name?: string;
  role?: Role;
  allowedRoutes?: string[];
  active?: boolean;
}

/** Criar acesso / gerar senha nova — a senha vem em claro só nesta resposta. */
export interface UserWithPassword {
  user: ManagedUser;
  password: string;
}
