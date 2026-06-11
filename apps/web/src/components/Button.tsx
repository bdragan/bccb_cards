import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

const variants = {
  primary:
    "border-felt/35 bg-white text-felt shadow-sm shadow-ink/10 hover:border-felt hover:bg-emerald-50 active:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500",
  selected:
    "border-felt bg-felt text-white shadow-sm shadow-ink/10 hover:border-[#17613f] hover:bg-[#17613f] disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-500",
} as const;

type ButtonVariant = keyof typeof variants;

export function Button({
  children,
  className = "",
  variant = "primary",
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>) {
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-felt disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
