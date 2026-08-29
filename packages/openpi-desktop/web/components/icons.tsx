/**
 * Minimal SVG icon components to replace lucide-react.
 * Paths from https://lucide.dev (MIT license)
 */
import type { SVGProps } from "react";

const ICON_SIZE = 20;
const ICON_STROKE = 1.5;

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
	return (
		<svg
			width={ICON_SIZE}
			height={ICON_SIZE}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={ICON_STROKE}
			strokeLinecap="round"
			strokeLinejoin="round"
			{...props}
		>
			{children}
		</svg>
	);
}

export const ArrowLeft = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M19 12H5M12 19l-7-7 7-7" />
	</Icon>
);
export const Bell = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
		<path d="M10.5 21a1.5 1.5 0 0 0 3 0" />
	</Icon>
);
export const Check = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<polyline points="20 6 9 17 4 12" />
	</Icon>
);
export const ChevronDown = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<polyline points="6 9 12 15 18 9" />
	</Icon>
);
export const ChevronUp = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<polyline points="18 15 12 9 6 15" />
	</Icon>
);
export const RefreshCw = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<polyline points="23 4 23 10 17 10" />
		<polyline points="1 20 1 14 7 14" />
		<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
	</Icon>
);
export const Search = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<circle cx="11" cy="11" r="8" />
		<path d="m21 21-4.3-4.3" />
	</Icon>
);
export const X = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M18 6 6 18M6 6l12 12" />
	</Icon>
);
export const Mic = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
		<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
		<line x1="12" x2="12" y1="19" y2="22" />
	</Icon>
);
export const MoreHorizontal = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<circle cx="12" cy="12" r="1" />
		<circle cx="19" cy="12" r="1" />
		<circle cx="5" cy="12" r="1" />
	</Icon>
);
export const Package = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 1 0 4l-9 5-9-5A2 2 0 0 1 3 8m18 0h-9a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V10" />
	</Icon>
);
export const PanelLeftClose = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="18" height="18" rx="2" />
		<path d="M9 12 4.5 7.5 9 3" />
		<path d="M4 22V2" />
	</Icon>
);
export const PanelLeftOpen = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="18" height="18" rx="2" />
		<path d="M9 12 4.5 7.5 9 3" />
	</Icon>
);
export const PanelRight = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="18" height="18" rx="2" />
		<path d="M9 12h6" />
		<path d="M15 3v18" />
	</Icon>
);
export const Paperclip = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.2a2 2 0 0 1-2.83-2.83l9.19-9.19" />
	</Icon>
);
export const Pause = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="4" height="16" x="6" y="4" rx="1" />
		<rect width="4" height="16" x="14" y="4" rx="1" />
	</Icon>
);
export const Pencil = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
		<path d="m15 5 4 4" />
	</Icon>
);
export const Pin = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M12 17v5" />
		<path d="M9 10.76a2 2 0 0 1-1.11-3.38l3.25-.94a2 2 0 0 1 2.42 1.38l.83 2.88 2.88-.83a2 2 0 0 1 2.37 2.37l-.83 2.88 2.88-.83a2 2 0 0 1 1.38 2.42l-.94 3.25a2 2 0 0 1-3.38 1.11L12 14.24l-2.24 2.24a2 2 0 0 1-3.38-1.11l-.94-3.25a2 2 0 0 1 1.38-2.42l2.88.83-.83-2.88a2 2 0 0 1 2.42-1.38Z" />
	</Icon>
);
export const Play = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<polygon points="5 3 19 12 5 21 5 3" />
	</Icon>
);
export const Plus = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M5 12h14" />
		<path d="M12 5v14" />
	</Icon>
);
export const Save = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M15.2 3a2 2 0 0 1 1.4.6l2.8 2.8a2 2 0 0 1 .6 1.4v12.2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.2Z" />
		<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
		<polyline points="17 21 17 13 7 13 7 21" />
		<polyline points="7 3 7 8 15 8" />
	</Icon>
);
export const Send = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="m22 2-7 20-4-9-9-4Z" />
		<path d="M22 2 11 13" />
	</Icon>
);
export const Server = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
		<rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
		<line x1="6" x2="6.01" y1="6" y2="6" />
		<line x1="6" x2="6.01" y1="18" y2="18" />
	</Icon>
);
export const Share2 = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<circle cx="18" cy="5" r="3" />
		<circle cx="6" cy="12" r="3" />
		<circle cx="18" cy="19" r="3" />
		<line x1="8.59" x2="15.42" y1="13.51" y2="17.49" />
		<line x1="15.41" x2="8.59" y1="6.51" y2="10.49" />
	</Icon>
);
export const Slash = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<line x1="2" x2="22" y1="2" y2="22" />
	</Icon>
);
export const Sparkles = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
		<path d="M5 3v4" />
		<path d="M19 17v4" />
		<path d="M3 5h4" />
		<path d="M17 19h4" />
	</Icon>
);
export const Square = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="18" height="18" x="3" y="3" rx="2" />
	</Icon>
);
export const Terminal = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<polyline points="4 17 10 11 4 5" />
		<line x1="12" x2="20" y1="19" y2="19" />
	</Icon>
);
export const TerminalSquare = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="18" height="18" x="3" y="3" rx="2" />
		<polyline points="7 10 10 13 7 16" />
		<line x1="12" x2="16" y1="10" y2="10" />
	</Icon>
);
export const Trash2 = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M3 6h18" />
		<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
		<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
		<line x1="10" x2="10" y1="11" y2="17" />
		<line x1="14" x2="14" y1="11" y2="17" />
		<path d="M5 6l1 14h12l1-14" />
	</Icon>
);
export const UserRound = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<circle cx="12" cy="8" r="5" />
		<path d="M20 21a8 8 0 0 0-16 0" />
	</Icon>
);
export const WandSparkles = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="m19 7-3 2" />
		<path d="m5 12 6-6" />
		<path d="m14 3 3 3" />
		<path d="m21 14-2.5 .5" />
		<path d="m15.5 4.5 1 1" />
		<path d="M12 2v3" />
		<path d="M12 19v3" />
		<path d="M4.2 4.2l2.1 2.1" />
		<path d="m19.8 19.8-2.1-2.1" />
	</Icon>
);
export const Wrench = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M3 21h18" />
		<path d="M5 21V7l8-4 8 8v14" />
		<path d="M9 11h6" />
		<path d="M9 6h.01" />
		<path d="M15 13h.01" />
	</Icon>
);
// Extra icons used in surfaces
export const Cpu = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="16" height="16" x="4" y="4" rx="2" />
		<rect width="6" height="6" x="9" y="9" rx="1" />
		<path d="M15 2v2" />
		<path d="M15 20v2" />
		<path d="M2 8h2" />
		<path d="M2 16h2" />
		<path d="M20 8h2" />
		<path d="M20 16h2" />
		<path d="M8 2v2" />
		<path d="M8 20v2" />
	</Icon>
);
export const Download = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<polyline points="7 10 12 15 17 10" />
		<line x1="12" x2="12" y1="15" y2="3" />
	</Icon>
);
export const ExternalLink = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M15 3h6v6" />
		<path d="M10 14 21 3" />
		<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
	</Icon>
);
export const FileJson = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
		<path d="M14 2v4a2 2 0 0 0 2 2h4" />
		<path d="m9 15 2-2-2-2" />
		<path d="m15 15-2-2 2-2" />
	</Icon>
);
export const FileText = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
		<path d="M14 2v4a2 2 0 0 0 2 2h4" />
		<path d="M10 12a1 1 0 0 0 0 2h4a1 1 0 0 0 0-2Z" />
		<path d="M10 17a1 1 0 0 0 0 2h4a1 1 0 0 0 0-2Z" />
		<path d="M10 7a1 1 0 0 0 0 2h1" />
	</Icon>
);
export const Folder = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" />
	</Icon>
);
export const FolderPlus = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z" />
		<path d="M9 11v6" />
		<path d="M12 14h-6" />
	</Icon>
);
export const GitBranch = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<line x1="6" x2="6" y1="3" y2="15" />
		<circle cx="18" cy="6" r="3" />
		<circle cx="6" cy="18" r="3" />
		<path d="M18 9a9 9 0 0 1-9 9" />
	</Icon>
);
export const Github = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c1.2-.6 2.5-1.5 2.5-3.5v-4c0-1.5-1-2-2-2h-1c-.5-.8-1.5-1.5-2.5-1.5s-2 .7-2.5 1.5h-1c-1 0-2 .5-2 2v4c0 2 1.3 2.9 2.5 3.5 0 .4-.1.8-.1 1.2V22" />
		<path d="M12 2C6.5 2 2 6.5 2 12c0 4.4 2.9 8.2 6.8 9.5.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.5 2.3 1.1 2.8.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.2-.4-1.3.1-2.6 0 0 .8-.3 2.7 1 .8-.2 1.6-.3 2.4-.3s1.6.1 2.4.3c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.7.9.7 1.8v2.7c0 .3.2.6.7.5C19.1 20.2 22 16.4 22 12 22 6.5 17.5 2 12 2Z" />
	</Icon>
);
export const History = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
		<path d="M3 3v5h5" />
		<path d="M12 7v5l4 2" />
	</Icon>
);
export const Image = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
		<circle cx="9" cy="9" r="2" />
		<path d="m21 15-5-5L5 21" />
	</Icon>
);
export const ImageIcon = Image;
export const ListTodo = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect x="3" y="5" width="6" height="6" rx="1" />
		<path d="m3 17 2 2 4-4" />
		<path d="M13 6h8" />
		<path d="M13 12h8" />
		<path d="M13 18h8" />
	</Icon>
);
export const LogIn = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
		<polyline points="10 17 15 12 10 7" />
		<line x1="15" x2="3" y1="12" y2="12" />
	</Icon>
);
export const Menu = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<line x1="4" x2="20" y1="12" y2="12" />
		<line x1="4" x2="20" y1="6" y2="6" />
		<line x1="4" x2="20" y1="18" y2="18" />
	</Icon>
);
export const MessageSquare = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
	</Icon>
);
export const Share = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
		<polyline points="16 6 12 2 8 6" />
		<line x1="12" x2="12" y1="2" y2="15" />
	</Icon>
);
export const Trash = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M3 6h18" />
		<path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
		<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
	</Icon>
);
// ArrowDown
export const ArrowDown = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M12 5v14M5 12h14" />
	</Icon>
);
// AtSign
export const AtSign = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<circle cx="12" cy="12" r="4" />
		<path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
	</Icon>
);
// Blocks
export const Blocks = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="7" height="7" x="3" y="3" rx="1" />
		<rect width="7" height="7" x="14" y="3" rx="1" />
		<rect width="7" height="7" x="3" y="14" rx="1" />
		<path d="M17 14v-1a1 1 0 0 0-1-1h-1" />
	</Icon>
);
// BookOpen
export const BookOpen = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z" />
		<path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z" />
	</Icon>
);
// Bot
export const Bot = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M12 8V4H8" />
		<rect width="16" height="12" x="4" y="8" rx="2" />
		<path d="M2 14h2" />
		<path d="M20 14h2" />
		<path d="M15 13v2" />
		<path d="M9 13v2" />
	</Icon>
);
// BrainCircuit
export const BrainCircuit = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M12 5a3 3 0 1 0-5.997.705A2.004 2.004 0 0 0 5 7.5c0 1.037.778 1.895 1.775 1.988A3.001 3.001 0 0 0 9 12.003V14" />
		<path d="M12 5a3 3 0 1 1 5.997.705A2.004 2.004 0 0 1 19 7.5c0 1.037-.778 1.895-1.775 1.988A3.001 3.001 0 0 1 15 12.003V14" />
		<path d="M7.5 15.5h9" />
		<path d="M8 20h8" />
		<path d="M12 14v1.5" />
	</Icon>
);
// Cable
export const Cable = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="M10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
		<path d="M14 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
		<path d="M7.5 13.5 4 17" />
		<path d="m16.5 10.5 3.5 3.5" />
		<path d="M4 7v5.5" />
		<path d="m20 4-4 4" />
	</Icon>
);
// CalendarClock
export const CalendarClock = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="18" height="18" x="3" rx="2" />
		<path d="M16 2v4" />
		<path d="M8 2v4" />
		<path d="M3 10h18" />
		<path d="M8 14h.01" />
		<path d="M12 14h.01" />
		<path d="M16 14h.01" />
		<path d="M8 18h.01" />
		<path d="M12 18h.01" />
	</Icon>
);
// CircleStop
export const CircleStop = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<circle cx="12" cy="12" r="10" />
		<rect width="6" height="6" x="9" y="9" rx="1" />
	</Icon>
);
// Clapperboard
export const Clapperboard = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="20" height="16" x="2" y="3" rx="2" />
		<path d="M2 7h20" />
		<path d="M6 7v10" />
		<path d="M10 7v10" />
		<path d="M14 7v10" />
		<path d="M18 7v10" />
	</Icon>
);
// Clock3
export const Clock3 = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3 3" />
	</Icon>
);
// Copy
export const Copy = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<rect width="14" height="14" x="8" y="8" rx="2" />
		<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
	</Icon>
);
// Store (package with shelf)
export const Store = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
		<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
		<path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
		<path d="M2 7h20" />
		<path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.6-1.6A2.7 2.7 0 0 0 16 11a2.7 2.7 0 0 1-1.6-1.6A2.7 2.7 0 0 0 12 9a2.7 2.7 0 0 1-1.6-1.6A2.7 2.7 0 0 0 8 9v0a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7" />
	</Icon>
);
// ChevronRight
export const ChevronRight = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<path d="m9 18 6-6-6-6" />
	</Icon>
);
// ChevronsUpDown
export const ChevronsUpDown = (props: SVGProps<SVGSVGElement>) => (
	<Icon {...props}>
		<polyline points="7 7 12 12 17 7" />
		<polyline points="7 13 12 18 17 13" />
	</Icon>
);
