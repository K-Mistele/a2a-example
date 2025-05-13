import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { prettyJSON } from 'hono/pretty-json'
import { type SSEStreamingApi, streamSSE } from 'hono/streaming'
import createLogger from 'logging'
import type * as schema from '../schema'
import { A2AError, normalizeError } from './error'
import type { TaskContext as OldTaskContext, TaskHandler } from './handler'
import { createSuccessResponse, isValidJsonRpcRequest } from './jsonrpc'
import {
    type ActiveCancellationsStore,
    BunRedisActiveCancellationsStore,
    BunRedisTaskStore,
    type TaskAndHistory,
    type TaskStore,
} from './store'
import {
    applyUpdateToTaskAndHistory,
    createTaskArtifactEvent,
    createTaskFailureStatusUpdate,
    createTaskStatusEvent,
} from './tasks'
import { getCurrentTimestamp, isArtifactUpdate, isTaskStatusUpdate, validateTaskSendParams } from './utils'
const logger = createLogger('A2AServer')

type CorsOptions = Parameters<typeof cors>[0]
/**
 * Options for configuring the A2AServer.
 */
export interface A2AServerOptions {
    /** Task storage implementation. Defaults to InMemoryTaskStore. */
    taskStore?: TaskStore
    /** CORS configuration options or boolean/string. Defaults to allowing all origins. */
    cors?: CorsOptions | boolean | string
    /** Base path for the A2A endpoint. Defaults to '/'. */
    basePath?: string
    /** Agent Card for the agent being served. */
    card: schema.AgentCard
}

// Define new TaskContext without the store, based on the original from handler.ts
export interface TaskContext extends Omit<OldTaskContext, 'taskStore'> {
    isCancelled: () => Promise<boolean>
}

export class A2AServer {
    private taskHandler: TaskHandler
    private taskStore: TaskStore
    private activeCancellations: ActiveCancellationsStore
    private corsOptions: CorsOptions | boolean | string
    private basePath: string
    public readonly app: Hono

    public card: schema.AgentCard

    constructor(handler: TaskHandler, options: A2AServerOptions) {
        this.taskHandler = handler
        this.taskStore = options.taskStore || new BunRedisTaskStore()
        this.activeCancellations = new BunRedisActiveCancellationsStore()
        this.corsOptions = options.cors || true
        this.basePath = options.basePath ?? '/'
        this.card = options.card
        this.app = new Hono()
        if (this.basePath !== '/') this.basePath = `/${this.basePath.replace(/^\/|\/$/g, '')}/`
    }

