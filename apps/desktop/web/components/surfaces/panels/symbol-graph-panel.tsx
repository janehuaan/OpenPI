import { useEffect, useState } from "react";
import {
	Cpu,
	FileCode,
	GitBranch,
	Layers,
	RefreshCw,
	Search,
	Sparkles,
	Terminal,
	Wrench,
	X,
} from "../../icons";
import { desktopApi } from "../../../api";
import type { SymbolKind } from "@openpi/shared";

interface CodeSymbolItem {
	name: string;
	kind: SymbolKind;
	filePath: string;
	line: number;
	signature?: string;
	exportScope?: string;
}

interface SymbolReferenceItem {
	filePath: string;
	line: number;
	lineContent: string;
}

const KIND_FILTERS: Array<{ id: string; label: string; kind?: SymbolKind }> = [
	{ id: "all", label: "全部" },
	{ id: "func", label: "函数", kind: "function" },
	{ id: "class", label: "类", kind: "class" },
	{ id: "type", label: "接口/类型", kind: "interface" },
	{ id: "struct", label: "结构体", kind: "struct" },
];

export function SymbolGraphPanel({
	cwd,
	onInsertReference,
}: {
	cwd?: string;
	onInsertReference?(symbolName: string, filePath: string, line: number): void;
}) {
	const [query, setQuery] = useState("");
	const [activeFilter, setActiveFilter] = useState("all");
	const [loading, setLoading] = useState(false);
	const [symbols, setSymbols] = useState<CodeSymbolItem[]>([]);
	const [stats, setStats] = useState<{ totalIndexed: number; filesIndexed: number } | null>(null);

	const [selectedSymbol, setSelectedSymbol] = useState<CodeSymbolItem | null>(null);
	const [references, setReferences] = useState<SymbolReferenceItem[]>([]);
	const [loadingRefs, setLoadingRefs] = useState(false);

	const filterKind = KIND_FILTERS.find((f) => f.id === activeFilter)?.kind;

	const handleSearch = async (searchTerm = query) => {
		setLoading(true);
		try {
			const res = await desktopApi.searchCodeSymbols({
				cwd,
				query: searchTerm,
				kind: filterKind,
				limit: 50,
			});
			if (res?.symbols) {
				setSymbols(res.symbols);
				setStats({
					totalIndexed: res.totalIndexed ?? 0,
					filesIndexed: res.filesIndexed ?? 0,
				});
			}
		} catch (e) {
			console.error("[SymbolGraph] Search error:", e);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void handleSearch(query);
	}, [activeFilter, cwd]);

	const handleFindReferences = async (sym: CodeSymbolItem) => {
		setSelectedSymbol(sym);
		setLoadingRefs(true);
		try {
			const res = await desktopApi.getCodeSymbolReferences({
				cwd,
				symbol: sym.name,
			});
			if (res?.references) {
				setReferences(res.references);
			}
		} catch (e) {
			console.error("[SymbolGraph] References error:", e);
		} finally {
			setLoadingRefs(false);
		}
	};

	const getKindBadgeClass = (kind: SymbolKind) => {
		switch (kind) {
			case "function":
				return "badge-kind-func";
			case "class":
				return "badge-kind-class";
			case "interface":
			case "type":
				return "badge-kind-type";
			case "struct":
				return "badge-kind-struct";
			default:
				return "badge-kind-default";
		}
	};

	return (
		<div className="symbol-graph-panel" role="region" aria-label="全工程代码符号语义图谱">
			{/* Search Header */}
			<div className="symbol-graph-header">
				<div className="symbol-search-input-wrap">
					<Search size={14} className="text-gray-400" />
					<input
						type="text"
						className="symbol-search-input"
						placeholder="搜索函数、类、接口、类型符号..."
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							void handleSearch(e.target.value);
						}}
					/>
					{query && (
						<button
							type="button"
							className="symbol-clear-btn"
							onClick={() => {
								setQuery("");
								void handleSearch("");
							}}
						>
							<X size={12} />
						</button>
					)}
				</div>

				<div className="symbol-filter-pills">
					{KIND_FILTERS.map((f) => (
						<button
							key={f.id}
							type="button"
							className={`symbol-filter-pill ${activeFilter === f.id ? "active" : ""}`}
							onClick={() => setActiveFilter(f.id)}
						>
							{f.label}
						</button>
					))}
				</div>

				{stats && (
					<div className="symbol-index-stats">
						<span>已索引 {stats.totalIndexed} 符号</span>
						<span>•</span>
						<span>{stats.filesIndexed} 代码文件</span>
					</div>
				)}
			</div>

			{/* Main Content Area */}
			<div className="symbol-graph-content">
				{loading ? (
					<div className="symbol-graph-loading">
						<RefreshCw size={18} className="animate-spin text-blue-500" />
						<span>扫描全工程符号图谱...</span>
					</div>
				) : symbols.length === 0 ? (
					<div className="symbol-graph-empty">
						<FileCode size={24} className="text-gray-400 mb-2" />
						<p>未找到匹配的代码符号</p>
					</div>
				) : (
					<div className="symbol-list">
						{symbols.map((sym, idx) => (
							<div
								key={`${sym.filePath}-${sym.line}-${sym.name}-${idx}`}
								className={`symbol-list-item ${selectedSymbol?.name === sym.name ? "selected" : ""}`}
								onClick={() => handleFindReferences(sym)}
							>
								<div className="symbol-item-top">
									<span className={`symbol-kind-tag ${getKindBadgeClass(sym.kind)}`}>
										{sym.kind}
									</span>
									<span className="symbol-name">{sym.name}</span>
									<span className="symbol-location">
										{sym.filePath}:{sym.line}
									</span>
								</div>

								{sym.signature && (
									<div className="symbol-signature">
										<code>{sym.signature}</code>
									</div>
								)}

								<div className="symbol-item-actions">
									<button
										type="button"
										className="symbol-action-btn"
										onClick={(e) => {
											e.stopPropagation();
											void handleFindReferences(sym);
										}}
									>
										查找全工程调用引用
									</button>
									{onInsertReference && (
										<button
											type="button"
											className="symbol-action-btn primary"
											onClick={(e) => {
												e.stopPropagation();
												onInsertReference(sym.name, sym.filePath, sym.line);
											}}
										>
											引用至输入框
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				)}

				{/* Selected Symbol References Drawer */}
				{selectedSymbol && (
					<div className="symbol-references-pane">
						<div className="symbol-ref-header">
							<div className="symbol-ref-title">
								<GitBranch size={13} className="text-blue-500" />
								<span>「{selectedSymbol.name}」的引用与调用点 ({references.length})</span>
							</div>
							<button
								type="button"
								className="symbol-close-ref-btn"
								onClick={() => setSelectedSymbol(null)}
							>
								<X size={13} />
							</button>
						</div>

						<div className="symbol-ref-list">
							{loadingRefs ? (
								<div className="symbol-ref-loading">
									<RefreshCw size={14} className="animate-spin text-blue-500" />
									<span>检索调用点...</span>
								</div>
							) : references.length === 0 ? (
								<div className="symbol-ref-empty">
									<span>全工程中未发现对该符号的显式引用</span>
								</div>
							) : (
								references.map((ref, ridx) => (
									<div
										key={`${ref.filePath}-${ref.line}-${ridx}`}
										className="symbol-ref-item"
										onClick={() => {
											if (onInsertReference) {
												onInsertReference(selectedSymbol.name, ref.filePath, ref.line);
											}
										}}
									>
										<div className="symbol-ref-loc">
											<span>{ref.filePath}</span>
											<span className="symbol-ref-line">L{ref.line}</span>
										</div>
										<code className="symbol-ref-snippet">{ref.lineContent}</code>
									</div>
								))
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
