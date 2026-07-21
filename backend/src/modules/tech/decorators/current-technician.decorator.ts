import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface TechnicianContext {
  id: string;
  name: string;
  tenantId: string;
  mustChangePassword: boolean;
}

/** Técnico logado, populado pelo TechnicianJwtGuard. */
export const CurrentTechnician = createParamDecorator(
  (data: keyof TechnicianContext | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest();
    const technician: TechnicianContext = req.technician;
    return data ? technician?.[data] : technician;
  },
);
