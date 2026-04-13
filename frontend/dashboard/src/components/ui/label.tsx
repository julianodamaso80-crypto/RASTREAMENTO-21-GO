import * as React from "react"
import { cn } from "@/lib/utils"

function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      data-slot="label"
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium text-foreground leading-none select-none",
        className
      )}
      {...props}
    >
      {children}
      {required && <span className="text-destructive" aria-hidden="true">*</span>}
    </label>
  )
}

export { Label }
