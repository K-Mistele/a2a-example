import type * as Schema from '../schema'
import type { TaskAndHistory } from './store'
import { getCurrentTimestamp, isArtifactUpdate, isTaskStatusUpdate } from './utils'

export function applyUpdateToTaskAndHistory(
    current: TaskAndHistory,
    update: Omit<Schema.TaskStatus, 'timestamp'> | Schema.Artifact,
): TaskAndHistory {
    const newTask = { ...current.task } // Shallow copy task
    const newHistory = [...current.history] // Shallow copy history

    if (isTaskStatusUpdate(update)) {
        // Merge status update
        newTask.status = {
            ...newTask.status, // Keep existing properties if not overwritten
            ...update, // Apply updates
            timestamp: getCurrentTimestamp(), // Always update timestamp
        }
        // If the update includes an agent message, add it to history
        if (update.message?.role === 'agent') {
            newHistory.push(update.message)
        }
    } else if (isArtifactUpdate(update)) {
        // Handle artifact update
        if (!newTask.artifacts) {
            newTask.artifacts = []
        } else {
            // Ensure we're working with a copy of the artifacts array
            newTask.artifacts = [...newTask.artifacts]
        }

        const existingIndex = update.index ?? -1 // Use index if provided
        let replaced = false

        if (existingIndex >= 0 && existingIndex < newTask.artifacts.length) {
            const existingArtifact = newTask.artifacts[existingIndex]
            if (update.append) {
                // Create a deep copy for modification to avoid mutating original
                const appendedArtifact = JSON.parse(JSON.stringify(existingArtifact))
                appendedArtifact.parts.push(...update.parts)
                if (update.metadata) {
                    appendedArtifact.metadata = {
                        ...(appendedArtifact.metadata || {}),
                        ...update.metadata,
                    }
                }
                if (update.lastChunk !== undefined) appendedArtifact.lastChunk = update.lastChunk
                if (update.description) appendedArtifact.description = update.description
                newTask.artifacts[existingIndex] = appendedArtifact // Replace with appended version
                replaced = true
            } else {
                // Overwrite artifact at index (with a copy of the update)
                newTask.artifacts[existingIndex] = { ...update }
                replaced = true
            }
        } else if (update.name) {
            const namedIndex = newTask.artifacts.findIndex((a) => a.name === update.name)
            if (namedIndex >= 0) {
                newTask.artifacts[namedIndex] = { ...update } // Replace by name (with copy)
                replaced = true
            }
        }

        if (!replaced) {
            newTask.artifacts.push({ ...update }) // Add as a new artifact (copy)
            // Sort if indices are present
            if (newTask.artifacts.some((a) => a.index !== undefined)) {
                newTask.artifacts.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            }
        }
    }

    return { task: newTask, history: newHistory }
}

export function createTaskStatusEvent(
    taskId: string,
    status: Schema.TaskStatus,
    final: boolean,
): Schema.TaskStatusUpdateEvent {
    return {
        id: taskId,
        status: status, // Assumes status already has timestamp from applyUpdate
        final: final,
    }
}

export function createTaskFailureStatusUpdate(error: any): Omit<Schema.TaskStatus, 'timestamp'> {
    return {
        state: 'failed',
        message: {
            role: 'agent',
            parts: [
                {
                    type: 'text',
                    text: `Handler failed: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        },
    }
}

export function createTaskArtifactEvent(
    taskId: string,
    artifact: Schema.Artifact,
    final: boolean,
): Schema.TaskArtifactUpdateEvent {
    return {
        id: taskId,
        artifact: artifact,
        final: final, // Usually false unless it's the very last thing
    }
}
