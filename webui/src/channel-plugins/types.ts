import type { ComponentType } from "react";

import type { ChannelPresentation } from "@/components/settings/channels/catalog";
import type {
  NanodeskFeatureInfo,
  NanodeskFeaturesPayload,
} from "@/lib/types";

export type ChannelPluginPanelProps = {
  token: string;
  feature: NanodeskFeatureInfo;
  actionKey: string | null;
  chatAppsDocsUrl?: string;
  showBrandLogos: boolean;
  onAction: (action: "enable" | "disable", name: string) => void;
  onFeaturesUpdate: (payload: NanodeskFeaturesPayload) => void;
};

export type ChannelPluginConnectFlowProps = {
  token: string;
  feature: NanodeskFeatureInfo;
  idleLabel?: string;
  connectRequestId?: number;
  onFeaturesUpdate: (payload: NanodeskFeaturesPayload) => void;
};

export type ChannelUiContribution = {
  presentation: ChannelPresentation;
  aliases?: Record<string, Partial<ChannelPresentation>>;
  Panel?: ComponentType<ChannelPluginPanelProps>;
  ConnectFlow?: ComponentType<ChannelPluginConnectFlowProps>;
  canConnectBeforeConfigured?: boolean;
};

export type RegisteredChannelUiContribution = {
  channel: string;
  webui: string;
  contribution: ChannelUiContribution;
};
