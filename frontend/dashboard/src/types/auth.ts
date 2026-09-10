export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'CLIENT';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  tenant: Tenant;
  /** Telas liberadas. Vazio = todas as telas que o perfil já permite. */
  allowedRoutes?: string[];
  /** WhatsApp cadastrado (só o verificado recebe código de recuperação). */
  phone?: string | null;
  /** Falso enquanto o número não foi confirmado por código. */
  phoneVerified?: boolean;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}