    public start(port: number = 41241, start: boolean = true): Hono {
        this.app.use(prettyJSON()) // With options: prettyJSON({ space: 4 })

        if (this.corsOptions !== false) {
            const options =
                typeof this.corsOptions === 'string'
                    ? { origin: this.corsOptions }
                    : this.corsOptions === true
                      ? undefined // default
                      : this.corsOptions

            this.app.use(cors(options))
        }

        // Error handling middleware
        this.app.all(async (c, next) => {
            await next()

            if (c.error instanceof HTTPException) {
                return c.json(
                    {
                        message: c.error.message,
                        cause: c.error.cause,
                    },
                    c.error.status,
                )
            }
            // Handle all other non-explicitly HTTP errors as JSON-RPC errors
            let responseError: schema.JSONRPCResponse<null, unknown>
            if (c.error && c.error instanceof A2AError) {
                logger.error(`A2A Error: ${c.error.message}`)
                responseError = normalizeError(c.error.message, c.error.taskId ?? null, c.error.taskId ?? undefined)
                return c.json(responseError ?? {}, 200)
            } else if (c.error) {
                logger.error(`Unknown Error: ${c.error.message} (500)`)
                responseError = normalizeError(c.error.message, null, undefined)
                return c.json(responseError ?? {}, 200)
            }
        })

        // Serve the agent card.
        this.app.get('/.well-known/agent.json', (c) => {
            logger.debug('[AgentCard] GET /.well-known/agent.json called')
            logger.debug('[AgentCard] Returning agent card name:', this.card.name) // Assuming .name, adjust if different
            return c.json(this.card)
        })

        // The JSON-RPC handler endpoint
        this.app.post(this.basePath, async (c, next) => {
            let taskId: string | undefined = undefined
            let body: any
            let requestId: number | string | null = null
            logger.debug(`[JSON-RPC Router] POST ${this.basePath} called`)
            // Get the body of the request and validate it.
            try {
                body = await c.req.json()
                requestId = body.id ?? null
                // Use a type assertion for params to safely access id for logging
                taskId = (body.params as { id?: string })?.id
                logger.debug(
                    `[JSON-RPC Router] Request ID: ${requestId}, Method: ${body.method}, Task ID (from params.id, if any): ${taskId}`,
                )
            } catch (error) {
                logger.error('[JSON-RPC Router] Failed to parse JSON body or read basic fields:', error)
                throw new HTTPException(400, {
                    message: 'Invalid JSON-RPC request',
                })
            }
            if (!isValidJsonRpcRequest(body)) {
                logger.warn('[JSON-RPC Router] Invalid JSON-RPC request structure detected.', body)
                throw A2AError.invalidRequest('Invalid JSON-RPC request structure')
            }
            // Re-assign taskId more definitively after validation, if it exists in params and is a string
            taskId =
                typeof (body.params as { id?: unknown })?.id === 'string'
                    ? (body.params as { id: string }).id
                    : undefined
            requestId = body.id ?? null
            try {
                logger.debug(
                    `[JSON-RPC Router] Routing method: ${body.method} for request ID: ${requestId}, Task ID: ${taskId}`,
                )
                // Route based on method
                switch (body.method) {
                    case 'tasks/send':
                        logger.debug(`[JSON-RPC Router] Matched 'tasks/send'. Delegating to taskSend handler.`)
                        return await this.taskSend(body as schema.SendTaskRequest, c)
                    case 'tasks/sendSubscribe':
                        logger.debug(
                            `[JSON-RPC Router] Matched 'tasks/sendSubscribe'. Delegating to taskSendSubscribe handler.`,
                        )
                        return this.taskSendSubscribe(body as schema.SendTaskStreamingRequest, c)
                    case 'tasks/get':
                        logger.debug(`[JSON-RPC Router] Matched 'tasks/get'. Delegating to taskGet handler.`)
                        return await this.taskGet(body as schema.GetTaskRequest, c)
                    case 'tasks/cancel':
                        logger.debug(`[JSON-RPC Router] Matched 'tasks/cancel'. Delegating to taskCancel handler.`)
                        return await this.taskCancel(body as schema.CancelTaskRequest, c)
                    default:
                        logger.warn(`[JSON-RPC Router] Method not found: ${body.method}`)
                        throw A2AError.methodNotFound(body.method)
                }
            } catch (error: any) {
                if (error instanceof A2AError && taskId && !error.taskId) {
                    error.taskId = taskId
                }
                logger.error(
                    `[JSON-RPC Router] Error during method dispatch for ${body.method} (Request ID: ${requestId}, Task ID: ${taskId}):`,
                    error,
                )
                // Return a JSON RPC error response
                return c.json(normalizeError(error.message, requestId, taskId), 200)
            }
        })

        return this.app
    }

