import type { ContentfulStatusCode } from 'hono/utils/http-status'
import createLogger from 'logging'
import * as schema from '../schema'
import { createErrorResponse } from './jsonrpc'

const logger = createLogger('Error')
/**
 * Custom error class for A2A server operations, incorporating JSON-RPC error codes.
 */
export class A2AError extends Error {
    public code: schema.KnownErrorCode | number
    public data?: unknown
    public taskId?: string // Optional task ID context

    constructor(code: schema.KnownErrorCode | number, message: string, data?: unknown, taskId?: string) {
        super(message)
        this.name = 'A2AError'
        this.code = code
        this.data = data
        this.taskId = taskId // Store associated task ID if provided
    }

    /**
     * Formats the error into a standard JSON-RPC error object structure.
     */
    toJSONRPCError(): schema.JSONRPCError<unknown> {
        const errorObject: schema.JSONRPCError<unknown> = {
            code: this.code,
            message: this.message,
        }
        if (this.data !== undefined) {
            errorObject.data = this.data
        }
        return errorObject
    }

    // Static factory methods for common errors

    static parseError(message: string, data?: unknown): A2AError {
        return new A2AError(schema.ErrorCodeParseError, message, data)
    }

    static invalidRequest(message: string, data?: unknown): A2AError {
        return new A2AError(schema.ErrorCodeInvalidRequest, message, data)
    }

    static methodNotFound(method: string): A2AError {
        return new A2AError(schema.ErrorCodeMethodNotFound, `Method not found: ${method}`)
    }

    static invalidParams(message: string, data?: unknown): A2AError {
        return new A2AError(schema.ErrorCodeInvalidParams, message, data)
    }

    static internalError(message: string, data?: unknown): A2AError {
        return new A2AError(schema.ErrorCodeInternalError, message, data)
    }

    static taskNotFound(taskId: string): A2AError {
        return new A2AError(schema.ErrorCodeTaskNotFound, `Task not found: ${taskId}`, undefined, taskId)
    }

    static taskNotCancelable(taskId: string): A2AError {
        return new A2AError(schema.ErrorCodeTaskNotCancelable, `Task not cancelable: ${taskId}`, undefined, taskId)
    }

    static pushNotificationNotSupported(): A2AError {
        return new A2AError(schema.ErrorCodePushNotificationNotSupported, 'Push Notification is not supported')
    }

    static unsupportedOperation(operation: string): A2AError {
        return new A2AError(schema.ErrorCodeUnsupportedOperation, `Unsupported operation: ${operation}`)
    }
}

export class HttpError extends Error {
    public statusCode: ContentfulStatusCode
    public data?: unknown

    constructor(statusCode: ContentfulStatusCode, message: string, data?: unknown) {
        super(message)
        this.statusCode = statusCode
        this.data = data
    }

    static notFound(message?: string, data?: unknown): HttpError {
        return new HttpError(404, message ?? 'Not Found', data)
    }

    static badRequest(message?: string, data?: unknown): HttpError {
        return new HttpError(400, message ?? 'Bad Request', data)
    }

    static internalServerError(message?: string, data?: unknown): HttpError {
        return new HttpError(500, message ?? 'Internal Server Error', data)
    }

    static unauthorized(message?: string, data?: unknown): HttpError {
        return new HttpError(401, message ?? 'Unauthorized', data)
    }

    static forbidden(message?: string, data?: unknown): HttpError {
        return new HttpError(403, message ?? 'Forbidden', data)
    }
}

/**
 * Normalize an error into a JSON-RPC error response.
 * @param error
 * @param reqId
 * @param taskId
 * @returns
 */
export function normalizeError(
    error: any,
    reqId: string | number | null,
    taskId?: string,
): schema.JSONRPCResponse<null, unknown> {
    let a2aError: A2AError
    if (error instanceof A2AError) {
        a2aError = error
    } else if (error instanceof Error) {
        a2aError = A2AError.internalError(error.message, {
            stack: error.stack,
        })
    } else {
        a2aError = A2AError.internalError('An unknown error occurred.', error)
    }

    // Ensure task ID context is available if possible
    if (taskId && !a2aError.taskId) {
        a2aError.taskId = taskId
    }

    logger.error(`Error processing request (Task: ${a2aError.taskId ?? 'N/A'}, ReqID: ${reqId ?? 'N/A'}):`, a2aError)
    return createErrorResponse(reqId, a2aError.toJSONRPCError())
}
