import {
  Bug,
  Calendar,
  Check,
  ChevronRight,
  Clock3,
  Code,
  Database,
  FileText,
  Flag,
  Folder,
  Globe,
  Heart,
  ImageIcon,
  Info,
  Lightbulb,
  MessageSquare,
  Play,
  Plus,
  Rocket,
  Scale,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Star,
  Target,
  Terminal,
  User,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { CardOption, CardOptionsData } from "@/lib/card-options";
import { resolveCardRenderer } from "@/components/cards/card-registry";
import { cn } from "@/lib/utils";

/**
 * Curated lucide name → icon map.
 *
 * Card icons come from model output, so they are matched against an explicit
 * allowlist instead of a dynamic lookup (which would drag every icon into the
 * bundle). Anything that is not on the list — typically an emoji — is rendered
 * as text.
 */
const CARD_ICONS: Record<string, LucideIcon> = {
  bug: Bug,
  calendar: Calendar,
  "chevron-right": ChevronRight,
  check: Check,
  clock: Clock3,
  code: Code,
  database: Database,
  download: FileText,
  file: FileText,
  "file-text": FileText,
  flag: Flag,
  folder: Folder,
  globe: Globe,
  heart: Heart,
  image: ImageIcon,
  info: Info,
  idea: Lightbulb,
  key: Scale,
  layers: Scale,
  lightbulb: Lightbulb,
  link: Code,
  lock: Shield,
  message: MessageSquare,
  "message-square": MessageSquare,
  play: Play,
  plus: Plus,
  rocket: Rocket,
  scale: Scale,
  search: Search,
  send: Send,
  settings: Settings,
  shield: Shield,
  sparkles: Sparkles,
  star: Star,
  tag: Flag,
  target: Target,
  terminal: Terminal,
  user: User,
  users: Users,
  x: X,
  zap: Zap,
};

function normalizeIconName(icon: string): string {
  return icon.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

/** Fixed-size badge so cards with and without icons stay on the same baseline. */
function CardIconBadge({ icon }: { icon: string }) {
  const IconComponent = CARD_ICONS[normalizeIconName(icon)];
  if (IconComponent) {
    return (
      <span
        aria-hidden
        className="grid h-7 w-7 shrink-0 place-items-center rounded-mark border border-border/60 bg-muted/50 text-muted-foreground"
      >
        <IconComponent className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-mark border border-border/60 bg-muted/50 text-[15px] leading-none"
    >
      {icon}
    </span>
  );
}

interface CardOptionTileProps {
  option: CardOption;
  group: CardOptionsData;
  selected: boolean;
  disabled: boolean;
  multiSelect: boolean;
  onSelect: () => void;
}

/**
 * One selectable card: icon, title, description, pluggable body, and the
 * hover / selected / disabled states the group asks for.
 */
export function CardOptionTile({
  option,
  group,
  selected,
  disabled,
  multiSelect,
  onSelect,
}: CardOptionTileProps) {
  const Body = resolveCardRenderer(option.kind);
  return (
    <button
      type="button"
      data-card-option={option.id}
      data-card-selected={selected ? "true" : "false"}
      aria-pressed={multiSelect ? selected : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group relative flex w-full min-w-0 items-start gap-3 rounded-control border px-3 py-2.5 text-left",
        "transition-colors duration-150 motion-reduce:transition-none",
        "hover:border-primary/50 hover:bg-accent/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "active:scale-[0.995] motion-reduce:active:scale-100",
        "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-70",
        selected
          ? "border-primary/70 bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.35)]"
          : "border-border/70 bg-card/70",
      )}
    >
      {option.icon ? <CardIconBadge icon={option.icon} /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-5 text-foreground">
          <span className="min-w-0 break-words">{option.title}</span>
          {selected && !multiSelect ? (
            <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
          ) : null}
        </span>
        {option.description ? (
          <span className="mt-0.5 block break-words text-xs leading-4 text-muted-foreground">
            {option.description}
          </span>
        ) : null}
        <Body option={option} group={group} selected={selected} disabled={disabled} />
      </span>
      {multiSelect ? (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-mark border-2 transition-colors",
            selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
          )}
        >
          {selected ? <Check className="h-3 w-3 stroke-[3]" /> : null}
        </span>
      ) : (
        <ChevronRight
          aria-hidden
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground group-disabled:text-muted-foreground/60"
        />
      )}
    </button>
  );
}
