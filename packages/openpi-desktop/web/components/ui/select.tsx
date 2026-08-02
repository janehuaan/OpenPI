import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../../lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

const SelectTrigger = forwardRef<
	ElementRef<typeof SelectPrimitive.Trigger>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Trigger ref={ref} className={cn("ui-select-trigger", className)} {...props}>
		{children}
		<SelectPrimitive.Icon asChild>
			<ChevronDown size={12} />
		</SelectPrimitive.Icon>
	</SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = forwardRef<
	ElementRef<typeof SelectPrimitive.Content>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
	<SelectPrimitive.Portal>
		<SelectPrimitive.Content ref={ref} position={position} className={cn("ui-select-content", className)} {...props}>
			<SelectPrimitive.ScrollUpButton className="ui-select-scroll-button">
				<ChevronUp size={14} />
			</SelectPrimitive.ScrollUpButton>
			<SelectPrimitive.Viewport className="ui-select-viewport">{children}</SelectPrimitive.Viewport>
			<SelectPrimitive.ScrollDownButton className="ui-select-scroll-button">
				<ChevronDown size={14} />
			</SelectPrimitive.ScrollDownButton>
		</SelectPrimitive.Content>
	</SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectItem = forwardRef<
	ElementRef<typeof SelectPrimitive.Item>,
	ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
	<SelectPrimitive.Item ref={ref} className={cn("ui-select-item", className)} {...props}>
		<span className="ui-select-item-indicator">
			<SelectPrimitive.ItemIndicator>
				<Check size={14} />
			</SelectPrimitive.ItemIndicator>
		</span>
		<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
	</SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
