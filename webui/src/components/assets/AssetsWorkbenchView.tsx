import { useState } from "react";
import type { ReactNode } from "react";
import { Boxes, Brain, Plug, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { McpServersPage } from "@/components/settings/mcp/McpServersPage";
import { SkillsCatalogSettings } from "@/components/settings/SkillsCatalogSettings";
import { Button } from "@/components/ui/button";
import { useMcpServers } from "@/hooks/useMcpServers";
import type { SkillSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

import { TeamAssetsPanel } from "./TeamAssetsPanel";

type AssetTab = "skills" | "mcp" | "team";

export function AssetsWorkbenchView({
  skills,
  teamMcpNames = [],
  onRestart,
  isRestarting = false,
}: {
  skills: SkillSummary[];
  teamMcpNames?: string[];
  onRestart: () => void;
  isRestarting?: boolean;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<AssetTab>("skills");
  const mcp = useMcpServers();
  const configuredMcpNames = mcp.presets
    .filter((item) => item.installed || item.source === "custom")
    .map((item) => item.name);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-settings-canvas">
      <header className="shrink-0 border-b border-border/55 bg-settings-canvas px-5 py-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-7xl items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Boxes className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">
              {t("assets.eyebrow", { defaultValue: "团队能力" })}
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {t("assets.title", { defaultValue: "资产" })}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {t("assets.subtitle", { defaultValue: "管理可组合到 Agent 中的技能知识与外部工具连接。" })}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-border/55">
            <TabButton active={tab === "skills"} onClick={() => setTab("skills")}>
              <Brain className="h-4 w-4" aria-hidden />
              {t("assets.skills", { defaultValue: "技能" })}
              <span className="ml-1 text-xs text-muted-foreground">{skills.length}</span>
            </TabButton>
            <TabButton active={tab === "mcp"} onClick={() => setTab("mcp")}>
              <Plug className="h-4 w-4" aria-hidden />
              {t("assets.mcp", { defaultValue: "MCP 工具" })}
              <span className="ml-1 text-xs text-muted-foreground">{configuredMcpNames.length}</span>
            </TabButton>
            <TabButton active={tab === "team"} onClick={() => setTab("team")}>
              <Users className="h-4 w-4" aria-hidden />
              {t("assets.teamHub.label", { defaultValue: "团队" })}
            </TabButton>
          </div>

          {tab === "skills" ? <SkillsCatalogSettings skills={skills} /> : null}
          {tab === "mcp" ? (
            <McpServersPage
              presets={mcp.presets}
              teamAssetNames={teamMcpNames}
              showAssetOwnership
              loading={mcp.loading}
              actionKey={mcp.actionKey}
              error={mcp.error}
              message={mcp.message}
              requiresRestart={mcp.requiresRestart}
              onRestart={onRestart}
              isRestarting={isRestarting}
              onRefresh={() => void mcp.refresh()}
              onDismissStatus={mcp.dismissStatus}
              onToggleServer={(preset, enabled) => void mcp.toggleServer(preset, enabled)}
              onSaveServer={mcp.saveServer}
              onTestServer={(name) => void mcp.testServer(name)}
              onRemoveServer={(name) => void mcp.removeServer(name)}
              onReconnectServer={(name) => void mcp.reconnectServer(name)}
            />
          ) : null}
          {tab === "team" ? (
            <TeamAssetsPanel
              localSkillNames={skills
                .filter((item) => item.source === "workspace")
                .map((item) => item.name)}
              localMcpNames={configuredMcpNames}
              onRestart={onRestart}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        "h-10 gap-2 rounded-none border-b-2 px-3 text-sm",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {children}
    </Button>
  );
}
