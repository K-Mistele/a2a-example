export interface AgentAuthentication {
	// Array of authentication scheme names supported/required by the agent's endpoint
	// (e.g., "Bearer", "Basic", "OAuth2", "ApiKey").
	// Standard names (e.g., from OpenAPI specification, IANA registry) SHOULD be used where applicable.
	// An empty array means no specific A2A-level schemes are advertised.
	schemes: string[];
	// Optional field, MAY contain non-secret, scheme-specific information.
	// Examples: For "OAuth2", this could be a JSON string with `tokenUrl`, `authorizationUrl`, `scopes`.
	// For "ApiKey", it could specify the header name (`in: "header"`, `name: "X-Custom-API-Key"`).
	// **CRITICAL**: This field MUST NOT contain plaintext secrets (e.g., actual API key values, passwords).
	// If the Agent Card itself needs to be protected due to this field containing sensitive URLs
	// or configuration, the endpoint serving the Agent Card MUST be secured.
	credentials?: string | null; // E.g., A JSON string parsable by the client for scheme details.
}
