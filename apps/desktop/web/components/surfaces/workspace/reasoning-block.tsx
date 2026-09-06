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
	const [isOpen, setIsOpen] = useState(isWorking || defaultOpen);
	const charCount = reasoning.length;

	useEffect(() => {
		if (isWorking) {
			setIsOpen(true);
		} else if (defaultOpen) {
			setIsOpen(true);
		}
	}, [isWorking, defaultOpen]);

	return (
		<details
			className={`message-reasoning ${isWorking ? "is-thinking" : ""}`}
			open={isOpen}
			onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}
		>
			<summary>
				<BrainCircuit size={13} className="reasoning-brain-icon" />
				<span className="reasoning-label">
					{isWorking ? "正在深度思考…" : `思考过程 (${charCount} 字)`}
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
