export interface AgentSkill {
	// A unique identifier for this skill within the context of this agent
	// (e.g., "currency-converter", "generate-image-from-prompt", "summarize-text-v2").
	// Clients MAY use this ID to request a specific skill if the agent supports such dispatch.
	id: string;
	// Human-readable name of the skill (e.g., "Currency Conversion Service", "Image Generation AI").
	name: string;
	// Detailed description of what the skill does, its purpose, and any important considerations.
	// [CommonMark](https://commonmark.org/) MAY be used for rich text formatting.
	description?: string | null;
	// Array of keywords or categories for discoverability and categorization
	// (e.g., ["finance", "conversion"], ["media", "generative ai", "image"]).
	tags?: string[] | null;
	// Array of example prompts, inputs, or use cases illustrating how to use this skill
	// (e.g., ["convert 100 USD to EUR", "generate a photorealistic image of a cat wearing a wizard hat"]).
	// These help clients (and potentially end-users or other agents) understand how to formulate requests for this skill.
	examples?: string[] | null;
	// Overrides `agentCard.defaultInputModes` specifically for this skill.
	// If `null` or omitted, the agent's `defaultInputModes` apply.
	inputModes?: string[] | null; // Array of MIME types
	// Overrides `agentCard.defaultOutputModes` specifically for this skill.
	// If `null` or omitted, the agent's `defaultOutputModes` apply.
	outputModes?: string[] | null; // Array of MIME types
}