    async loadOrCreateTaskAndHistory(
        taskId: string,
        initialMessage: schema.Message,
        sessionId?: string | null,
        metadata?: Record<string, unknown> | null,
    ): Promise<TaskAndHistory> {
        let data = await this.taskStore.load(taskId)
        let needsSave = false

        // If no such task exists, create a new one
        if (!data) {
            const initialTask: schema.Task = {
                id: taskId,
                sessionId: sessionId ?? undefined,
                status: {
                    state: 'submitted',
                    timestamp: getCurrentTimestamp(),
                    message: null, // no message for initial user message
                },
                artifacts: [],
                metadata: metadata ?? {},
            }
            const initialHistory: schema.Message[] = [initialMessage]
            data = { task: initialTask, history: initialHistory }
            needsSave = true
            logger.debug(`[Task ${taskId}] Created new task and history`)
        }
        // Handle if the task already exists.
        else {
            logger.debug(`[Task ${taskId}] Loaded task and history`)
            data = { task: data.task, history: [...data.history, initialMessage] }
            needsSave = true

            // handle state transitions for existing tasks
            const finalStates: Array<schema.TaskState> = ['completed', 'failed', 'canceled']

            // If the task is in a final state, reset it to 'submitted' and keep the history.
            if (finalStates.includes(data.task.status.state)) {
                logger.warn(
                    `[Task ${taskId}]  Received message for task already in final state ${data.task.status.state}. Handling as new submission (keeping history).`,
                )

                // Option 1: reset state to 'submitted' - keeps history and effectively restarts the task.
                const resetUpdate: Omit<schema.TaskStatus, 'timestamp'> = {
                    state: 'submitted',
                    message: null, // this clears the old agent message
                }
                data = applyUpdateToTaskAndHistory(data, resetUpdate)
                needsSave = true
            }
            // If the task is in 'input-required' state, change it to 'working' and keep the history.
            else if (data.task.status.state === 'input-required') {
                logger.debug(
                    `[Task ${taskId}] Received message for task in 'input-required' state. Changing state to 'working'`,
                )
                const workingUpdate: Omit<schema.TaskStatus, 'timestamp'> = {
                    state: 'working',
                }
                data = applyUpdateToTaskAndHistory(data, workingUpdate)
                needsSave = true
            }
            // If the task is in 'working' state, ignore the message.
            else if (data.task.status.state === 'working') {
                logger.warn(`[Task ${taskId}] Received message for task in 'working' state. Ignoring.`)
            }
        }
        if (needsSave) {
            await this.taskStore.save(data)
        }

        return {
            task: { ...data.task },
            history: [...data.history],
        }
    }

    createTaskContext(
        task: schema.Task,
        userMessage: schema.Message,
        history: schema.Message[], // Add history parameter
    ): TaskContext {
        return {
            task: { ...task }, // Pass a copy
            userMessage: userMessage,
            history: [...history], // Pass a copy of the history
            isCancelled: async () => await this.activeCancellations.has(task.id),
            // taskStore is removed
        }
    }

    /**
     * Handle a request to send a task to the agent.
     * @param req
     * @param ctx
     */
    async taskSend(req: schema.SendTaskRequest, ctx: Context) {
        validateTaskSendParams(req)

        const { id: taskId, message, sessionId, metadata } = req.params
        logger.debug(`[TaskSend] Handler called for Task ID: ${taskId}, Request ID: ${req.id}`)
        let currentData = await this.loadOrCreateTaskAndHistory(taskId, message, sessionId, metadata)
        const context = this.createTaskContext(currentData.task, message, currentData.history)

        const generator = this.taskHandler(context)
        try {
            for await (const yieldValue of generator) {
                // apply update immutable
                currentData = applyUpdateToTaskAndHistory(currentData, yieldValue)
                await this.taskStore.save(currentData)
                context.task = currentData.task
            }
            logger.debug(
                `[TaskSend] Successfully processed Task ID: ${taskId}. Current state: ${currentData.task.status.state}`,
            )
        } catch (handlerError) {
            const failureStatusUpdate: Omit<schema.TaskStatus, 'timestamp'> =
                createTaskFailureStatusUpdate(handlerError)

            currentData = applyUpdateToTaskAndHistory(currentData, failureStatusUpdate)
            try {
                await this.taskStore.save(currentData)
            } catch (error) {
                logger.error(`[Task ${currentData.task.id}] Failed to save task after handler failure:`, error)
            }
            logger.error(`[TaskSend] Error in handler for Task ID: ${taskId}, Request ID: ${req.id}:`, handlerError)
            throw normalizeError(handlerError, req.id, taskId)
        }

        if (req.id === null) {
            logger.warn('Received a JSON-RPC response with a null ID. This should not happen.')
            return
        }

        // send the JSON RPC success response
        logger.debug(`[TaskSend] Returning success response for Task ID: ${taskId}, Request ID: ${req.id}`)
        return ctx.json(createSuccessResponse(req.id, currentData))
    }

