import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { prettyJSON } from 'hono/pretty-json'
import createLogger from 'logging'
import type * as schema from '../schema'
import { A2AError, normalizeError } from './error'
import type { TaskContext as OldTaskContext, TaskHandler } from './handler'
import { createSuccessResponse, isValidJsonRpcRequest } from './jsonrpc'
import { BunRedisTaskStore, type TaskAndHistory, type TaskStore } from './store'
import { applyUpdateToTaskAndHistory } from './tasks'
import { getCurrentTimestamp, validateTaskSendParams } from './utils'
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
export interface TaskContext extends Omit<OldTaskContext, 'taskStore'> {}

export class A2AServer {
    private taskHandler: TaskHandler
    private taskStore: TaskStore
    private corsOptions: CorsOptions | boolean | string
    private basePath: string
    private activeCancellations: Set<string> = new Set()
    public card: schema.AgentCard

    constructor(handler: TaskHandler, options: A2AServerOptions) {
        this.taskHandler = handler
        this.taskStore = options.taskStore || new BunRedisTaskStore()
        this.corsOptions = options.cors || true
        this.basePath = options.basePath ?? '/'
        this.card = options.card
        if (this.basePath !== '/') this.basePath = `/${this.basePath.replace(/^\/|\/$/g, '')}/`
    }

    public start(port: number = 10_000, start: boolean = true): Hono {
        const app = new Hono()
        app.use(prettyJSON()) // With options: prettyJSON({ space: 4 })

        if (this.corsOptions !== false) {
            const options =
                typeof this.corsOptions === 'string'
                    ? { origin: this.corsOptions }
                    : this.corsOptions === true
                      ? undefined // default
                      : this.corsOptions

            app.use(cors(options))
        }

        // Error handling middleware
        app.all(async (c, next) => {
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
        app.get('/.well-known/agent.json', (c) => {
            return c.json(this.card)
        })

        // The JSON-RPC handler endpoint
        app.post(this.basePath, async (c, next) => {
            let taskId: string | undefined = undefined
            let body: any
            let requestId: number | string | null = null
            // Get the body of the request and validate it.
            try {
                body = await c.req.json()
            } catch (error) {
                throw new HTTPException(400, {
                    message: 'Invalid JSON-RPC request',
                })
            }
            if (!isValidJsonRpcRequest(body)) throw A2AError.invalidRequest('Invalid JSON-RPC request structure')
            taskId = (body.params as any)?.id
            requestId = body.id ?? null
            try {
                // Route based on method
                switch (body.method) {
                    case 'tasks/send':
                        break
                    case 'tasks/sendSubscribe':
                        break
                    case 'tasks/get':
                        break
                    case 'tasks/cancel':
                        break
                    default:
                        throw A2AError.methodNotFound(body.method)
                }
            } catch (error: any) {
                if (error instanceof A2AError && taskId && !error.taskId) {
                    error.taskId = taskId
                }
                // Return a JSON RPC error response
                return c.json(normalizeError(error.message, requestId, taskId), 200)
            }
        })

        // add the endpoint handler
        app.post(this.basePath, async (c) => {
            const body = await c.req.json()
            if (!isValidJsonRpcRequest(body)) {
            }
        })

        return app
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
            isCancelled: () => this.activeCancellations.has(task.id),
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
        } catch (handlerError) {
            const failureStatusUpdate: Omit<schema.TaskStatus, 'timestamp'> = {
                state: 'failed',
                message: {
                    role: 'agent',
                    parts: [
                        {
                            text: `Handler failed: ${
                                handlerError instanceof Error ? handlerError.message : String(handlerError)
                            }`,
                            type: 'text',
                        },
                    ],
                },
            }
            currentData = applyUpdateToTaskAndHistory(currentData, failureStatusUpdate)
            try {
                await this.taskStore.save(currentData)
            } catch (error) {
                logger.error(`[Task ${currentData.task.id}] Failed to save task after handler failure:`, error)
            }
            throw normalizeError(handlerError, req.id, taskId)
        }

        if (req.id === null) {
            logger.warn('Received a JSON-RPC response with a null ID. This should not happen.')
            return
        }

        // send the JSON RPC success response
        return ctx.json(createSuccessResponse(req.id, currentData))
    }

    async taskSendSubscribe(req: schema.SendTaskStreamingRequest, ctx: Context)

    async taskGet(req: schema.GetTaskRequest, ctx: Context)

    async taskCancel(req: schema.CancelTaskRequest, ctx: Context)
}
