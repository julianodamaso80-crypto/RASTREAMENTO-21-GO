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
