import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from "react";
import { cn } from "../../lib/utils";

const Command = forwardRef<ElementRef<typeof CommandPrimitive>, ComponentPropsWithoutRef<typeof CommandPrimitive>>(
	({ className, ...props }, ref) => <CommandPrimitive ref={ref} className={cn("ui-command", className)} {...props} />,
);
Command.displayName = CommandPrimitive.displayName;

const CommandInput = forwardRef<
	ElementRef<typeof CommandPrimitive.Input>,
	ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
	<div className="ui-command-input-wrap" cmdk-input-wrapper="">
		<Search size={14} strokeWidth={2} aria-hidden />
		<CommandPrimitive.Input
			ref={ref}
			className={cn("ui-command-input", className)}
			// Avoid browser default focus ring stacking on top of our styles
			style={{ outline: "none", boxShadow: "none" }}
			{...props}
		/>
	</div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = forwardRef<
	ElementRef<typeof CommandPrimitive.List>,
	ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.List ref={ref} className={cn("ui-command-list", className)} {...props} />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = forwardRef<
	ElementRef<typeof CommandPrimitive.Empty>,
	ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Empty ref={ref} className={cn("ui-command-empty", className)} {...props} />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = forwardRef<
	ElementRef<typeof CommandPrimitive.Group>,
	ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Group ref={ref} className={cn("ui-command-group", className)} {...props} />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandItem = forwardRef<
	ElementRef<typeof CommandPrimitive.Item>,
	ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Item ref={ref} className={cn("ui-command-item", className)} {...props} />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

export { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList };
