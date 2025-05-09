export interface AgentCapabilities {
	// If `true`, the agent supports `tasks/sendSubscribe` and `tasks/resubscribe` for real-time
	// updates via Server-Sent Events (SSE). Default: `false`.
	streaming?: boolean;
	// If `true`, the agent supports `tasks/pushNotification/set` and `tasks/pushNotification/get`
	// for asynchronous task updates via webhooks. Default: `false`.
	pushNotifications?: boolean;
	// If `true`, the agent may include a detailed history of status changes
	// within the `Task` object (future enhancement; specific mechanism TBD). Default: `false`.
	stateTransitionHistory?: boolean;
}