    /**
     * Handle a request to send a task to the agent with streaming
     * @param req
     * @param ctx
     * @returns
     */
    async taskSendSubscribe(req: schema.SendTaskStreamingRequest, ctx: Context) {
        validateTaskSendParams(req)
        const { id: taskId, message, sessionId, metadata } = req.params
        logger.debug(`[TaskSendSubscribe] Handler called for Task ID: ${taskId}, Request ID: ${req.id}`)

        let currentData = await this.loadOrCreateTaskAndHistory(taskId, message, sessionId, metadata)

        const context = this.createTaskContext(currentData.task, message, currentData.history)
        const generator = this.taskHandler(context)

        let lastEventWasFinal = false
        const sendEvent = (eventData: schema.JSONRPCResponse, stream: SSEStreamingApi) =>
            stream.writeSSE({
                data: JSON.stringify(eventData),
                // NOTE that `id`, `retry` and `event` are not used in the implementation
            })

        return streamSSE(ctx, async (stream) => {
            logger.debug(`[TaskSendSubscribe] Stream starting for Task ID: ${taskId}, Request ID: ${req.id}`)
            try {
                for await (const yieldValue of generator) {
                    // Apply update immutably
                    currentData = applyUpdateToTaskAndHistory(currentData, yieldValue)
                    // save the updated state
                    await this.taskStore.save(currentData)
                    // update context snapshot for next iteration
                    context.task = currentData.task

                    let event: schema.TaskStatusUpdateEvent | schema.TaskArtifactUpdateEvent
                    let isFinal = false

                    if (isTaskStatusUpdate(yieldValue)) {
                        // TODO - google's implementation treats "input-required" as a terminal state, and probably doesn't implement it robustly.
                        const terminalStates: Array<schema.TaskState> = [
                            'completed',
                            'failed',
                            'canceled',
                            'input-required',
                        ]
                        isFinal = terminalStates.includes(currentData.task.status.state)
                        event = createTaskStatusEvent(taskId, currentData.task.status, isFinal)
                        if (isFinal)
                            logger.debug(
                                `[Task ${taskId}] Yielded terminal state event ${currentData.task.status.state}, marking event as final`,
                            )
                    } else if (isArtifactUpdate(yieldValue)) {
                        // Find the updated artifact in the new task object
                        const updatedArtifact =
                            currentData.task.artifacts?.find(
                                (a) =>
                                    (a.index !== undefined && a.index === yieldValue.index) ||
                                    (a.name && a.name === yieldValue.name),
                            ) ?? yieldValue // Fallback
                        event = createTaskArtifactEvent(taskId, updatedArtifact, false)
                        // Note: Artifact updates themselves don't usually mark the task as final.
                    } else {
                        logger.warn(`[Task ${taskId}] Received unknown update type:`, yieldValue)
                        continue
                    }

                    sendEvent(createSuccessResponse(req.id, event), stream)
                    logger.debug(
                        `[TaskSendSubscribe] Sent event for Task ID: ${taskId}. Final: ${isFinal}. Event type: ${'event' in event ? event.event : 'N/A'}`,
                    )
                    lastEventWasFinal = isFinal
                    if (isFinal) break
                }

                if (!lastEventWasFinal) {
                    logger.warn(
                        `[Task ${taskId}] Task completed without a final event. Sending final state: ${currentData.task.status.state}. Request ID: ${req.id}`,
                    )

                    const finalStates: schema.TaskState[] = ['completed', 'failed', 'canceled', 'input-required']
                    if (!finalStates.includes(currentData.task.status.state)) {
                        logger.warn(
                            `[Task ${taskId}] Task ended non-terminally (${currentData.task.status.state}). Forcing 'completed'`,
                        )

                        currentData = applyUpdateToTaskAndHistory(currentData, {
                            state: 'completed',
                        })
                        await this.taskStore.save(currentData)
                    }

                    const finalEvent = createTaskStatusEvent(
                        taskId,
                        currentData.task.status,
                        true, // mark as final
                    )
                    sendEvent(createSuccessResponse(req.id, finalEvent), stream)
                    logger.debug(
                        `[TaskSendSubscribe] Sent default final event for Task ID: ${taskId}. State: ${currentData.task.status.state}`,
                    )
                }
            } catch (error: any) {
                logger.error(`[Task ${taskId}] Error streaming task (Request ID: ${req.id}):`, error)
                const failureUpdate: Omit<schema.TaskStatus, 'timestamp'> = createTaskFailureStatusUpdate(error)
                currentData = applyUpdateToTaskAndHistory(currentData, failureUpdate)

                try {
                    await this.taskStore.save(currentData)
                } catch (error) {
                    logger.error(`[Task ${taskId}] Failed to save task after handler failure:`, error)
                }

                const errorEvent = createTaskStatusEvent(
                    taskId,
                    currentData.task.status,
                    true, // mark as final
                )
                sendEvent(createSuccessResponse(req.id, errorEvent), stream)
                logger.debug(
                    `[TaskSendSubscribe] Sent error event for Task ID: ${taskId}. State: ${currentData.task.status.state}`,
                )
            } finally {
                if (!stream.closed) {
                    logger.debug(`[TaskSendSubscribe] Closing stream for Task ID: ${taskId}, Request ID: ${req.id}`)
                    await stream.close()
                } else {
                    logger.debug(
                        `[TaskSendSubscribe] Stream already closed for Task ID: ${taskId}, Request ID: ${req.id}`,
                    )
                }
            }
        })
    }

