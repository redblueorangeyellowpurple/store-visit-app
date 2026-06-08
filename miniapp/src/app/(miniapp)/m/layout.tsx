import ViewAsControl from "./ViewAsControl";

// Wraps every /m/* screen (tabs + visit/store detail + intel) so the admin
// view-as control floats consistently across the whole mini app. Non-admins
// get zero markup from it — see ViewAsControl.
export default function MiniAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <ViewAsControl />
    </>
  );
}
