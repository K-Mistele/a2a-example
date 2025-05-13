import createLogger from 'logging'
import type * as schema from '../schema'
import { A2AError } from './error'

const logger = createLogger('JSONRPC')

/**
 * Creates a JSON-RPC error response from a normalized error.
 * @param id - The request ID.
 * @param error - The error object.
 * @returns A JSON-RPC error response.
 */
export function createErrorResponse(
    id: number | string | null,
    error: schema.JSONRPCError<unknown>,
): schema.JSONRPCResponse<null, unknown> {
    return {
        jsonrpc: '2.0',
        id,
        error,
    }
}

/**
 * Creates a JSON-RPC success response.
 * @param id - The request ID.
 * @param result - The result of the request.
 * @returns A JSON-RPC success response.
 */
export function createSuccessResponse<T>(id: number | string | null, result: T): schema.JSONRPCResponse<T> {
    if (id === null) {
        throw A2AError.internalError('Cannot create a success response with a null ID')
    }
    return {
        jsonrpc: '2.0',
        id,
        result,
    }
}

/**
 * Represents a JSON-RPC request.
 * @property jsonrpc - The JSON-RPC version.
 * @property method - The method name.
 * @property id - The request ID.
 * @property params - The request parameters.
 */
export interface JsonRpcRequest {
    jsonrpc: string
    method: string
    id: string | number | null
    params?: any
}

/**
 * Type guard to check if a value is a valid JSON-RPC request.
 * @param body - The value to check.
 * @returns True if the value is a valid JSON-RPC request, false otherwise.
 */
export function isValidJsonRpcRequest(body: any): body is JsonRpcRequest {
    return (
        typeof body === 'object' &&
        body !== null &&
        body.jsonrpc === '2.0' &&
        typeof body.method === 'string' &&
        (body.id === null || typeof body.id === 'string' || typeof body.id === 'number') && // ID is required for requests needing response
        (body.params === undefined ||
            typeof body.params === 'object' || // Allows null, array, or object
            Array.isArray(body.params))
    )
}