    /**
     * Handle a request to get the current state of a task.
     * @param req
     * @param ctx
     * @returns
     */
    async taskGet(req: schema.GetTaskRequest, ctx: Context) {
        const { id: taskId } = req.params
        logger.debug(`[TaskGet] Handler called for Task ID: ${taskId}, Request ID: ${req.id}`)
        if (!taskId) throw A2AError.invalidParams('Missing task ID.')

        const data = await this.taskStore.load(taskId)
        if (!data) {
            logger.warn(`[TaskGet] Task not found for Task ID: ${taskId}, Request ID: ${req.id}`)
            throw A2AError.taskNotFound(taskId)
        }

        if (!req.id) throw A2AError.invalidParams('Missing request ID.')
        logger.debug(`[TaskGet] Returning data for Task ID: ${taskId}, Request ID: ${req.id}`)
        return ctx.json(createSuccessResponse(req.id, data))
    }

    /**
     * Handle a request to cancel a task.
     * @param req
     * @param ctx
     * @returns
     */
    async taskCancel(req: schema.CancelTaskRequest, ctx: Context) {
        const { id: taskId } = req.params
        logger.debug(`[TaskCancel] Handler called for Task ID: ${taskId}, Request ID: ${req.id ?? 'N/A'}`)
        let data = await this.taskStore.load(taskId)
        if (!data) {
            logger.warn(`[TaskCancel] Task not found for Task ID: ${taskId}, Request ID: ${req.id ?? 'N/A'}`)
            throw A2AError.taskNotFound(taskId)
        }

        // make sure that the task is cancelable
        const finalStates: schema.TaskState[] = ['completed', 'failed', 'canceled']
        if (finalStates.includes(data.task.status.state)) {
            logger.warn(
                `[Task ${taskId}] Received cancel request for task in final state ${data.task.status.state}. Ignoring. Request ID: ${req.id ?? 'N/A'}`,
            )
            return ctx.json(createSuccessResponse(req.id ?? null, data.task))
        }

        this.activeCancellations.add(taskId) // signal cancellation
        logger.debug(`[TaskCancel] Signaled cancellation for Task ID: ${taskId}`)

        const cancelUpdate: Omit<schema.TaskStatus, 'timestamp'> = {
            state: 'canceled',
            message: {
                role: 'agent',
                parts: [{ text: 'Task canceled by request.', type: 'text' }],
            },
        }
        data = applyUpdateToTaskAndHistory(data, cancelUpdate)
        await this.taskStore.save(data)
        this.activeCancellations.delete(taskId) // remove the cancellation signal
        logger.debug(
            `[TaskCancel] Successfully cancelled and saved Task ID: ${taskId}. Returning success. Request ID: ${req.id ?? 'N/A'}`,
        )
        return ctx.json(createSuccessResponse(req.id ?? null, data))
    }
}
