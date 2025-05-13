import type * as schema from '../schema'
import type { TaskHandler, TaskYieldUpdate } from './handler'
import { A2AServer } from './server'

const server = new A2AServer(taskHandler, {
    card: {
        name: 'Test agent',
        url: 'http://localhost:10000/',
        version: '1.0.0',
        capabilities: {
            streaming: true,
            pushNotifications: false, // TODO support this
            stateTransitionHistory: false, // TODO support this
        },
        skills: [
            {
                id: 'test-skill',
                name: 'Test skill',
                description: 'Returns hello world',
                inputModes: ['text'],
                outputModes: ['text'],
            } satisfies schema.AgentSkill,
        ],
    } satisfies schema.AgentCard,
})
server.start(41241, true)

/**
 * This is the task handler that will be used by the server.
 * @param parameters
 */
async function* taskHandler(...parameters: Parameters<TaskHandler>): ReturnType<TaskHandler> {
    yield {
        state: 'working',
        message: {
            role: 'agent',
            parts: [
                {
                    type: 'text',
                    text: 'Hello, world!',
                },
            ],
        },
    } satisfies TaskYieldUpdate
    yield {
        state: 'completed',
    } satisfies TaskYieldUpdate
}

// `bun run dev` or `bun run start`
export default {
    fetch: server.app.fetch,
    port: 41241,
}
