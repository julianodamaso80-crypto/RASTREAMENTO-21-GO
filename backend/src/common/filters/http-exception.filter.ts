import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  /**
   * P2002 do Prisma. Reconhecido pelo `code`, não por `instanceof`: o backend
   * importa o client por `.prisma/client` e uma segunda instância da classe
   * faria o `instanceof` mentir justamente na hora do erro.
   */
  private static ehConflitoDeUnicidade(exception: unknown): boolean {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === 'P2002'
    );
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Erro interno do servidor';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        message = (resObj.message as string | string[]) || message;
        error = (resObj.error as string) || error;
      }
    } else if (HttpExceptionFilter.ehConflitoDeUnicidade(exception)) {
      // Conflito de unicidade do Postgres não é falha nossa de execução: é
      // registro repetido, e quem está na tela precisa saber QUAL. Sem isto o
      // vínculo do IMEI 866557086559061 falhou seis vezes em três dias (24 a
      // 26/08/2026) mostrando só "Erro interno do servidor".
      const err = exception as { meta?: { target?: unknown } };
      const alvo = err.meta?.target;
      const campos = Array.isArray(alvo) ? alvo.join(', ') : String(alvo ?? '');
      status = HttpStatus.CONFLICT;
      error = 'Conflict';
      message = campos
        ? `Este valor já está em uso no banco (${campos}). Verifique se o registro não existe em outro cadastro, inclusive excluído.`
        : 'Este valor já está em uso no banco. Verifique se o registro não existe em outro cadastro, inclusive excluído.';
      this.logger.error(`Conflito de unicidade: ${campos || 'alvo desconhecido'}`);
    } else {
      const err = exception as Error;
      this.logger.error(
        `Unhandled exception: ${err?.message || 'unknown'}`,
        err?.stack || JSON.stringify(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      error,
      timestamp: new Date().toISOString(),
    });
  }
}
