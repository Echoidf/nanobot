import type { AgentProfilePayload } from "@/lib/types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Id of the built-in agent profile that the backend always synthesizes. */
export const DEFAULT_AGENT_ID = "default";

/**
 * Return the localized description to render for one agent profile.
 *
 * The default profile's description is backend-generated English copy that the
 * user cannot edit, so map it to a translation key instead of rendering it
 * verbatim. User-created profiles keep their own text, which is user data.
 */
export function agentDescription(
  agent: Pick<AgentProfilePayload, "id" | "description">,
  t: Translate,
): string {
  if (agent.id === DEFAULT_AGENT_ID) {
    return t("agents.profile.defaultDescription", {
      defaultValue: "Default NanoDesk assistant using the global model, skills, and tools.",
    });
  }
  return (
    agent.description.trim() ||
    t("agents.workbench.noDescription", { defaultValue: "No description provided." })
  );
}
