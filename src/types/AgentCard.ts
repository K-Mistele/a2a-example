import type { AgentAuthentication } from "./AgentAuthentication";
import type { AgentCapabilities } from "./AgentCapabilities";
import type { AgentProvider } from "./AgentProvider";
import type { AgentSkill } from "./AgentSkill";
// An AgentCard conveys key information about an A2A Server:
// - Overall identity and descriptive details.
// - Service endpoint URL.
// - Supported A2A protocol capabilities (streaming, push notifications).
// - Authentication requirements.
// - Default input/output content types (MIME types).
// - A list of specific skills the agent offers.
export interface AgentCard {
	// Human-readable name of the agent (e.g., "Recipe Advisor Agent").
	name: string;
	// A human-readable description of the agent and its general purpose.
	// [CommonMark](https://commonmark.org/) MAY be used for rich text formatting.
	// (e.g., "This agent helps users find recipes, plan meals, and get cooking instructions.")
	description?: string | null;
	// The base URL endpoint for the agent's A2A service (where JSON-RPC requests are sent).
	// Must be an absolute HTTPS URL for production (e.g., `https://agent.example.com/a2a/api`).
	// HTTP MAY be used for local development/testing only.
	url: string;
	// Information about the organization or entity providing the agent.
	provider?: AgentProvider | null;
	// Version string for the agent or its A2A implementation
	// (format is defined by the provider, e.g., "1.0.0", "2023-10-26-beta").
	version: string;
	// URL pointing to human-readable documentation for the agent (e.g., API usage, detailed skill descriptions).
	documentationUrl?: string | null;
	// Specifies optional A2A protocol features supported by this agent.
	capabilities: AgentCapabilities;
	// Authentication schemes required to interact with the agent's `url` endpoint.
	// If `null`, omitted, or an empty `schemes` array, no A2A-level authentication is explicitly advertised
	// (NOT recommended for production; other security like network ACLs might still apply).
	authentication?: AgentAuthentication | null;
	// Array of [MIME types](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types)
	// the agent generally accepts as input across all skills, unless overridden by a specific skill.
	// Default if omitted: `["text/plain"]`. Example: `["text/plain", "image/png"]`.
	defaultInputModes?: string[];
	// Array of MIME types the agent generally produces as output across all skills, unless overridden by a specific skill.
	// Default if omitted: `["text/plain"]`. Example: `["text/plain", "application/json"]`.
	defaultOutputModes?: string[];
	// An array of specific skills or capabilities the agent offers.
	// Must contain at least one skill if the agent is expected to perform actions beyond simple presence.
	skills: AgentSkill[];
}
