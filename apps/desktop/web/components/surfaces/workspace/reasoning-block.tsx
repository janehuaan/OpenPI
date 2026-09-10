import { useEffect, useState } from "react";
import { BrainCircuit, ChevronDown } from "../../icons.tsx";

export function ReasoningBlock({
	reasoning,
	isWorking = false,
	defaultOpen = false,
}: {
	reasoning: string;
	isWorking?: boolean;
	defaultOpen?: boolean;
}) {
	const [isOpen, setIsOpen] = useState(isWorking && defaultOpen);
	const [userToggled, setUserToggled] = useState(false);
	const charCount = reasoning.length;

	// When generation completes or text arrives, auto-collapse unless user explicitly toggled it open
	useEffect(() => {
		if (!userToggled) {
			setIsOpen(isWorking && defaultOpen);
		}
	}, [isWorking, defaultOpen, userToggled]);

	return (
		<details
			className={`message-reasoning ${isWorking ? "is-thinking" : ""}`}
			open={isOpen}
			onToggle={(e) => {
				setUserToggled(true);
				setIsOpen((e.target as HTMLDetailsElement).open);
			}}
		>
			<summary>
				<BrainCircuit size={13} className="reasoning-brain-icon" />
				<span className="reasoning-label">
					{isWorking
						? "正在深度思考…"
						: isOpen
							? `思考过程 (${charCount} 字)`
							: `已深度思考 (${charCount} 字) · 点击查看`}
				</span>
				<ChevronDown
					size={13}
					className="reasoning-chevron"
					style={{
						marginLeft: "auto",
						transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
						transition: "transform 160ms ease",
					}}
				/>
			</summary>
			<pre>{reasoning}</pre>
		</details>
	);
}
