import * as React from "react";

import { cn } from "@/lib/utils";

type InputProps = React.ComponentProps<"input"> & { clearable?: boolean };

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", clearable = true, value, onChange, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);

    // attach forwarded ref
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);

    const showClear =
      clearable && typeof value === "string" && value.length > 0 && !props.disabled && type !== "password";

    function handleClear(e: React.MouseEvent) {
      e.preventDefault();
      if (!innerRef.current) return;
      // clear the native value
      innerRef.current.value = "";
      // focus the input after clearing
      innerRef.current.focus();

      // dispatch a native input event so uncontrolled listeners notice (guarded for SSR/build)
      if (typeof Event !== "undefined") {
        const inputEvent = new Event("input", { bubbles: true });
        innerRef.current.dispatchEvent(inputEvent);
      }

      // call React's onChange if provided (controlled inputs)
      if (typeof onChange === "function") {
        const synthetic = { target: innerRef.current } as unknown as React.ChangeEvent<HTMLInputElement>;
        onChange(synthetic);
      }
    }

    return (
      <div className={cn("relative w-full", className && "")}
        // ensure the wrapper shrinks to input size when used inline
      >
        <input
          ref={innerRef}
          type={type}
          value={value}
          onChange={onChange}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            // leave space for the clear button when shown
            showClear ? "pr-9" : "",
          )}
          {...props}
        />

        {showClear && (
          <button
            aria-label="נקה" 
            title="נקה"
            onClick={handleClear}
            className="absolute inset-y-0 right-2 flex items-center justify-center rounded text-muted-foreground hover:text-foreground"
            type="button"
          >
            {/* simple X glyph so we don't add new deps */}
            <span className="select-none text-sm leading-none">×</span>
          </button>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
