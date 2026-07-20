import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

@Injectable()
export class SimulationEvaluatorGatewayLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(
    SimulationEvaluatorGatewayLoggingInterceptor.name,
  );

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = performance.now();
    const requestId = request.header('x-simulation-gateway-request-id') || null;
    const workerId = request.header('x-simulation-worker-id') || null;
    const taskId =
      typeof request.params.taskId === 'string' ? request.params.taskId : null;
    const details = () => ({
      requestId,
      workerId,
      taskId,
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      responseBytes: Number(response.getHeader('content-length') || 0),
    });

    response.setHeader(
      'x-simulation-gateway-request-id',
      requestId || 'missing',
    );
    return next.handle().pipe(
      tap(() =>
        this.logger.log(
          JSON.stringify({ event: 'worker_gateway_request', ...details() }),
        ),
      ),
      catchError((error: unknown) => {
        const status =
          error &&
          typeof error === 'object' &&
          'getStatus' in error &&
          typeof error.getStatus === 'function'
            ? error.getStatus()
            : 500;
        response.statusCode = status;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          JSON.stringify({
            event: 'worker_gateway_request_error',
            ...details(),
            status,
            error: message.slice(0, 1_000),
          }),
        );
        return throwError(() => error);
      }),
    );
  }
}
