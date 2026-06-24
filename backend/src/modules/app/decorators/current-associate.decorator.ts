import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentAssociateData {
  id: string;
  name: string;
  cpf: string;
  email: string | null;
  phone: string | null;
  tenantId: string;
}

/**
 * Injeta o associado autenticado (populado por AssociateJwtGuard).
 * Use `@CurrentAssociate()` pro objeto inteiro ou `@CurrentAssociate('id')` pra um campo.
 */
export const CurrentAssociate = createParamDecorator(
  (data: keyof CurrentAssociateData | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const associate = req.associate as CurrentAssociateData;
    return data ? associate?.[data] : associate;
  },
);
