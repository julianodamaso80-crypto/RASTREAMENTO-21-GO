import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

function SelectNative({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative w-full">
      <select
        data-slot="select-native"
        className={cn(
          "h-9 w-full appearance-none rounded-lg border border-border bg-input pl-3 pr-9 text-sm text-foreground transition-colors outline-none cursor-pointer",
          "hover:border-border/80 focus-visible:border-brand-orange-500 focus-visible:ring-2 focus-visible:ring-brand-orange-500/30",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "[&>option]:bg-popover [&>option]:text-foreground",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    </div>
  )
}

export { SelectNative }
