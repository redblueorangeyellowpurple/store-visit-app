import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SVA",
  description: "Store Visit App — CM mini app",
};

// Disable iOS auto-zoom on input focus. Telegram WebApp convention.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/*
          Admin view-as shim. Runs before hydration (so it's installed before
          any page fires its data fetch). When an admin has picked a CM to view
          as, the id lives in sessionStorage and this adds it as the X-View-As
          header on every /api/m/* call. sessionStorage clears when the webview
          closes, so view-as resets each time the app is reopened. The swap is
          only honoured server-side for verified admins, so this header is inert
          for everyone else.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(window.__svaViewAsPatched)return;window.__svaViewAsPatched=true;var orig=window.fetch;window.fetch=function(input,init){try{var url=typeof input==="string"?input:(input&&input.url)||"";var t=sessionStorage.getItem("sva_view_as");if(t&&url.indexOf("/api/m/")===0){init=init||{};var h=new Headers(init.headers||(typeof input!=="string"&&input.headers)||{});h.set("X-View-As",t);init.headers=h;}}catch(e){}return orig.call(this,input,init);};})();`,
          }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
