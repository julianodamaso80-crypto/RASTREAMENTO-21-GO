import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "w-full min-h-[80px] rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground transition-colors outline-none resize-y",
        "placeholder:text-muted-foreground hover:border-border/80",
        "focus-visible:border-brand-orange-500 focus-visible:ring-2 focus-visible:ring-brand-orange-500/30",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
