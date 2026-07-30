import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface TransformedResponse<T> {
  data: T;
  meta?: {
    total: number;
    page: number;
    perPage: number;
  };
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<
  T,
  TransformedResponse<T>
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<TransformedResponse<T>> {
    return next.handle().pipe(
      map((result) => {
        // Página HTML (privacidade, exclusão de dados): retorna crua, sem
        // envelopar em { data } — senão o navegador/loja recebe JSON no lugar
        // da página. Só strings que começam com '<' (HTML/XML); JSON de API
        // sempre retorna objeto, então não é afetado.
        if (typeof result === 'string' && result.trimStart().startsWith('<')) {
          return result as unknown as TransformedResponse<T>;
        }
        // Se já tem formato paginado, retorna como está
        if (
          result &&
          typeof result === 'object' &&
          'data' in result &&
          'meta' in result
        ) {
          return result;
        }
        return { data: result };
      }),
    );
  }
}
