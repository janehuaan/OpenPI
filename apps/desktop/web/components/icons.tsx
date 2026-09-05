/**
 * Minimal SVG icon components replacing lucide-react.
 * Paths generated verbatim from lucide-react@0.468.0 (ISC license, https://lucide.dev).
 */
import type { SVGProps } from "react";

const ICON_SIZE = 20;
const ICON_STROKE = 2;

/**
 * lucide-react's call signature: callers size icons with `size`, not
 * width/height. `size` is not a valid SVG attribute, so it must be mapped here —
 * spreading it onto <svg> renders every icon at the default size instead.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "size"> & { size?: number | string };

function Icon({ children, size = ICON_SIZE, ...props }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
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

export const ArrowLeft = (props: IconProps) => (
	<Icon {...props}>
		<path d={"m12 19-7-7 7-7"} />
		<path d={"M19 12H5"} />
	</Icon>
);
export const Bell = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M10.268 21a2 2 0 0 0 3.464 0"} />
		<path
			d={
				"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"
			}
		/>
	</Icon>
);
export const Check = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M20 6 9 17l-5-5"} />
	</Icon>
);
export const ChevronDown = (props: IconProps) => (
	<Icon {...props}>
		<path d={"m6 9 6 6 6-6"} />
	</Icon>
);
export const ChevronUp = (props: IconProps) => (
	<Icon {...props}>
		<path d={"m18 15-6-6-6 6"} />
	</Icon>
);
export const RefreshCw = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"} />
		<path d={"M21 3v5h-5"} />
		<path d={"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"} />
		<path d={"M8 16H3v5"} />
	</Icon>
);
export const Search = (props: IconProps) => (
	<Icon {...props}>
		<circle cx={"11"} cy={"11"} r={"8"} />
		<path d={"m21 21-4.3-4.3"} />
	</Icon>
);
export const X = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M18 6 6 18"} />
		<path d={"m6 6 12 12"} />
	</Icon>
);
export const Mic = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"} />
		<path d={"M19 10v2a7 7 0 0 1-14 0v-2"} />
		<line x1={"12"} x2={"12"} y1={"19"} y2={"22"} />
	</Icon>
);
export const MoreHorizontal = (props: IconProps) => (
	<Icon {...props}>
		<circle cx={"12"} cy={"12"} r={"1"} />
		<circle cx={"19"} cy={"12"} r={"1"} />
		<circle cx={"5"} cy={"12"} r={"1"} />
	</Icon>
);
export const Package = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"
			}
		/>
		<path d={"M12 22V12"} />
		<path d={"m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"} />
		<path d={"m7.5 4.27 9 5.15"} />
	</Icon>
);
export const PanelLeftClose = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"18"} height={"18"} x={"3"} y={"3"} rx={"2"} />
		<path d={"M9 3v18"} />
		<path d={"m16 15-3-3 3-3"} />
	</Icon>
);
export const PanelLeftOpen = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"18"} height={"18"} x={"3"} y={"3"} rx={"2"} />
		<path d={"M9 3v18"} />
		<path d={"m14 9 3 3-3 3"} />
	</Icon>
);
export const PanelRight = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"18"} height={"18"} x={"3"} y={"3"} rx={"2"} />
		<path d={"M15 3v18"} />
	</Icon>
);
export const Paperclip = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M13.234 20.252 21 12.3"} />
		<path
			d={
				"m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486"
			}
		/>
	</Icon>
);
export const Pause = (props: IconProps) => (
	<Icon {...props}>
		<rect x={"14"} y={"4"} width={"4"} height={"16"} rx={"1"} />
		<rect x={"6"} y={"4"} width={"4"} height={"16"} rx={"1"} />
	</Icon>
);
export const Pencil = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
			}
		/>
		<path d={"m15 5 4 4"} />
	</Icon>
);
export const Pin = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M12 17v5"} />
		<path
			d={
				"M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"
			}
		/>
	</Icon>
);
export const Play = (props: IconProps) => (
	<Icon {...props}>
		<polygon points={"6 3 20 12 6 21 6 3"} />
	</Icon>
);
export const Plus = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M5 12h14"} />
		<path d={"M12 5v14"} />
	</Icon>
);
export const Save = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"} />
		<path d={"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"} />
		<path d={"M7 3v4a1 1 0 0 0 1 1h7"} />
	</Icon>
);
export const Send = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"
			}
		/>
		<path d={"m21.854 2.147-10.94 10.939"} />
	</Icon>
);
export const Server = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"20"} height={"8"} x={"2"} y={"2"} rx={"2"} ry={"2"} />
		<rect width={"20"} height={"8"} x={"2"} y={"14"} rx={"2"} ry={"2"} />
		<line x1={"6"} x2={"6.01"} y1={"6"} y2={"6"} />
		<line x1={"6"} x2={"6.01"} y1={"18"} y2={"18"} />
	</Icon>
);
export const Share2 = (props: IconProps) => (
	<Icon {...props}>
		<circle cx={"18"} cy={"5"} r={"3"} />
		<circle cx={"6"} cy={"12"} r={"3"} />
		<circle cx={"18"} cy={"19"} r={"3"} />
		<line x1={"8.59"} x2={"15.42"} y1={"13.51"} y2={"17.49"} />
		<line x1={"15.41"} x2={"8.59"} y1={"6.51"} y2={"10.49"} />
	</Icon>
);
export const Slash = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M22 2 2 22"} />
	</Icon>
);
export const Sparkles = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
			}
		/>
		<path d={"M20 3v4"} />
		<path d={"M22 5h-4"} />
		<path d={"M4 17v2"} />
		<path d={"M5 18H3"} />
	</Icon>
);
export const Square = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"18"} height={"18"} x={"3"} y={"3"} rx={"2"} />
	</Icon>
);
export const Terminal = (props: IconProps) => (
	<Icon {...props}>
		<polyline points={"4 17 10 11 4 5"} />
		<line x1={"12"} x2={"20"} y1={"19"} y2={"19"} />
	</Icon>
);
export const TerminalSquare = (props: IconProps) => (
	<Icon {...props}>
		<path d={"m7 11 2-2-2-2"} />
		<path d={"M11 13h4"} />
		<rect width={"18"} height={"18"} x={"3"} y={"3"} rx={"2"} ry={"2"} />
	</Icon>
);
export const Trash2 = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M3 6h18"} />
		<path d={"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"} />
		<path d={"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"} />
		<line x1={"10"} x2={"10"} y1={"11"} y2={"17"} />
		<line x1={"14"} x2={"14"} y1={"11"} y2={"17"} />
	</Icon>
);
export const UserRound = (props: IconProps) => (
	<Icon {...props}>
		<circle cx={"12"} cy={"8"} r={"5"} />
		<path d={"M20 21a8 8 0 0 0-16 0"} />
	</Icon>
);
export const WandSparkles = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"
			}
		/>
		<path d={"m14 7 3 3"} />
		<path d={"M5 6v4"} />
		<path d={"M19 14v4"} />
		<path d={"M10 2v2"} />
		<path d={"M7 8H3"} />
		<path d={"M21 16h-4"} />
		<path d={"M11 3H9"} />
	</Icon>
);
export const Wrench = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
			}
		/>
	</Icon>
);
export const Cpu = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"16"} height={"16"} x={"4"} y={"4"} rx={"2"} />
		<rect width={"6"} height={"6"} x={"9"} y={"9"} rx={"1"} />
		<path d={"M15 2v2"} />
		<path d={"M15 20v2"} />
		<path d={"M2 15h2"} />
		<path d={"M2 9h2"} />
		<path d={"M20 15h2"} />
		<path d={"M20 9h2"} />
		<path d={"M9 2v2"} />
		<path d={"M9 20v2"} />
	</Icon>
);
export const Download = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"} />
		<polyline points={"7 10 12 15 17 10"} />
		<line x1={"12"} x2={"12"} y1={"15"} y2={"3"} />
	</Icon>
);
export const ExternalLink = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M15 3h6v6"} />
		<path d={"M10 14 21 3"} />
		<path d={"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"} />
	</Icon>
);
export const FileJson = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"} />
		<path d={"M14 2v4a2 2 0 0 0 2 2h4"} />
		<path d={"M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"} />
		<path d={"M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"} />
	</Icon>
);
export const FileText = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"} />
		<path d={"M14 2v4a2 2 0 0 0 2 2h4"} />
		<path d={"M10 9H8"} />
		<path d={"M16 13H8"} />
		<path d={"M16 17H8"} />
	</Icon>
);
export const Folder = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
			}
		/>
	</Icon>
);
export const FolderPlus = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M12 10v6"} />
		<path d={"M9 13h6"} />
		<path
			d={
				"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
			}
		/>
	</Icon>
);
export const GitBranch = (props: IconProps) => (
	<Icon {...props}>
		<line x1={"6"} x2={"6"} y1={"3"} y2={"15"} />
		<circle cx={"18"} cy={"6"} r={"3"} />
		<circle cx={"6"} cy={"18"} r={"3"} />
		<path d={"M18 9a9 9 0 0 1-9 9"} />
	</Icon>
);
export const Github = (props: IconProps) => (
	<Icon {...props}>
		<path
			d={
				"M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"
			}
		/>
		<path d={"M9 18c-4.51 2-5-2-7-2"} />
	</Icon>
);
export const History = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"} />
		<path d={"M3 3v5h5"} />
		<path d={"M12 7v5l4 2"} />
	</Icon>
);
export const Image = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"18"} height={"18"} x={"3"} y={"3"} rx={"2"} ry={"2"} />
		<circle cx={"9"} cy={"9"} r={"2"} />
		<path d={"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"} />
	</Icon>
);

export const ImageIcon = Image;
export const ListTodo = (props: IconProps) => (
	<Icon {...props}>
		<rect x={"3"} y={"5"} width={"6"} height={"6"} rx={"1"} />
		<path d={"m3 17 2 2 4-4"} />
		<path d={"M13 6h8"} />
		<path d={"M13 12h8"} />
		<path d={"M13 18h8"} />
	</Icon>
);
export const LogIn = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"} />
		<polyline points={"10 17 15 12 10 7"} />
		<line x1={"15"} x2={"3"} y1={"12"} y2={"12"} />
	</Icon>
);
export const Menu = (props: IconProps) => (
	<Icon {...props}>
		<line x1={"4"} x2={"20"} y1={"12"} y2={"12"} />
		<line x1={"4"} x2={"20"} y1={"6"} y2={"6"} />
		<line x1={"4"} x2={"20"} y1={"18"} y2={"18"} />
	</Icon>
);
export const MessageSquare = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"} />
	</Icon>
);
export const Share = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"} />
		<polyline points={"16 6 12 2 8 6"} />
		<line x1={"12"} x2={"12"} y1={"2"} y2={"15"} />
	</Icon>
);
export const Trash = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M3 6h18"} />
		<path d={"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"} />
		<path d={"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"} />
	</Icon>
);
export const ArrowDown = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M12 5v14"} />
		<path d={"m19 12-7 7-7-7"} />
	</Icon>
);
export const AtSign = (props: IconProps) => (
	<Icon {...props}>
		<circle cx={"12"} cy={"12"} r={"4"} />
		<path d={"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"} />
	</Icon>
);
export const Blocks = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"7"} height={"7"} x={"14"} y={"3"} rx={"1"} />
		<path d={"M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"} />
	</Icon>
);
export const BookOpen = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M12 7v14"} />
		<path
			d={
				"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
			}
		/>
	</Icon>
);
export const Bot = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M12 8V4H8"} />
		<rect width={"16"} height={"12"} x={"4"} y={"8"} rx={"2"} />
		<path d={"M2 14h2"} />
		<path d={"M20 14h2"} />
		<path d={"M15 13v2"} />
		<path d={"M9 13v2"} />
	</Icon>
);
export const BrainCircuit = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"} />
		<path d={"M9 13a4.5 4.5 0 0 0 3-4"} />
		<path d={"M6.003 5.125A3 3 0 0 0 6.401 6.5"} />
		<path d={"M3.477 10.896a4 4 0 0 1 .585-.396"} />
		<path d={"M6 18a4 4 0 0 1-1.967-.516"} />
		<path d={"M12 13h4"} />
		<path d={"M12 18h6a2 2 0 0 1 2 2v1"} />
		<path d={"M12 8h8"} />
		<path d={"M16 8V5a2 2 0 0 1 2-2"} />
		<circle cx={"16"} cy={"13"} r={".5"} />
		<circle cx={"18"} cy={"3"} r={".5"} />
		<circle cx={"20"} cy={"21"} r={".5"} />
		<circle cx={"20"} cy={"8"} r={".5"} />
	</Icon>
);
export const Cable = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M17 21v-2a1 1 0 0 1-1-1v-1a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1a1 1 0 0 1-1 1"} />
		<path d={"M19 15V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V9"} />
		<path d={"M21 21v-2h-4"} />
		<path d={"M3 5h4V3"} />
		<path d={"M7 5a1 1 0 0 1 1 1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1V3"} />
	</Icon>
);
export const CalendarClock = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"} />
		<path d={"M16 2v4"} />
		<path d={"M8 2v4"} />
		<path d={"M3 10h5"} />
		<path d={"M17.5 17.5 16 16.3V14"} />
		<circle cx={"16"} cy={"16"} r={"6"} />
	</Icon>
);
export const CircleStop = (props: IconProps) => (
	<Icon {...props}>
		<circle cx={"12"} cy={"12"} r={"10"} />
		<rect x={"9"} y={"9"} width={"6"} height={"6"} rx={"1"} />
	</Icon>
);
export const Clapperboard = (props: IconProps) => (
	<Icon {...props}>
		<path d={"M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"} />
		<path d={"m6.2 5.3 3.1 3.9"} />
		<path d={"m12.4 3.4 3.1 4"} />
		<path d={"M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"} />
	</Icon>
);
export const Clock3 = (props: IconProps) => (
	<Icon {...props}>
		<circle cx={"12"} cy={"12"} r={"10"} />
		<polyline points={"12 6 12 12 16.5 12"} />
	</Icon>
);
export const Copy = (props: IconProps) => (
	<Icon {...props}>
		<rect width={"14"} height={"14"} x={"8"} y={"8"} rx={"2"} ry={"2"} />
		<path d={"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"} />
	</Icon>
);
export const Store = (props: IconProps) => (
	<Icon {...props}>
		<path d={"m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"} />
		<path d={"M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"} />
		<path d={"M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"} />
		<path d={"M2 7h20"} />
		<path
			d={
				"M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7"
			}
		/>
	</Icon>
);
export const ChevronRight = (props: IconProps) => (
	<Icon {...props}>
		<path d={"m9 18 6-6-6-6"} />
	</Icon>
);
export const ChevronsUpDown = (props: IconProps) => (
	<Icon {...props}>
		<path d={"m7 15 5 5 5-5"} />
		<path d={"m7 9 5-5 5 5"} />
	</Icon>
);
