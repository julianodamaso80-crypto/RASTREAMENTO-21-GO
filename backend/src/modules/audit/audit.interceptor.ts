import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import type { Request, Response } from 'express';
import { AuditAction } from '.prisma/client';
import { AuditService, AuditInput } from './audit.service';

const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths que o interceptor ignora (ruído, sem valor auditável).
const SKIP_PATHS = [/^\/api\/v1\/health/, /^\/api\/docs/];

interface AuthenticatedRequest extends Request {
  tenantId?: string;
  user?: { id: string; email?: string; role?: string };
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedRequest>();
    const res = http.getResponse<Response>();

    if (SKIP_METHODS.has(req.method)) return next.handle();
    if (SKIP_PATHS.some((re) => re.test(req.originalUrl))) return next.handle();

    return next.handle().pipe(
      tap(() => {
        this.emit(req, res.statusCode, null);
      }),
      catchError((err: unknown) => {
        const status =
          typeof err === 'object' && err && 'status' in err
            ? Number((err as { status?: number }).status) || 500
            : 500;
        this.emit(req, status, err);
        return throwError(() => err);
      }),
    );
  }

  private emit(req: AuthenticatedRequest, status: number, err: unknown) {
    const action = this.resolveAction(req, status);
    const { entity, entityId } = this.resolveEntity(req);

    const input: AuditInput = {
      tenantId: req.tenantId ?? null,
      userId: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
      action,
      entity,
      entityId,
      method: req.method,
      path: req.originalUrl,
      statusCode: status,
      ip: this.resolveIp(req),
      userAgent: req.headers['user-agent']?.toString() ?? null,
      metadata: err ? { error: this.serializeError(err) } : null,
    };

    this.audit.log(input);
  }

  private resolveAction(
    req: AuthenticatedRequest,
    status: number,
  ): AuditAction {
    const url = req.originalUrl;
    if (/\/auth\/login\b/.test(url)) {
      return status >= 400 ? AuditAction.LOGIN_FAILED : AuditAction.LOGIN;
    }
    if (/\/auth\/logout\b/.test(url)) return AuditAction.LOGOUT;
    if (/\/auth\/(forgot-password|reset-password)\b/.test(url)) {
      return AuditAction.PASSWORD_RESET;
    }
    if (/\/admin\/restore\//.test(url)) return AuditAction.RESTORE;
    if (/\/sms-commands\b/.test(url) && req.method === 'POST') {
      return AuditAction.COMMAND_SENT;
    }

    switch (req.method) {
      case 'POST':
        return AuditAction.CREATE;
      case 'PUT':
      case 'PATCH':
        return AuditAction.UPDATE;
      case 'DELETE':
        return AuditAction.DELETE;
      default:
        return AuditAction.OTHER;
    }
  }

  // Extrai entidade do path. Ex: /api/v1/vehicles/123 → entity=vehicles, entityId=123.
  // Não tenta ser esperto — se o path não bate, entity fica null.
  private resolveEntity(req: AuthenticatedRequest): {
    entity: string | null;
    entityId: string | null;
  } {
    const parts = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'v1');
    if (idx === -1 || idx + 1 >= parts.length) {
      return { entity: null, entityId: null };
    }
    const entity = parts[idx + 1] ?? null;
    const maybeId = parts[idx + 2];
    const entityId = maybeId && !maybeId.startsWith('?') ? maybeId : null;
    return { entity, entityId };
  }

  private resolveIp(req: AuthenticatedRequest): string | null {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      return fwd.split(',')[0].trim();
    }
    return req.ip ?? null;
  }

  private serializeError(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return { name: err.name, message: err.message };
    }
    return { value: String(err) };
  }
}
