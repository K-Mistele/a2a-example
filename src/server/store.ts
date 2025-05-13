/**
 * NOTE this is a redis/valkey-based store implementation as opposed to the in-memory store in the example that Google provides.
 */

import { RedisClient } from 'bun'
import createLogger from 'logging'
import type * as Schema from '../schema'

// helper type for the simplified store
export interface TaskAndHistory {
    task: Schema.Task
    history: Schema.Message[]
}

/**
 * Simplified interface for task storage providers.
 * Stores and retrieves both the task and its full message history together.
 */
export interface TaskStore {
    /**
     * Saves a task and its associated message history.
     * Overwrites existing data if the task ID exists.
     * @param data An object containing the task and its history.
     * @returns A promise resolving when the save operation is complete.
     */
    save(data: TaskAndHistory): Promise<void>

    /**
     * Loads a task and its history by task ID.
     * @param taskId The ID of the task to load.
     * @returns A promise resolving to an object containing the Task and its history, or null if not found.
     */
    load(taskId: string): Promise<TaskAndHistory | null>
}

// =====================
// BunRedisTaskStore
// =====================

/**
 * BunRedisTaskStore is a task store that uses Redis to store and retrieve task and history data.
 *
 * @example
 * const store = new BunRedisTaskStore()
 * await store.save({ task: { id: '123', status: 'pending' }, history: [] })
 * const data = await store.load('123')
 * console.log(data)
 *
 * @method save - Saves a task and its history to Redis.
 * @method load - Loads a task and its history from Redis.
 */
export class BunRedisTaskStore implements TaskStore {
    private redis: RedisClient
    private logger = createLogger('BunRedisTaskStore')

    constructor(redisUrl: string = 'redis://localhost:6379') {
        this.redis = new RedisClient(redisUrl)
        this.redis.connect().then(() => this.logger.info('Connected to Redis'))
    }

    /**
     * Loads a task and its history from Redis.
     * @param taskId The ID of the task to load.
     * @returns A promise resolving to an object containing the Task and its history, or null if not found.
     */
    async load(taskId: string): Promise<TaskAndHistory | null> {
        this.logger.debug(`Loading task ${taskId} from Redis`)
        const data = await this.redis.get(taskId)
        if (!data) {
            this.logger.warn(`No data found for task ${taskId}`)
            return null
        }
        this.logger.debug(`Loaded task ${taskId} from Redis:`, JSON.parse(data))
        return JSON.parse(data) as TaskAndHistory
    }

    /**
     * Saves a task and its history to Redis.
     * @param data An object containing the task and its history.
     * @returns A promise resolving when the save operation is complete.
     */
    async save(data: TaskAndHistory): Promise<void> {
        this.logger.debug(`Saving task ${data.task.id} to Redis:`, data)
        await this.redis.set(data.task.id, JSON.stringify(data))
    }
}

export interface ActiveCancellationsStore {
    add(taskId: string): Promise<void>
    delete(taskId: string): Promise<void>
    has(taskId: string): Promise<boolean>
}

export class BunRedisActiveCancellationsStore implements ActiveCancellationsStore {
    private redis: RedisClient
    private logger = createLogger('BunRedisActiveCancellationsStore')

    private readonly activeCancellationsKey = 'active-cancellations'

    constructor(redisUrl: string = 'redis://localhost:6379') {
        this.redis = new RedisClient(redisUrl)
        this.redis.connect().then(() => this.logger.info('Connected to Redis'))
    }

    async delete(taskId: string): Promise<void> {
        await this.redis.srem(this.activeCancellationsKey, taskId)
    }
    async has(taskId: string): Promise<boolean> {
        return await this.redis.sismember(this.activeCancellationsKey, taskId)
    }
    async add(taskId: string): Promise<void> {
        await this.redis.sadd('active-cancellations', taskId)
    }
}
