"use client";

/**
 * Submit button that asks for confirmation before letting its form submit.
 * Used for destructive-ish actions like deactivating an exchange rate, so the
 * user gets a clear "are you sure?" without a full modal system.
 */
export default function ConfirmButton({
  message,
  children,
  className = "text-xs text-gray-500 hover:underline",
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
